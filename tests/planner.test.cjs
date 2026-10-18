const test = require('node:test');
const assert = require('node:assert/strict');
const { monthGrid, taskRows, eventsForDay, sortedEvents } = require('../dist/planner.js');

test('calendar uses 42 Monday-first local dates across the year boundary', () => {
  const grid = monthGrid(2027, 0);
  assert.equal(grid.length, 42);
  assert.equal(grid[0].key, '2026-12-28');
  assert.equal(grid[41].key, '2027-02-07');
  assert.equal(grid.filter(day => day.inMonth).length, 31);
  assert.equal(new Set(grid.map(day => day.key)).size, 42);
});

test('calendar includes February 29 in leap years and only 28 days otherwise', () => {
  assert.equal(monthGrid(2028, 1).filter(day => day.inMonth).length, 29);
  assert.ok(monthGrid(2028, 1).some(day => day.key === '2028-02-29'));
  assert.equal(monthGrid(2027, 1).filter(day => day.inMonth).length, 28);
});

test('daily agenda sorts unfinished priorities first while keeping completed history', () => {
  const state = { goals: [{ id: 'g1', steps: [
    { id: 'done', dueDate: '2026-10-18', priority: 'high', done: true },
    { id: 'low', dueDate: '2026-10-18', priority: 'low', done: false },
    { id: 'normal', dueDate: '2026-10-18', priority: 'normal', done: false },
    { id: 'high', dueDate: '2026-10-18', priority: 'high', done: false },
    { id: 'tomorrow', dueDate: '2026-10-19', priority: 'high', done: false }
  ] }] };
  assert.deepEqual(taskRows(state, 'day', '2026-10-18', '2026-10-18').map(row => row.step.id), ['high', 'normal', 'low', 'done']);
  assert.equal(state.goals[0].steps[0].id, 'done', 'sorting must not mutate saved order');
});

test('unplanned and overdue lists exclude completed tasks and respect calendar dates', () => {
  const state = { goals: [{ id: 'g1', steps: [
    { id: 'old', dueDate: '2026-10-17', priority: 'normal', done: false },
    { id: 'today', dueDate: '2026-10-18', priority: 'normal', done: false },
    { id: 'done', dueDate: '2026-10-17', priority: 'normal', done: true },
    { id: 'unplanned', dueDate: null, priority: 'normal', done: false },
    { id: 'unplanned-done', dueDate: null, priority: 'normal', done: true }
  ] }] };
  assert.deepEqual(taskRows(state, 'overdue', '2026-10-19', '2026-10-18').map(row => row.step.id), ['old']);
  assert.deepEqual(taskRows(state, 'unplanned', '2026-10-19', '2026-10-18').map(row => row.step.id), ['unplanned']);
});

test('important dates appear on the selected day, including annual leap-day adjustment', () => {
  const dates = [
    { id: 'yearly', date: '2024-02-29', repeat: 'yearly', pinned: false },
    { id: 'once', date: '2027-02-28', repeat: 'none', pinned: false },
    { id: 'past', date: '2026-02-28', repeat: 'none', pinned: false }
  ];
  assert.deepEqual(eventsForDay(dates, '2027-02-28').map(item => item.id), ['yearly', 'once']);
  assert.deepEqual(eventsForDay(dates, '2028-02-28').map(item => item.id), []);
  assert.deepEqual(eventsForDay(dates, '2028-02-29').map(item => item.id), ['yearly']);
});

test('important dates sort pinned first, then nearest; past one-off events keep elapsed days', () => {
  const now = new Date(2026, 9, 18, 23, 30).getTime();
  const dates = [
    { id: 'far', date: '2026-12-01', repeat: 'none', pinned: false },
    { id: 'past', date: '2026-10-17', repeat: 'none', pinned: false },
    { id: 'today', date: '2026-10-18', repeat: 'none', pinned: false },
    { id: 'pinned', date: '2026-12-30', repeat: 'none', pinned: true }
  ];
  const result = sortedEvents(dates, now);
  assert.deepEqual(result.map(row => row.event.id), ['pinned', 'today', 'past', 'far']);
  assert.equal(result.find(row => row.event.id === 'past').delta, -1);
});
