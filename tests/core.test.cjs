const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../dist/core.js');
function fixture() { const d = C.initial(); d.goals.push({ id: 'g', title: '毕业作品', why: '', createdAt: Date.now(), steps: [{ id: 's', text: '画一张草图', done: false, completedAt: null, dueDate: null, priority: 'normal' }] }); return d; }
function legacyFixture() { const d = fixture(); d.version = 1; for (const field of ['dates', 'preferences', 'pomodoroCount', 'mode']) delete d[field]; for (const step of d.goals[0].steps) { delete step.dueDate; delete step.priority; } return d; }
test('empty backup and fallback selections round-trip', () => { assert.deepEqual(C.validate(C.initial()), C.initial()); assert.equal(C.validate(fixture()).selectedStep, 's'); });
test('reject damaged backups, duplicate IDs and excessive text without altering input', () => { const d = fixture(); d.goals[0].steps.push({ ...d.goals[0].steps[0] }); assert.throws(() => C.validate(d)); assert.equal(d.goals[0].steps.length, 2); assert.throws(() => C.validate({ version: 2, goals: [], sessions: [] })); const long = fixture(); long.goals[0].title = 'x'.repeat(101); assert.throws(() => C.validate(long)); });
test('running timers use wall clock, paused timers do not', () => { assert.equal(C.remaining({ status: 'running', endsAt: 10000 }, 3500), 6500); assert.equal(C.remaining({ status: 'running', endsAt: 10000 }, 11000), 0); assert.equal(C.remaining({ status: 'paused', remaining: 1234 }, 99999), 1234); });
test('restore expired timer but reject orphan or completed task timer', () => { const d = fixture(); d.timer = { kind: 'focus', goalId: 'g', stepId: 's', status: 'running', duration: 600000, remaining: 600000, endsAt: Date.now() - 1000 }; assert.ok(C.validate(d).timer); d.goals[0].steps[0].done = true; assert.throws(() => C.validate(d)); });
test('weekly totals use local calendar dates, include empty days and exclude older history', () => { const now = new Date(2026, 9, 17, 12).getTime(); const sessions = [{ finishedAt: now, seconds: 600 }, { finishedAt: new Date(2026, 9, 16, 23, 59).getTime(), seconds: 1500 }, { finishedAt: new Date(2026, 9, 9, 12).getTime(), seconds: 999 }]; const days = C.week(sessions, now); assert.equal(days.length, 7); assert.equal(days[6].seconds, 600); assert.equal(days[5].seconds, 1500); assert.equal(days.reduce((a, d) => a + d.seconds, 0), 2100); });
test('backup import keeps user content as text and strips unexpected fields', () => { const d = fixture(); d.goals[0].title = '<img src=x onerror=alert(1)>'; d.admin = true; const result = C.validate(d); assert.equal(result.goals[0].title, d.goals[0].title); assert.equal(result.admin, undefined); });

const sessionAt = (year, month, day, seconds, hour = 12, minute = 0) => ({ finishedAt: new Date(year, month - 1, day, hour, minute).getTime(), seconds });
test('annual totals include every month, preserve empty months and count each active date once', () => {
  const sessions = [sessionAt(2026, 1, 4, 1500), sessionAt(2026, 1, 4, 600, 18), sessionAt(2026, 1, 9, 30), sessionAt(2026, 10, 17, 2700), sessionAt(2026, 2, 1, 0)];
  const before = JSON.stringify(sessions), annual = C.annual(sessions, 2026);
  assert.equal(annual.months.length, 12);
  assert.deepEqual(annual.months[0], { month: 1, seconds: 2130, count: 3, activeDays: 2 });
  assert.deepEqual(annual.months[1], { month: 2, seconds: 0, count: 0, activeDays: 0 });
  assert.deepEqual(annual.months[9], { month: 10, seconds: 2700, count: 1, activeDays: 1 });
  assert.equal(annual.seconds, 4830); assert.equal(annual.count, 4); assert.equal(annual.activeDays, 3);
  assert.equal(JSON.stringify(sessions), before);
});
test('year and month boundaries use local completion dates rather than UTC dates', () => {
  const sessions = [sessionAt(2025, 12, 31, 60, 23, 59), sessionAt(2026, 1, 1, 120, 0, 1), sessionAt(2026, 1, 31, 180, 23, 59), sessionAt(2026, 2, 1, 240, 0, 1), sessionAt(2027, 1, 1, 300, 0, 1)];
  assert.equal(C.annual(sessions, 2025).seconds, 60);
  const annual = C.annual(sessions, 2026);
  assert.equal(annual.seconds, 540); assert.equal(annual.months[0].seconds, 300); assert.equal(annual.months[1].seconds, 240);
  assert.equal(C.annual(sessions, 2027).seconds, 300);
});
test('leap day belongs to February and repeated sessions do not double-count active days', () => {
  const sessions = [sessionAt(2024, 2, 28, 60), sessionAt(2024, 2, 29, 120, 0, 1), sessionAt(2024, 2, 29, 180, 23, 59), sessionAt(2024, 3, 1, 240, 0, 1)];
  const annual = C.annual(sessions, 2024);
  assert.deepEqual(annual.months[1], { month: 2, seconds: 360, count: 3, activeDays: 2 });
  assert.deepEqual(annual.months[2], { month: 3, seconds: 240, count: 1, activeDays: 1 });
  assert.equal(annual.activeDays, 3);
});
test('year navigation includes current year and recorded past years only, in chronological order', () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  assert.deepEqual(C.focusYears([], now), [2026]);
  const sessions = [sessionAt(2024, 1, 1, 60), sessionAt(2020, 12, 31, 60), sessionAt(2024, 2, 29, 60), sessionAt(2027, 1, 1, 60)];
  assert.deepEqual(C.focusYears(sessions, now), [2020, 2024, 2026]);
});
test('old version-one backups retain all historical sessions for annual statistics', () => {
  const data = legacyFixture();
  data.sessions = [2023, 2024, 2025, 2026].map(year => ({ ...sessionAt(year, 6, 1, 600), id: `history-${year}`, goalTitle: '历史目标', stepTitle: '历史行动' }));
  const restored = C.validate(JSON.parse(JSON.stringify(data)));
  assert.equal(restored.version, 2); assert.deepEqual(restored.sessions, data.sessions);
  assert.equal(C.annual(restored.sessions, 2023).seconds, 600);
  assert.equal(C.annual([], 2026).seconds, 0); assert.equal(C.annual([], 2026).months.length, 12);
});

test('version-one migration preserves goal IDs, task status, selection and an active timer', () => {
  const data = legacyFixture(); data.selectedGoal = 'g'; data.selectedStep = 's'; data.minutes = 45;
  data.timer = { goalId: 'g', stepId: 's', status: 'paused', duration: 2700000, remaining: 1200000, endsAt: Date.now() };
  const original = JSON.stringify(data), migrated = C.validate(data);
  assert.equal(JSON.stringify(data), original);
  assert.equal(C.key, 'next-small-step.v1'); assert.equal(migrated.version, 2); assert.equal(migrated.minutes, 45);
  assert.deepEqual(migrated.timer, { kind: 'focus', ...data.timer });
  assert.equal(migrated.goals[0].steps[0].dueDate, null); assert.equal(migrated.goals[0].steps[0].priority, 'normal');
  assert.deepEqual(migrated.preferences, { shortBreak: 5, longBreak: 15, cycles: 4 });
  assert.deepEqual(migrated.dates, []); assert.equal(migrated.pomodoroCount, 0); assert.equal(migrated.mode, 'focus');
});

test('version-two backup round-trips scheduled tasks, important dates and custom pomodoro settings', () => {
  const data = fixture(); data.selectedGoal = 'g'; data.selectedStep = 's'; data.minutes = 90;
  Object.assign(data.goals[0].steps[0], { dueDate: '2028-02-29', priority: 'high' });
  data.dates = [{ id: 'event', title: '作品提交', date: '2028-02-29', category: '学习', repeat: 'yearly', pinned: true }];
  data.preferences = { shortBreak: 7, longBreak: 30, cycles: 6 }; data.pomodoroCount = 12; data.mode = 'longBreak';
  data.timer = { kind: 'longBreak', goalId: null, stepId: null, status: 'paused', duration: 1800000, remaining: 780000, endsAt: Date.now() };
  assert.deepEqual(C.validate(JSON.parse(JSON.stringify(data))), data);
});

test('reject malformed scheduling fields and out-of-range settings without changing the backup', () => {
  const badChanges = [
    d => { d.goals[0].steps[0].dueDate = '2026-02-29'; }, d => { d.goals[0].steps[0].priority = 'urgent'; },
    d => { delete d.goals[0].steps[0].dueDate; }, d => { d.minutes = 4; }, d => { d.minutes = 181; }, d => { d.minutes = 5.5; },
    d => { d.preferences.shortBreak = 0; }, d => { d.preferences.longBreak = 61; }, d => { d.preferences.cycles = 1; },
    d => { d.pomodoroCount = -1; }, d => { d.pomodoroCount = 2.5; }, d => { d.mode = 'automatic'; },
    d => { d.dates = [{ id: 's', title: '重复 ID', date: '2026-12-01', category: '', repeat: 'none', pinned: false }]; },
    d => { d.dates = [{ id: 'e', title: '事件', date: '2026-13-01', category: '', repeat: 'none', pinned: false }]; },
    d => { d.dates = [{ id: 'e', title: '事件', date: '2026-12-01', category: 'x'.repeat(33), repeat: 'none', pinned: false }]; },
    d => { d.dates = [{ id: 'e', title: '事件', date: '2026-12-01', category: '', repeat: 'weekly', pinned: false }]; },
    d => { d.dates = [{ id: 'e', title: '事件', date: '2026-12-01', category: '', repeat: 'none', pinned: 'true' }]; },
    d => { d.dates = Array.from({ length: 201 }, (_, i) => ({ id: `e${i}`, title: '事件', date: '2026-12-01', category: '', repeat: 'none', pinned: false })); }
  ];
  for (const change of badChanges) { const data = fixture(); change(data); const before = JSON.stringify(data); assert.throws(() => C.validate(data)); assert.equal(JSON.stringify(data), before); }
});

test('custom focus and break timers enforce independent duration and task constraints', () => {
  const data = fixture(); data.minutes = 180;
  data.timer = { kind: 'focus', goalId: 'g', stepId: 's', status: 'running', duration: 10800000, remaining: 10800000, endsAt: Date.now() + 10800000 };
  assert.equal(C.validate(data).timer.duration, 10800000);
  data.timer.duration += 60000; assert.throws(() => C.validate(data));
  data.mode = 'shortBreak'; data.timer = { kind: 'shortBreak', goalId: null, stepId: null, status: 'paused', duration: 60000, remaining: 20000, endsAt: Date.now() };
  assert.equal(C.validate(data).timer.goalId, null);
  data.timer.goalId = 'g'; assert.throws(() => C.validate(data)); data.timer.goalId = null;
  data.timer.duration = 3660000; assert.throws(() => C.validate(data)); data.timer.duration = 60000;
  data.timer.kind = 'focus'; assert.throws(() => C.validate(data));
});

test('calendar dates reject impossible days and compare local calendar boundaries', () => {
  assert.equal(C.validDate('2024-02-29'), true); assert.equal(C.validDate('0001-01-01'), true);
  for (const date of ['2025-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '0000-01-01', '2026-1-01', null]) assert.equal(C.validDate(date), false);
  assert.equal(C.dateDelta('2027-01-01', new Date(2026, 11, 31, 23, 59).getTime()), 1);
  assert.equal(C.dateDelta('2024-03-01', new Date(2024, 1, 28, 0, 1).getTime()), 2);
  assert.equal(C.dateDelta('2026-03-09', new Date(2026, 2, 8, 23, 59).getTime()), 1);
  assert.equal(C.dateDelta('2026-10-18', new Date(2026, 9, 18, 23, 59).getTime()), 0);
  assert.equal(C.dateDelta('2026-10-17', new Date(2026, 9, 18).getTime()), -1);
});

test('yearly important days handle today, the next year, leap birthdays and future start dates', () => {
  const leap = { date: '2024-02-29', repeat: 'yearly' };
  assert.equal(C.occurrence(leap, new Date(2025, 1, 28, 23).getTime()), '2025-02-28');
  assert.equal(C.occurrence(leap, new Date(2025, 2, 1).getTime()), '2026-02-28');
  assert.equal(C.occurrence(leap, new Date(2028, 1, 28).getTime()), '2028-02-29');
  assert.equal(C.occurrence({ date: '2020-01-01', repeat: 'yearly' }, new Date(2026, 11, 31).getTime()), '2027-01-01');
  assert.equal(C.occurrence({ date: '2030-06-01', repeat: 'yearly' }, new Date(2026, 9, 18).getTime()), '2030-06-01');
  assert.equal(C.occurrence({ date: '2020-01-01', repeat: 'none' }, new Date(2026, 9, 18).getTime()), '2020-01-01');
});

function activeTimer(data, kind = 'focus', duration = 1500000) { data.mode = kind; data.timer = { kind, goalId: kind === 'focus' ? 'g' : null, stepId: kind === 'focus' ? 's' : null, status: 'running', duration, remaining: duration, endsAt: 10000000 }; }
test('a full focus interval records one session then suggests a break without starting it', () => {
  const data = fixture(); activeTimer(data);
  assert.deepEqual(C.settleTimer(data, 10000000), { kind: 'focus', seconds: 1500, completed: true });
  assert.equal(data.sessions.length, 1); assert.equal(data.sessions[0].finishedAt, 10000000);
  assert.equal(data.pomodoroCount, 1); assert.equal(data.mode, 'shortBreak'); assert.equal(data.timer, null);
  assert.equal(C.settleTimer(data, 20000000), null); assert.equal(data.sessions.length, 1);
  data.pomodoroCount = 3; activeTimer(data); C.settleTimer(data, 10000000);
  assert.equal(data.pomodoroCount, 4); assert.equal(data.mode, 'longBreak'); assert.equal(data.timer, null);
});

test('breaks never enter focus statistics and partial completion does not increment pomodoros', () => {
  const data = fixture(); activeTimer(data, 'focus'); C.settleTimer(data, 9500000);
  assert.equal(data.sessions[0].seconds, 1000); assert.equal(data.pomodoroCount, 0); assert.equal(data.mode, 'focus');
  activeTimer(data, 'shortBreak', 300000); C.settleTimer(data, 10000000);
  assert.equal(data.sessions.length, 1); assert.equal(data.pomodoroCount, 0); assert.equal(data.mode, 'focus'); assert.equal(data.timer, null);
  activeTimer(data, 'focus', 10800000); C.settleTimer(data, 10000000);
  data.selectedGoal = 'g'; data.selectedStep = 's';
  assert.equal(data.sessions[1].seconds, 10800); assert.equal(C.validate(data).sessions.length, 2);
});

test('returning after a long absence settles only the original interval at its original end time', () => {
  const data = fixture(); activeTimer(data);
  C.settleTimer(data, 10000000 + 86400000 * 8);
  assert.equal(data.sessions.length, 1); assert.equal(data.sessions[0].seconds, 1500); assert.equal(data.sessions[0].finishedAt, 10000000);
  assert.equal(data.pomodoroCount, 1); assert.equal(data.timer, null); assert.equal(data.mode, 'shortBreak');
});

test('accepted long-term history remains readable after another focus session without truncation', () => {
  const data = fixture();
  data.sessions = Array.from({ length: 50000 }, (_, i) => ({ id: `history-${i}`, goalTitle: '历史目标', stepTitle: '历史行动', finishedAt: 1000000 + i, seconds: 60 }));
  const restored = C.validate(JSON.parse(JSON.stringify(data)));
  activeTimer(restored);
  C.settleTimer(restored, 10000000);
  const reloaded = C.validate(JSON.parse(JSON.stringify(restored)));
  assert.equal(reloaded.sessions.length, 50001);
  assert.deepEqual(reloaded.sessions.slice(0, 50000), data.sessions);
  assert.equal(reloaded.sessions[50000].seconds, 1500);
  assert.equal(reloaded.sessions[50000].finishedAt, 10000000);
  assert.equal(reloaded.pomodoroCount, 1);
  assert.equal(reloaded.timer, null);
});
