(() => {
  'use strict';
  document.getElementById('quick-task-open').addEventListener('click', () => {
    window.StepApp?.addTask(StepCore.dayKey(Date.now()));
  });
  const links = [...document.querySelectorAll('.header nav a')];
  const sections = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const activate = id => links.forEach(link => {
    const selected = link.getAttribute('href') === '#' + id;
    link.classList.toggle('is-current', selected);
    if (selected) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  let queued = false;
  const update = () => {
    queued = false;
    const active = sections.filter(section => section.getBoundingClientRect().top <= Math.min(200, innerHeight * .3)).at(-1);
    activate((active || sections[0]).id);
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  links.forEach(link => link.addEventListener('click', () => activate(link.hash.slice(1))));
  update();
})();
