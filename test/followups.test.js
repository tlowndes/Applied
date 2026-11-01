'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { followUpState, followUpList, stats, reminderText, isReminderDue } = require('../lib/followups');
const { addDays, daysBetween, weekStart, isDateString } = require('../lib/dates');

const app = (over = {}) => ({ id: Math.random().toString(36), role: 'Designer', company: 'Acme', status: 'applied', appliedOn: '2026-10-24', followUpOn: '2026-10-31', followUpDone: false, ...over });

test('date helpers', () => {
  assert.equal(addDays('2026-10-25', 7), '2026-11-01'); // across the clocks going back
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(daysBetween('2026-10-24', '2026-10-31'), 7);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2); // across the clocks going forward
  assert.equal(weekStart('2026-11-01'), '2026-10-26'); // Sunday → previous Monday
  assert.equal(weekStart('2026-10-26'), '2026-10-26');
  assert.ok(isDateString('2026-02-28'));
  assert.ok(!isDateString('2026-02-30'));
  assert.ok(!isDateString('soon'));
});

test('follow-up states', () => {
  assert.deepEqual(followUpState(app(), '2026-10-31'), { state: 'today', days: 0 });
  assert.deepEqual(followUpState(app(), '2026-11-02'), { state: 'overdue', days: 2 });
  assert.deepEqual(followUpState(app(), '2026-10-27'), { state: 'upcoming', days: 4 });
});

test('no follow-up once done, or once past the Applied stage', () => {
  assert.equal(followUpState(app({ followUpDone: true }), '2026-11-02').state, 'none');
  assert.equal(followUpState(app({ status: 'interview' }), '2026-11-02').state, 'none');
  assert.equal(followUpState(app({ followUpOn: '' }), '2026-11-02').state, 'none');
});

test('follow-up list is soonest first', () => {
  const list = followUpList([app({ company: 'Later', followUpOn: '2026-11-05' }), app({ company: 'Overdue', followUpOn: '2026-10-29' }), app({ status: 'offer' })], '2026-10-31');
  assert.deepEqual(list.map((f) => f.app.company), ['Overdue', 'Later']);
});

test('stats', () => {
  const apps = [
    app({ followUpOn: '2026-10-30' }),
    app({ appliedOn: '2026-10-28', followUpOn: '2026-11-04' }),
    app({ status: 'interview', appliedOn: '2026-10-29' }),
    app({ status: 'offer' }),
    app({ status: 'rejected', heardBack: true }),
    app({ status: 'rejected', heardBack: false }),
  ];
  const s = stats(apps, '2026-10-31', 10);
  assert.equal(s.active, 4);
  assert.equal(s.due, 1);
  assert.equal(s.interviews, 1);
  assert.equal(s.replyRate, 50); // interview, offer and one rejection heard back: 3 of 6
  assert.equal(s.thisWeek, 2); // Mon 26 Oct onwards
  assert.equal(stats([], '2026-10-31').replyRate, null);
});

test('reminder text', () => {
  assert.equal(reminderText([app({ followUpOn: '2026-11-09' })], '2026-10-31'), null);
  assert.deepEqual(reminderText([app({ company: 'Brightloop', role: 'Product Designer' })], '2026-10-31'), {
    title: 'Time to follow up with Brightloop',
    body: 'You applied for Product Designer 7 days ago.',
  });
  const many = reminderText(['A', 'B', 'C', 'D', 'E'].map((c) => app({ company: c })), '2026-10-31');
  assert.equal(many.title, '5 follow-ups due');
  assert.equal(many.body, 'A, B, C and 2 more.');
});

test('daily reminder goes once, after its time', () => {
  const at = (h, m) => new Date(2026, 9, 31, h, m);
  assert.equal(isReminderDue(at(8, 59), '09:00', null), false);
  assert.equal(isReminderDue(at(9, 0), '09:00', null), true);
  assert.equal(isReminderDue(at(14, 0), '09:00', '2026-10-30'), true); // PC was off at 9
  assert.equal(isReminderDue(at(14, 0), '09:00', '2026-10-31'), false);
});
