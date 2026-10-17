(() => {
  'use strict';
  const C = StepCore, $ = id => document.getElementById(id);
  let state = C.initial(), editId = null, confirmation = null, toastTimeout, storageBlocked = false;
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
  function timerLocked() { if (!state.timer) return false; toast('先完成当前专注，或重置计时，再切换行动。'); return true; }
  function selectFirst() { state.selectedStep = getGoal()?.steps.find(s => !s.done)?.id || null; }
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
  function settleSession(finishedAt = Date.now()) {
    const t = state.timer; if (!t) return;
    const goal = state.goals.find(g => g.id === t.goalId), step = goal?.steps.find(s => s.id === t.stepId);
    const seconds = Math.floor((t.duration - C.remaining(t, finishedAt)) / 1000);
    if (seconds > 0) state.sessions.push({ id: C.id(), goalTitle: goal.title, stepTitle: step.text, seconds, finishedAt });
    state.timer = null;
  }
  function completeStep(g, s) {
    if (state.timer?.stepId === s.id) settleSession();
    s.done = !s.done; s.completedAt = s.done ? Date.now() : null;
    if (s.done && state.selectedStep === s.id) selectFirst();
    if (!s.done && !state.selectedStep) state.selectedStep = s.id;
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
      const choose = button(s.text, 'step-select', () => { if (s.done) { toast('这一步已经完成，可以勾选左侧圆圈重新打开。'); return; } if (s.id === state.selectedStep || timerLocked()) return; state.selectedStep = s.id; save(); render(); });
      const remove = button('×', 'step-delete', () => { if (state.timer?.stepId === s.id) { toast('请先完成或重置这一步的专注。'); return; } confirmAction('移除这一步？', s.text, () => { g.steps = g.steps.filter(x => x.id !== s.id); if (state.selectedStep === s.id) selectFirst(); save(); render(); }); }, `删除行动：${s.text}`);
      item.append(check, choose, remove); $('step-list').append(item);
    }
  }
  function drawTimer() {
    const t = state.timer, step = getStep(), ms = t ? C.remaining(t) : state.minutes * 60000, seconds = Math.ceil(ms / 1000);
    $('timer-readout').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    $('focus-state').textContent = t ? t.status === 'running' ? '正在专注' : '已暂停' : '准备开始';
    $('focus-task').textContent = step?.text || (getGoal()?.steps.length && getGoal().steps.every(s => s.done) ? '这个目标已完成，去迎接下一件想做的事。' : '选好下一步，再把时间留给它。');
    $('ring-progress').style.strokeDashoffset = String(t ? 678.584 * ms / t.duration : 678.584);
    $('timer-start').textContent = t ? t.status === 'running' ? '暂停一下 Ⅱ' : '继续专注 →' : '开始专注 →';
    $('timer-start').disabled = !step; $('timer-reset').disabled = !t; $('finish-step').disabled = !step;
    document.querySelectorAll('[data-minutes]').forEach(el => { el.disabled = !!t; el.setAttribute('aria-pressed', String(Number(el.dataset.minutes) === (t ? t.duration / 60000 : state.minutes))); });
    document.title = t ? `${$('timer-readout').textContent} · ${t.status === 'running' ? '专注中' : '已暂停'} · 下一小步` : '下一小步 · 让想法慢慢发生';
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
  function render() { renderGoals(); renderSteps(); drawTimer(); renderStats(); }
  function openGoal(id = null) { if (!id && state.goals.length >= 100) { toast('最多保留 100 个目标，请先整理已有目标。'); return; } editId = id; const g = state.goals.find(g => g.id === id); $('goal-form').reset(); $('goal-error').textContent = ''; $('goal-dialog-title').textContent = g ? '给目标一点调整。' : '你想让什么发生？'; $('goal-name').value = g?.title || ''; $('goal-reason').value = g?.why || ''; $('new-steps-fields').hidden = !!g; $('goal-dialog').showModal(); $('goal-name').focus(); }
  $('new-goal').onclick = () => openGoal(); $('empty-create').onclick = () => openGoal(); $('edit-goal').onclick = () => openGoal(state.selectedGoal);
  $('goal-form').onsubmit = e => {
    e.preventDefault(); const title = $('goal-name').value.trim(), why = $('goal-reason').value.trim(), lines = $('goal-steps').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!title) { $('goal-error').textContent = '写一个目标名称再开始吧。'; return; }
    if (lines.length > 100 || lines.some(s => s.length > 160)) { $('goal-error').textContent = '最多 100 个行动，每个行动不超过 160 字。'; return; }
    if (editId) { const g = state.goals.find(g => g.id === editId); g.title = title; g.why = why; }
    else { const g = { id: C.id(), title, why, createdAt: Date.now(), steps: lines.map(s => ({ id: C.id(), text: s, done: false, completedAt: null })) }; state.goals.push(g); if (!state.timer) { state.selectedGoal = g.id; selectFirst(); } }
    save(); render(); $('goal-dialog').close(); toast(editId ? '目标已更新。' : '一个新的开始，已经放好了。');
  };
  const templates = { learn: '写下这次学习要回答的一个问题\n阅读一小节，记下三个要点\n合上资料，用自己的话解释一次', create: '写下作品要解决的一个问题\n画出最简单的一版草图\n完成一个可以演示的小功能', career: '选出一个想申请的岗位\n找出岗位要求与经历的三个交集\n修改简历中最相关的一段经历' };
  document.querySelectorAll('[data-template]').forEach(el => { el.onclick = () => { const apply = () => { $('goal-steps').value = templates[el.dataset.template]; }; if ($('goal-steps').value.trim()) confirmAction('替换当前的行动草稿？', '将使用所选模板替换输入框中的行动，目标名称和原因会保留。', apply); else apply(); }; });
  $('add-step-form').onsubmit = e => { e.preventDefault(); const g = getGoal(), value = $('step-input').value.trim(); if (!g || !value) return; if (g.steps.length >= 100) { toast('每个目标最多 100 个行动。'); return; } const step = { id: C.id(), text: value, done: false, completedAt: null }; g.steps.push(step); if (!state.selectedStep) state.selectedStep = step.id; $('step-input').value = ''; save(); render(); $('step-input').focus(); };
  document.querySelectorAll('[data-minutes]').forEach(el => { el.onclick = () => { if (state.timer) return; state.minutes = Number(el.dataset.minutes); save(); drawTimer(); }; });
  $('timer-start').onclick = () => {
    if (!getStep()) return;
    const now = Date.now();
    if (!state.timer) state.timer = { goalId: state.selectedGoal, stepId: state.selectedStep, status: 'running', duration: state.minutes * 60000, remaining: state.minutes * 60000, endsAt: now + state.minutes * 60000 };
    else if (state.timer.status === 'running') { tick(); if (!state.timer) return; state.timer.remaining = C.remaining(state.timer, now); state.timer.status = 'paused'; }
    else { state.timer.endsAt = now + state.timer.remaining; state.timer.status = 'running'; }
    save(); drawTimer();
  };
  $('timer-reset').onclick = () => { if (!state.timer) return; confirmAction('重新开始计时？', '这一段未结束的专注不会计入记录；目标和完成状态保持不变。', () => { state.timer = null; save(); drawTimer(); toast('已重置，可以重新开始。'); }); };
  $('finish-step').onclick = () => { const g = getGoal(), s = getStep(); if (g && s) completeStep(g, s); };
  function tick() {
    if (state.timer?.status === 'running' && C.remaining(state.timer) <= 0) { const end = state.timer.endsAt; settleSession(end); save(); render(); toast('这一段专注结束了。喝口水，再决定下一小步。'); }
    else drawTimer();
  }
  function download(contents, name) {
    if (window.NextStepAndroid?.saveBackup) {
      try { window.NextStepAndroid.saveBackup(contents, name); toast('请选择备份的保存位置。'); }
      catch { toast('暂时无法打开保存窗口，请稍后重试。'); }
      return;
    }
    const blob = new Blob([contents], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    toast('备份已生成，请保存在你找得到的地方。');
  }
  window.addEventListener('nextstep-backup-result', event => {
    const status = event.detail?.status;
    toast(status === 'success' ? '备份已保存，可以用它迁移到其他设备。' : status === 'cancelled' ? '已取消保存，当前数据没有改变。' : '备份未能保存，请检查保存位置后重试。');
  });
  $('export-data').onclick = () => {
    tick();
    if (storageBlocked) { try { const raw = localStorage.getItem(C.key); if (raw) { download(raw, `下一小步-原始数据-${C.dayKey(Date.now())}.json`); return; } } catch {} }
    download(JSON.stringify(state, null, 2), `下一小步-备份-${C.dayKey(Date.now())}.json`);
  };
  $('import-data').onclick = () => { if (state.timer) { toast('请先完成或重置当前计时，再导入备份。'); return; } $('import-file').click(); };
  $('import-file').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      if (file.size > 20000000) throw new Error('备份文件超过 20 MB，请选择较小的备份文件。');
      const imported = C.validate(JSON.parse(await file.text()));
      confirmAction('用备份恢复进度？', `备份包含 ${imported.goals.length} 个目标、${imported.sessions.length} 条专注记录。导入会替换当前数据，建议先取消并导出当前备份。`, () => { state = imported; storageBlocked = false; $('storage-warning').hidden = true; save(); tick(); render(); toast('备份已恢复。'); });
    } catch (error) { toast(error instanceof SyntaxError ? '这不是有效的 JSON 备份，原数据未改变。' : error.message); }
  };
  // A second tab must load the latest state rather than silently overwrite it.
  window.addEventListener('storage', e => { if (e.key !== C.key) return; try { state = e.newValue ? C.validate(JSON.parse(e.newValue)) : C.initial(); storageBlocked = false; $('storage-warning').hidden = true; document.querySelectorAll('dialog[open]').forEach(d => d.close()); render(); toast('已同步另一个标签页的进度。'); } catch { storageBlocked = true; warning('另一个标签页写入的数据无法读取，请先导出备份。'); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); renderStats(); } });
  window.addEventListener('nextstep-resume', () => { tick(); renderStats(); });
  if (window.NextStepAndroid) {
    document.querySelector('.privacy').lastChild.textContent = '只存在这台设备里';
    const dataHelp = document.querySelector('.guide-list li:last-child p');
    dataHelp.textContent = '安卓应用数据保存在本机，电脑网页和手机不会自动同步。使用导出、导入备份迁移记录；卸载应用会清除本机数据。切到后台或锁屏后仍按时钟计算，回到应用时补记已结束的计时；不会在后台发出到时通知。';
  }
  $('today-label').textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) + '  /  A FRESH START';
  render(); tick(); setInterval(tick, 1000);
})();
