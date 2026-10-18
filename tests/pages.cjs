const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
if (process.platform === 'win32') { process.env.SystemRoot ||= 'C:\\Windows'; process.env.WINDIR ||= 'C:\\Windows'; }

const root = path.resolve(__dirname, '..');
const qa = path.join(root, '.qa');
fs.mkdirSync(qa, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pages = ['workspace', 'planner', 'important-dates', 'footprints'];
const screenshots = [];
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
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = path.join(qa, 'pages-browser-' + Date.now());
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=19349',
    '--user-data-dir=' + profile, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let ws, count = 0;
  try {
    let tabs;
    for (let n = 0; n < 40; n++) {
      try { tabs = await (await fetch('http://127.0.0.1:19349/json/list', { signal: AbortSignal.timeout(1000) })).json(); break; }
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
      const next = ++id;
      pending.set(next, message => message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result));
      ws.send(JSON.stringify({ id: next, method, params }));
    });
    const ev = async expression => {
      const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const assert = (value, label) => { if (!value) throw Error(label); count++; console.log('PASS ' + label); };
    const waitFor = async (expression, label = 'page ready') => {
      for (let n = 0; n < 60; n++) { if (await ev(expression)) return; await delay(100); }
      throw Error('Timed out: ' + label);
    };
    const ready = "document.readyState==='complete' && !!window.StepPages && !!window.StepApp && document.querySelectorAll('#planner-grid .planner-day').length===42 && document.querySelectorAll('#annual-chart .month-column').length===12";
    const active = page => `document.querySelectorAll('[data-page]:not([hidden])').length===1 && !document.getElementById(${JSON.stringify(page)}).hidden && document.getElementById(${JSON.stringify(page)}).getClientRects().length>0 && document.querySelector('.header nav a[aria-current="page"]')?.hash===${JSON.stringify('#' + page)}`;
    const viewport = async width => {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 600 });
      await delay(100);
    };
    const click = async selector => {
      const point = await ev(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node || !node.getClientRects().length) throw Error('Click target is hidden or missing: '+${JSON.stringify(selector)}); node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}); const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      await delay(80);
    };
    const navigate = async page => {
      await click(`.header nav a[href="#${page}"]`);
      await waitFor(active(page), `show ${page}`);
    };
    const reload = async () => { await cdp('Page.reload'); await delay(150); await waitFor(ready); };
    const screenshot = async name => {
      await ev("window.scrollTo({top:0,left:0,behavior:'instant'});document.querySelector('#toast').style.visibility='hidden'");
      await delay(100);
      const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(qa, name), Buffer.from(result.data, 'base64'));
      screenshots.push(name);
      await ev("document.querySelector('#toast').style.visibility=''");
    };

    await cdp('Runtime.enable'); await cdp('Page.enable'); await viewport(1440);
    await cdp('Page.navigate', { url: url + '#important-dates' }); await waitFor(ready);
    assert(await ev(active('important-dates')), 'direct important-date link opens only that page');
    await reload();
    assert(await ev(active('important-dates')), 'refresh preserves the linked page');
    await navigate('planner'); await navigate('footprints');
    await ev('history.back()'); await waitFor(active('planner'), 'browser back to calendar');
    assert(await ev("location.hash==='#planner'"), 'browser Back restores the preceding page and hash');
    await ev('history.forward()'); await waitFor(active('footprints'), 'browser forward to statistics');
    assert(await ev("location.hash==='#footprints'"), 'browser Forward restores the following page');
    await ev("location.hash='#not-a-page'"); await waitFor(active('workspace'), 'invalid hash fallback');
    assert(await ev(active('workspace')), 'unknown hash falls back to the workspace');
    await cdp('Page.navigate', { url }); await delay(100); await waitFor(ready);
    assert(await ev(active('workspace')), 'opening without a hash starts at the workspace');
    assert(await ev("document.querySelector('#ongoing-focus').hidden || !document.querySelector('#ongoing-focus').getClientRects().length"), 'no ongoing-timer shortcut is shown before a timer exists');

    for (const width of [1440, 390, 320]) {
      await viewport(width);
      for (const page of pages) {
        await navigate(page);
        assert(await ev(`${active(page)} && document.documentElement.scrollWidth<=${width}`), `${width}px ${page} shows one page without horizontal overflow`);
        assert(await ev("[...document.querySelectorAll('[data-page][hidden] button,[data-page][hidden] input,[data-page][hidden] select')].every(node=>node.getClientRects().length===0)"), `${width}px ${page} hides controls belonging to other pages`);
        assert(await ev("(() => { const original=document.activeElement; for(const page of document.querySelectorAll('[data-page][hidden]')) { page.querySelector('button,input,select,a[href]')?.focus(); if(page.contains(document.activeElement)) return false; } original?.focus(); return true; })()"), `${width}px ${page} excludes hidden pages from keyboard focus`);
        if (page === 'footprints') assert(await ev("document.querySelector('#annual-chart').getBoundingClientRect().height>0 && document.querySelectorAll('#annual-chart .month-column').length===12 && document.querySelector('#history-list').closest('[data-page]').id==='footprints'"), `${width}px statistics keeps twelve visible months and owns recent history`);
        await screenshot(`pages-empty-${width}-${page}.png`);
      }
    }

    await viewport(1440); await navigate('planner');
    await click('#planner-prev-month');
    const calendarView = await ev("({label:document.querySelector('#planner-month-label').textContent,date:document.querySelector('#planner-grid [aria-pressed=true]')?.dataset.date||null})");
    await navigate('important-dates'); await navigate('planner');
    assert(await ev(`JSON.stringify({label:document.querySelector('#planner-month-label').textContent,date:document.querySelector('#planner-grid [aria-pressed=true]')?.dataset.date||null})===${JSON.stringify(JSON.stringify(calendarView))}`), 'switching pages preserves the selected calendar month and date');
    await click('#planner-today'); await navigate('footprints'); await click('#stats-week-view');
    await navigate('workspace'); await navigate('footprints');
    assert(await ev("!document.querySelector('#weekly-stats').hidden && document.querySelector('#annual-stats').hidden"), 'switching pages preserves the chosen statistics period');
    await click('#stats-year-view');
    await navigate('workspace');
    for (const title of ['整理作品的第一版说明', '检查演示中的交互细节']) {
      await click('#quick-task-open');
      await ev(`document.querySelector('#task-title').value=${JSON.stringify(title)};document.querySelector('#task-date').value=StepCore.dayKey(Date.now());document.querySelector('#task-form').requestSubmit()`);
    }
    await navigate('planner'); await click('.planner-task-title');
    assert(await ev(`${active('workspace')} && document.querySelector('#focus-task').textContent==='整理作品的第一版说明'`), 'choosing a calendar task opens its focus workspace');
    await click('[data-minutes="10"]'); await click('#timer-start');
    const running = await ev("JSON.parse(localStorage.getItem(StepCore.key)).timer");
    assert(running?.status === 'running', 'focus timer starts from the selected calendar task');
    const before = await ev("document.querySelector('#timer-readout').textContent");
    await navigate('planner'); await click('.planner-task-row:nth-child(2) .planner-task-title');
    assert(await ev(`${active('planner')} && JSON.parse(localStorage.getItem(StepCore.key)).timer.stepId===${JSON.stringify(running.stepId)} && JSON.parse(localStorage.getItem(StepCore.key)).selectedStep===${JSON.stringify(running.stepId)}`), 'locked task selection stays on the calendar without replacing the running task');
    for (const page of ['important-dates', 'footprints', 'planner']) {
      await navigate(page);
      assert(await ev(`!document.querySelector('#ongoing-focus').hidden && document.querySelector('#ongoing-focus').getClientRects().length>0 && JSON.parse(localStorage.getItem(StepCore.key)).timer.endsAt===${running.endsAt}`), `${page} keeps the timer deadline and exposes a return shortcut`);
    }
    await delay(1200);
    assert(await ev(`document.querySelector('#timer-readout').textContent!==${JSON.stringify(before)} && JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===0`), 'timer continues while its workspace is hidden without recording a premature session');
    await reload();
    assert(await ev(`${active('planner')} && JSON.parse(localStorage.getItem(StepCore.key)).timer.endsAt===${running.endsAt}`), 'refresh restores the current page and the same running timer');
    await click('#ongoing-focus');
    assert(await ev(`${active('workspace')} && !document.querySelector('#ongoing-focus').getClientRects().length`), 'ongoing-focus shortcut returns to the workspace and hides itself');
    await click('#timer-start');
    const remaining = await ev("JSON.parse(localStorage.getItem(StepCore.key)).timer.remaining");
    await navigate('important-dates'); await delay(1100); await navigate('workspace');
    assert(await ev(`JSON.parse(localStorage.getItem(StepCore.key)).timer.status==='paused' && JSON.parse(localStorage.getItem(StepCore.key)).timer.remaining===${remaining}`), 'page switching preserves a paused timer without consuming remaining time');
    await click('#timer-reset'); await click('#confirm-yes');
    await navigate('planner'); await click('.planner-task-row:nth-child(2) .planner-task-title');
    assert(await ev(`${active('workspace')} && document.querySelector('#focus-task').textContent==='检查演示中的交互细节'`), 'calendar can select another task after the timer is reset');
    await navigate('important-dates'); await click('#dates-add');
    await ev("document.querySelector('#date-title').value='作品展示';document.querySelector('#date-day').value=StepCore.dayKey(Date.now());document.querySelector('#date-category').value='学习';document.querySelector('#date-form').requestSubmit()");
    const saved = await ev('JSON.stringify(StepApp.getState())');
    for (const width of [1440, 390]) {
      await viewport(width);
      for (const page of pages) { await navigate(page); await screenshot(`pages-filled-${width}-${page}.png`); }
    }
    assert(await ev(`JSON.stringify(StepApp.getState())===${JSON.stringify(saved)}`), 'navigation and responsive layouts leave all saved data unchanged');
    // Verify the user's double-click entry point in this same isolated profile.
    const localUrl = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
    await cdp('Page.navigate', { url: localUrl + '#important-dates' }); await delay(150); await waitFor(ready);
    assert(await ev(`location.protocol==='file:' && location.hash==='#important-dates' && ${active('important-dates')}`), 'local HTML direct link opens its requested page');
    await reload();
    assert(await ev(active('important-dates')), 'local HTML refresh preserves the current page');
    await navigate('planner'); await navigate('workspace');
    assert(await ev(`location.protocol==='file:' && location.hash==='#workspace' && ${active('workspace')}`), 'local HTML switches pages without leaving the local file');
    await ev('history.back()'); await waitFor(active('planner'), 'local HTML browser back');
    assert(await ev("location.hash==='#planner'"), 'local HTML Back restores the preceding page');
    assert(errors.length === 0, 'no routing or browser runtime errors');
    fs.writeFileSync(path.join(qa, 'pages-result.json'), JSON.stringify({ passed: count, errors, viewports: [1440, 390, 320], screenshots }, null, 2));
    console.log(`${count} page-navigation checks passed`);
    await cdp('Browser.close');
  } finally { ws?.close(); browser.kill(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
