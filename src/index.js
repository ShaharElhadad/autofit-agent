require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');
const activityLog = require('./config/activity-log');
const AutoFitController = require('./browser/autofit-controller');
const WhatsAppBot = require('./whatsapp/greenapi-bot');
const WeeklyReportScheduler = require('./scheduler/weekly-reports');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', apiRoutes);

// Serve the UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ============ BOOT ============

async function boot() {
  // 1. Start web server first (so UI is available)
  app.listen(PORT, () => {
    console.log(`AutoFit Agent running on http://localhost:${PORT}`);
    activityLog.add('info', `הסוכן הופעל - http://localhost:${PORT}`);
  });

  // 2. Init Playwright + AutoFit controller
  const controller = new AutoFitController();
  app.set('controller', controller);

  try {
    await controller.init();
    await controller.login();
  } catch (e) {
    activityLog.add('error', `שגיאה בהפעלת דפדפן: ${e.message}`);
  }

  // 3. Init WhatsApp bot
  const whatsapp = new WhatsAppBot(controller);
  app.set('whatsapp', whatsapp);

  try {
    await whatsapp.start();
  } catch (e) {
    activityLog.add('error', `שגיאה בהפעלת WhatsApp: ${e.message}`);
  }

  // 4. Init weekly scheduler
  const scheduler = new WeeklyReportScheduler(controller);
  app.set('scheduler', scheduler);
  scheduler.start();
}

boot().catch(e => {
  console.error('Boot failed:', e);
  activityLog.add('error', `הפעלה נכשלה: ${e.message}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  activityLog.add('info', 'הסוכן נכבה');
  const controller = app.get('controller');
  const whatsapp = app.get('whatsapp');
  if (whatsapp) whatsapp.stop();
  if (controller) await controller.close();
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  activityLog.add('error', `שגיאה לא צפויה: ${err.message}`);
});
