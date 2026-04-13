const activityLog = require('../config/activity-log');
const settings = require('../config/settings');

class WhatsAppBot {
  constructor(controller) {
    this.controller = controller;
    this.isConnected = false;
    this.phone = null;
    this.instanceId = process.env.GREEN_API_INSTANCE_ID;
    this.token = process.env.GREEN_API_TOKEN;
    this.baseUrl = `https://api.green-api.com/waInstance${this.instanceId}`;
    this.allowedNumbers = (process.env.ALLOWED_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);
    this.polling = null;
  }

  // ===================== LIFECYCLE =====================

  async start() {
    if (!this.instanceId || !this.token) {
      activityLog.add('error', 'GreenAPI credentials missing');
      return;
    }

    activityLog.add('info', 'מתחבר ל-WhatsApp...');

    // Check connection
    try {
      const state = await this.apiCall('getStateInstance');
      this.isConnected = state?.stateInstance === 'authorized';
      if (this.isConnected) {
        activityLog.add('info', 'WhatsApp מחובר');
      } else {
        activityLog.add('error', `WhatsApp לא מחובר (${state?.stateInstance})`);
      }
    } catch (e) {
      activityLog.add('error', `שגיאה בחיבור WhatsApp: ${e.message}`);
    }

    // Start polling for messages
    this.startPolling();
  }

  stop() {
    if (this.polling) clearInterval(this.polling);
  }

  // ===================== POLLING =====================

  startPolling() {
    this.polling = setInterval(async () => {
      try {
        const notification = await this.apiCall('receiveNotification');
        if (notification?.body) {
          await this.handleNotification(notification);
          // Delete the notification after processing
          await this.apiCall(`deleteNotification/${notification.receiptId}`);
        }
      } catch (e) {
        // Silence polling errors
      }
    }, 3000);
  }

  // ===================== MESSAGE HANDLING =====================

  async handleNotification(notification) {
    const body = notification.body;

    // Only handle incoming messages
    if (body.typeWebhook !== 'incomingMessageReceived') return;

    const chatId = body.senderData?.chatId;
    const senderNumber = chatId?.replace('@c.us', '');
    const message = body.messageData?.textMessageData?.textMessage;

    if (!message || !chatId) return;

    // Check whitelist
    if (this.allowedNumbers.length > 0 && !this.allowedNumbers.includes(senderNumber)) {
      return; // Ignore unauthorized numbers
    }

    // Check if agent is enabled
    if (!settings.get('agent')?.enabled) {
      await this.sendMessage(chatId, 'הסוכן מושבת כרגע. הפעל אותו דרך לוח הבקרה.');
      return;
    }

    activityLog.add('whatsapp', `הודעה מ-${senderNumber}: "${message.substring(0, 50)}..."`);

    try {
      const response = await this.processMessage(message);
      await this.sendMessage(chatId, response);
      activityLog.add('whatsapp', `תשובה נשלחה ל-${senderNumber}`);
    } catch (e) {
      activityLog.add('error', `שגיאה בעיבוד הודעה: ${e.message}`);
      await this.sendMessage(chatId, 'סליחה, נתקלתי בשגיאה. אנסה שוב בקרוב.');
    }
  }

  // ===================== INTENT DETECTION (Hebrew NLP) =====================

  async processMessage(message) {
    const msg = message.trim().toLowerCase();

    // --- Dashboard / Stats ---
    if (match(msg, ['דשבורד', 'סטטיסטיקות', 'מצב כללי', 'סיכום'])) {
      const stats = await this.controller.getDashboardStats();
      return formatDashboard(stats);
    }

    // --- Users list ---
    if (match(msg, ['כל הלקוחות', 'רשימת לקוחות', 'כל המשתמשים', 'תראה לי את כל'])) {
      const users = await this.controller.getAllUsers();
      return formatUsersList(users);
    }

    // --- TODO list ---
    if (match(msg, ['משימות', 'לעשות', 'רשימת המשימות', 'מה יש לעשות', 'todo'])) {
      const todos = await this.controller.getTodoList();
      return formatTodos(todos);
    }

    // --- Add TODO ---
    if (match(msg, ['תוסיף משימה', 'הוסף משימה', 'תוסיף לרשימה'])) {
      const text = message.replace(/תוסיף משימה[:\s]*/i, '').replace(/הוסף משימה[:\s]*/i, '').trim();
      if (!text) return 'מה המשימה? כתוב: תוסיף משימה: [תוכן המשימה]';
      await this.controller.addTodoItem(text);
      return `המשימה נוספה: "${text}"`;
    }

    // --- Meetings ---
    if (match(msg, ['פגישות', 'אימונים', 'מתי יש לי', 'לוח', 'מפגשים'])) {
      const meetings = await this.controller.getScheduledMeetings();
      return formatMeetings(meetings);
    }

    // --- Who didn't update ---
    if (match(msg, ['לא עדכן', 'לא שלח', 'מי לא', 'לא דיווח'])) {
      const stats = await this.controller.getDashboardStats();
      return `${stats.noWeightUpdate || '?'} לקוחות לא עדכנו משקל.`;
    }

    // --- Messages ---
    if (match(msg, ['הודעות', 'הודעות חדשות', 'יש הודעות'])) {
      const stats = await this.controller.getDashboardStats();
      const count = stats.unreadMessages || 0;
      return count > 0 ? `יש ${count} הודעות שלא נקראו.` : 'אין הודעות חדשות.';
    }

    // --- Specific user ---
    if (match(msg, ['מה המצב של', 'פרופיל של', 'תראה לי את', 'מידע על'])) {
      const name = extractName(message);
      if (!name) return 'על איזה לקוח? כתוב: מה המצב של [שם]';
      try {
        const profile = await this.controller.getUserProfile(name);
        return formatProfile(name, profile);
      } catch (e) {
        return `לא הצלחתי למצוא את "${name}": ${e.message}`;
      }
    }

    // --- Send notification ---
    if (match(msg, ['תשלח הודעה', 'תשלח לכולם', 'שלח הודעה'])) {
      return 'כדי לשלוח הודעה, השתמש בלוח הבקרה באתר (כפתור "שליחת הודעה").';
    }

    // --- Help ---
    if (match(msg, ['עזרה', 'מה אתה יכול', 'פקודות', 'help'])) {
      return HELP_TEXT;
    }

    // --- Default ---
    return 'לא הבנתי. כתוב "עזרה" לרשימת הפקודות, או שאל שאלה על הלקוחות שלך.';
  }

  // ===================== SEND =====================

  async sendMessage(chatId, text) {
    return this.apiCall('sendMessage', {
      chatId,
      message: text
    });
  }

  // ===================== API =====================

  async apiCall(method, body = null) {
    const url = `${this.baseUrl}/${method}/${this.token}`;
    const opts = {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    return res.json();
  }
}

// ===================== HELPERS =====================

function match(msg, keywords) {
  return keywords.some(k => msg.includes(k));
}

function extractName(msg) {
  const patterns = [
    /(?:המצב של|פרופיל של|תראה לי את|מידע על)\s+(.+)/,
    /(?:משקל של|צעדים של|אימונים של|תזונה של)\s+(.+)/,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m) return m[1].trim().replace(/[?!.,]$/, '');
  }
  return null;
}

function formatDashboard(stats) {
  return `סיכום דשבורד:
- לקוחות חדשים השבוע: ${stats.newUsers ?? '?'}
- מפגשים מתוזמנים: ${stats.scheduledMeetings ?? '?'}
- לא עדכנו משקל: ${stats.noWeightUpdate ?? '?'}
- הודעות לא נקראו: ${stats.unreadMessages ?? '?'}`;
}

function formatUsersList(users) {
  if (!users.length) return 'לא נמצאו לקוחות.';
  const active = users.filter(u => u.active);
  const inactive = users.filter(u => !u.active);
  let text = `סה"כ ${users.length} לקוחות (${active.length} פעילים):\n\n`;
  text += users.map(u => `${u.active ? '' : '[לא פעיל] '}${u.name}`).join('\n');
  return text;
}

function formatTodos(todos) {
  if (!todos.length) return 'אין משימות ברשימה.';
  return 'רשימת משימות:\n' + todos.map((t, i) =>
    `${i + 1}. ${t.completed ? '[V] ' : '[ ] '}${t.text}`
  ).join('\n');
}

function formatMeetings(meetings) {
  if (!meetings.length) return 'אין פגישות מתוזמנות.';
  return 'פגישות:\n' + meetings.map(m => `- ${m.text}`).join('\n');
}

function formatProfile(name, profile) {
  const lines = [`פרופיל: ${name}\n`];
  for (const [key, value] of Object.entries(profile)) {
    if (value && key.length < 30) {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

const HELP_TEXT = `מה אני יכול לעשות:

- "דשבורד" / "סיכום" - סטטיסטיקות מהירות
- "כל הלקוחות" - רשימת כל הלקוחות
- "מה המצב של [שם]" - מידע על לקוח
- "מי לא עדכן משקל?" - מי לא דיווח
- "יש הודעות חדשות?" - הודעות לא נקראו
- "פגישות" - מפגשים מתוזמנים
- "משימות" - רשימת המשימות
- "תוסיף משימה: [טקסט]" - הוספת משימה

שליחת הודעות ועדכונים שבועיים - דרך לוח הבקרה באתר.`;

module.exports = WhatsAppBot;
