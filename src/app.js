'use strict';

/* global applied */

const COLUMNS = [
  { id: 'applied', label: 'Applied', empty: 'Nothing waiting. Add one from a job ad link.' },
  { id: 'interview', label: 'Interview', empty: 'Drag a card here when they get in touch.' },
  { id: 'offer', label: 'Offer', empty: 'Fingers crossed.' },
  { id: 'rejected', label: 'Rejected', empty: 'Nothing here, long may it last.' },
];

let state = null;
let search = '';
let editingId = null;
let followUpChoice = 7; // days, or 'pick'
let filledFields = [];

const $ = (id) => document.getElementById(id);

// Builds an element. Text is always set with textContent, so nothing typed or fetched
// can ever be run as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICON_BELL = '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/></svg>';
function bell() {
  const span = document.createElement('span');
  span.innerHTML = ICON_BELL; // fixed markup, no user text
  return span.firstChild;
}

// ---------- Dates ----------

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function dayString(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(s, n) {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return dayString(d);
}
function daysBetween(a, b) {
  const da = parseDay(a);
  const db = parseDay(b);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
}
function niceDate(s, withDay = false) {
  const d = parseDay(s);
  if (!d) return '';
  const opts = { day: 'numeric', month: 'short' };
  if (withDay) opts.weekday = 'short';
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}
// "2026-11-04T10:00" → "Tue 4 Nov, 10:00"
function niceDateTime(s) {
  if (!s) return '';
  const date = niceDate(s, true);
  const time = /T(\d{2}:\d{2})/.exec(s);
  return time ? `${date}, ${time[1]}` : date;
}
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---------- Helpers ----------

function logoClass(name) {
  let hash = 0;
  for (const ch of String(name || '?')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `logo c${hash % 8}`;
}

function cvLabel(file) {
  if (!file) return '';
  const name = file.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  const parts = name.split(/\s+[-–—]\s+|_-_/);
  return (parts.length > 1 ? parts[parts.length - 1] : name).trim() || name;
}

function followUp(app) {
  return state.followUps.find((f) => f.id === app.id) || { state: 'none' };
}

function followUpTag(app) {
  const f = followUp(app);
  if (f.state === 'overdue') return h('span', { class: 'tag due' }, bell(), `${plural(f.days, 'day')} overdue`);
  if (f.state === 'today') return h('span', { class: 'tag due' }, bell(), 'Follow up today');
  if (f.state === 'upcoming') return h('span', { class: 'tag soon' }, `Follow up in ${plural(f.days, 'day')}`);
  if (app.status === 'applied' && app.followUpDone) return h('span', { class: 'tag' }, 'Followed up');
  return null;
}

function matches(app) {
  if (!search) return true;
  const hay = `${app.role} ${app.company} ${app.location} ${app.notes}`.toLowerCase();
  return search.split(/\s+/).every((w) => hay.includes(w));
}

let toastTimer = null;
function toast(text, undo) {
  $('toast-text').textContent = text;
  $('toast-undo').hidden = !undo;
  $('toast-undo').onclick = async () => { hideToast(); await undo(); };
  $('toast').classList.remove('hide');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 6000 : 3000);
}
function hideToast() {
  $('toast').classList.add('hide');
}

// ---------- Board ----------

function card(app) {
  const tags = [];
  if (app.status === 'applied') {
    tags.push(followUpTag(app));
  } else if (app.status === 'interview' || app.status === 'offer') {
    if (app.nextStep || app.nextStepAt) {
      const text = [app.nextStep, niceDateTime(app.nextStepAt)].filter(Boolean).join(' · ');
      tags.push(h('span', { class: app.status === 'offer' ? 'tag ok' : 'tag int' }, text));
    }
  } else if (app.status === 'rejected') {
    tags.push(h('span', { class: 'tag' }, `Closed ${niceDate(app.statusChangedOn)}`));
  }
  if (app.status === 'offer' && app.salary) tags.push(h('span', { class: 'tag' }, app.salary));
  if (app.cvPath && app.status !== 'rejected') tags.push(h('span', { class: 'tag', title: app.cvPath }, `CV · ${cvLabel(app.cvPath)}`));

  const sub = [app.company, app.location].filter(Boolean).join(' · ');
  const el = h('button', {
    class: `card${app.status === 'rejected' ? ' muted' : ''}`,
    draggable: 'true',
    'data-id': app.id,
    title: 'Open, or drag to another column',
    onclick: () => openModal(app),
    ondragstart: (e) => {
      e.dataTransfer.setData('text/plain', app.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    },
    ondragend: () => el.classList.remove('dragging'),
  },
  h('div', { class: 'card-top' },
    h('div', { class: logoClass(app.company), 'aria-hidden': 'true' }, (app.company || app.role || '?').trim().charAt(0).toUpperCase()),
    h('div', {}, h('div', { class: 'role' }, app.role || 'Untitled role'), h('div', { class: 'co' }, sub))),
  tags.filter(Boolean).length ? h('div', { class: 'tags' }, tags.filter(Boolean)) : null);
  return el;
}

// Applied: follow-ups due first, then newest. Others: most recently moved first.
function sortFor(column, apps) {
  if (column === 'applied') {
    return apps.sort((a, b) => (a.followUpOn || '9').localeCompare(b.followUpOn || '9') || b.appliedOn.localeCompare(a.appliedOn));
  }
  if (column === 'interview') {
    return apps.sort((a, b) => (a.nextStepAt || '9').localeCompare(b.nextStepAt || '9'));
  }
  return apps.sort((a, b) => (b.statusChangedOn || '').localeCompare(a.statusChangedOn || ''));
}

function renderBoard() {
  const s = state.stats;
  $('stat-active').textContent = s.active;
  $('stat-due').textContent = s.due;
  $('stat-due-card').classList.toggle('warn', s.due > 0);
  $('stat-interviews').textContent = s.interviews;
  $('stat-reply').textContent = s.replyRate == null ? '–' : `${s.replyRate}%`;

  const wrap = $('columns');
  wrap.replaceChildren(...COLUMNS.map((col) => {
    const all = state.applications.filter((a) => a.status === col.id);
    const shown = sortFor(col.id, all.filter(matches));
    const el = h('div', { class: `col ${col.id}`, 'data-status': col.id },
      h('div', { class: 'col-head' }, h('span', { class: 'dot' }), col.label, h('span', { class: 'n' }, all.length)),
      shown.map(card),
      shown.length ? null : h('div', { class: 'col-empty' }, search && all.length ? 'No matches' : col.empty));
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      const app = state.applications.find((a) => a.id === id);
      if (!app || app.status === col.id) return;
      const from = app.status;
      await applied.move(id, col.id);
      await load();
      toast(`Moved to ${col.label}`, async () => { await applied.move(id, from); await load(); });
    });
    return el;
  }));
}

// ---------- Follow-ups ----------

function renderFollowUps() {
  const list = $('followups-list');
  const items = state.followUps.map((f) => ({ ...f, app: state.applications.find((a) => a.id === f.id) })).filter((f) => f.app);
  const due = items.filter((f) => f.state !== 'upcoming');
  const soon = items.filter((f) => f.state === 'upcoming');
  $('followups-sub').textContent = due.length
    ? `${plural(due.length, 'follow-up')} due. A short, friendly email is plenty.`
    : 'Nothing due. You\'ll get a nudge when something is.';

  const row = (f) => {
    const { app } = f;
    const when = f.state === 'overdue' ? `${plural(f.days, 'day')} overdue`
      : f.state === 'today' ? 'Due today' : `Due ${niceDate(app.followUpOn, true)}`;
    const ago = daysBetween(app.appliedOn, state.today);
    return h('div', { class: 'row' },
      h('div', { class: logoClass(app.company), 'aria-hidden': 'true' }, (app.company || '?').charAt(0).toUpperCase()),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, `${app.role} · ${app.company}`),
        h('div', { class: 'row-meta' }, `Applied ${ago <= 0 ? 'today' : `${plural(ago, 'day')} ago`} · ${when}`)),
      h('div', { class: 'row-actions' },
        app.link ? h('button', { class: 'btn btn-sm', onclick: () => applied.openLink(app.link) }, 'Open ad') : null,
        h('button', { class: 'btn btn-sm', onclick: () => openModal(app) }, 'Details'),
        h('button', { class: 'btn btn-sm', onclick: async () => { await applied.snooze(app.id, 3); await load(); toast('Snoozed for 3 days'); } }, 'Snooze 3 days'),
        h('button', { class: 'btn btn-sm btn-primary', onclick: async () => { await applied.followUpDone(app.id); await load(); toast(`Nice one. Marked ${app.company} as followed up`); } }, 'Done')));
  };

  if (!items.length) {
    list.replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'All caught up'), 'Follow-ups appear here for applications still waiting to hear back.'));
    return;
  }
  list.replaceChildren(...[
    due.length ? h('div', { class: 'section-title' }, 'Due now') : null,
    ...due.map(row),
    soon.length ? h('div', { class: 'section-title' }, 'Coming up') : null,
    ...soon.map(row),
  ].filter(Boolean));
}

// ---------- CVs ----------

function renderCvs() {
  const folder = state.settings.cvFolder;
  $('cv-folder-path').textContent = folder || 'No CV folder chosen';
  const list = $('cvs-list');
  if (!state.cvs.length) {
    list.replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'No CVs found'),
      `Save your CVs as PDFs in ${folder || 'a folder'} and they'll show up here. Name them like "Your Name CV – Product v3.pdf" and the bit after the dash becomes the label.`));
    return;
  }
  list.replaceChildren(...state.cvs.map((cv) => {
    const use = state.cvUsage[cv.file.toLowerCase()] || { sent: 0, heardBack: 0 };
    const ext = cv.name.split('.').pop().toUpperCase();
    const usage = use.sent ? `Sent ${plural(use.sent, 'time')} · heard back from ${use.heardBack}` : 'Not sent yet';
    return h('div', { class: 'row' },
      h('div', { class: `pdf${ext === 'PDF' ? '' : ' doc'}` }, ext === 'PDF' ? 'PDF' : 'DOC'),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, cv.label),
        h('div', { class: 'row-meta' }, `${cv.name} · edited ${niceDate(cv.modified.slice(0, 10))} · ${usage}`)),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-sm', onclick: () => applied.showCv(cv.file) }, 'Show in folder'),
        h('button', { class: 'btn btn-sm', onclick: () => applied.openCv(cv.file) }, 'Open')));
  }));
}

// ---------- Settings ----------

function renderSettings() {
  const s = state.settings;
  if (document.activeElement !== $('set-followup')) $('set-followup').value = s.followUpDays;
  if (document.activeElement !== $('set-goal')) $('set-goal').value = s.weeklyGoal;
  if (document.activeElement !== $('set-reminder')) $('set-reminder').value = s.reminderTime;
  $('set-startup').checked = s.startWithWindows;
  $('set-updates').checked = s.autoUpdate;
  for (const b of $('set-theme').children) b.classList.toggle('on', b.dataset.theme === s.theme);
  const u = state.update;
  const status = {
    unavailable: 'Updates work in the installed app.',
    checking: 'Checking for updates…',
    downloading: `Downloading ${u.version}…`,
    'up-to-date': 'You\'re up to date.',
    ready: `Version ${u.version} is ready. Restart to install it.`,
    error: 'Couldn\'t check for updates just now.',
  }[u.status] || 'Installs new versions next time Applied restarts.';
  $('version-text').textContent = `Version ${u.current}. ${status}`;
  $('update-bar').hidden = u.status !== 'ready';
  $('update-text').textContent = `Applied ${u.version} is ready.`;
}

function renderSidebar() {
  const s = state.stats;
  $('due-count').hidden = !s.due;
  $('due-count').textContent = s.due;
  $('goal').hidden = !s.weeklyGoal;
  $('goal-title').textContent = `${s.thisWeek} of ${s.weeklyGoal} this week`;
  $('goal-bar').style.width = `${Math.min(100, s.weeklyGoal ? (s.thisWeek / s.weeklyGoal) * 100 : 0)}%`;
}

function render() {
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
  renderSidebar();
  renderBoard();
  renderFollowUps();
  renderCvs();
  renderSettings();
}

async function load() {
  state = await applied.getState();
  render();
}

function showPage(page) {
  for (const b of document.querySelectorAll('.nav-btn')) b.classList.toggle('active', b.dataset.page === page);
  for (const p of document.querySelectorAll('.page')) p.classList.toggle('active', p.id === page);
}

// ---------- Add / edit ----------

function setTag(field, text, auto) {
  $(`t-${field}`).textContent = text;
  $(`f-${field}`).classList.toggle('auto', !!auto);
}

function renderFollowUpChoice() {
  const def = state.settings.followUpDays;
  const options = [...new Set([3, def, 14])].sort((a, b) => a - b);
  $('f-followup').replaceChildren(...options.map((d) => h('button', {
    type: 'button',
    class: followUpChoice === d ? 'on' : '',
    onclick: () => { followUpChoice = d; renderFollowUpChoice(); },
  }, plural(d, 'day'))), h('button', {
    type: 'button',
    class: followUpChoice === 'pick' ? 'on' : '',
    onclick: () => {
      followUpChoice = 'pick';
      if (!$('f-followup-date').value) $('f-followup-date').value = addDays($('f-applied').value || state.today, def);
      renderFollowUpChoice();
    },
  }, 'Pick date'));
  $('f-followup-date').hidden = followUpChoice !== 'pick';
  $('t-followup').textContent = followUpChoice === 'pick' ? '' : `Default ${plural(def, 'day')}`;
}

function renderCvOptions(selected) {
  const options = state.cvs.map((cv) => h('option', { value: cv.file, selected: cv.file === selected }, `${cv.label}  (${cv.name})`));
  if (selected && !state.cvs.some((cv) => cv.file === selected)) {
    options.unshift(h('option', { value: selected, selected: true }, `${cvLabel(selected)}  (${selected.split(/[\\/]/).pop()})`));
  }
  options.unshift(h('option', { value: '', selected: !selected }, state.cvs.length ? 'No CV linked' : 'No CVs in your CV folder yet'));
  $('f-cv').replaceChildren(...options);
}

function updateStageFields() {
  const status = $('f-status').value;
  $('next-field').hidden = !editingId || !['interview', 'offer'].includes(status);
  $('followup-field').hidden = !!editingId && status !== 'applied';
}

async function openModal(app = null) {
  editingId = app ? app.id : null;
  filledFields = [];
  const v = app || {};
  $('modal-title').textContent = app ? `${app.role || 'Application'}` : 'Add an application';
  $('modal-sub').textContent = app ? `${app.company}${app.appliedOn ? ` · applied ${niceDate(app.appliedOn)}` : ''}` : "Paste the job ad link. I'll fill in what I can, you tidy the rest.";
  $('f-link').value = v.link || '';
  for (const f of ['role', 'company', 'location', 'salary']) {
    $(`f-${f}`).value = v[f] || '';
    setTag(f, '', false);
  }
  $('f-applied').value = v.appliedOn || state.today;
  $('t-applied').textContent = app ? '' : 'Today';
  $('f-status').value = v.status || 'applied';
  $('f-next').value = v.nextStep || '';
  $('f-next-at').value = v.nextStepAt || '';
  $('f-notes').value = v.notes || '';
  $('fetch-note').hidden = true;
  $('status-field').hidden = !app;
  $('delete-btn').hidden = !app;
  $('open-ad-btn').hidden = !(app && app.link);
  $('save-btn').textContent = app ? 'Save' : 'Add to Applied';

  // Follow-up: match an existing date to one of the buttons where possible.
  const def = state.settings.followUpDays;
  followUpChoice = def;
  $('f-followup-date').value = '';
  if (app && app.followUpOn) {
    const gap = daysBetween(app.appliedOn, app.followUpOn);
    if ([3, def, 14].includes(gap)) followUpChoice = gap;
    else { followUpChoice = 'pick'; $('f-followup-date').value = app.followUpOn; }
  }
  renderFollowUpChoice();
  renderCvOptions(v.cvPath || (app ? '' : (state.cvs[0] && state.cvs[0].file) || ''));
  updateStageFields();

  $('modal').showModal();
  if (!app) {
    const link = await applied.clipboardLink();
    if (link && !$('f-link').value) {
      $('f-link').value = link;
      fetchAd();
    } else {
      $('f-link').focus();
    }
  }
}

async function fetchAd() {
  const url = $('f-link').value.trim();
  if (!url) { $('f-link').focus(); return; }
  const note = $('fetch-note');
  note.hidden = false;
  note.classList.remove('error');
  $('fetch-text').textContent = 'Reading the job ad…';
  $('fetch-btn').disabled = true;
  const result = await applied.fetchJobAd(url);
  $('fetch-btn').disabled = false;
  if (!result.ok) {
    note.classList.add('error');
    $('fetch-text').textContent = result.message;
    $('f-role').focus();
    return;
  }
  filledFields = [];
  for (const f of ['role', 'company', 'location', 'salary']) {
    if (result[f]) {
      $(`f-${f}`).value = result[f];
      setTag(f, 'From link', true);
      filledFields.push(f);
    }
  }
  $('f-link').value = result.link;
  $('fetch-text').textContent = `Filled ${plural(filledFields.length, 'field')} from the ad. Check them before saving.`;
}

function formFields() {
  const appliedOn = $('f-applied').value || state.today;
  const followUpOn = followUpChoice === 'pick' ? ($('f-followup-date').value || addDays(appliedOn, state.settings.followUpDays)) : addDays(appliedOn, followUpChoice);
  const fields = {
    link: $('f-link').value.trim(),
    role: $('f-role').value,
    company: $('f-company').value,
    location: $('f-location').value,
    salary: $('f-salary').value,
    appliedOn,
    followUpOn,
    cvPath: $('f-cv').value,
    notes: $('f-notes').value,
  };
  if (editingId) {
    fields.status = $('f-status').value;
    fields.nextStep = $('f-next').value;
    fields.nextStepAt = $('f-next-at').value;
    const app = state.applications.find((a) => a.id === editingId);
    // A new follow-up date means a new follow-up, so it's no longer "done".
    if (app && app.followUpOn !== followUpOn) fields.followUpDone = false;
  }
  return fields;
}

async function save(e) {
  e.preventDefault();
  if (!$('f-role').value.trim() || !$('f-company').value.trim()) {
    (!$('f-role').value.trim() ? $('f-role') : $('f-company')).focus();
    return;
  }
  const fields = formFields();
  if (editingId) {
    await applied.update(editingId, fields);
    toast('Saved');
  } else {
    await applied.add(fields);
    toast(`Added ${fields.company}. Follow-up ${niceDate(fields.followUpOn, true)}`);
  }
  $('modal').close();
  await load();
}

async function remove() {
  const app = state.applications.find((a) => a.id === editingId);
  if (!app) return;
  await applied.remove(app.id);
  $('modal').close();
  await load();
  toast(`Deleted ${app.role} at ${app.company}`, async () => { await applied.add(app); await load(); });
}

// ---------- Wiring ----------

function saveSetting(settings) {
  applied.saveSettings(settings).then((s) => { state = s; render(); });
}

for (const b of document.querySelectorAll('.nav-btn')) b.addEventListener('click', () => showPage(b.dataset.page));
$('search').addEventListener('input', (e) => { search = e.target.value.trim().toLowerCase(); renderBoard(); });
$('add-btn').addEventListener('click', () => openModal());
$('fetch-btn').addEventListener('click', fetchAd);
$('f-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchAd(); } });
$('f-link').addEventListener('paste', () => setTimeout(fetchAd, 0));
$('f-status').addEventListener('change', updateStageFields);
$('f-applied').addEventListener('change', () => { $('t-applied').textContent = ''; });
for (const f of ['role', 'company', 'location', 'salary']) {
  $(`f-${f}`).addEventListener('input', () => setTag(f, filledFields.includes(f) ? 'Edited' : '', false));
}
$('browse-cv').addEventListener('click', async () => {
  const file = await applied.pickCv();
  if (file) renderCvOptions(file);
});
$('app-form').addEventListener('submit', save);
$('cancel-btn').addEventListener('click', () => $('modal').close());
$('delete-btn').addEventListener('click', remove);
$('open-ad-btn').addEventListener('click', () => applied.openLink($('f-link').value));
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').close(); });

$('set-followup').addEventListener('change', (e) => saveSetting({ followUpDays: e.target.value }));
$('set-goal').addEventListener('change', (e) => saveSetting({ weeklyGoal: e.target.value }));
$('set-reminder').addEventListener('change', (e) => saveSetting({ reminderTime: e.target.value }));
$('set-startup').addEventListener('change', (e) => saveSetting({ startWithWindows: e.target.checked }));
$('set-updates').addEventListener('change', (e) => saveSetting({ autoUpdate: e.target.checked }));
for (const b of $('set-theme').children) b.addEventListener('click', () => saveSetting({ theme: b.dataset.theme }));
$('check-updates').addEventListener('click', () => applied.checkUpdates().then((s) => { state = s; render(); }));
$('update-btn').addEventListener('click', () => applied.installUpdate());
$('open-cv-folder').addEventListener('click', () => applied.openCvFolder());
$('change-cv-folder').addEventListener('click', async () => {
  const folder = await applied.pickFolder();
  if (folder) saveSetting({ cvFolder: folder });
});

applied.onStateChanged(load);
applied.onShowPage(showPage);
applied.onAddApplication(() => { showPage('board'); openModal(); });

load();
