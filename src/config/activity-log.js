const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../../data/activity-log.json');
const MAX_ENTRIES = 200;

function ensureFile() {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '[]', 'utf-8');
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function add(type, message, details = null) {
  const entries = readAll();
  entries.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    type, // 'info' | 'action' | 'error' | 'whatsapp' | 'report'
    message,
    details
  });

  // Trim to max
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;

  fs.writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2), 'utf-8');
  return entries[0];
}

function getRecent(count = 50) {
  return readAll().slice(0, count);
}

function clear() {
  ensureFile();
  fs.writeFileSync(LOG_PATH, '[]', 'utf-8');
}

module.exports = { add, getRecent, clear };
