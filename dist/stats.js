(() => {
  'use strict';
  const $ = id => document.getElementById(id), C = StepCore;
  let selectedYear = new Date().getFullYear(), sessions = [], years = [];
  const element = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
  const duration = seconds => {
    if (!seconds) return '0 分钟';
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = Math.floor(seconds % 60);
    return [hours ? `${hours} 小时` : '', minutes ? `${minutes} 分` : '', rest ? `${rest} 秒` : ''].filter(Boolean).join(' ');
  };
  function showView(view) {
    const annual = view === 'year';
    $('annual-stats').hidden = !annual; $('weekly-stats').hidden = annual;
    $('stats-year-view').setAttribute('aria-pressed', String(annual));
    $('stats-week-view').setAttribute('aria-pressed', String(!annual));
  }
  $('stats-year-view').onclick = () => showView('year');
  $('stats-week-view').onclick = () => showView('week');
  $('focus-year').onchange = event => { selectedYear = Number(event.target.value); draw(); };
  $('year-prev').onclick = () => { const index = years.indexOf(selectedYear); if (index > 0) { selectedYear = years[index - 1]; draw(); } };
  $('year-next').onclick = () => { const index = years.indexOf(selectedYear); if (index < years.length - 1) { selectedYear = years[index + 1]; draw(); } };
  function tableRow(label, seconds, count, activeDays) {
    const row = document.createElement('tr'), heading = element('th', label); heading.scope = 'row';
    row.append(heading, element('td', duration(seconds)), element('td', `${count} 次`), element('td', `${activeDays} 天`));
    return row;
  }
  function draw() {
    const summary = C.annual(sessions, selectedYear), index = years.indexOf(selectedYear);
    $('focus-year').value = String(selectedYear);
    $('year-prev').disabled = index <= 0; $('year-next').disabled = index >= years.length - 1;
    $('annual-duration').textContent = duration(summary.seconds);
    $('annual-description').textContent = `${selectedYear} 年 · ${summary.count} 次专注 · ${summary.activeDays} 个活跃日`;
    $('annual-empty').hidden = summary.count !== 0;
    $('annual-table-caption').textContent = `${selectedYear} 年逐月专注统计`;
    $('annual-chart').setAttribute('aria-label', `${selectedYear} 年每月专注时长，全年 ${duration(summary.seconds)}。各月精确数据见下方明细表。`);
    $('annual-chart').replaceChildren(); $('monthly-table-body').replaceChildren();
    const max = Math.max(60, ...summary.months.map(month => month.seconds));
    const now = new Date();
    for (const month of summary.months) {
      const future = selectedYear === now.getFullYear() && month.month > now.getMonth() + 1 && month.count === 0;
      const col = element('div', '', `month-column${future ? ' future-month' : ''}`);
      col.title = `${selectedYear} 年 ${month.month} 月：${future ? '尚未到来' : `${duration(month.seconds)}，${month.count} 次专注，${month.activeDays} 个活跃日`}`;
      const track = element('div', '', 'month-bar-track'), bar = element('div', '', 'month-bar');
      bar.style.height = month.seconds ? `${Math.max(4, month.seconds / max * 100)}%` : '2px';
      track.append(bar); col.append(track, element('span', `${month.month}月`)); $('annual-chart').append(col);
      const row = tableRow(`${month.month} 月`, month.seconds, month.count, month.activeDays);
      if (future) { row.classList.add('future-month'); row.children[1].textContent = '尚未到来'; row.children[2].textContent = '—'; row.children[3].textContent = '—'; }
      $('monthly-table-body').append(row);
    }
    $('monthly-table-total').replaceChildren(tableRow('全年合计', summary.seconds, summary.count, summary.activeDays));
  }
  function render(nextSessions) {
    sessions = nextSessions; years = C.focusYears(sessions);
    if (!years.includes(selectedYear)) selectedYear = new Date().getFullYear();
    const options = years.map(year => { const option = element('option', `${year} 年`); option.value = year; return option; });
    $('focus-year').replaceChildren(...options);
    draw();
  }
  window.StepStats = { render };
})();
