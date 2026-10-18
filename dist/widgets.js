(() => {
  'use strict';
  const bridge = window.NextStepWidgets;
  if (!bridge || typeof bridge.publish !== 'function') return;
  let app, last = '';
  function sync(state) {
    if (!state) return;
    const selected = state.goals.find(g => g.id === state.selectedGoal);
    const step = selected?.steps.find(s => s.id === state.selectedStep && !s.done);
    const data = {
      version: 1, tasks: state.goals.flatMap(g => g.steps.filter(s => !s.done && s.dueDate).map(s => ({ goalId: g.id, id: s.id, text: s.text, dueDate: s.dueDate, priority: s.priority }))),
      dates: state.dates, timer: state.timer,
      selected: { goalId: selected?.id || '', stepId: step?.id || '', title: step?.text || '' },
      minutes: state.mode === 'focus' ? state.minutes : state.preferences[state.mode], mode: state.mode,
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    };
    const json = JSON.stringify(data);
    if (json === last) return;
    try { if (bridge.publish(json) === true) last = json; } catch { /* Widgets never block saving app data. */ }
  }
  function consume() {
    if (!app) return;
    let command;
    try { command = JSON.parse(bridge.takeCommand() || 'null'); } catch { return; }
    if (!command || !['open', 'start', 'pause', 'resume', 'complete'].includes(command.action)) return;
    if (document.querySelector('dialog[open]')) { app.toast('请先关闭当前窗口，再点击桌面组件。'); return; }
    const state = app.getState();
    const page = ['workspace', 'calendar', 'important-dates'].includes(command.page) ? command.page : 'workspace';
    location.hash = page;
    if (command.action === 'open') return;
    if (command.action === 'complete') {
      const goal = state.goals.find(g => g.id === command.goalId), step = goal?.steps.find(s => s.id === command.stepId);
      if (step && !step.done && step.dueDate === StepCore.dayKey(Date.now())) app.completeStep(goal, step);
      else app.toast('这条待办已更新，桌面组件已同步。');
    } else {
      const timer = state.timer;
      const sameTimer = timer && timer.endsAt === command.endsAt && timer.kind === command.kind && (timer.stepId || '') === command.stepId;
      const valid = command.action === 'start'
        ? !timer && state.mode === command.kind && (state.mode !== 'focus' || (state.selectedGoal === command.goalId && state.selectedStep === command.stepId))
        : sameTimer && timer.status === (command.action === 'pause' ? 'running' : 'paused');
      if (valid) document.getElementById('timer-start').click();
      else app.toast('计时状态已变化，桌面组件已同步。');
    }
    sync(app.getState());
  }
  function init(api) {
    app = api;
    const button = document.createElement('button'); button.id = 'widgets-open'; button.className = 'text-button'; button.type = 'button'; button.textContent = '桌面组件';
    const dialog = document.createElement('dialog'); dialog.id = 'widgets-dialog';
    dialog.innerHTML = '<div class="dialog-heading"><span class="eyebrow">ON YOUR HOME SCREEN</span><button type="button" class="close-button" aria-label="关闭桌面组件">×</button></div><h2>把下一步，放到桌面。</h2><p>桌面持续显示专注倒计时、今日待办与重要日期。点击计时按钮或待办，会进入应用完成操作并保存记录。</p><div class="confirm-actions" style="flex-wrap:wrap"><button class="button secondary" type="button" data-widget="focus">添加专注计时</button><button class="button secondary" type="button" data-widget="todos">添加今日待办</button><button class="button secondary" type="button" data-widget="dates">添加重要日期</button></div><p class="muted">也可以长按桌面空白处，在组件列表中搜索“下一小步”。内容保存在本机，组件随应用内操作更新；系统省电可能推迟日期和到时状态刷新。</p>';
    document.body.append(dialog);
    dialog.querySelector('.close-button').onclick = () => dialog.close();
    button.onclick = () => { sync(app.getState()); dialog.showModal(); };
    document.querySelector('.sidebar-bottom').insertBefore(button, document.getElementById('guide-open'));
    for (const item of dialog.querySelectorAll('[data-widget]')) item.onclick = () => {
      try { if (!bridge.requestPin(item.dataset.widget)) app.toast('请长按桌面空白处，在组件列表中添加“下一小步”。'); }
      catch { app.toast('请从手机桌面的组件列表添加。'); }
    };
    addEventListener('nextstep-widget-command', consume);
    new MutationObserver(() => sync(app.getState())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    sync(app.getState()); consume();
  }
  window.StepWidgets = { init, sync };
})();
