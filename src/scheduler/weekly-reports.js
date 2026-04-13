const cron = require('node-cron');
const settings = require('../config/settings');
const activityLog = require('../config/activity-log');

class WeeklyReportScheduler {
  constructor(controller) {
    this.controller = controller;
    this.cronJob = null;
  }

  start() {
    this.schedule();
    activityLog.add('info', 'מנגנון עדכונים שבועיים הופעל');
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  schedule() {
    this.stop();

    const config = settings.get('weeklyReport');
    if (!config?.enabled) return;

    const day = config.dayOfWeek ?? 0;
    const [hour, minute] = (config.time || '09:00').split(':').map(Number);

    // Cron: minute hour * * dayOfWeek
    const cronExpr = `${minute} ${hour} * * ${day}`;

    this.cronJob = cron.schedule(cronExpr, async () => {
      activityLog.add('report', 'התחלת שליחת עדכונים שבועיים...');
      await this.runNow();
    }, { timezone: 'Asia/Jerusalem' });

    const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    activityLog.add('info', `עדכון שבועי מתוזמן: יום ${days[day]} ב-${config.time}`);
  }

  async runNow() {
    const config = settings.get('weeklyReport');
    const template = settings.get('messageTemplate') || settings.DEFAULT_SETTINGS.messageTemplate;

    if (!this.controller?.isLoggedIn) {
      activityLog.add('error', 'לא ניתן לשלוח עדכונים - לא מחובר ל-AutoFit');
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    try {
      const users = await this.controller.getAllUsers();
      const activeUsers = config?.excludeInactive !== false
        ? users.filter(u => u.active)
        : users;

      for (const user of activeUsers) {
        try {
          const message = await this.buildMessage(user, config, template);

          await this.controller.sendNotification(
            user.name,
            'סיכום שבועי',
            message
          );

          sent++;
          await sleep(2000); // Rate limiting between sends
        } catch (e) {
          failed++;
          activityLog.add('error', `שגיאה בשליחה ל-${user.name}: ${e.message}`);
        }
      }

      activityLog.add('report', `עדכון שבועי הושלם: ${sent} נשלחו, ${failed} נכשלו`);
    } catch (e) {
      activityLog.add('error', `שגיאה בתהליך העדכון השבועי: ${e.message}`);
    }

    return { sent, failed };
  }

  async buildMessage(user, config, template) {
    const metrics = config?.metrics || {};
    const lines = [];

    if (metrics.weight) lines.push('- משקל: יעודכן בקרוב');
    if (metrics.steps) lines.push('- צעדים: יעודכן בקרוב');
    if (metrics.training) lines.push('- אימונים: יעודכן בקרוב');
    if (metrics.nutrition) lines.push('- תזונה: יעודכן בקרוב');
    if (metrics.water) lines.push('- שתייה: יעודכן בקרוב');

    const metricsText = lines.join('\n');
    const personalMessage = 'המשך כך! שבוע מצוין מחכה לך.';

    return template
      .replace('{name}', user.name)
      .replace('{metrics}', metricsText)
      .replace('{personalMessage}', personalMessage);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = WeeklyReportScheduler;
