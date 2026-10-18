(function (root) {
  'use strict';
  const VERSION = 2;
  const key = 'next-small-step.v1';
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const initial = () => ({ version: VERSION, goals: [], sessions: [], selectedGoal: null, selectedStep: null, minutes: 25, timer: null, dates: [], preferences: { shortBreak: 5, longBreak: 15, cycles: 4 }, pomodoroCount: 0, mode: 'focus' });
  function dayKey(time) { const d = new Date(time); return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function dateNumber(date) {
    const [year, month, day] = date.split('-').map(Number), result = new Date(0);
    result.setUTCHours(0, 0, 0, 0); result.setUTCFullYear(year, month - 1, day);
    return result.getTime();
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') return false;
    const parsed = new Date(dateNumber(value));
    return `${String(parsed.getUTCFullYear()).padStart(4, '0')}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}` === value;
  }
  // Compare calendar components rather than elapsed hours, including DST changes.
  function dateDelta(date, now = Date.now()) { return validDate(date) ? Math.round((dateNumber(date) - dateNumber(dayKey(now))) / 86400000) : NaN; }
  function occurrence(event, now = Date.now()) {
    if (!event || !validDate(event.date)) return null;
    if (event.repeat !== 'yearly') return event.date;
    const atYear = year => {
      const prefix = String(year).padStart(4, '0'), suffix = event.date.slice(5), result = `${prefix}-${suffix}`;
      return suffix === '02-29' && !validDate(result) ? `${prefix}-02-28` : result;
    };
    const year = Math.max(new Date(now).getFullYear(), Number(event.date.slice(0, 4))), candidate = atYear(year);
    return dateDelta(candidate, now) >= 0 ? candidate : atYear(year + 1);
  }
  function remaining(timer, now = Date.now()) { return timer ? Math.max(0, timer.status === 'running' ? timer.endsAt - now : timer.remaining) : 0; }
  function validate(data) {
    const fail = () => { throw new Error('备份格式不正确或版本不支持，原数据未被改动。'); };
    const string = (v, max) => typeof v === 'string' && v.length <= max;
    const finite = v => typeof v === 'number' && Number.isFinite(v);
    const timestamp = v => finite(v) && Math.abs(v) <= 8640000000000000;
    const whole = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
    if (!data || ![1, VERSION].includes(data.version) || !Array.isArray(data.goals) || !Array.isArray(data.sessions) || data.goals.length > 100) fail();
    const legacy = data.version === 1;
    let dates = [], preferences = { shortBreak: 5, longBreak: 15, cycles: 4 }, pomodoroCount = 0, mode = 'focus';
    if (!legacy) {
      if (!Array.isArray(data.dates) || data.dates.length > 200 || !data.preferences || !whole(data.preferences.shortBreak, 1, 60) || !whole(data.preferences.longBreak, 1, 60) || !whole(data.preferences.cycles, 2, 8) || !whole(data.pomodoroCount, 0, Number.MAX_SAFE_INTEGER) || !['focus', 'shortBreak', 'longBreak'].includes(data.mode) || !whole(data.minutes, 5, 180)) fail();
      preferences = { shortBreak: data.preferences.shortBreak, longBreak: data.preferences.longBreak, cycles: data.preferences.cycles };
      pomodoroCount = data.pomodoroCount; mode = data.mode;
    }
    const ids = new Set();
    const unique = v => { if (!string(v, 120) || !v || ids.has(v)) fail(); ids.add(v); };
    const goals = data.goals.map(g => {
      if (!g || !string(g.title, 100) || !g.title.trim() || !string(g.why, 240) || !Array.isArray(g.steps) || g.steps.length > 100 || !timestamp(g.createdAt)) fail();
      unique(g.id);
      const steps = g.steps.map(s => {
        if (!s || !string(s.text, 160) || !s.text.trim() || typeof s.done !== 'boolean' || !(s.completedAt === null || timestamp(s.completedAt)) || (!legacy && (!(s.dueDate === null || validDate(s.dueDate)) || !['low', 'normal', 'high'].includes(s.priority)))) fail();
        unique(s.id); return { id: s.id, text: s.text, done: s.done, completedAt: s.completedAt, dueDate: legacy ? null : s.dueDate, priority: legacy ? 'normal' : s.priority };
      });
      return { id: g.id, title: g.title, why: g.why, steps, createdAt: g.createdAt };
    });
    const sessions = data.sessions.map(s => {
      if (!s || !string(s.id, 120) || !string(s.goalTitle, 100) || !string(s.stepTitle, 160) || !timestamp(s.finishedAt) || !finite(s.seconds) || s.seconds < 0 || s.seconds > 10800) fail();
      unique(s.id); return { id: s.id, goalTitle: s.goalTitle, stepTitle: s.stepTitle, finishedAt: s.finishedAt, seconds: s.seconds };
    });
    if (!legacy) dates = data.dates.map(event => {
      if (!event || !string(event.title, 100) || !event.title.trim() || !validDate(event.date) || !string(event.category, 32) || !['none', 'yearly'].includes(event.repeat) || typeof event.pinned !== 'boolean') fail();
      unique(event.id); return { id: event.id, title: event.title, date: event.date, category: event.category, repeat: event.repeat, pinned: event.pinned };
    });
    let timer = null;
    if (data.timer !== null && data.timer !== undefined) {
      const t = data.timer, kind = legacy ? 'focus' : t.kind, g = goals.find(g => g.id === t.goalId), s = g?.steps.find(s => s.id === t.stepId);
      if (!['focus', 'shortBreak', 'longBreak'].includes(kind) || mode !== kind || !['running', 'paused'].includes(t.status) || !whole(t.duration / 60000, kind === 'focus' ? 5 : 1, kind === 'focus' ? 180 : 60) || !finite(t.remaining) || t.remaining < 0 || t.remaining > t.duration || !timestamp(t.endsAt) || t.endsAt > Date.now() + t.duration + 60000) fail();
      if (kind === 'focus' ? (!g || !s || s.done) : (t.goalId !== null || t.stepId !== null)) fail();
      timer = { kind, goalId: kind === 'focus' ? g.id : null, stepId: kind === 'focus' ? s.id : null, status: t.status, duration: t.duration, remaining: t.remaining, endsAt: t.endsAt };
    }
    const selectedGoal = timer?.goalId || (goals.some(g => g.id === data.selectedGoal) ? data.selectedGoal : goals[0]?.id || null);
    const goal = goals.find(g => g.id === selectedGoal);
    const selectedStep = timer?.stepId || (goal?.steps.some(s => s.id === data.selectedStep && !s.done) ? data.selectedStep : goal?.steps.find(s => !s.done)?.id || null);
    return { version: VERSION, goals, sessions, selectedGoal, selectedStep, minutes: legacy ? ([10, 25, 45].includes(data.minutes) ? data.minutes : 25) : data.minutes, timer, dates, preferences, pomodoroCount, mode };
  }
  // Settle only the active interval. No missed-break or offline auto-loop records.
  function settleTimer(state, finishedAt = Date.now()) {
    const timer = state.timer; if (!timer) return null;
    const remainingMs = remaining(timer, finishedAt), seconds = Math.max(0, Math.floor((timer.duration - remainingMs) / 1000)), completed = remainingMs === 0;
    if (timer.kind === 'focus') {
      const goal = state.goals.find(g => g.id === timer.goalId), step = goal?.steps.find(s => s.id === timer.stepId);
      if (goal && step && seconds > 0) state.sessions.push({ id: id(), goalTitle: goal.title, stepTitle: step.text, seconds, finishedAt: completed && timer.status === 'running' ? timer.endsAt : finishedAt });
      if (completed) { state.pomodoroCount += 1; state.mode = state.pomodoroCount % state.preferences.cycles === 0 ? 'longBreak' : 'shortBreak'; }
    } else state.mode = 'focus';
    state.timer = null;
    return { kind: timer.kind, seconds, completed };
  }
  function week(sessions, now = Date.now()) {
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - 6 + i); const key = dayKey(d); return { key, date: d, seconds: sessions.filter(s => dayKey(s.finishedAt) === key).reduce((sum, s) => sum + s.seconds, 0) }; });
  }
  // Group the original history by local calendar month; never trim saved sessions.
  function annual(sessions, year = new Date().getFullYear()) {
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, seconds: 0, count: 0, activeDays: 0 }));
    const days = months.map(() => new Set());
    for (const session of sessions) {
      const date = new Date(session.finishedAt);
      if (date.getFullYear() !== year || session.seconds <= 0) continue;
      const index = date.getMonth(), month = months[index];
      month.seconds += session.seconds;
      month.count += 1;
      days[index].add(dayKey(date));
    }
    months.forEach((month, i) => { month.activeDays = days[i].size; });
    return { year, months, seconds: months.reduce((n, m) => n + m.seconds, 0), count: months.reduce((n, m) => n + m.count, 0), activeDays: months.reduce((n, m) => n + m.activeDays, 0) };
  }
  function focusYears(sessions, now = Date.now()) {
    const current = new Date(now).getFullYear(), years = new Set([current]);
    for (const session of sessions) {
      const year = new Date(session.finishedAt).getFullYear();
      if (Number.isInteger(year) && year <= current) years.add(year);
    }
    return [...years].sort((a, b) => a - b);
  }
  const api = { key, initial, id, remaining, validate, dayKey, validDate, dateDelta, occurrence, settleTimer, week, annual, focusYears };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StepCore = api;
})(globalThis);
