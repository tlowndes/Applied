'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The only way the UI talks to the main process.
contextBridge.exposeInMainWorld('applied', {
  getState: () => ipcRenderer.invoke('get-state'),
  add: (fields) => ipcRenderer.invoke('add-application', fields),
  update: (id, fields) => ipcRenderer.invoke('update-application', id, fields),
  move: (id, status) => ipcRenderer.invoke('move-application', id, status),
  remove: (id) => ipcRenderer.invoke('delete-application', id),
  followUpDone: (id) => ipcRenderer.invoke('follow-up-done', id),
  snooze: (id, days) => ipcRenderer.invoke('snooze', id, days),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  fetchJobAd: (url) => ipcRenderer.invoke('fetch-job-ad', url),
  clipboardLink: () => ipcRenderer.invoke('clipboard-link'),
  openLink: (url) => ipcRenderer.invoke('open-link', url),
  openCv: (file) => ipcRenderer.invoke('open-cv', file),
  showCv: (file) => ipcRenderer.invoke('show-cv', file),
  openCvFolder: () => ipcRenderer.invoke('open-cv-folder'),
  pickCv: () => ipcRenderer.invoke('pick-cv'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onStateChanged: (cb) => ipcRenderer.on('state-changed', () => cb()),
  onShowPage: (cb) => ipcRenderer.on('show-page', (_e, page) => cb(page)),
  onAddApplication: (cb) => ipcRenderer.on('add-application', () => cb()),
});
