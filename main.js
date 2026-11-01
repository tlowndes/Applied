'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, nativeTheme, shell, dialog, clipboard, net } = require('electron');
const path = require('path');
const os = require('os');
const { Store } = require('./lib/store');
const { stats, followUpList, reminderText, isReminderDue } = require('./lib/followups');
const { listCvs, cvUsage } = require('./lib/cvs');
const { parseJobAd } = require('./lib/jobad');
const { toDateString } = require('./lib/dates');
const { Updater } = require('./lib/updater');

const DATA_DIR = path.join(app.getPath('appData'), 'applied');
const DEFAULT_CV_FOLDER = path.join(os.homedir(), 'Documents', 'CVs');

// Matches build.appId, so Windows ties notifications and the taskbar entry to the app's icon.
if (process.platform === 'win32') app.setAppUserModelId('uk.co.tomlowndes.applied');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const store = new Store(path.join(DATA_DIR, 'applied.json'), { cvFolder: DEFAULT_CV_FOLDER });
let win = null;
let tray = null;
let rebuildTray = () => {};

const ICON_PATH = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const TRAY_ICON_PATH = process.platform === 'win32' ? ICON_PATH : path.join(__dirname, 'assets', 'tray.png');

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON_PATH });
  if (onClick) n.on('click', onClick);
  n.show();
}

function today() {
  return toDateString();
}

function state() {
  const t = today();
  const apps = store.applications;
  return {
    today: t,
    applications: apps,
    settings: store.settings,
    dark: nativeTheme.shouldUseDarkColors,
    stats: stats(apps, t, store.settings.weeklyGoal),
    followUps: followUpList(apps, t).map((f) => ({ id: f.app.id, state: f.state, days: f.days })),
    cvs: listCvs(store.settings.cvFolder),
    cvUsage: cvUsage(apps),
    update: { status: updater.status, version: updater.version, current: app.getVersion() },
  };
}

function refresh() {
  if (win && !win.isDestroyed()) win.webContents.send('state-changed');
  rebuildTray();
}

const updater = new Updater({
  app,
  notify,
  isEnabled: () => store.settings.autoUpdate,
  onChange: () => refresh(),
});

function showPage(page) {
  if (!win) return;
  win.show();
  win.focus();
  win.webContents.send('show-page', page);
}

// Sends the daily follow-up nudge once the reminder time has passed. Checked every minute.
function sendReminderIfDue(now = new Date()) {
  const { reminderTime, reminderLastSent } = store.settings;
  if (!isReminderDue(now, reminderTime, reminderLastSent)) return;
  const text = reminderText(store.applications, toDateString(now));
  if (text) notify(text.title, text.body, () => showPage('followups'));
  store.settings.reminderLastSent = toDateString(now);
  store.save();
  // The board's "due" chips change at midnight too, so redraw once a day here.
  refresh();
}

// Fetches a job ad and pulls out what it can. Never throws: on failure it says why, so
// the form can ask for the details by hand.
async function fetchJobAd(url) {
  let parsed;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    return { ok: false, message: "That doesn't look like a web link." };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, message: 'Only web links (http or https) can be read.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await net.fetch(parsed.href, {
      signal: controller.signal,
      headers: { 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-GB,en;q=0.9' },
    });
    if (!res.ok) return { ok: false, message: `The site said no (error ${res.status}). Fill it in by hand.` };
    const html = (await res.text()).slice(0, 3_000_000);
    const ad = parseJobAd(html, res.url || parsed.href);
    if (!ad.filled.length) return { ok: false, message: "Couldn't find the job details on that page. Fill it in by hand." };
    return { ok: true, link: parsed.href, ...ad };
  } catch (err) {
    const message = err.name === 'AbortError' ? 'The page took too long to load.' : "Couldn't reach that page.";
    return { ok: false, message: `${message} Fill it in by hand.` };
  } finally {
    clearTimeout(timer);
  }
}

// Only files the app already knows about can be opened: a listed CV or one an application uses.
function isKnownCv(file) {
  const f = String(file || '').toLowerCase();
  if (!f) return false;
  return listCvs(store.settings.cvFolder).some((cv) => cv.file.toLowerCase() === f)
    || store.applications.some((a) => (a.cvPath || '').toLowerCase() === f);
}

function applyTheme() {
  nativeTheme.themeSource = store.settings.theme;
}

function setLoginItem(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Applied',
    icon: ICON_PATH,
    show: !process.argv.includes('--hidden'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121514' : '#f4f3ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  // Links in notes or job ads open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    // Closing the window hides it; the app keeps running in the tray for reminders.
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (icon.isEmpty()) console.warn(`Tray icon not found at ${TRAY_ICON_PATH}`);
  tray = new Tray(icon);
  rebuildTray = () => {
    if (!tray) return;
    const due = stats(store.applications, today()).due;
    tray.setToolTip(due ? `Applied: ${due} follow-up${due === 1 ? '' : 's'} due` : 'Applied');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open', click: () => showPage('board') },
      { label: 'Add from link…', click: () => { showPage('board'); win.webContents.send('add-application'); } },
      { label: due ? `Follow-ups (${due} due)` : 'Follow-ups', click: () => showPage('followups') },
      { type: 'separator' },
      updater.status === 'ready'
        ? { label: `Restart to update (${updater.version})`, click: () => updater.installNow() }
        : { label: 'Check for updates', click: () => updater.check(true) },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
  };
  rebuildTray();
  tray.on('click', () => showPage('board'));
}

ipcMain.handle('get-state', () => state());
ipcMain.handle('add-application', (_e, fields) => { const a = store.add(fields); refresh(); return a; });
ipcMain.handle('update-application', (_e, id, fields) => { const a = store.update(id, fields); refresh(); return a; });
ipcMain.handle('move-application', (_e, id, status) => { const a = store.move(id, status); refresh(); return a; });
ipcMain.handle('delete-application', (_e, id) => { const ok = store.remove(id); refresh(); return ok; });
ipcMain.handle('follow-up-done', (_e, id) => { const a = store.followUpDone(id); refresh(); return a; });
ipcMain.handle('snooze', (_e, id, days) => { const a = store.snooze(id, Number(days) || 3); refresh(); return a; });
ipcMain.handle('save-settings', (_e, settings) => {
  store.saveSettings(settings);
  applyTheme();
  setLoginItem(store.settings.startWithWindows);
  refresh();
  return state();
});
ipcMain.handle('fetch-job-ad', (_e, url) => fetchJobAd(url));
ipcMain.handle('clipboard-link', async () => {
  // Newer Electron versions return a promise here; await works either way.
  const text = String((await clipboard.readText()) || '').trim();
  return /^https?:\/\/\S+$/i.test(text) ? text : '';
});
ipcMain.handle('open-link', (_e, url) => {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
});
ipcMain.handle('open-cv', (_e, file) => (isKnownCv(file) ? shell.openPath(file) : 'Not a known CV'));
ipcMain.handle('show-cv', (_e, file) => { if (isKnownCv(file)) shell.showItemInFolder(file); });
ipcMain.handle('open-cv-folder', () => shell.openPath(store.settings.cvFolder));
ipcMain.handle('pick-cv', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose the CV you sent',
    defaultPath: store.settings.cvFolder || undefined,
    filters: [{ name: 'CVs', extensions: ['pdf', 'docx', 'doc'] }],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose your CV folder',
    defaultPath: store.settings.cvFolder || undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('check-updates', () => { updater.check(true); return state(); });
ipcMain.handle('install-update', () => updater.installNow());

app.whenReady().then(() => {
  applyTheme();
  createWindow();
  createTray();
  setLoginItem(store.settings.startWithWindows);
  updater.start();
  sendReminderIfDue();
  setInterval(() => sendReminderIfDue(), 60 * 1000);
  nativeTheme.on('updated', () => refresh());
  app.on('activate', () => win.show());
});

app.on('second-instance', () => showPage('board'));

app.on('before-quit', () => {
  updater.stop();
  store.save();
});
