'use strict';

const fs = require('fs');
const path = require('path');

const CV_TYPES = ['.pdf', '.docx', '.doc'];

// A short name for a CV, for the card tag. "Tom Lowndes CV – Product v3.pdf" → "Product v3".
function cvLabel(file) {
  if (!file) return '';
  const name = path.basename(String(file).replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
  const parts = name.split(/\s+[-–—]\s+|_-_/);
  const label = parts.length > 1 ? parts[parts.length - 1] : name;
  return label.trim() || name;
}

// The CVs in a folder (not its subfolders), newest first.
function listCvs(folder) {
  if (!folder) return [];
  let names;
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  return names
    .filter((n) => CV_TYPES.includes(path.extname(n).toLowerCase()) && !n.startsWith('~$'))
    .map((n) => {
      const file = path.join(folder, n);
      try {
        const st = fs.statSync(file);
        return st.isFile() ? { file, name: n, label: cvLabel(n), modified: st.mtime.toISOString() } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

// How many applications used each CV, so the CVs page can show which ones get replies.
function cvUsage(apps) {
  const usage = {};
  for (const a of apps) {
    if (!a.cvPath) continue;
    const key = a.cvPath.toLowerCase();
    usage[key] ||= { sent: 0, heardBack: 0 };
    usage[key].sent += 1;
    if (a.heardBack || a.status === 'interview' || a.status === 'offer') usage[key].heardBack += 1;
  }
  return usage;
}

module.exports = { CV_TYPES, cvLabel, listCvs, cvUsage };
