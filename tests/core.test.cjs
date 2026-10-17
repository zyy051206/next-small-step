const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../dist/core.js');
function fixture() { const d = C.initial(); d.goals.push({ id: 'g', title: '毕业作品', why: '', createdAt: Date.now(), steps: [{ id: 's', text: '画一张草图', done: false, completedAt: null }] }); return d; }
test('empty backup and fallback selections round-trip', () => { assert.deepEqual(C.validate(C.initial()), C.initial()); assert.equal(C.validate(fixture()).selectedStep, 's'); });
test('reject damaged backups, duplicate IDs and excessive text without altering input', () => { const d = fixture(); d.goals[0].steps.push({ ...d.goals[0].steps[0] }); assert.throws(() => C.validate(d)); assert.equal(d.goals[0].steps.length, 2); assert.throws(() => C.validate({ version: 2, goals: [], sessions: [] })); const long = fixture(); long.goals[0].title = 'x'.repeat(101); assert.throws(() => C.validate(long)); });
test('running timers use wall clock, paused timers do not', () => { assert.equal(C.remaining({ status: 'running', endsAt: 10000 }, 3500), 6500); assert.equal(C.remaining({ status: 'running', endsAt: 10000 }, 11000), 0); assert.equal(C.remaining({ status: 'paused', remaining: 1234 }, 99999), 1234); });
test('restore expired timer but reject orphan or completed task timer', () => { const d = fixture(); d.timer = { goalId: 'g', stepId: 's', status: 'running', duration: 600000, remaining: 600000, endsAt: Date.now() - 1000 }; assert.ok(C.validate(d).timer); d.goals[0].steps[0].done = true; assert.throws(() => C.validate(d)); });
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
  const data = fixture();
  data.sessions = [2023, 2024, 2025, 2026].map(year => ({ ...sessionAt(year, 6, 1, 600), id: `history-${year}`, goalTitle: '历史目标', stepTitle: '历史行动' }));
  const restored = C.validate(JSON.parse(JSON.stringify(data)));
  assert.equal(restored.version, 1); assert.deepEqual(restored.sessions, data.sessions);
  assert.equal(C.annual(restored.sessions, 2023).seconds, 600);
  assert.equal(C.annual([], 2026).seconds, 0); assert.equal(C.annual([], 2026).months.length, 12);
});
