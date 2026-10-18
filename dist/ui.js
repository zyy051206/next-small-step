(() => {
  'use strict';
  const pages = [...document.querySelectorAll('[data-page]')];
  const links = [...document.querySelectorAll('.header nav a')];
  const names = new Set(pages.map(page => page.id));
  const ongoing = document.getElementById('ongoing-focus');
  let current = null;

  function updateTimer() {
    const timer = window.StepApp?.getState().timer;
    ongoing.hidden = !timer || current === 'workspace';
    document.body.classList.toggle('has-ongoing-focus', !ongoing.hidden);
    if (!ongoing.hidden) {
      const status = document.getElementById('focus-state').textContent;
      const time = document.getElementById('timer-readout').textContent;
      ongoing.querySelector('strong').textContent = `${status} · ${time}`;
      ongoing.setAttribute('aria-label', `${status}，剩余 ${time}，返回工作台`);
    }
  }

  function render(id, { focus = true, focusTarget } = {}) {
    current = id;
    pages.forEach(page => { page.hidden = page.id !== id; });
    links.forEach(link => {
      const selected = link.hash === '#' + id;
      link.classList.toggle('is-current', selected);
      if (selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    updateTimer();
    const page = document.getElementById(id);
    const target = focusTarget ? page.querySelector(focusTarget) : page.querySelector('h1');
    if (focus && target) {
      if (!target.matches('button,a,input,select,textarea')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (focusTarget && target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
  }

  function show(id, options = {}) {
    if (!names.has(id)) id = 'workspace';
    if (location.hash !== '#' + id) {
      history[options.replace ? 'replaceState' : 'pushState'](null, '', '#' + id);
    }
    render(id, options);
  }

  function restore(initial = false) {
    let id = location.hash.slice(1);
    if (!names.has(id)) {
      id = 'workspace';
      history.replaceState(null, '', '#workspace');
    }
    // Back/forward can emit both events for the same view.
    if (current !== id) render(id, { focus: !initial });
  }

  document.querySelectorAll('.header a[href^="#"]').forEach(link => {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      show(link.hash.slice(1));
    });
  });
  document.getElementById('quick-task-open').addEventListener('click', () => {
    window.StepApp?.addTask(StepCore.dayKey(Date.now()));
  });
  ongoing.addEventListener('click', () => show('workspace', { focusTarget: '#timer-start' }));
  window.StepPages = { show, updateTimer };
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  addEventListener('hashchange', () => restore());
  addEventListener('popstate', () => restore());
  restore(true);
})();
