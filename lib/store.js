'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STATUSES } = require('./followups');
const { toDateString, addDays, isDateString } = require('./dates');

const DEFAULT_SETTINGS = {
  followUpDays: 7,
  weeklyGoal: 10,
  cvFolder: '',
  reminderTime: '09:00',
  reminderLastSent: null,
  theme: 'system', // 'system', 'light' or 'dark'
  startWithWindows: false,
  autoUpdate: true,
};

// Text fields an application can have, and how long each may be.
const TEXT_FIELDS = { role: 200, company: 200, location: 200, salary: 100, link: 2000, notes: 5000, nextStep: 200, nextStepAt: 40, cvPath: 1000 };
const DATE_FIELDS = ['appliedOn', 'followUpOn'];

function cleanFields(input) {
  const out = {};
  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    if (key in input) out[key] = String(input[key] ?? '').trim().slice(0, max);
  }
  for (const key of DATE_FIELDS) {
    if (key in input) out[key] = isDateString(input[key]) ? String(input[key]).slice(0, 10) : '';
  }
  if ('status' in input && STATUSES.includes(input.status)) out.status = input.status;
  if ('followUpDone' in input) out.followUpDone = !!input.followUpDone;
  // Only web links can be opened from the app.
  if (out.link && !/^https?:\/\//i.test(out.link)) out.link = '';
  return out;
}

// Applications and settings, kept in one JSON file. Missing or broken files start fresh;
// a broken file is kept alongside as .bak so nothing is lost.
class Store {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = defaults;
    this.data = this.load();
  }

  load() {
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        try { fs.copyFileSync(this.filePath, `${this.filePath}.bak`); } catch { /* nothing to keep */ }
      }
      saved = {};
    }
    return {
      applications: Array.isArray(saved.applications) ? saved.applications : [],
      settings: { ...DEFAULT_SETTINGS, ...this.defaults, ...(saved.settings || {}) },
    };
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Write then rename, so a crash mid-save never leaves a half-written file.
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  get applications() {
    return this.data.applications;
  }

  get settings() {
    return this.data.settings;
  }

  get(id) {
    return this.data.applications.find((a) => a.id === id) || null;
  }

  add(input, today = toDateString()) {
    const fields = cleanFields(input);
    const appliedOn = fields.appliedOn || today;
    const app = {
      id: crypto.randomUUID(),
      role: '', company: '', location: '', salary: '', link: '', notes: '', nextStep: '', nextStepAt: '', cvPath: '',
      status: 'applied',
      followUpDone: false,
      heardBack: false,
      createdAt: new Date().toISOString(),
      ...fields,
      appliedOn,
      followUpOn: fields.followUpOn || addDays(appliedOn, this.settings.followUpDays),
      statusChangedOn: today,
    };
    if (app.status !== 'applied') app.heardBack = true;
    this.data.applications.unshift(app);
    this.save();
    return app;
  }

  update(id, input, today = toDateString()) {
    const app = this.get(id);
    if (!app) return null;
    const fields = cleanFields(input);
    if (fields.status && fields.status !== app.status) {
      app.statusChangedOn = today;
      // Hearing anything back, even a no, counts towards the reply rate.
      if (app.status === 'applied') app.heardBack = true;
    }
    Object.assign(app, fields);
    this.save();
    return app;
  }

  move(id, status, today = toDateString()) {
    return this.update(id, { status }, today);
  }

  followUpDone(id) {
    return this.update(id, { followUpDone: true });
  }

  snooze(id, days = 3, today = toDateString()) {
    return this.update(id, { followUpOn: addDays(today, days), followUpDone: false }, today);
  }

  remove(id) {
    const before = this.data.applications.length;
    this.data.applications = this.data.applications.filter((a) => a.id !== id);
    if (this.data.applications.length === before) return false;
    this.save();
    return true;
  }

  saveSettings(input) {
    const s = this.settings;
    if ('followUpDays' in input) s.followUpDays = Math.min(60, Math.max(1, Math.round(Number(input.followUpDays)) || 7));
    if ('weeklyGoal' in input) s.weeklyGoal = Math.min(100, Math.max(0, Math.round(Number(input.weeklyGoal)) || 0));
    if ('cvFolder' in input) s.cvFolder = String(input.cvFolder || '');
    if ('reminderTime' in input && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.reminderTime)) s.reminderTime = input.reminderTime;
    if ('theme' in input && ['system', 'light', 'dark'].includes(input.theme)) s.theme = input.theme;
    if ('startWithWindows' in input) s.startWithWindows = !!input.startWithWindows;
    if ('autoUpdate' in input) s.autoUpdate = !!input.autoUpdate;
    this.save();
    return s;
  }
}

module.exports = { Store, DEFAULT_SETTINGS, cleanFields };
