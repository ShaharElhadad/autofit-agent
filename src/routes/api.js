const express = require('express');
const router = express.Router();
const settings = require('../config/settings');
const activityLog = require('../config/activity-log');

// ============ STATUS ============

router.get('/status', (req, res) => {
  const app = req.app;
  const controller = app.get('controller');
  const whatsapp = app.get('whatsapp');

  res.json({
    agent: {
      running: settings.get('agent')?.enabled ?? true,
      uptime: process.uptime()
    },
    autofit: {
      connected: controller?.isLoggedIn ?? false,
      lastCheck: controller?.lastHealthCheck ?? null
    },
    whatsapp: {
      connected: whatsapp?.isConnected ?? false,
      phone: whatsapp?.phone ?? null
    }
  });
});

// ============ SETTINGS ============

router.get('/settings', (req, res) => {
  res.json(settings.load());
});

router.post('/settings', (req, res) => {
  const updated = settings.update(req.body);
  activityLog.add('info', 'ההגדרות עודכנו');
  res.json(updated);
});

// ============ ACTIVITY LOG ============

router.get('/logs', (req, res) => {
  const count = parseInt(req.query.count) || 50;
  res.json(activityLog.getRecent(count));
});

router.delete('/logs', (req, res) => {
  activityLog.clear();
  res.json({ ok: true });
});

// ============ AGENT CONTROL ============

router.post('/agent/toggle', (req, res) => {
  const current = settings.get('agent');
  const newState = !current.enabled;
  settings.update({ agent: { enabled: newState } });
  activityLog.add('action', newState ? 'הסוכן הופעל' : 'הסוכן הושבת');
  res.json({ enabled: newState });
});

// ============ MANUAL ACTIONS ============

router.post('/action/send-message', async (req, res) => {
  const { target, title, body } = req.body;
  const controller = req.app.get('controller');

  if (!controller?.isLoggedIn) {
    return res.status(503).json({ error: 'לא מחובר ל-AutoFit' });
  }

  try {
    await controller.sendNotification(target, title, body);
    activityLog.add('action', `נשלחה הודעה: "${title}" ל-${target === 'all' ? 'כל הלקוחות' : target}`);
    res.json({ ok: true });
  } catch (e) {
    activityLog.add('error', `שגיאה בשליחת הודעה: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

router.post('/action/add-todo', async (req, res) => {
  const { text } = req.body;
  const controller = req.app.get('controller');

  if (!controller?.isLoggedIn) {
    return res.status(503).json({ error: 'לא מחובר ל-AutoFit' });
  }

  try {
    await controller.addTodoItem(text);
    activityLog.add('action', `נוספה משימה: "${text}"`);
    res.json({ ok: true });
  } catch (e) {
    activityLog.add('error', `שגיאה בהוספת משימה: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

router.post('/action/test-weekly', async (req, res) => {
  const scheduler = req.app.get('scheduler');
  if (!scheduler) {
    return res.status(503).json({ error: 'מנגנון עדכונים לא מוגדר' });
  }

  try {
    const result = await scheduler.runNow();
    activityLog.add('report', `נשלחו ${result.sent} עדכונים שבועיים (בדיקה)`);
    res.json(result);
  } catch (e) {
    activityLog.add('error', `שגיאה בשליחת עדכונים: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ============ AUTOFIT DATA ============

router.get('/users', async (req, res) => {
  const controller = req.app.get('controller');
  if (!controller?.isLoggedIn) {
    return res.status(503).json({ error: 'לא מחובר ל-AutoFit' });
  }

  try {
    const users = await controller.getAllUsers();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/dashboard', async (req, res) => {
  const controller = req.app.get('controller');
  if (!controller?.isLoggedIn) {
    return res.status(503).json({ error: 'לא מחובר ל-AutoFit' });
  }

  try {
    const stats = await controller.getDashboardStats();
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
