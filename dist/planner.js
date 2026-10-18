(function (root) {
  'use strict';

  const C = root.StepCore || (typeof module !== 'undefined' && module.exports ? require('./core.js') : null);
  const priorityOrder = { high: 0, normal: 1, low: 2 };
  const priorityLabels = { high: '高优先级', normal: '普通', low: '低优先级' };

  function localDate(key) {
    const [year, month, day] = key.split('-').map(Number);
    // setFullYear also handles years below 100 without Date's 1900 offset.
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(12, 0, 0, 0);
    return date;
  }

  function dateKey(date) {
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function monthGrid(year, month) {
    const first = localDate(`${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`);
    first.setDate(first.getDate() - (first.getDay() + 6) % 7);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(first);
      date.setDate(first.getDate() + index);
      return { key: dateKey(date), day: date.getDate(), inMonth: date.getMonth() === month && date.getFullYear() === year };
    });
  }

  function taskRows(state, filter, selected, today) {
    return state.goals.flatMap(goal => goal.steps.map(step => ({ goal, step })))
      .filter(({ step }) => filter === 'unplanned' ? !step.dueDate && !step.done
        : filter === 'overdue' ? !!step.dueDate && step.dueDate < today && !step.done
          : step.dueDate === selected)
      .sort((a, b) => Number(a.step.done) - Number(b.step.done)
        || (priorityOrder[a.step.priority] ?? 1) - (priorityOrder[b.step.priority] ?? 1)
        || (a.step.dueDate || '').localeCompare(b.step.dueDate || ''));
  }

  function eventsForDay(events, key) {
    const time = localDate(key).getTime();
    return events.filter(event => C.occurrence(event, time) === key);
  }

  function sortedEvents(events, now = Date.now()) {
    return events.map(event => {
      const next = C.occurrence(event, now);
      return { event, next, delta: C.dateDelta(next, now) };
    }).sort((a, b) => Number(b.event.pinned) - Number(a.event.pinned)
      || Math.abs(a.delta) - Math.abs(b.delta) || b.delta - a.delta);
  }

  let bridge, ready = false, state, selectedDate = dateKey(new Date());
  let shownYear = new Date().getFullYear(), shownMonth = new Date().getMonth(), filter = 'day', editingDate = null;
  let lastDay = selectedDate;
  const $ = id => document.getElementById(id);
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, className, action, label) {
    const node = element('button', className, text);
    node.type = 'button';
    node.onclick = action;
    if (label) node.setAttribute('aria-label', label);
    return node;
  }
  function dayLabel(key) {
    const date = localDate(key);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
  function chooseDay(key, focus) {
    selectedDate = key;
    const date = localDate(key);
    shownYear = date.getFullYear();
    shownMonth = date.getMonth();
    filter = 'day';
    render(bridge.getState());
    if (focus) $('planner-grid').querySelector(`[data-date="${key}"]`)?.focus();
  }
  function shiftMonth(amount) {
    const date = localDate(`${String(shownYear).padStart(4, '0')}-${String(shownMonth + 1).padStart(2, '0')}-01`);
    date.setMonth(date.getMonth() + amount);
    if (date.getFullYear() < 1 || date.getFullYear() > 9999) return;
    shownYear = date.getFullYear(); shownMonth = date.getMonth();
    render(bridge.getState());
  }

  function refreshDay() {
    const today = dateKey(new Date());
    if (today === lastDay) return;
    if (selectedDate === lastDay) {
      const previous = localDate(lastDay), current = localDate(today);
      selectedDate = today;
      if (shownYear === previous.getFullYear() && shownMonth === previous.getMonth()) {
        shownYear = current.getFullYear(); shownMonth = current.getMonth();
      }
    }
    lastDay = today;
  }

  function init(api) {
    bridge = api;
    if (ready) return;
    if (!$('planner') || !$('important-dates')) return;
    ready = true;
    $('planner').innerHTML = `
      <div class="planner-section-heading"><div><span class="planner-eyebrow">MAKE SPACE FOR YOUR DAY</span><h1 id="planner-title">日历与计划</h1><p>把想做的事，安排到看得见的日子里。</p></div></div>
      <div class="planner-layout">
        <div class="planner-calendar">
          <div class="planner-calendar-toolbar"><h3 id="planner-month-label"></h3><div class="planner-calendar-nav"><button id="planner-today" type="button">今天</button><button id="planner-prev-month" type="button" aria-label="上一个月">‹</button><button id="planner-next-month" type="button" aria-label="下一个月">›</button></div></div>
          <div class="planner-weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
          <div id="planner-grid" class="planner-grid" role="group" aria-label="选择日期，方向键可切换日期"></div>
          <div class="planner-calendar-key"><span><i class="planner-task-dot"></i>待办</span><span><i class="planner-date-dot"></i>重要日期</span><span>点击日期查看安排</span></div>
        </div>
        <div class="planner-agenda">
          <div class="planner-agenda-heading"><div><span id="plan-day-context" class="planner-eyebrow"></span><h3 id="plan-heading"></h3></div><button id="plan-add" class="planner-add-button" type="button"><span aria-hidden="true">＋</span>安排待办</button></div>
          <div class="planner-filters" role="group" aria-label="计划筛选"><button type="button" data-plan-filter="day" aria-pressed="true">当天 <span></span></button><button type="button" data-plan-filter="unplanned" aria-pressed="false">未安排 <span></span></button><button type="button" data-plan-filter="overdue" aria-pressed="false">已逾期 <span></span></button></div>
          <div id="plan-items" class="planner-agenda-items" aria-live="polite"></div>
          <p class="planner-agenda-note" id="plan-note">点击待办名称，将它选为当前专注任务。</p>
        </div>
      </div>`;
    $('important-dates').innerHTML = `
      <div class="planner-section-heading"><div><span class="planner-eyebrow">SOMETHING TO LOOK FORWARD TO</span><h1 id="dates-title">重要日期</h1><p>把期待和约定，放进日历。</p></div><button id="dates-add" class="planner-add-button" type="button"><span aria-hidden="true">＋</span>添加日期</button></div>
      <div id="date-list" class="planner-date-list"></div>`;
    const dialog = element('dialog', 'planner-date-dialog');
    dialog.id = 'date-dialog';
    dialog.setAttribute('aria-labelledby', 'date-dialog-title');
    dialog.innerHTML = `<form id="date-form"><div class="dialog-heading"><span class="planner-eyebrow">SAVE A LITTLE ANTICIPATION</span><button type="button" id="date-close" class="close-button" aria-label="关闭重要日期编辑">×</button></div><h2 id="date-dialog-title">记住一个重要日子</h2>
      <label for="date-title">这个日子叫什么</label><input id="date-title" name="title" maxlength="100" required autocomplete="off">
      <label for="date-day">日期</label><input id="date-day" name="date" type="date" min="0001-01-01" max="9999-12-31" required>
      <label for="date-category">分类 <span class="optional">可自定义</span></label><input id="date-category" name="category" maxlength="32" list="date-category-options" autocomplete="off"><datalist id="date-category-options"><option value="考试"></option><option value="工作"></option><option value="生活"></option><option value="纪念日"></option></datalist>
      <div class="planner-date-options"><label><input id="date-repeat" name="repeat" type="checkbox"><span>每年重复<small>每年重新计算倒计时</small></span></label><label><input id="date-pinned" name="pinned" type="checkbox"><span>置顶显示<small>把最重要的日子放在前面</small></span></label></div>
      <p id="date-leap-note" class="planner-form-note" hidden>2 月 29 日在平年按 2 月 28 日计算。</p><p id="date-error" class="form-error" role="alert"></p><button type="submit" class="button primary">保存日期 <span aria-hidden="true">↗</span></button></form>`;
    document.body.append(dialog);
    $('planner-prev-month').onclick = () => shiftMonth(-1);
    $('planner-next-month').onclick = () => shiftMonth(1);
    $('planner-today').onclick = () => chooseDay(dateKey(new Date()));
    $('plan-add').onclick = () => bridge.addTask(selectedDate);
    document.querySelectorAll('[data-plan-filter]').forEach(node => { node.onclick = () => { filter = node.dataset.planFilter; render(bridge.getState()); }; });
    $('dates-add').onclick = () => openDate();
    $('date-close').onclick = () => dialog.close();
    $('date-repeat').onchange = updateLeapNote;
    $('date-day').oninput = updateLeapNote;
    $('date-form').onsubmit = saveDate;
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    $('planner-grid').addEventListener('keydown', event => {
      const target = event.target.closest('[data-date]');
      if (!target) return;
      const date = localDate(target.dataset.date);
      const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (Object.prototype.hasOwnProperty.call(shifts, event.key)) date.setDate(date.getDate() + shifts[event.key]);
      else if (event.key === 'Home') date.setDate(date.getDate() - (date.getDay() + 6) % 7);
      else if (event.key === 'End') date.setDate(date.getDate() + 6 - (date.getDay() + 6) % 7);
      else return;
      event.preventDefault();
      if (date.getFullYear() >= 1 && date.getFullYear() <= 9999) chooseDay(dateKey(date), true);
    });
  }

  function renderCalendar() {
    const now = dateKey(new Date());
    $('planner-month-label').textContent = `${shownYear} 年 ${shownMonth + 1} 月`;
    $('planner-prev-month').disabled = shownYear === 1 && shownMonth === 0;
    $('planner-next-month').disabled = shownYear === 9999 && shownMonth === 11;
    const cells = monthGrid(shownYear, shownMonth);
    const counts = new Map(cells.map(cell => [cell.key, { tasks: 0, dates: 0 }]));
    state.goals.forEach(goal => goal.steps.forEach(step => {
      if (!step.done && counts.has(step.dueDate)) counts.get(step.dueDate).tasks++;
    }));
    const firstTime = localDate(cells.find(cell => C.validDate(cell.key)).key).getTime();
    state.dates.forEach(event => {
      const key = C.occurrence(event, firstTime);
      if (counts.has(key)) counts.get(key).dates++;
    });
    const fragment = document.createDocumentFragment();
    const tabDate = cells.some(cell => cell.key === selectedDate) ? selectedDate : cells.find(cell => cell.inMonth).key;
    cells.forEach(cell => {
      const count = counts.get(cell.key), selected = cell.key === selectedDate;
      const node = button('', `planner-day${cell.inMonth ? '' : ' outside'}${cell.key === now ? ' today' : ''}${selected ? ' selected' : ''}`, () => chooseDay(cell.key, true), `${dayLabel(cell.key)}${cell.key === now ? '，今天' : ''}，${count.tasks} 项待办，${count.dates} 个重要日期`);
      node.dataset.date = cell.key;
      node.disabled = !C.validDate(cell.key);
      node.tabIndex = cell.key === tabDate ? 0 : -1;
      node.setAttribute('aria-pressed', String(selected));
      if (cell.key === now) node.setAttribute('aria-current', 'date');
      node.append(element('span', 'planner-day-number', cell.day));
      const dots = element('span', 'planner-day-dots');
      dots.setAttribute('aria-hidden', 'true');
      if (count.tasks) dots.append(element('i', 'planner-task-dot'));
      if (count.dates) dots.append(element('i', 'planner-date-dot'));
      node.append(dots); fragment.append(node);
    });
    $('planner-grid').replaceChildren(fragment);
  }

  function renderAgenda() {
    const today = dateKey(new Date()), day = localDate(selectedDate);
    const rows = taskRows(state, filter, selectedDate, today);
    const events = filter === 'day' ? eventsForDay(state.dates, selectedDate) : [];
    const dateText = `${day.getMonth() + 1} 月 ${day.getDate()} 日`;
    $('plan-day-context').textContent = filter === 'day' ? `${day.getFullYear()} · 星期${'日一二三四五六'[day.getDay()]}` : filter === 'unplanned' ? '留一点时间，安排下一步' : '重新安排，也是一种前进';
    $('plan-heading').textContent = filter === 'day' ? `${dateText}${selectedDate === today ? ' · 今天' : ''}` : filter === 'unplanned' ? '还没安排的待办' : '需要重新安排的待办';
    $('plan-add').setAttribute('aria-label', `为${dayLabel(selectedDate)}安排待办`);
    document.querySelectorAll('[data-plan-filter]').forEach(node => {
      node.setAttribute('aria-pressed', String(node.dataset.planFilter === filter));
      const amount = taskRows(state, node.dataset.planFilter, selectedDate, today).filter(row => !row.step.done).length;
      node.querySelector('span').textContent = amount ? String(amount) : '';
    });
    const fragment = document.createDocumentFragment();
    events.forEach(event => {
      const row = element('div', 'planner-event-row');
      const mark = element('span', 'planner-event-mark', '◇'); mark.setAttribute('aria-hidden', 'true');
      const content = button('', 'planner-event-title', () => openDate(event.id), `编辑重要日期：${event.title}`);
      content.append(element('strong', '', event.title), element('small', '', `${event.category || '重要日期'}${event.repeat === 'yearly' ? ' · 每年重复' : ''}`));
      row.append(mark, content, element('span', 'planner-event-tag', '重要日期')); fragment.append(row);
    });
    rows.forEach(({ goal, step }) => {
      const active = state.selectedGoal === goal.id && state.selectedStep === step.id;
      const row = element('div', `planner-task-row${step.done ? ' done' : ''}${active ? ' active' : ''}`);
      const check = button(step.done ? '✓' : '', 'planner-task-check', () => bridge.completeStep(goal, step), `${step.done ? '撤销完成' : '完成待办'}：${step.text}`);
      check.setAttribute('aria-pressed', String(step.done));
      const content = button('', 'planner-task-title', () => {
        if (!step.done && bridge.selectTask(goal.id, step.id)) root.StepPages?.show('workspace', { focusTarget: '#timer-start' });
      }, step.done ? `${step.text}，已完成` : `选择专注任务：${step.text}`);
      content.disabled = step.done;
      const title = element('strong', '', step.text);
      const meta = element('span', 'planner-task-meta');
      meta.append(element('small', '', goal.title));
      if (step.priority && step.priority !== 'normal') meta.append(element('span', `planner-priority ${step.priority}`, priorityLabels[step.priority]));
      if (filter === 'overdue') meta.append(element('span', 'planner-overdue-label', `已过 ${-C.dateDelta(step.dueDate)} 天`));
      if (active && !step.done) meta.append(element('span', 'planner-current-label', '当前专注'));
      content.append(title, meta);
      const edit = button('编辑', 'planner-task-edit', () => bridge.editTask(goal.id, step.id), `编辑待办：${step.text}`);
      row.append(check, content, edit); fragment.append(row);
    });
    if (!rows.length && !events.length) {
      const empty = element('div', 'planner-empty-agenda');
      const icon = element('span', 'planner-empty-icon');
      icon.innerHTML = '<svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><rect x="8" y="10" width="28" height="28" rx="6" stroke="currentColor" stroke-width="1.4"/><path d="M15 6v8m14-8v8M8 20h28m-20 8 4 4 8-8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const title = filter === 'day' ? '这一天，还留着空白' : filter === 'unplanned' ? '没有未安排的待办' : '没有逾期的待办';
      const description = filter === 'day' ? '给自己留一件想完成的小事，也留一点余地。' : filter === 'unplanned' ? '没有设置日期的行动会放在这里，随时可以安排。' : '按自己的节奏来。已经完成的行动不会出现在这里。';
      empty.append(icon, element('strong', '', title), element('p', '', description)); fragment.append(empty);
    }
    $('plan-items').replaceChildren(fragment);
    $('plan-note').textContent = filter === 'day' ? '点击待办名称，选为当前专注任务。' : filter === 'unplanned' ? '点击「编辑」为待办安排日期与优先级。' : '点击「编辑」调整日期，给计划一次重新开始的机会。';
  }

  function renderDates() {
    const fragment = document.createDocumentFragment();
    if (!state.dates.length) {
      const empty = element('div', 'planner-dates-empty');
      const mark = element('span', 'planner-dates-empty-mark');
      mark.innerHTML = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="9" y="11" width="30" height="29" rx="7" stroke="currentColor" stroke-width="1.5"/><path d="M17 7v8m14-8v8M9 21h30m-15 5 1.7 3.5 3.8.6-2.8 2.7.7 3.8-3.4-1.8-3.4 1.8.7-3.8-2.8-2.7 3.8-.6L24 26Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const copy = element('div', ''); copy.append(element('strong', '', '下一次期待，是什么时候？'), element('p', '', '记录考试、生日、旅行，或任何对你重要的一天。'));
      empty.append(mark, copy, button('记下一个日子 ↗', 'planner-empty-date-action', () => openDate())); fragment.append(empty);
    }
    sortedEvents(state.dates).forEach(({ event, next, delta }) => {
      const card = element('article', `planner-date-card${delta === 0 ? ' is-today' : ''}`);
      const top = element('div', 'planner-date-top');
      const badges = element('div', 'planner-date-badges');
      badges.append(element('span', 'planner-date-category', event.category || '重要日期'));
      if (event.pinned) badges.append(element('span', 'planner-date-pin', '已置顶'));
      const controls = element('div', 'planner-date-controls');
      controls.append(button('编辑', '', () => openDate(event.id), `编辑重要日期：${event.title}`), button('×', 'planner-date-delete', () => deleteDate(event.id), `删除重要日期：${event.title}`));
      top.append(badges, controls);
      const title = element('h3', '', event.title);
      const date = element('p', 'planner-date-target', `${next.replaceAll('-', '.')} ${event.repeat === 'yearly' ? '· 每年重复' : ''}`.trim());
      const count = element('div', 'planner-date-count');
      if (delta === 0) count.append(element('strong', 'planner-date-today-label', '就是今天'), element('span', '', '把今天过得特别一点'));
      else count.append(element('span', '', delta > 0 ? '还有' : '已经过去'), element('strong', '', Math.abs(delta)), element('span', '', '天'));
      card.append(top, title, date, count); fragment.append(card);
    });
    $('date-list').replaceChildren(fragment);
  }

  function openDate(id) {
    const event = bridge.getState().dates.find(item => item.id === id);
    editingDate = event?.id || null;
    $('date-dialog-title').textContent = event ? '编辑重要日期' : '记住一个重要日子';
    $('date-form').reset();
    $('date-title').value = event?.title || '';
    $('date-day').value = event?.date || selectedDate;
    $('date-category').value = event?.category || '';
    $('date-repeat').checked = event?.repeat === 'yearly';
    $('date-pinned').checked = !!event?.pinned;
    $('date-error').textContent = '';
    updateLeapNote();
    $('date-dialog').showModal();
    $('date-title').focus();
  }

  function updateLeapNote() {
    $('date-leap-note').hidden = !$('date-repeat').checked || !$('date-day').value.endsWith('-02-29');
  }

  function saveDate(event) {
    event.preventDefault();
    const title = $('date-title').value.trim(), date = $('date-day').value, category = $('date-category').value.trim();
    if (!title) { $('date-error').textContent = '先给这个日子起一个名字。'; $('date-title').focus(); return; }
    if (title.length > 100 || category.length > 32) { $('date-error').textContent = '名称最多 100 个字，分类最多 32 个字。'; return; }
    if (!C.validDate(date)) { $('date-error').textContent = '请选择一个有效的日期。'; $('date-day').focus(); return; }
    const current = bridge.getState();
    if (!editingDate && current.dates.length >= 200) { $('date-error').textContent = '最多可保存 200 个重要日期，请先整理已有日期。'; return; }
    const values = { title, date, category, repeat: $('date-repeat').checked ? 'yearly' : 'none', pinned: $('date-pinned').checked };
    if (editingDate) {
      const target = current.dates.find(item => item.id === editingDate);
      if (!target) { $('date-error').textContent = '这个日期已不存在，请关闭后重新添加。'; return; }
      Object.assign(target, values);
    } else current.dates.push({ id: C.id(), ...values });
    $('date-dialog').close();
    bridge.saveAndRender();
    bridge.toast(editingDate ? '重要日期已更新。' : '已经记下这个重要日子。');
  }

  function deleteDate(id) {
    const event = bridge.getState().dates.find(item => item.id === id);
    if (!event) return;
    bridge.confirm('删除这个重要日期？', `「${event.title}」将从日历和重要日期中移除。`, () => {
      const current = bridge.getState();
      current.dates = current.dates.filter(item => item.id !== id);
      bridge.saveAndRender();
      bridge.toast('重要日期已删除。');
    });
  }

  function render(nextState) {
    if (!ready) return;
    // The app's shared day-change refresh keeps all pages on the same local day.
    refreshDay();
    state = nextState;
    renderCalendar(); renderAgenda(); renderDates();
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { monthGrid, taskRows, eventsForDay, sortedEvents };
  else root.StepPlanner = { init, render };
})(globalThis);
