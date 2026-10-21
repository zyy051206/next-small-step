(() => {
  'use strict';
  const C = window.StepCore, $ = id => document.getElementById(id);
  const soundNames = { off: '安静', rain: '雨声', breeze: '微风', white: '白噪音' };
  let app, dialog, soundStarted = false;

  function build() {
    dialog = document.createElement('dialog');
    dialog.id = 'immersive-dialog';
    dialog.className = 'immersive';
    dialog.setAttribute('aria-labelledby', 'immersive-title');
    dialog.innerHTML = `
      <div class="immersive-inner">
        <header class="immersive-top">
          <span id="immersive-mode" class="immersive-eyebrow">FOCUS TIME</span>
          <button id="immersive-close" class="immersive-close" type="button" aria-label="退出沉浸模式">退出沉浸 ×</button>
        </header>
        <div class="immersive-task-block">
          <h2 id="immersive-title">选好下一步，再把时间留给它。</h2>
          <p id="immersive-meta" class="immersive-meta"></p>
        </div>
        <div class="immersive-ring-wrap">
          <svg class="immersive-ring-svg" viewBox="0 0 240 240" aria-hidden="true"><circle class="ring-base" cx="120" cy="120" r="108"/><circle id="immersive-ring" cx="120" cy="120" r="108"/></svg>
          <div id="immersive-readout" class="immersive-readout" role="timer" aria-label="沉浸模式剩余时间">25:00</div>
        </div>
        <div class="immersive-today" aria-live="polite"><span id="immersive-today-label"></span><div id="immersive-today-dots" class="tomato-dots" aria-hidden="true"></div></div>
        <div class="immersive-actions">
          <button id="immersive-start" class="button primary" type="button">开始专注 →</button>
          <button id="immersive-finish" class="button secondary" type="button">完成这一步 ✓</button>
        </div>
        <section class="immersive-sound" aria-label="白噪音">
          <div class="immersive-sound-head"><span>白噪音</span><span id="immersive-sound-state">安静</span></div>
          <div class="immersive-sound-options" role="group" aria-label="选择白噪音">
            <button type="button" data-sound="off">安静</button>
            <button type="button" data-sound="rain">雨声</button>
            <button type="button" data-sound="breeze">微风</button>
            <button type="button" data-sound="white">白噪音</button>
          </div>
          <label class="immersive-volume"><span>音量</span><input id="immersive-volume" type="range" min="0" max="100" step="5" value="35"></label>
        </section>
        <p class="immersive-hint">按 Esc 退出沉浸；计时会继续。声音只在沉浸模式中播放。</p>
      </div>`;
    document.body.append(dialog);
    $('immersive-close').onclick = () => dialog.close();
    $('immersive-start').onclick = () => {
      $('timer-start').click();
      const state = app.getState();
      if (state.preferences.sound !== 'off' && state.timer?.status === 'running') playSound(state.preferences.sound, state.preferences.volume);
    };
    $('immersive-finish').onclick = () => $('finish-step').click();
    dialog.querySelectorAll('[data-sound]').forEach(node => {
      node.onclick = () => {
        const state = app.getState(), kind = node.dataset.sound;
        state.preferences.sound = kind;
        app.saveAndRender();
        if (kind === 'off' || !state.timer || state.timer.status !== 'running') stopSound();
        else playSound(kind, state.preferences.volume);
      };
    });
    $('immersive-volume').oninput = event => {
      const state = app.getState(), value = Number(event.target.value);
      state.preferences.volume = value;
      window.StepSound?.setVolume(value / 100);
      $('immersive-sound-state').textContent = `${soundNames[state.preferences.sound] || '安静'} · ${value}%`;
    };
    $('immersive-volume').onchange = () => app.saveAndRender();
    dialog.addEventListener('close', () => stopSound());
    dialog.addEventListener('cancel', () => stopSound());
  }

  function playSound(kind, volume) {
    if (kind === 'off' || !kind) { stopSound(); return; }
    let played = false;
    try { played = window.StepSound?.play(kind, Number(volume) / 100) === true; } catch { played = false; }
    soundStarted = played;
    if (!played) app.toast('当前环境无法播放白噪音，计时不受影响。');
  }

  function stopSound() {
    if (soundStarted) { try { window.StepSound?.stop(); } catch {} }
    soundStarted = false;
  }

  function updateSound(state) {
    const kind = state.preferences.sound || 'off', volume = Number(state.preferences.volume) || 0;
    dialog.querySelectorAll('[data-sound]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.sound === kind)));
    $('immersive-volume').value = String(volume);
    $('immersive-sound-state').textContent = kind === 'off' ? '安静' : state.timer?.status === 'running' ? `${soundNames[kind]} · ${volume}%` : `${soundNames[kind]} · 开始时播放`;
  }

  function render(state) {
    if (!dialog || !dialog.open) return;
    const timer = state.timer, mode = timer?.kind || state.mode, isFocus = mode === 'focus';
    const goal = state.goals.find(g => g.id === (timer?.goalId || state.selectedGoal));
    const step = goal?.steps.find(s => s.id === (timer?.stepId || state.selectedStep) && !s.done);
    const ms = timer ? C.remaining(timer) : (isFocus ? state.minutes : state.preferences[mode]) * 60000;
    const total = timer ? timer.duration : (isFocus ? state.minutes : state.preferences[mode]) * 60000;
    const seconds = Math.ceil(ms / 1000);
    $('immersive-readout').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    $('immersive-ring').style.strokeDashoffset = String(678.584 * Math.max(0, Math.min(1, ms / (total || 1))));
    $('immersive-mode').textContent = isFocus ? (timer ? (timer.status === 'running' ? 'FOCUSING NOW' : 'PAUSED') : 'FOCUS TIME') : mode === 'shortBreak' ? 'SHORT BREAK' : 'LONG BREAK';
    $('immersive-title').textContent = isFocus
      ? step?.text || (goal?.steps.length && goal.steps.every(s => s.done) ? '这个目标已完成，去迎接下一件想做的事。' : '选好下一步，再把时间留给它。')
      : mode === 'shortBreak' ? '离开屏幕，给注意力一点恢复的时间。' : '完成了一轮。伸个懒腰，慢慢充好电。';
    const today = C.todayTomatoes(state.sessions), dailyGoal = state.preferences.dailyGoal;
    const parts = [];
    if (isFocus && goal) parts.push(goal.title);
    if (isFocus && step && (step.estimate || step.pomodoros)) parts.push(step.estimate ? `这个任务 ${step.pomodoros} / ${step.estimate} 个番茄` : `这个任务 ${step.pomodoros} 个番茄`);
    $('immersive-meta').textContent = parts.join(' · ');
    $('immersive-today-label').textContent = `今日番茄 ${today} / ${dailyGoal}`;
    $('immersive-today-dots').replaceChildren(...Array.from({ length: dailyGoal }, (_, i) => {
      const dot = document.createElement('i'); if (i < today) dot.className = 'on'; return dot;
    }));
    $('immersive-start').textContent = timer ? timer.status === 'running' ? '暂停一下 Ⅱ' : `继续${isFocus ? '专注' : '休息'} →` : isFocus && !step ? '先添加或选择一个行动' : `开始${isFocus ? '专注' : '休息'} →`;
    $('immersive-start').disabled = !timer && isFocus && !step;
    $('immersive-finish').disabled = !step || !isFocus;
    updateSound(state);
    if (!timer || timer.status !== 'running') stopSound();
  }

  function open() {
    if (!dialog) build();
    const state = app.getState();
    dialog.showModal();
    render(state);
    $('immersive-close').focus();
    if (state.timer?.status === 'running' && state.preferences.sound !== 'off') playSound(state.preferences.sound, state.preferences.volume);
  }

  function init(api) {
    app = api;
    const trigger = $('immersive-open');
    if (trigger) trigger.onclick = open;
    // Build lazily on first use so pages that never open it pay no layout cost.
  }

  window.StepFocus = { init, render, open };
})();