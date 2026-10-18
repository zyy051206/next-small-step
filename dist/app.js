(() => {
  'use strict';
  const C = StepCore, $ = id => document.getElementById(id);
  let state = C.initial(), editId = null, confirmation = null, toastTimeout, storageBlocked = false, displayedDay = null;
  const text = (tag, value, cls) => { const el = document.createElement(tag); el.textContent = value; if (cls) el.className = cls; return el; };
  const button = (label, cls, action, aria) => { const el = text('button', label, cls); el.type = 'button'; el.onclick = action; if (aria) el.setAttribute('aria-label', aria); return el; };
  const getGoal = () => state.goals.find(g => g.id === state.selectedGoal);
  const getStep = () => getGoal()?.steps.find(s => s.id === state.selectedStep && !s.done);
  function toast(message) { clearTimeout(toastTimeout); $('toast').textContent = message; $('toast').hidden = false; toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 4500); }
  function warning(message) { $('storage-warning').textContent = message; $('storage-warning').hidden = false; }
  try { const raw = localStorage.getItem(C.key); if (raw) state = C.validate(JSON.parse(raw)); }
  catch { storageBlocked = true; warning('浏览器中的进度无法读取。为保护原数据，本次不会覆盖保存；请先导出保留原始数据，或导入有效备份恢复。'); }
  function save() {
    if (storageBlocked) return;
    try { localStorage.setItem(C.key, JSON.stringify(state)); }
    catch { warning('浏览器无法保存进度（可能是存储已满或被禁用）。当前内容暂存在此页面，请导出备份后再关闭。'); }
  }
  function confirmAction(title, body, action) { confirmation = action; $('confirm-title').textContent = title; $('confirm-body').textContent = body; $('confirm-dialog').showModal(); $('confirm-no').focus(); }
  $('confirm-no').onclick = () => $('confirm-dialog').close();
  $('confirm-yes').onclick = () => { const action = confirmation; $('confirm-dialog').close(); action?.(); };
  $('confirm-dialog').addEventListener('close', () => { confirmation = null; });
  document.querySelectorAll('[data-close]').forEach(el => { el.onclick = () => $(el.dataset.close).close(); });
  $('guide-open').onclick = () => $('guide-dialog').showModal();
  function timerLocked() { if (!state.timer) return false; toast('先结束当前计时，或重置后再切换。'); return true; }
  function selectFirst() { state.selectedStep = getGoal()?.steps.find(s => !s.done)?.id || null; }
  function selectTask(goalId, stepId) {
    const goal = state.goals.find(g => g.id === goalId), step = goal?.steps.find(s => s.id === stepId);
    if (!step || step.done) { toast('这一步已经完成，可以先撤销完成。'); return false; }
    if (state.timer && (state.timer.goalId !== goalId || state.timer.stepId !== stepId)) { timerLocked(); return false; }
    state.selectedGoal = goalId; state.selectedStep = stepId; state.mode = 'focus'; save(); render();
    return true;
  }
  const newStep = (value, dueDate = null, priority = 'normal') => ({ id: C.id(), text: value, done: false, completedAt: null, dueDate, priority });
  function renderGoals() {
    $('goal-count').textContent = `${state.goals.length} 个目标`;
    $('goal-list').replaceChildren();
    if (!state.goals.length) { const empty = text('div', '', 'goals-empty'); empty.append(text('span', '一个念头，也值得开始。'), text('p', '还没有目标。给一直想做的事，留一个位置。')); $('goal-list').append(empty); }
    for (const g of state.goals) {
      const done = g.steps.filter(s => s.done).length;
      const item = text('div', '', `goal-item${g.id === state.selectedGoal ? ' selected' : ''}`);
      const choose = button('', 'goal-select', () => { if (g.id === state.selectedGoal || timerLocked()) return; state.selectedGoal = g.id; selectFirst(); save(); render(); });
      choose.setAttribute('aria-pressed', String(g.id === state.selectedGoal));
      choose.append(text('strong', g.title), text('small', `${done} / ${g.steps.length} 小步${g.steps.length && done === g.steps.length ? ' · 已达成 ✓' : ''}`));
      const track = text('span', '', 'mini-track'), fill = document.createElement('i'); fill.style.width = `${g.steps.length ? done / g.steps.length * 100 : 0}%`; track.append(fill); choose.append(track);
      const remove = button('×', 'goal-delete', () => {
        if (state.timer?.goalId === g.id) { toast('请先完成或重置这个目标的专注。'); return; }
        confirmAction('移除这个目标？', `「${g.title}」及其中的行动会被删除，已记录的专注时长仍会保留。`, () => { state.goals = state.goals.filter(x => x.id !== g.id); if (state.selectedGoal === g.id) { state.selectedGoal = state.goals[0]?.id || null; selectFirst(); } save(); render(); toast('已移除目标，历史专注记录保留。'); });
      }, `删除目标：${g.title}`);
      item.append(choose, remove); $('goal-list').append(item);
    }
  }
  function settleSession(finishedAt = Date.now()) { return C.settleTimer(state, finishedAt); }
  function completeStep(g, s) {
    if (state.timer?.stepId === s.id) settleSession();
    s.done = !s.done; s.completedAt = s.done ? Date.now() : null;
    if (s.done && state.selectedStep === s.id) selectFirst();
    if (!s.done && !state.selectedStep && g.id === state.selectedGoal) state.selectedStep = s.id;
    save(); render();
    if (s.done) toast(g.steps.every(s => s.done) ? '这个目标完成了。记得为自己高兴一下。' : '又走完了一小步。');
  }
  function renderSteps() {
    const g = getGoal(); $('steps-empty').hidden = !!g; $('steps-content').hidden = !g; $('edit-goal').hidden = !g;
    if (!g) return;
    $('goal-title').textContent = g.title; $('goal-why').textContent = g.why || '把目标拆小一点，就更容易开始。';
    const done = g.steps.filter(s => s.done).length, percent = g.steps.length ? Math.round(done / g.steps.length * 100) : 0;
    $('progress-text').textContent = `已走过 ${done} / ${g.steps.length} 小步`; $('progress-percent').textContent = `${percent}%`; $('progress-fill').style.width = `${percent}%`;
    $('step-list').replaceChildren();
    if (!g.steps.length) $('step-list').append(text('p', '目标有了。下面写下第一个能在今天开始的动作吧。', 'history-empty'));
    for (const s of g.steps) {
      const item = text('div', '', `step-item${s.done ? ' done' : ''}${state.selectedStep === s.id ? ' active' : ''}`);
      const check = button(s.done ? '✓' : '', 'step-check', () => completeStep(g, s), `${s.done ? '撤销完成' : '完成行动'}：${s.text}`); check.setAttribute('aria-pressed', String(s.done));
      const choose = button(s.text, 'step-select', () => selectTask(g.id, s.id));
      const content = text('div', '', 'step-content'), meta = text('div', '', 'step-meta');
      if (s.dueDate) {
        const delta = C.dateDelta(s.dueDate), label = delta === 0 ? '今天' : delta === 1 ? '明天' : s.dueDate.slice(5).replace('-', '/');
        meta.append(text('span', !s.done && delta < 0 ? `已逾期 · ${label}` : label, `step-date${!s.done && delta < 0 ? ' overdue' : ''}`));
      }
      if (s.priority !== 'normal') meta.append(text('span', s.priority === 'high' ? '优先处理' : '稍后再做', `priority priority-${s.priority}`));
      content.append(choose); if (meta.childNodes.length) content.append(meta);
      const edit = button('编辑', 'step-edit', () => editTask(g.id, s.id), `编辑行动：${s.text}`);
      const remove = button('×', 'step-delete', () => { if (state.timer?.stepId === s.id) { toast('请先完成或重置这一步的专注。'); return; } confirmAction('移除这一步？', s.text, () => { g.steps = g.steps.filter(x => x.id !== s.id); if (state.selectedStep === s.id) selectFirst(); save(); render(); }); }, `删除行动：${s.text}`);
      item.append(check, content, edit, remove); $('step-list').append(item);
    }
  }
  function drawTimer() {
    window.StepReminders?.sync(state.timer);
    const t = state.timer, step = getStep(), mode = t?.kind || state.mode, isFocus = mode === 'focus', ms = t ? C.remaining(t) : (isFocus ? state.minutes : state.preferences[mode]) * 60000, seconds = Math.ceil(ms / 1000);
    $('timer-readout').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    $('focus-state').textContent = t ? t.status === 'running' ? (isFocus ? '正在专注' : '正在休息') : '已暂停' : (isFocus ? '准备开始' : mode === 'shortBreak' ? '短休息 · 等待开始' : '长休息 · 等待开始');
    $('focus-task').textContent = isFocus ? (step?.text || (getGoal()?.steps.length && getGoal().steps.every(s => s.done) ? '这个目标已完成，去迎接下一件想做的事。' : '选好下一步，再把时间留给它。')) : (mode === 'shortBreak' ? '离开屏幕，给注意力一点恢复的时间。' : '完成了一轮。伸个懒腰，慢慢充好电。');
    $('ring-progress').style.strokeDashoffset = String(t ? 678.584 * ms / t.duration : 678.584);
    $('timer-start').textContent = t ? t.status === 'running' ? '暂停一下 Ⅱ' : `继续${isFocus ? '专注' : '休息'} →` : `开始${isFocus ? '专注' : '休息'} →`;
    $('timer-start').disabled = isFocus && !step; $('timer-reset').disabled = !t; $('finish-step').disabled = !step || !isFocus;
    const presets = document.querySelector('.durations'); if (presets) presets.hidden = !isFocus;
    document.querySelectorAll('[data-minutes]').forEach(el => { el.disabled = !!t || !isFocus; el.setAttribute('aria-pressed', String(Number(el.dataset.minutes) === (t && isFocus ? t.duration / 60000 : state.minutes))); });
    document.querySelectorAll('[data-focus-mode]').forEach(el => { el.disabled = !!t; el.setAttribute('aria-pressed', String(el.dataset.focusMode === mode)); });
    if ($('focus-settings-open')) $('focus-settings-open').disabled = !!t;
    if ($('pomodoro-progress')) $('pomodoro-progress').textContent = `累计完成 ${state.pomodoroCount} 次专注 · 每轮 ${state.preferences.cycles} 次`;
    document.title = t ? `${$('timer-readout').textContent} · ${t.status === 'running' ? (isFocus ? '专注中' : '休息中') : '已暂停'} · 下一小步` : '下一小步 · 让想法慢慢发生';
    window.StepPages?.updateTimer();
  }
  function renderStats() {
    $('stat-steps').textContent = state.goals.reduce((n, g) => n + g.steps.filter(s => s.done).length, 0);
    $('stat-minutes').textContent = Math.floor(state.sessions.reduce((n, s) => n + s.seconds, 0) / 60);
    $('stat-goals').textContent = state.goals.filter(g => g.steps.length && g.steps.every(s => s.done)).length;
    const days = C.week(state.sessions), max = Math.max(60, ...days.map(d => d.seconds));
    $('week-total').textContent = `${Math.floor(days.reduce((n, d) => n + d.seconds, 0) / 60)} 分钟`;
    $('week-chart').replaceChildren();
    for (const [i, d] of days.entries()) {
      const col = text('div', '', `day${i === 6 ? ' today' : ''}`), bar = text('div', '', 'day-bar'); bar.style.height = `${Math.max(3, d.seconds / max * 58)}px`;
      col.title = `${d.key}：${Math.floor(d.seconds / 60)} 分 ${Math.floor(d.seconds % 60)} 秒`; col.setAttribute('aria-label', col.title); col.append(bar, text('span', i === 6 ? '今天' : `${d.date.getMonth() + 1}/${d.date.getDate()}`)); $('week-chart').append(col);
    }
    StepStats.render(state.sessions);
    $('history-list').replaceChildren();
    if (!state.sessions.length) $('history-list').append(text('p', '还没有专注记录。第一段属于自己的时间，会从这里开始。', 'history-empty'));
    for (const s of [...state.sessions].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, 8)) {
      const row = text('div', '', 'history-row'), description = document.createElement('div');
      description.append(text('strong', s.stepTitle), text('small', `${s.goalTitle} · ${new Date(s.finishedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`));
      row.append(description, text('span', s.seconds < 60 ? `${s.seconds} 秒` : `${Math.floor(s.seconds / 60)} 分 ${Math.floor(s.seconds % 60)} 秒`)); $('history-list').append(row);
    }
  }
  function refreshDateHeading() {
    const now = new Date(), today = C.dayKey(now);
    if (today === displayedDay) return false;
    displayedDay = today;
    $('today-label').textContent = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) + '  /  A FRESH START';
    return true;
  }
  function render() { refreshDateHeading(); renderGoals(); renderSteps(); drawTimer(); renderStats(); window.StepPlanner?.render(state); }
  function openGoal(id = null) { if (!id && state.goals.length >= 100) { toast('最多保留 100 个目标，请先整理已有目标。'); return; } editId = id; const g = state.goals.find(g => g.id === id); $('goal-form').reset(); $('goal-error').textContent = ''; $('goal-dialog-title').textContent = g ? '给目标一点调整。' : '你想让什么发生？'; $('goal-name').value = g?.title || ''; $('goal-reason').value = g?.why || ''; $('new-steps-fields').hidden = !!g; $('goal-dialog').showModal(); $('goal-name').focus(); }
  $('new-goal').onclick = () => openGoal(); $('empty-create').onclick = () => openGoal(); $('edit-goal').onclick = () => openGoal(state.selectedGoal);
  $('goal-form').onsubmit = e => {
    e.preventDefault(); const title = $('goal-name').value.trim(), why = $('goal-reason').value.trim(), lines = $('goal-steps').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!title) { $('goal-error').textContent = '写一个目标名称再开始吧。'; return; }
    if (lines.length > 100 || lines.some(s => s.length > 160)) { $('goal-error').textContent = '最多 100 个行动，每个行动不超过 160 字。'; return; }
    if (editId) { const g = state.goals.find(g => g.id === editId); g.title = title; g.why = why; }
    else { const g = { id: C.id(), title, why, createdAt: Date.now(), steps: lines.map(s => newStep(s)) }; state.goals.push(g); if (!state.timer) { state.selectedGoal = g.id; selectFirst(); } }
    save(); render(); $('goal-dialog').close(); toast(editId ? '目标已更新。' : '一个新的开始，已经放好了。');
  };
  const templates = { learn: '写下这次学习要回答的一个问题\n阅读一小节，记下三个要点\n合上资料，用自己的话解释一次', create: '写下作品要解决的一个问题\n画出最简单的一版草图\n完成一个可以演示的小功能', career: '选出一个想申请的岗位\n找出岗位要求与经历的三个交集\n修改简历中最相关的一段经历' };
  document.querySelectorAll('[data-template]').forEach(el => { el.onclick = () => { const apply = () => { $('goal-steps').value = templates[el.dataset.template]; }; if ($('goal-steps').value.trim()) confirmAction('替换当前的行动草稿？', '将使用所选模板替换输入框中的行动，目标名称和原因会保留。', apply); else apply(); }; });
  // Shared task editor: the calendar and goal list operate on the same steps.
  let taskEditing = null;
  const taskDialog = document.createElement('dialog'); taskDialog.id = 'task-dialog'; taskDialog.setAttribute('aria-labelledby', 'task-dialog-title');
  taskDialog.innerHTML = '<form id="task-form"><div class="dialog-heading"><span class="eyebrow">ONE THING AT A TIME</span><button type="button" class="close-button" aria-label="关闭">×</button></div><h2 id="task-dialog-title">添加待办</h2><label for="task-title">要做什么</label><input id="task-title" maxlength="160" required><div id="task-group-field"><label for="task-group">归属目标</label><select id="task-group"></select></div><div class="form-grid"><div><label for="task-date">计划日期 <span class="optional">选填</span></label><input id="task-date" type="date" min="0001-01-01" max="9999-12-31"></div><div><label for="task-priority">优先级</label><select id="task-priority"><option value="normal">普通</option><option value="high">优先处理</option><option value="low">稍后再做</option></select></div></div><p class="form-error" id="task-error" role="alert"></p><button class="button primary" type="submit">保存待办</button></form>';
  document.body.append(taskDialog); taskDialog.querySelector('.close-button').onclick = () => taskDialog.close();
  function openTask(goalId = null, stepId = null, date = null) {
    const goal = state.goals.find(g => g.id === goalId), step = goal?.steps.find(s => s.id === stepId);
    if (stepId && !step) return;
    taskEditing = step ? { goalId, stepId } : null;
    $('task-form').reset(); $('task-error').textContent = ''; $('task-dialog-title').textContent = step ? '编辑待办' : '添加待办';
    $('task-title').value = step?.text || ''; $('task-date').value = step?.dueDate || (C.validDate(date) ? date : ''); $('task-priority').value = step?.priority || 'normal';
    $('task-group-field').hidden = !!step; $('task-group').replaceChildren();
    for (const g of state.goals) { const option = text('option', g.title); option.value = g.id; option.disabled = g.steps.length >= 100; $('task-group').append(option); }
    const daily = state.goals.find(g => g.title === '日常待办');
    if (!daily && state.goals.length < 100) { const option = text('option', '日常待办（新建）'); option.value = ''; $('task-group').append(option); }
    const preferred = state.goals.find(g => g.id === state.selectedGoal && g.steps.length < 100) || (daily?.steps.length < 100 ? daily : null) || state.goals.find(g => g.steps.length < 100);
    $('task-group').value = preferred?.id || '';
    taskDialog.showModal(); $('task-title').focus();
  }
  function addTask(date = null) { openTask(null, null, date); }
  function editTask(goalId, stepId) { openTask(goalId, stepId); }
  $('task-form').onsubmit = e => {
    e.preventDefault(); const value = $('task-title').value.trim(), date = $('task-date').value || null, priority = $('task-priority').value;
    if (!value || value.length > 160 || (date !== null && !C.validDate(date)) || !['normal', 'high', 'low'].includes(priority)) { $('task-error').textContent = '请填写有效的任务名称、日期和优先级。'; return; }
    if (taskEditing) {
      const goal = state.goals.find(g => g.id === taskEditing.goalId), step = goal?.steps.find(s => s.id === taskEditing.stepId);
      if (!step) { $('task-error').textContent = '这条任务已被移除，请关闭窗口后重试。'; return; }
      step.text = value; step.dueDate = date; step.priority = priority;
    } else {
      let goal = state.goals.find(g => g.id === $('task-group').value);
      if (!goal) {
        if ($('task-group').value !== '' || state.goals.length >= 100 || state.goals.some(g => g.title === '日常待办')) { $('task-error').textContent = '没有可用的目标，请先整理已有目标。'; return; }
        goal = { id: C.id(), title: '日常待办', why: '', createdAt: Date.now(), steps: [] }; state.goals.push(goal);
      }
      if (goal.steps.length >= 100) { $('task-error').textContent = '这个目标已有 100 个行动，请换一个目标。'; return; }
      const step = newStep(value, date, priority); goal.steps.push(step);
      if (!state.timer) { state.selectedGoal = goal.id; state.selectedStep = step.id; }
    }
    save(); render(); taskDialog.close(); toast(taskEditing ? '待办已更新。' : '待办已添加。');
  };
  const settingsDialog = document.createElement('dialog'); settingsDialog.id = 'focus-settings-dialog'; settingsDialog.setAttribute('aria-labelledby', 'focus-settings-title');
  settingsDialog.innerHTML = '<form id="focus-settings-form"><div class="dialog-heading"><span class="eyebrow">YOUR OWN RHYTHM</span><button type="button" class="close-button" aria-label="关闭">×</button></div><h2 id="focus-settings-title">番茄钟设置</h2><p class="muted">每段计时结束后，由你决定何时开始下一段。</p><div class="form-grid"><div><label for="settings-focus">专注 / 分钟</label><input id="settings-focus" type="number" min="5" max="180" step="1" required></div><div><label for="settings-cycles">每轮番茄数</label><input id="settings-cycles" type="number" min="2" max="8" step="1" required></div><div><label for="settings-short">短休息 / 分钟</label><input id="settings-short" type="number" min="1" max="60" step="1" required></div><div><label for="settings-long">长休息 / 分钟</label><input id="settings-long" type="number" min="1" max="60" step="1" required></div></div><p class="settings-note">完成一整段专注才计入番茄数；休息不计入专注时长。</p><p class="form-error" id="focus-settings-error" role="alert"></p><button class="button primary" type="submit">保存设置</button></form>';
  document.body.append(settingsDialog); settingsDialog.querySelector('.close-button').onclick = () => settingsDialog.close();
  if ($('focus-settings-open')) $('focus-settings-open').onclick = () => {
    if (timerLocked()) return;
    $('settings-focus').value = state.minutes; $('settings-cycles').value = state.preferences.cycles; $('settings-short').value = state.preferences.shortBreak; $('settings-long').value = state.preferences.longBreak; $('focus-settings-error').textContent = ''; settingsDialog.showModal(); $('settings-focus').focus();
  };
  $('focus-settings-form').onsubmit = e => {
    e.preventDefault(); if (timerLocked()) return;
    const minutes = Number($('settings-focus').value), cycles = Number($('settings-cycles').value), shortBreak = Number($('settings-short').value), longBreak = Number($('settings-long').value);
    if (![minutes, cycles, shortBreak, longBreak].every(Number.isInteger) || minutes < 5 || minutes > 180 || cycles < 2 || cycles > 8 || shortBreak < 1 || shortBreak > 60 || longBreak < 1 || longBreak > 60) { $('focus-settings-error').textContent = '专注为 5–180 分钟，休息为 1–60 分钟，每轮为 2–8 个番茄，请输入整数。'; return; }
    state.minutes = minutes; state.preferences = { shortBreak, longBreak, cycles }; save(); render(); settingsDialog.close(); toast('已保存你的节奏。');
  };
  if ($('focus-modes')) for (const [mode, label] of [['focus', '专注'], ['shortBreak', '短休息'], ['longBreak', '长休息']]) {
    const el = button(label, 'focus-mode', () => { if (timerLocked()) return; state.mode = mode; save(); drawTimer(); }); el.dataset.focusMode = mode; el.setAttribute('aria-pressed', 'false'); $('focus-modes').append(el);
  }
  $('add-step-form').onsubmit = e => { e.preventDefault(); const g = getGoal(), value = $('step-input').value.trim(); if (!g || !value) return; if (g.steps.length >= 100) { toast('每个目标最多 100 个行动。'); return; } const step = newStep(value); g.steps.push(step); if (!state.selectedStep) state.selectedStep = step.id; $('step-input').value = ''; save(); render(); $('step-input').focus(); };
  document.querySelectorAll('[data-minutes]').forEach(el => { el.onclick = () => { if (state.timer) return; state.minutes = Number(el.dataset.minutes); save(); drawTimer(); }; });
  $('timer-start').onclick = () => {
    if (state.mode === 'focus' && !getStep()) return;
    const now = Date.now();
    if (!state.timer) { const duration = (state.mode === 'focus' ? state.minutes : state.preferences[state.mode]) * 60000; state.timer = { kind: state.mode, goalId: state.mode === 'focus' ? state.selectedGoal : null, stepId: state.mode === 'focus' ? state.selectedStep : null, status: 'running', duration, remaining: duration, endsAt: now + duration }; }
    else if (state.timer.status === 'running') { tick(); if (!state.timer) return; state.timer.remaining = C.remaining(state.timer, now); state.timer.status = 'paused'; }
    else { state.timer.endsAt = now + state.timer.remaining; state.timer.status = 'running'; }
    save(); drawTimer();
  };
  $('timer-reset').onclick = () => { if (!state.timer) return; confirmAction('重新开始计时？', '这一段未结束的计时不会计入记录；任务和完成状态保持不变。', () => { state.timer = null; save(); drawTimer(); toast('已重置，可以重新开始。'); }); };
  $('finish-step').onclick = () => { const g = getGoal(), s = getStep(); if (g && s) completeStep(g, s); };
  function tick() {
    const dayChanged = refreshDateHeading();
    if (state.timer?.status === 'running' && C.remaining(state.timer) <= 0) { const end = state.timer.endsAt, result = settleSession(end); save(); render(); toast(result.kind === 'focus' ? `这一段专注已记下。准备好后，开始${state.mode === 'longBreak' ? '长' : '短'}休息。` : '休息结束了。选好下一件事，再开始专注。'); }
    else {
      drawTimer();
      // Refresh date-dependent views once per day without resetting form drafts.
      if (dayChanged) { renderSteps(); renderStats(); window.StepPlanner?.render(state); }
    }
  }
  function download(contents, name) {
    if (window.NextStepAndroid?.saveBackup) {
      try { window.NextStepAndroid.saveBackup(contents, name); toast('请选择备份的保存位置。'); }
      catch { toast('暂时无法打开保存窗口，请稍后重试。'); }
      return;
    }
    const blob = new Blob([contents], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    toast(window.NextStepDesktop ? '请选择备份的保存位置。' : '备份已生成，请保存在你找得到的地方。');
  }
  window.addEventListener('nextstep-backup-result', event => {
    const status = event.detail?.status;
    toast(status === 'success' ? '备份已保存，可以用它迁移到其他设备。' : status === 'cancelled' ? '已取消保存，当前数据没有改变。' : '备份未能保存，请检查保存位置后重试。');
  });
  $('export-data').onclick = async () => {
    tick();
    if (storageBlocked) { try { const raw = localStorage.getItem(C.key); if (raw) { download(raw, `下一小步-原始数据-${C.dayKey(Date.now())}.json`); return; } } catch {} }
    try { $('export-data').disabled = true; const bundle = await StepBackup.create(state); download(JSON.stringify(bundle), `下一小步-完整备份-${C.dayKey(Date.now())}.json`); }
    catch { toast('完整备份未能生成，请检查存储和背景图片后重试。'); }
    finally { $('export-data').disabled = false; }
  };
  $('import-data').onclick = () => { if (state.timer) { toast('请先完成或重置当前计时，再导入备份。'); return; } $('import-file').click(); };
  $('import-file').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('备份文件超过 64 MB。');
      const bundle = await StepBackup.parse(JSON.parse(await file.text())), imported = bundle.data;
      confirmAction('用备份恢复数据？', `备份包含 ${imported.goals.length} 个目标、${imported.dates.length} 个重要日和 ${imported.sessions.length} 条专注记录。${bundle.legacy ? '这是旧版进度备份，保留当前外观设置。' : '同时恢复背景、外观、更新与提醒设置。'}导入会替换当前数据，建议先导出当前完整备份。`, async () => {
        if (state.timer) { toast('请先结束当前计时，再恢复备份。'); return; }
        const blocker = document.createElement('dialog'); blocker.textContent = '正在恢复，请稍候…'; document.body.append(blocker); blocker.addEventListener('cancel', e=>e.preventDefault()); blocker.showModal();
        try { await StepBackup.restore(bundle); state = imported; storageBlocked = false; $('storage-warning').hidden = true; tick(); render(); toast('备份已恢复，通知权限仍由这台设备决定。'); }
        catch (error) { toast(error.message || '恢复失败，请重试。'); }
        finally { blocker.close(); blocker.remove(); }
      });
    } catch (error) { toast(error instanceof SyntaxError ? '这不是有效的 JSON 备份，原数据未改变。' : error.message); }
  };
  // A second tab must load the latest state rather than silently overwrite it.
  window.addEventListener('storage', e => { if (e.key !== C.key) return; try { state = e.newValue ? C.validate(JSON.parse(e.newValue)) : C.initial(); storageBlocked = false; $('storage-warning').hidden = true; document.querySelectorAll('dialog[open]').forEach(d => d.close()); render(); toast('已同步另一个标签页的进度。'); } catch { storageBlocked = true; warning('另一个标签页写入的数据无法读取，请先导出备份。'); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); renderStats(); } });
  window.addEventListener('nextstep-resume', () => { tick(); renderStats(); });
  if (window.NextStepAndroid || window.NextStepDesktop) {
    const privacy = document.querySelector('.privacy');
    if (privacy) { const dot = document.createElement('i'); privacy.replaceChildren(dot, document.createTextNode('只存在这台设备里')); }
    const dataHelp = document.querySelector('.guide-list li:last-child p');
    if (dataHelp) dataHelp.textContent = '应用数据保存在本机，不同设备和网页之间不会自动同步。使用导出、导入备份迁移记录；清除应用数据前请先备份。离开应用后仍按时钟计算，回来时补记已结束的单段计时；不会自动循环。可在番茄钟设置中开启系统提醒，通知权限由当前设备控制。';
  }
  window.StepApp = { getState: () => state, saveAndRender: () => { save(); render(); }, confirm: confirmAction, toast, completeStep, selectTask, editTask, addTask };
  window.StepPlanner?.init(window.StepApp);
  render(); tick(); setInterval(tick, 1000);
})();
