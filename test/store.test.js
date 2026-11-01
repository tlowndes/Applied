'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');
const { cvLabel, listCvs, cvUsage } = require('../lib/cvs');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'applied-test-'));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
let n = 0;
const newStore = () => new Store(path.join(ROOT, `s${n++}`, 'applied.json'));

test('adding sets the follow-up from the default gap', () => {
  const s = newStore();
  const a = s.add({ role: ' Product Designer ', company: 'Brightloop', link: 'https://example.com/job' }, '2026-10-31');
  assert.equal(a.role, 'Product Designer');
  assert.equal(a.status, 'applied');
  assert.equal(a.appliedOn, '2026-10-31');
  assert.equal(a.followUpOn, '2026-11-07');
  s.saveSettings({ followUpDays: 3 });
  assert.equal(s.add({ role: 'x', company: 'y' }, '2026-10-31').followUpOn, '2026-11-03');
});

test('saves to disk and loads back', () => {
  const s = newStore();
  s.add({ role: 'UI Designer', company: 'Kestrel' }, '2026-10-31');
  s.saveSettings({ weeklyGoal: 12, theme: 'dark' });
  const again = new Store(s.filePath);
  assert.equal(again.applications[0].company, 'Kestrel');
  assert.equal(again.settings.weeklyGoal, 12);
  assert.equal(again.settings.theme, 'dark');
});

test('a broken file starts fresh and is kept as .bak', () => {
  const file = path.join(ROOT, 'broken', 'applied.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  const s = new Store(file);
  assert.deepEqual(s.applications, []);
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), '{ not json');
});

test('moving out of Applied counts as hearing back', () => {
  const s = newStore();
  const a = s.add({ role: 'x', company: 'y' }, '2026-10-24');
  assert.equal(a.heardBack, false);
  s.move(a.id, 'rejected', '2026-10-31');
  assert.equal(s.get(a.id).heardBack, true);
  assert.equal(s.get(a.id).statusChangedOn, '2026-10-31');
  // Moving it back doesn't undo that they replied.
  s.move(a.id, 'applied');
  assert.equal(s.get(a.id).heardBack, true);
});

test('bad input is ignored', () => {
  const s = newStore();
  const a = s.add({ role: 'x', company: 'y', status: 'hired!', link: 'javascript:alert(1)', appliedOn: 'yesterday', id: 'mine' }, '2026-10-31');
  assert.equal(a.status, 'applied');
  assert.equal(a.link, '');
  assert.equal(a.appliedOn, '2026-10-31');
  assert.notEqual(a.id, 'mine');
  s.saveSettings({ followUpDays: 'lots', reminderTime: '25:99', theme: 'neon', weeklyGoal: -4 });
  assert.equal(s.settings.followUpDays, 7);
  assert.equal(s.settings.reminderTime, '09:00');
  assert.equal(s.settings.theme, 'system');
  assert.equal(s.settings.weeklyGoal, 0);
});

test('snooze and done', () => {
  const s = newStore();
  const a = s.add({ role: 'x', company: 'y' }, '2026-10-20');
  s.followUpDone(a.id);
  assert.equal(s.get(a.id).followUpDone, true);
  s.snooze(a.id, 3, '2026-10-31');
  assert.equal(s.get(a.id).followUpOn, '2026-11-03');
  assert.equal(s.get(a.id).followUpDone, false);
});

test('remove', () => {
  const s = newStore();
  const a = s.add({ role: 'x', company: 'y' });
  assert.equal(s.remove(a.id), true);
  assert.equal(s.remove(a.id), false);
  assert.equal(s.applications.length, 0);
});

test('CV labels', () => {
  assert.equal(cvLabel('Tom Lowndes CV – Product v3.pdf'), 'Product v3');
  assert.equal(cvLabel('C:\\Users\\tom\\Documents\\CVs\\Tom Lowndes CV - UI v2.pdf'), 'UI v2');
  assert.equal(cvLabel('cv.pdf'), 'cv');
  assert.equal(cvLabel(''), '');
});

test('lists CVs in a folder, newest first, skipping other files', () => {
  const dir = path.join(ROOT, 'cvs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CV – Old.pdf'), '');
  fs.writeFileSync(path.join(dir, 'CV – New.docx'), '');
  fs.writeFileSync(path.join(dir, 'notes.txt'), '');
  fs.writeFileSync(path.join(dir, '~$CV – New.docx'), '');
  fs.utimesSync(path.join(dir, 'CV – Old.pdf'), new Date(2026, 0, 1), new Date(2026, 0, 1));
  assert.deepEqual(listCvs(dir).map((c) => c.label), ['New', 'Old']);
  assert.deepEqual(listCvs(path.join(ROOT, 'missing')), []);
});

test('CV usage counts sends and replies', () => {
  const usage = cvUsage([
    { cvPath: 'C:\\CVs\\A.pdf', status: 'applied' },
    { cvPath: 'c:\\cvs\\a.pdf', status: 'interview' },
    { cvPath: '', status: 'offer' },
  ]);
  assert.deepEqual(usage, { 'c:\\cvs\\a.pdf': { sent: 2, heardBack: 1 } });
});
