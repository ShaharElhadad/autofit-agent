const { chromium } = require('playwright');
const { waitForAutoFitCode } = require('./email-code-reader');
const activityLog = require('../config/activity-log');

class AutoFitController {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.lastHealthCheck = null;
    this.baseUrl = 'https://app.auto-fit.co.il';
    this.healthCheckInterval = null;
  }

  // ===================== LIFECYCLE =====================

  async init() {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await this.browser.newContext({
      locale: 'he-IL',
      viewport: { width: 1920, height: 1080 }
    });
    this.page = await context.newPage();
    activityLog.add('info', 'דפדפן הופעל');
  }

  async close() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.browser) await this.browser.close();
    this.isLoggedIn = false;
    activityLog.add('info', 'דפדפן נסגר');
  }

  // ===================== AUTH =====================

  async login() {
    if (!this.page) await this.init();

    try {
      activityLog.add('info', 'מתחבר ל-AutoFit...');
      await this.page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });

      // Check if already logged in
      if (this.page.url().includes('/dashboard')) {
        this.isLoggedIn = true;
        activityLog.add('info', 'כבר מחובר ל-AutoFit');
        this.startHealthCheck();
        return true;
      }

      // Fill email
      const emailInput = await this.page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
      await emailInput.fill(process.env.AUTOFIT_EMAIL);

      // Click login/send code button
      const loginBtn = await this.page.$('button[type="submit"], button:has-text("כניסה"), button:has-text("התחבר"), button:has-text("שלח")');
      if (loginBtn) await loginBtn.click();

      // Wait for 6-digit code input
      await this.page.waitForTimeout(3000);

      const codeInput = await this.page.$('input[maxlength="6"], input[type="tel"], input[placeholder*="קוד"]');
      if (codeInput) {
        activityLog.add('info', 'ממתין לקוד אימות מהמייל...');

        const code = await waitForAutoFitCode(60000);
        activityLog.add('info', `קוד אימות התקבל: ${code.substring(0, 2)}****`);

        await codeInput.fill(code);

        // Submit the code
        const submitBtn = await this.page.$('button[type="submit"], button:has-text("אימות"), button:has-text("אישור"), button:has-text("כניסה")');
        if (submitBtn) await submitBtn.click();
      }

      // Wait for dashboard
      await this.page.waitForURL('**/dashboard**', { timeout: 15000 });
      this.isLoggedIn = true;
      activityLog.add('info', 'התחברות ל-AutoFit הצליחה');

      // Dismiss any popups
      await this.dismissPopups();

      this.startHealthCheck();
      return true;
    } catch (e) {
      activityLog.add('error', `שגיאה בהתחברות: ${e.message}`);
      this.isLoggedIn = false;
      return false;
    }
  }

  async dismissPopups() {
    try {
      const closeBtn = await this.page.$('button:has-text("סגור"), button:has-text("הבנתי"), .close-button');
      if (closeBtn) await closeBtn.click();
      await this.page.waitForTimeout(500);
    } catch {}
  }

  async ensureLoggedIn() {
    if (!this.isLoggedIn) {
      await this.login();
    }
  }

  startHealthCheck() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.page.goto(`${this.baseUrl}/dashboard`, { timeout: 10000 });
        const url = this.page.url();

        if (url.includes('login') || url.includes('auth') || !url.includes('auto-fit')) {
          activityLog.add('error', 'החיבור ל-AutoFit נפל, מתחבר מחדש...');
          this.isLoggedIn = false;
          await this.login();
        } else {
          this.lastHealthCheck = new Date().toISOString();
          await this.dismissPopups();
        }
      } catch (e) {
        activityLog.add('error', `בדיקת חיבור נכשלה: ${e.message}`);
        this.isLoggedIn = false;
        await this.login();
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  // ===================== READ: DASHBOARD =====================

  async getDashboardStats() {
    await this.ensureLoggedIn();
    await this.page.goto(`${this.baseUrl}/dashboard`, { waitUntil: 'networkidle' });
    await this.dismissPopups();

    return await this.page.evaluate(() => {
      const cards = document.querySelectorAll('.info-box, .stat-card, [class*="widget"]');
      const stats = {};

      document.querySelectorAll('[class*="card"], [class*="box"]').forEach(card => {
        const text = card.textContent.trim();
        const num = text.match(/\d+/);
        if (text.includes('חדשים') || text.includes('חדש')) stats.newUsers = num ? parseInt(num[0]) : 0;
        if (text.includes('מתוזמנ')) stats.scheduledMeetings = num ? parseInt(num[0]) : 0;
        if (text.includes('משקל')) stats.noWeightUpdate = num ? parseInt(num[0]) : 0;
        if (text.includes('הודעות') || text.includes('נקרא')) stats.unreadMessages = num ? parseInt(num[0]) : 0;
      });

      return stats;
    });
  }

  // ===================== READ: USERS =====================

  async getAllUsers() {
    await this.ensureLoggedIn();
    await this.page.goto(`${this.baseUrl}/all-users`, { waitUntil: 'networkidle' });
    await this.dismissPopups();
    await this.page.waitForTimeout(2000);

    return await this.page.evaluate(() => {
      const users = [];
      document.querySelectorAll('[class*="user-card"], [class*="card"]').forEach(card => {
        const name = card.querySelector('[class*="name"], h3, h4, strong');
        const email = card.querySelector('[class*="email"], [href*="mailto"]');
        const phone = card.querySelector('[class*="phone"], [href*="tel"]');
        const status = card.textContent.includes('פעיל');

        if (name) {
          users.push({
            name: name.textContent.trim(),
            email: email?.textContent.trim() || '',
            phone: phone?.textContent.trim() || '',
            active: status
          });
        }
      });
      return users;
    });
  }

  // ===================== READ: TODO =====================

  async getTodoList() {
    await this.ensureLoggedIn();
    await this.page.goto(`${this.baseUrl}/dashboard`, { waitUntil: 'networkidle' });
    await this.dismissPopups();

    // Scroll to TODO section
    await this.page.evaluate(() => {
      const el = [...document.querySelectorAll('h2, h3, h4, [class*="title"]')]
        .find(e => e.textContent.includes('לזכור') || e.textContent.includes('לעשות'));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
    await this.page.waitForTimeout(1000);

    return await this.page.evaluate(() => {
      const items = [];
      document.querySelectorAll('[class*="todo"], [class*="task"], [class*="remember"] li, [class*="remember"] [class*="item"]').forEach(el => {
        const text = el.textContent.trim();
        if (text && text.length > 2) {
          items.push({
            text,
            completed: el.classList.contains('completed') ||
              el.querySelector('input[type="checkbox"]:checked') !== null ||
              el.querySelector('[class*="done"], [class*="complete"]') !== null
          });
        }
      });
      return items;
    });
  }

  // ===================== WRITE: TODO =====================

  async addTodoItem(text) {
    await this.ensureLoggedIn();
    await this.page.goto(`${this.baseUrl}/dashboard`, { waitUntil: 'networkidle' });
    await this.dismissPopups();

    // Find and click the add button
    const addBtn = await this.page.$('button:has-text("הוספה")');
    if (!addBtn) throw new Error('לא נמצא כפתור הוספה');

    await addBtn.click();
    await this.page.waitForTimeout(1000);

    // Find input and type
    const input = await this.page.$('input[type="text"]:visible, textarea:visible');
    if (input) {
      await input.fill(text);
      await this.page.waitForTimeout(500);

      // Submit
      const saveBtn = await this.page.$('button:has-text("שמור"), button:has-text("הוסף"), button:has-text("אישור")');
      if (saveBtn) await saveBtn.click();
      await this.page.waitForTimeout(1000);
    }

    activityLog.add('action', `משימה נוספה: "${text}"`);
    return { success: true, item: text };
  }

  // ===================== WRITE: NOTIFICATIONS =====================

  async sendNotification(target, title, body) {
    await this.ensureLoggedIn();
    await this.page.goto(`${this.baseUrl}/notifications`, { waitUntil: 'networkidle' });
    await this.dismissPopups();
    await this.page.waitForTimeout(1000);

    // Select target audience
    if (target === 'all') {
      const allBtn = await this.page.$('button:has-text("כל המשתמשים"), [class*="all-users"]');
      if (allBtn) await allBtn.click();
    }

    // Fill title
    const titleInput = await this.page.$('input[placeholder*="כותרת"], [class*="title"] input');
    if (titleInput) await titleInput.fill(title);

    // Fill body
    const bodyInput = await this.page.$('textarea[placeholder*="תוכן"], textarea[placeholder*="הודעה"], [class*="description"] textarea');
    if (bodyInput) await bodyInput.fill(body);

    await this.page.waitForTimeout(500);

    // Click send
    const sendBtn = await this.page.$('button:has-text("שליחה"), button:has-text("שלח")');
    if (sendBtn) await sendBtn.click();

    await this.page.waitForTimeout(2000);
    activityLog.add('action', `הודעה נשלחה: "${title}"`);
    return { success: true };
  }

  // ===================== READ: MEETINGS =====================

  async getScheduledMeetings() {
    await this.ensureLoggedIn();
    await this.page.goto(`${this.baseUrl}/meetings`, { waitUntil: 'networkidle' });
    await this.dismissPopups();
    await this.page.waitForTimeout(2000);

    return await this.page.evaluate(() => {
      const meetings = [];
      document.querySelectorAll('[class*="event"], [class*="meeting"], [class*="appointment"]').forEach(el => {
        const text = el.textContent.trim();
        if (text) meetings.push({ text, raw: text });
      });
      return meetings;
    });
  }

  // ===================== READ: USER PROFILE =====================

  async getUserProfile(userName) {
    await this.ensureLoggedIn();
    await this.page.goto(`${this.baseUrl}/all-users`, { waitUntil: 'networkidle' });
    await this.dismissPopups();
    await this.page.waitForTimeout(2000);

    // Find and click user
    const userCard = await this.page.$(`text="${userName}"`);
    if (!userCard) throw new Error(`לקוח "${userName}" לא נמצא`);

    // Find the edit button near the user
    const editBtn = await userCard.evaluateHandle(el => {
      const card = el.closest('[class*="card"], [class*="user"]');
      return card?.querySelector('[class*="edit"], a[href*="user-edit"], button[class*="edit"]');
    });

    if (editBtn) {
      await editBtn.click();
    } else {
      await userCard.click();
    }

    await this.page.waitForTimeout(3000);

    return await this.page.evaluate(() => {
      const profile = {};
      document.querySelectorAll('input, select, textarea').forEach(el => {
        const label = el.previousElementSibling?.textContent?.trim() ||
          el.closest('[class*="field"], [class*="form-group"]')?.querySelector('label')?.textContent?.trim() || '';

        if (label && el.value) {
          profile[label] = el.value;
        }
      });
      return profile;
    });
  }
}

module.exports = AutoFitController;
