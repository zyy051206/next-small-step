(function (root) {
  'use strict';
  const VERSION = 1;
  const key = 'next-small-step.v1';
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const initial = () => ({ version: VERSION, goals: [], sessions: [], selectedGoal: null, selectedStep: null, minutes: 25, timer: null });
  function dayKey(time) { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function remaining(timer, now = Date.now()) { return timer ? Math.max(0, timer.status === 'running' ? timer.endsAt - now : timer.remaining) : 0; }
  function validate(data) {
    const fail = () => { throw new Error('备份格式不正确或版本不支持，原数据未被改动。'); };
    const string = (v, max) => typeof v === 'string' && v.length <= max;
    const finite = v => typeof v === 'number' && Number.isFinite(v);
    if (!data || data.version !== VERSION || !Array.isArray(data.goals) || !Array.isArray(data.sessions) || data.goals.length > 100 || data.sessions.length > 50000) fail();
    const ids = new Set();
    const unique = v => { if (!string(v, 120) || !v || ids.has(v)) fail(); ids.add(v); };
    const goals = data.goals.map(g => {
      if (!g || !string(g.title, 100) || !g.title.trim() || !string(g.why, 240) || !Array.isArray(g.steps) || g.steps.length > 100 || !finite(g.createdAt)) fail();
      unique(g.id);
      const steps = g.steps.map(s => { if (!s || !string(s.text, 160) || !s.text.trim() || typeof s.done !== 'boolean' || !(s.completedAt === null || finite(s.completedAt))) fail(); unique(s.id); return { id: s.id, text: s.text, done: s.done, completedAt: s.completedAt }; });
      return { id: g.id, title: g.title, why: g.why, steps, createdAt: g.createdAt };
    });
    const sessions = data.sessions.map(s => {
      if (!s || !string(s.id, 120) || !string(s.goalTitle, 100) || !string(s.stepTitle, 160) || !finite(s.finishedAt) || !finite(s.seconds) || s.seconds < 0 || s.seconds > 2700) fail();
      unique(s.id); return { id: s.id, goalTitle: s.goalTitle, stepTitle: s.stepTitle, finishedAt: s.finishedAt, seconds: s.seconds };
    });
    let timer = null;
    if (data.timer !== null && data.timer !== undefined) {
      const t = data.timer, g = goals.find(g => g.id === t.goalId), s = g?.steps.find(s => s.id === t.stepId);
      if (!g || !s || s.done || !['running', 'paused'].includes(t.status) || !finite(t.duration) || ![600000, 1500000, 2700000].includes(t.duration) || !finite(t.remaining) || t.remaining < 0 || t.remaining > t.duration || !finite(t.endsAt) || t.endsAt > Date.now() + t.duration + 60000) fail();
      timer = { goalId: g.id, stepId: s.id, status: t.status, duration: t.duration, remaining: t.remaining, endsAt: t.endsAt };
    }
    const selectedGoal = timer?.goalId || (goals.some(g => g.id === data.selectedGoal) ? data.selectedGoal : goals[0]?.id || null);
    const goal = goals.find(g => g.id === selectedGoal);
    const selectedStep = timer?.stepId || (goal?.steps.some(s => s.id === data.selectedStep && !s.done) ? data.selectedStep : goal?.steps.find(s => !s.done)?.id || null);
    return { version: VERSION, goals, sessions, selectedGoal, selectedStep, minutes: [10, 25, 45].includes(data.minutes) ? data.minutes : 25, timer };
  }
  function week(sessions, now = Date.now()) {
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - 6 + i); const key = dayKey(d); return { key, date: d, seconds: sessions.filter(s => dayKey(s.finishedAt) === key).reduce((sum, s) => sum + s.seconds, 0) }; });
  }
  const api = { key, initial, id, remaining, validate, dayKey, week };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StepCore = api;
})(globalThis);
