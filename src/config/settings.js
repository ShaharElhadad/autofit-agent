const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '../../data/settings.json');

const DEFAULT_SETTINGS = {
  agent: {
    enabled: true,
    name: 'סוכן AutoFit'
  },
  weeklyReport: {
    enabled: true,
    dayOfWeek: 0, // 0 = Sunday
    time: '09:00',
    metrics: {
      weight: true,
      steps: true,
      training: true,
      nutrition: true,
      water: true,
      measurements: false
    },
    rules: {
      metGoals: 'עידוד + סיכום הישגים',
      missedGoals: 'עידוד עדין + הצעות לשיפור',
      noData: 'תזכורת ידידותית לדווח',
      inactive3days: 'הודעת דאגה אישית'
    },
    excludeInactive: true
  },
  messageTemplate: `שלום {name},

סיכום השבוע שלך:
{metrics}

{personalMessage}

המאמן שלך`
};

function ensureDataDir() {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function load() {
  ensureDataDir();
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function save(settings) {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function get(key) {
  const settings = load();
  return key ? settings[key] : settings;
}

function update(partial) {
  const current = load();
  const merged = deepMerge(current, partial);
  save(merged);
  return merged;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = { load, save, get, update, DEFAULT_SETTINGS };
