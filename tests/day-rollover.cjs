const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
if (process.platform === 'win32') { process.env.SystemRoot ||= 'C:\\Windows'; process.env.WINDIR ||= 'C:\\Windows'; }

const root = path.resolve(__dirname, '..'), qa = path.join(root, '.qa');
fs.mkdirSync(qa, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer((req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(path.join(root, 'dist'), file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(qa, 'day-rollover-' + Date.now());
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=19359', '--user-data-dir=' + profile, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let ws, count = 0;
  try {
    let tabs;
    for (let n = 0; n < 40; n++) {
      try { tabs = await (await fetch('http://127.0.0.1:19359/json/list', { signal: AbortSignal.timeout(1000) })).json(); break; }
      catch { await delay(250); }
    }
    if (!tabs) throw Error('Headless Edge unavailable');
    ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map(), errors = [];
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
      else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    };
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, message => message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const ev = async expression => {
      const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const assert = (value, message) => { if (!value) throw Error(message); count++; console.log('PASS ' + message); };
    await cdp('Page.enable'); await cdp('Runtime.enable');
    // Advance the local wall clock and invoke the real registered interval callback;
    // no test waits for midnight or changes the computer's clock.
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.RealDate = Date;
      window.mockNow = new RealDate(2026, 9, 18, 23, 59).getTime();
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [window.mockNow])); }
        static now() { return window.mockNow; }
      };
      window.testIntervals = [];
      window.setInterval = (callback, milliseconds) => testIntervals.push({ callback, milliseconds });
      window.runTick = () => testIntervals.filter(item => item.milliseconds === 1000).forEach(item => item.callback());
    ` });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let n = 0; n < 50; n++) { if (await ev('!!window.StepApp && !!window.StepPages')) break; await delay(100); }
    assert(await ev('testIntervals.some(item => item.milliseconds === 1000)'), 'app registers the foreground timer callback');
    await ev(`
      document.querySelector('#quick-task-open').click();
      document.querySelector('#task-title').value = '跨日验证任务';
      document.querySelector('#task-form').requestSubmit();
      const state = StepApp.getState();
      state.sessions = [
        { id: 'week-edge', goalTitle: '测试', stepTitle: '七天边缘记录', seconds: 600, finishedAt: new Date(2026, 9, 12, 12).getTime() },
        { id: 'past-year', goalTitle: '测试', stepTitle: '往年记录', seconds: 300, finishedAt: new Date(2025, 4, 1, 12).getTime() }
      ];
      state.dates = [{ id: 'tomorrow', title: '明天的约定', date: '2026-10-19', category: '', repeat: 'none', pinned: false }];
      StepApp.saveAndRender();
      document.querySelector('#focus-year').value = '2025';
      document.querySelector('#focus-year').dispatchEvent(new Event('change'));
      document.querySelector('#step-input').value = '未提交的行内草稿';
      document.querySelector('.step-edit').click();
      document.querySelector('#task-title').value = '未提交的弹窗草稿';
      window.savedBeforeMidnight = localStorage.getItem(StepCore.key);
    `);
    assert(await ev("document.querySelector('.step-date').textContent === '今天' && document.querySelector('#week-total').textContent === '10 分钟'"), 'fixture starts with a today task and a record on the weekly boundary');

    await ev('mockNow = new RealDate(2026, 9, 19, 0, 1).getTime(); runTick()');
    assert(await ev("document.querySelector('#today-label').textContent.startsWith('10月19日')"), 'foreground midnight refreshes the workspace date');
    assert(await ev("document.querySelector('.step-date').textContent.startsWith('已逾期')"), 'foreground midnight changes yesterday task to overdue');
    assert(await ev("document.querySelector('#plan-heading').textContent === '10 月 19 日 · 今天'"), 'calendar selection follows today when it was on today');
    assert(await ev("document.querySelector('.planner-date-count').textContent.includes('就是今天')"), 'important-date countdown changes to today');
    assert(await ev("document.querySelector('#week-total').textContent === '0 分钟' && document.querySelector('#week-chart .day:last-child').getAttribute('aria-label').startsWith('2026-10-19')"), 'weekly chart drops the expired boundary day without reloading');
    assert(await ev("document.querySelector('#focus-year').value === '2025' && document.querySelector('#annual-duration').textContent === '5 分'"), 'date refresh preserves the selected historical statistics year');
    assert(await ev("document.querySelector('#task-dialog').open && document.querySelector('#task-title').value === '未提交的弹窗草稿' && document.querySelector('#step-input').value === '未提交的行内草稿'"), 'date refresh leaves modal and inline drafts untouched');
    assert(await ev('localStorage.getItem(StepCore.key) === savedBeforeMidnight'), 'date-only refresh never rewrites persisted user data');
    await ev("window.taskNodeBeforeTick = document.querySelector('.step-item'); window.calendarNodeBeforeTick = document.querySelector('.planner-day'); window.monthNodeBeforeTick = document.querySelector('#monthly-table-body tr'); runTick()");
    assert(await ev("taskNodeBeforeTick === document.querySelector('.step-item') && calendarNodeBeforeTick === document.querySelector('.planner-day') && monthNodeBeforeTick === document.querySelector('#monthly-table-body tr')"), 'ordinary same-day ticks do not rebuild date views');

    await ev(`
      document.querySelector('#task-dialog').close();
      StepPages.show('planner');
      document.querySelector('[data-date="2026-10-25"]').click();
      document.querySelector('#dates-add').click();
      document.querySelector('#date-title').value = '日期草稿';
      mockNow = new RealDate(2026, 9, 20, 8).getTime();
      document.dispatchEvent(new Event('visibilitychange'));
    `);
    assert(await ev("document.querySelector('#today-label').textContent.startsWith('10月20日') && document.querySelector('#week-chart .day:last-child').getAttribute('aria-label').startsWith('2026-10-20')"), 'browser visibility restoration refreshes the local day and weekly chart');
    assert(await ev("document.querySelector('#plan-heading').textContent === '10 月 25 日' && document.querySelector('[data-date=\"2026-10-25\"]').getAttribute('aria-pressed') === 'true'"), 'a deliberately selected calendar date stays selected across days');
    assert(await ev("document.querySelector('#date-dialog').open && document.querySelector('#date-title').value === '日期草稿' && document.querySelector('#date-day').value === '2026-10-25'"), 'visibility restoration keeps important-date drafts intact');

    await ev("document.querySelector('#date-dialog').close(); document.querySelector('#planner-today').click(); mockNow = new RealDate(2026, 9, 21, 8).getTime(); window.dispatchEvent(new Event('nextstep-resume'))");
    assert(await ev("document.querySelector('#today-label').textContent.startsWith('10月21日') && document.querySelector('#plan-heading').textContent === '10 月 21 日 · 今天' && document.querySelector('#week-chart .day:last-child').getAttribute('aria-label').startsWith('2026-10-21')"), 'native resume refreshes all date-dependent views');

    await ev("mockNow = new RealDate(2026, 11, 31, 23, 59).getTime(); window.dispatchEvent(new Event('nextstep-resume')); mockNow = new RealDate(2027, 0, 1, 0, 1).getTime(); runTick()");
    assert(await ev("document.querySelector('#today-label').textContent.startsWith('1月1日') && document.querySelector('#planner-month-label').textContent === '2027 年 1 月' && document.querySelector('#plan-heading').textContent === '1 月 1 日 · 今天'"), 'today calendar follows the month and year boundary');
    assert(await ev("document.querySelector('#focus-year').value === '2025' && [...document.querySelector('#focus-year').options].some(option => option.value === '2027')"), 'new year becomes available without resetting the chosen statistics year');
    assert(await ev('localStorage.getItem(StepCore.key) === savedBeforeMidnight'), 'all rollover and resume paths preserve saved records exactly');
    assert(errors.length === 0, 'no browser runtime errors');
    fs.writeFileSync(path.join(qa, 'day-rollover-result.json'), JSON.stringify({ passed: count, errors }, null, 2));
    console.log(`${count} day-rollover browser checks passed`);
    await cdp('Browser.close');
  } finally { ws?.close(); browser.kill(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
