'use strict';

const { daysBetween, weekStart, toDateString } = require('./dates');

const STATUSES = ['applied', 'interview', 'offer', 'rejected'];
const ACTIVE = ['applied', 'interview', 'offer'];

// Where an application's follow-up stands today. Only applications still waiting to hear
// back get follow-ups; once it moves to Interview the conversation's already going.
// Returns { state: 'overdue' | 'today' | 'upcoming' | 'none', days }.
function followUpState(app, today) {
  if (app.status !== 'applied' || !app.followUpOn || app.followUpDone) return { state: 'none', days: 0 };
  const days = daysBetween(today, app.followUpOn);
  if (days < 0) return { state: 'overdue', days: -days };
  if (days === 0) return { state: 'today', days: 0 };
  return { state: 'upcoming', days };
}

function isDue(app, today) {
  const { state } = followUpState(app, today);
  return state === 'overdue' || state === 'today';
}

// Due first (most overdue at the top), then the next ones coming up.
function followUpList(apps, today) {
  return apps
    .map((app) => ({ app, ...followUpState(app, today) }))
    .filter((f) => f.state !== 'none')
    .sort((a, b) => (a.app.followUpOn < b.app.followUpOn ? -1 : a.app.followUpOn > b.app.followUpOn ? 1 : 0));
}

// The numbers along the top of the board.
function stats(apps, today, weeklyGoal = 10) {
  const total = apps.length;
  const heard = apps.filter((a) => a.heardBack || a.status === 'interview' || a.status === 'offer').length;
  const monday = weekStart(today);
  return {
    active: apps.filter((a) => ACTIVE.includes(a.status)).length,
    due: apps.filter((a) => isDue(a, today)).length,
    interviews: apps.filter((a) => a.status === 'interview').length,
    replyRate: total ? Math.round((heard / total) * 100) : null,
    thisWeek: apps.filter((a) => a.appliedOn && a.appliedOn >= monday && a.appliedOn <= today).length,
    weeklyGoal,
  };
}

// Text for the daily nudge, or null when nothing's due.
function reminderText(apps, today) {
  const due = followUpList(apps, today).filter((f) => f.state !== 'upcoming');
  if (!due.length) return null;
  if (due.length === 1) {
    const { app } = due[0];
    const ago = daysBetween(app.appliedOn || today, today);
    return {
      title: `Time to follow up with ${app.company || 'them'}`,
      body: `You applied for ${app.role || 'the role'}${ago > 0 ? ` ${ago} day${ago === 1 ? '' : 's'} ago` : ''}.`,
    };
  }
  const names = due.slice(0, 3).map((f) => f.app.company || f.app.role).join(', ');
  return {
    title: `${due.length} follow-ups due`,
    body: `${names}${due.length > 3 ? ` and ${due.length - 3} more` : ''}.`,
  };
}

// True once the daily reminder time has passed today and it hasn't gone out yet today.
// If the PC was off at that time, it goes out as soon as the app is running again.
function isReminderDue(now, time, lastSentDay) {
  const today = toDateString(now);
  if (lastSentDay === today) return false;
  const [h, m] = String(time || '09:00').split(':').map(Number);
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}

module.exports = { STATUSES, ACTIVE, followUpState, isDue, followUpList, stats, reminderText, isReminderDue };
