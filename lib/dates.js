'use strict';

// Dates are stored as local 'YYYY-MM-DD' strings, so "today" means today where Tom is,
// and a follow-up never drifts by a day across the clocks changing.

function toDateString(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function isDateString(s) {
  const d = parseDate(s);
  return !!d && toDateString(d) === String(s).slice(0, 10);
}

function addDays(s, days) {
  const d = parseDate(s);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

// Whole days from a to b (b later = positive).
function daysBetween(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
}

// The Monday of the week a date falls in. UK weeks start on Monday.
function weekStart(s) {
  const d = parseDate(s);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return toDateString(d);
}

module.exports = { toDateString, parseDate, isDateString, addDays, daysBetween, weekStart };
