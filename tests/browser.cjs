const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
if (process.platform === 'win32') { process.env.SystemRoot ||= 'C:\\Windows'; process.env.WINDIR ||= 'C:\\Windows'; }
const root = path.resolve(__dirname, '..');
const qa = path.join(root, '.qa'); fs.mkdirSync(qa, { recursive: true });
// Never pick up a backup from an earlier run or use the user's browser profile.
const downloads = path.join(qa, 'downloads-' + Date.now()); fs.mkdirSync(downloads, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
const server = createServer((req, res) => { try { const file = req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1); res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html'); res.end(fs.readFileSync(path.join(root, 'dist', file))); } catch { res.statusCode = 404; res.end(); } });
(async () => {
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const url = `http://127.0.0.1:${server.address().port}/`;
 const profile = path.join(qa, 'browser-' + Date.now());
 const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-extensions', '--disable-gpu', '--no-first-run', '--remote-debugging-port=19347', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
 let ws, count = 0;
 try {
  let tabs;
  for (let n = 0; n < 20; n++) { try { tabs = await (await fetch('http://127.0.0.1:19347/json/list', { signal: AbortSignal.timeout(1000) })).json(); break; } catch { await delay(250); } }
  if (!tabs) throw Error('Headless Edge unavailable');
  ws = new WebSocket(tabs.find(t => t.type === 'page' && t.url === 'about:blank').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, m => m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result)); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const assert = (v, message) => { if (!v) throw Error(message); count++; console.log('PASS ' + message); };
  const waitFor = async (expression, label = 'page ready') => { for (let n = 0; n < 40; n++) { if (await ev(expression)) return; await delay(100); } throw Error('Timed out: ' + label); };
  const pageReady = "document.readyState==='complete' && !!window.StepApp && !!window.StepPlanner && document.querySelectorAll('#planner-grid .planner-day').length===42 && document.querySelectorAll('#annual-chart .month-column').length===12";
  const reload = async () => { await cdp('Page.reload'); await delay(150); await waitFor(pageReady); };
  const viewport = async (width, height = width < 600 ? 844 : 1100) => { await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }); await delay(80); };
  const screenshot = async name => { await ev("window.scrollTo(0,0);document.querySelector('#toast').style.visibility='hidden'"); const s = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(qa, name), Buffer.from(s.data, 'base64')); await ev("document.querySelector('#toast').style.visibility=''"); };
  let exportCount = 0;
  const exportBackup = async () => {
   // Chromium may overwrite a same-day filename, so isolate every export too.
   const currentDownload = path.join(downloads, String(++exportCount));
   fs.mkdirSync(currentDownload);
   await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: currentDownload });
   await ev("document.querySelector('#export-data').click()");
   for (let n = 0; n < 50; n++) {
    const name = fs.readdirSync(currentDownload).find(n => n.startsWith('下一小步-完整备份-') && n.endsWith('.json'));
    if (name) { const file = path.join(currentDownload, name); try { const full=JSON.parse(fs.readFileSync(file,'utf8')); return {file,full,data:full.data||full}; } catch {} }
    await delay(100);
   }
   throw Error('This run did not download a fresh JSON backup');
  };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url }); await waitFor(pageReady);
  assert(await ev("document.querySelector('#stat-steps').textContent==='0' && document.querySelector('#timer-start').disabled"), 'honest empty state');
  await screenshot('desktop-empty.png');
  await viewport(390); await screenshot('mobile-empty.png');
  for (const width of [320, 390, 1024, 1440]) { await viewport(width); assert(await ev(`document.documentElement.scrollWidth<=${width}`), `${width}px empty layout has no page overflow`); }
  await ev("document.querySelector('#empty-create').click();document.querySelector('#goal-name').value='完成一个个人作品';document.querySelector('#goal-reason').value='让想法变成可运行的东西';document.querySelector('[data-template=create]').click();document.querySelector('#goal-form').requestSubmit()");
  assert(await ev("document.querySelectorAll('.goal-item').length===1 && document.querySelectorAll('.step-item').length===3 && !document.querySelector('#goal-dialog').open"), 'create goal from editable template');
  await ev("document.querySelector('#step-input').value='<img src=x onerror=alert(1)>';document.querySelector('#add-step-form').requestSubmit()");
  assert(await ev("document.querySelectorAll('.step-item').length===4 && !document.querySelector('#step-list img')"), 'actions render safely as literal text');
  await ev("document.querySelector('[data-minutes=\"10\"]').click();document.querySelector('#timer-start').click()"); await delay(2100);
  assert(await ev("document.querySelector('#focus-state').textContent==='正在专注' && document.querySelector('[data-minutes=\"25\"]').disabled"), 'start timer and lock duration');
  await ev("document.querySelectorAll('.step-select')[1].click()");
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).selectedStep===JSON.parse(localStorage.getItem(StepCore.key)).goals[0].steps[0].id"), 'running timer prevents task switching');
  await ev("document.querySelector('#timer-start').click()");
  const paused = await ev("JSON.parse(localStorage.getItem(StepCore.key)).timer.remaining");
  assert(paused < 600000 && paused > 590000, 'pause records elapsed time');
  await reload(); await delay(1100);
  assert(await ev("document.querySelector('#focus-state').textContent==='已暂停' && JSON.parse(localStorage.getItem(StepCore.key)).timer.remaining===" + paused), 'paused timer survives refresh without counting paused time');
  await ev("document.querySelector('#timer-reset').click();document.querySelector('#confirm-no').click()"); await delay(50);
  assert(await ev("!!JSON.parse(localStorage.getItem(StepCore.key)).timer"), 'cancel reset preserves active timer');
  await ev("document.querySelector('#timer-start').click();window.originalNow=Date.now;Date.now=()=>originalNow()+610000"); await delay(1200);
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===1 && JSON.parse(localStorage.getItem(StepCore.key)).sessions[0].seconds===600 && !JSON.parse(localStorage.getItem(StepCore.key)).timer && JSON.parse(localStorage.getItem(StepCore.key)).mode==='shortBreak' && JSON.parse(localStorage.getItem(StepCore.key)).pomodoroCount===1"), 'deadline completion records one full session and offers a manual short break');
  await ev('Date.now=originalNow');
  assert(await ev("document.querySelector('#stat-steps').textContent==='0'"), 'timer does not falsely complete a task');
  await reload();
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===1"), 'refresh does not duplicate finished session');
  await ev("document.querySelector('[data-focus-mode=focus]').click()");
  await ev("document.querySelector('#finish-step').click()");
  assert(await ev("document.querySelector('#stat-steps').textContent==='1' && document.querySelector('#stat-minutes').textContent==='10'"), 'manual completion updates progress and preserves focus total');
  await ev("document.querySelector('#edit-goal').click();document.querySelector('#goal-name').value='我的第一个作品';document.querySelector('#goal-form').requestSubmit()");
  assert(await ev("document.querySelector('#goal-title').textContent==='我的第一个作品'"), 'edit goal');
  await ev("document.querySelectorAll('.step-delete')[3].click();document.querySelector('#confirm-yes').click()"); await delay(50);
  assert(await ev("document.querySelectorAll('.step-item').length===3"), 'confirmed action deletion');
  await screenshot('desktop.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert(await ev('document.documentElement.scrollWidth <= 390'), '390px mobile has no horizontal overflow');
  await screenshot('mobile.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 760, deviceScaleFactor: 1, mobile: true });
  assert(await ev('document.documentElement.scrollWidth <= 320'), '320px mobile has no horizontal overflow');
  await ev("document.querySelector('#new-goal').click()");
  assert(await ev('document.activeElement.id === "goal-name"'), 'dialog moves keyboard focus to input');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert(await ev("!document.querySelector('#goal-dialog').open"), 'Escape dismisses modal');
  const exported = await exportBackup();
  assert(exported.full.format === 'next-small-step.full-backup' && exported.data.version === 2 && exported.data.sessions.length === 1, 'fresh downloaded backup contains version-two state and real records');
  const backup = exported.file;
  const inputFile = async file => { const doc = await cdp('DOM.getDocument'); const { nodeId } = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#import-file' }); await cdp('DOM.setFileInputFiles', { nodeId, files: [file] }); await delay(150); };
  fs.writeFileSync(path.join(qa, 'invalid.json'), '{"version":999}');
  await inputFile(path.join(qa, 'invalid.json'));
  assert(await ev("document.querySelectorAll('.goal-item').length===1 && !document.querySelector('#confirm-dialog').open"), 'invalid import leaves state intact');
  await inputFile(backup);
  assert(await ev("document.querySelector('#confirm-dialog').open"), 'valid import asks before replacing');
  await ev("document.querySelector('#confirm-yes').click()"); await delay(50);
  assert(await ev("document.querySelector('#stat-minutes').textContent==='10' && document.querySelectorAll('.step-item').length===3"), 'backup restoration round trip');
  await ev("document.querySelector('.goal-delete').click();document.querySelector('#confirm-yes').click()"); await delay(50);
  assert(await ev("document.querySelectorAll('.goal-item').length===0 && document.querySelector('#stat-minutes').textContent==='10'"), 'deleting goal preserves focus history');

  // Create and edit through the same dialogs people use, then verify both task views.
  const dateKeys = await ev("(() => { const now=new Date(), next=new Date(now);next.setDate(next.getDate()+1);return {today:StepCore.dayKey(now),tomorrow:StepCore.dayKey(next)}; })()");
  await ev("document.querySelector('#quick-task-open').click()");
  assert(await ev("document.querySelector('#task-dialog').open && document.activeElement.id==='task-title'"), 'quick-add opens the shared accessible task editor');
  await ev(`document.querySelector('#task-title').value='整理毕业作品说明';document.querySelector('#task-date').value=${JSON.stringify(dateKeys.today)};document.querySelector('#task-priority').value='high';document.querySelector('#task-form').requestSubmit();document.querySelector('#planner-today').click()`);
  assert(await ev(`(() => { const s=JSON.parse(localStorage.getItem(StepCore.key)),t=s.goals[0].steps[0];return s.goals.length===1 && s.goals[0].title==='日常待办' && t.text==='整理毕业作品说明' && t.dueDate===${JSON.stringify(dateKeys.today)} && t.priority==='high' && document.querySelectorAll('.step-item').length===1 && document.querySelectorAll('.planner-task-row').length===1 && document.querySelector('.planner-task-title strong').textContent===t.text && !!document.querySelector('.planner-task-row .planner-priority.high');})()`), 'dated priority task appears once in the goal list and calendar agenda');
  assert(await ev(`document.querySelector('#planner-grid [data-date="${dateKeys.today}"]').getAttribute('aria-label').includes('1 项待办') && !!document.querySelector('#planner-grid [data-date="${dateKeys.today}"] .planner-task-dot')`), 'calendar marks the same scheduled task on its date');
  await ev(`document.querySelector('.planner-task-edit').click();document.querySelector('#task-title').value='完成毕业作品的第一版说明';document.querySelector('#task-date').value=${JSON.stringify(dateKeys.tomorrow)};document.querySelector('#task-priority').value='low';document.querySelector('#task-form').requestSubmit()`);
  assert(await ev(`document.querySelectorAll('.planner-task-row').length===0 && document.querySelector('.step-select').textContent==='完成毕业作品的第一版说明' && JSON.parse(localStorage.getItem(StepCore.key)).goals[0].steps[0].dueDate===${JSON.stringify(dateKeys.tomorrow)} && JSON.parse(localStorage.getItem(StepCore.key)).goals[0].steps[0].priority==='low'`), 'editing a task moves its day and updates the existing goal action');
  await ev(`document.querySelector('#planner-grid [data-date="${dateKeys.tomorrow}"]').click();document.querySelector('.planner-task-title').click()`);
  assert(await ev("(() => {const s=JSON.parse(localStorage.getItem(StepCore.key));return s.selectedStep===s.goals[0].steps[0].id && document.querySelector('#focus-task').textContent==='完成毕业作品的第一版说明' && !!document.querySelector('.planner-task-row.active') && !!document.querySelector('.step-item.active');})()"), 'calendar task selection updates the focus timer and active action');
  await ev("document.querySelector('.planner-task-check').click()");
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).goals[0].steps[0].done && !!document.querySelector('.step-item.done') && !!document.querySelector('.planner-task-row.done') && document.querySelector('#stat-steps').textContent==='1'"), 'calendar completion updates the shared action and lifetime completed count');
  await ev("document.querySelector('.step-check').click()");
  assert(await ev("!JSON.parse(localStorage.getItem(StepCore.key)).goals[0].steps[0].done && !document.querySelector('.planner-task-row.done') && document.querySelector('#stat-steps').textContent==='0'"), 'undoing completion in the workspace updates the calendar immediately');

  // Important days are actual user-created records, including literal HTML-like text.
  await ev(`document.querySelector('#dates-add').click();document.querySelector('#date-title').value='<img src=x onerror=alert(1)>';document.querySelector('#date-day').value=${JSON.stringify(dateKeys.today)};document.querySelector('#date-category').value='<b>比赛</b>';document.querySelector('#date-repeat').checked=true;document.querySelector('#date-pinned').checked=false;document.querySelector('#date-form').requestSubmit();document.querySelector('#planner-today').click()`);
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).dates.length===1 && document.querySelector('.planner-date-card h3').textContent==='<img src=x onerror=alert(1)>' && document.querySelector('.planner-date-category').textContent==='<b>比赛</b>' && !document.querySelector('#date-list img,#date-list b,#plan-items img') && document.querySelector('.planner-date-count').textContent.includes('就是今天') && document.querySelectorAll('.planner-event-row').length===1"), 'important dates render safe text and the today countdown in both calendar and card');
  await ev(`document.querySelector('#dates-add').click();document.querySelector('#date-title').value='作品提交';document.querySelector('#date-day').value=${JSON.stringify(dateKeys.tomorrow)};document.querySelector('#date-category').value='学习';document.querySelector('#date-pinned').checked=true;document.querySelector('#date-form').requestSubmit()`);
  assert(await ev("document.querySelectorAll('.planner-date-card').length===2 && document.querySelector('.planner-date-card h3').textContent==='作品提交' && document.querySelector('.planner-date-card .planner-date-count strong').textContent==='1' && !!document.querySelector('.planner-date-card .planner-date-pin')"), 'pinned date sorts first with an accurate next-day countdown');
  await ev("document.querySelector('.planner-date-card .planner-date-controls button').click();document.querySelector('#date-title').value='提交最终作品';document.querySelector('#date-repeat').checked=true;document.querySelector('#date-pinned').checked=false;document.querySelector('#date-form').requestSubmit()");
  assert(await ev("(() => {const e=JSON.parse(localStorage.getItem(StepCore.key)).dates.find(e=>e.title==='提交最终作品');return !!e && e.repeat==='yearly' && !e.pinned && document.querySelector('.planner-date-card h3').textContent==='<img src=x onerror=alert(1)>';})()"), 'editing date title, recurrence and pin status preserves the record and resorts cards');
  await ev("document.querySelector('.planner-date-card .planner-date-controls button').click();document.querySelector('#date-title').value='毕业作品答辩';document.querySelector('#date-category').value='学习';document.querySelector('#date-pinned').checked=true;document.querySelector('#date-form').requestSubmit()");
  const taskAndDates = await ev("JSON.stringify({goals:JSON.parse(localStorage.getItem(StepCore.key)).goals,dates:JSON.parse(localStorage.getItem(StepCore.key)).dates})");
  await reload();
  assert(await ev(`JSON.stringify({goals:JSON.parse(localStorage.getItem(StepCore.key)).goals,dates:JSON.parse(localStorage.getItem(StepCore.key)).dates})===${JSON.stringify(taskAndDates)} && document.querySelector('.planner-date-card h3').textContent==='毕业作品答辩' && !!document.querySelector('.planner-date-card .planner-date-pin')`), 'task dates, priorities, important dates and pin order survive refresh');
  await ev("[...document.querySelectorAll('.planner-date-card')].find(n=>n.querySelector('h3').textContent==='提交最终作品').querySelector('.planner-date-delete').click();document.querySelector('#confirm-no').click()");
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).dates.length===2"), 'cancelling date deletion preserves both records');
  await ev("[...document.querySelectorAll('.planner-date-card')].find(n=>n.querySelector('h3').textContent==='提交最终作品').querySelector('.planner-date-delete').click();document.querySelector('#confirm-yes').click()"); await delay(50);
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).dates.length===1 && document.querySelectorAll('.planner-date-card').length===1 && document.querySelector('.planner-date-card h3').textContent==='毕业作品答辩'"), 'confirmed date deletion removes only the requested record');

  await ev("document.querySelector('#focus-settings-open').click();document.querySelector('#settings-focus').value='7';document.querySelector('#settings-short').value='2';document.querySelector('#settings-long').value='4';document.querySelector('#settings-cycles').value='2';document.querySelector('#focus-settings-form').requestSubmit()");
  assert(await ev("(() => {const s=JSON.parse(localStorage.getItem(StepCore.key));return !document.querySelector('#focus-settings-dialog').open && s.minutes===7 && s.preferences.shortBreak===2 && s.preferences.longBreak===4 && s.preferences.cycles===2 && document.querySelector('#timer-readout').textContent==='07:00';})()"), 'custom focus, short break, long break and cycle settings are applied');
  await reload();
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).minutes===7 && JSON.parse(localStorage.getItem(StepCore.key)).preferences.cycles===2 && document.querySelector('#timer-readout').textContent==='07:00'"), 'custom pomodoro settings survive refresh');
  await ev("document.querySelector('[data-focus-mode=shortBreak]').click();document.querySelector('#timer-start').click()");
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).timer.kind==='shortBreak' && JSON.parse(localStorage.getItem(StepCore.key)).timer.duration===120000 && document.querySelector('#focus-state').textContent==='正在休息' && document.querySelector('#finish-step').disabled && document.querySelector('#focus-settings-open').disabled"), 'manual short break uses custom duration and locks incompatible actions');
  await ev("window.originalNow=Date.now;Date.now=()=>originalNow()+130000"); await delay(1200); await ev('Date.now=originalNow');
  assert(await ev("(() => {const s=JSON.parse(localStorage.getItem(StepCore.key));return s.sessions.length===1 && s.pomodoroCount===1 && s.mode==='focus' && !s.timer && document.querySelector('#stat-minutes').textContent==='10';})()"), 'finished rest adds no focus history and waits for manual focus start');
  await ev("document.querySelector('#timer-start').click();window.originalNow=Date.now;Date.now=()=>originalNow()+10800000"); await delay(1200); await ev('Date.now=originalNow');
  assert(await ev("(() => {const s=JSON.parse(localStorage.getItem(StepCore.key));return s.sessions.length===2 && s.sessions[1].seconds===420 && s.pomodoroCount===2 && s.mode==='longBreak' && !s.timer && document.querySelector('#timer-readout').textContent==='04:00' && document.querySelector('#stat-minutes').textContent==='17';})()"), 'long absence settles only one custom focus interval and offers the cycle long break');
  await reload(); await delay(1100);
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===2 && !JSON.parse(localStorage.getItem(StepCore.key)).timer && JSON.parse(localStorage.getItem(StepCore.key)).mode==='longBreak' && !JSON.parse(localStorage.getItem(StepCore.key)).goals[0].steps[0].done"), 'reload neither loops pomodoros nor duplicates history or completes the task');
  await ev("document.querySelector('[data-focus-mode=focus]').click()");
  for (const width of [320, 390, 1024, 1440]) { await viewport(width); assert(await ev(`document.documentElement.scrollWidth<=${width}`), `${width}px filled calendar and countdown layout has no page overflow`); }
  await screenshot('desktop-filled.png');
  await viewport(390); await screenshot('mobile-filled.png');
  const completeExport = await exportBackup();
  assert(completeExport.data.version===2 && completeExport.data.goals[0].steps[0].dueDate===dateKeys.tomorrow && completeExport.data.goals[0].steps[0].priority==='low' && completeExport.data.dates.length===1 && completeExport.data.dates[0].repeat==='yearly' && completeExport.data.dates[0].pinned && completeExport.data.minutes===7 && completeExport.data.preferences.cycles===2 && completeExport.data.pomodoroCount===2 && completeExport.data.sessions.length===2, 'fresh version-two export contains tasks, date metadata, preferences and focus history');
  await ev("document.querySelector('.planner-date-delete').click();document.querySelector('#confirm-yes').click()"); await delay(50);
  await inputFile(completeExport.file);
  assert(await ev("document.querySelector('#confirm-dialog').open && JSON.parse(localStorage.getItem(StepCore.key)).dates.length===0"), 'full backup restoration asks before replacing the changed data');
  await ev("document.querySelector('#confirm-yes').click()"); await delay(50);
  assert(await ev(`JSON.stringify(JSON.parse(localStorage.getItem(StepCore.key)))===${JSON.stringify(JSON.stringify(completeExport.data))} && document.querySelectorAll('.planner-date-card').length===1`), 'version-two backup round trip restores the complete data model unchanged');

  // Import a version-one fixture through the real file picker; only this isolated profile is changed.
  const annualFixture = await ev(`(() => {
    const year = new Date().getFullYear();
    let leapYear = year;
    while (new Date(leapYear, 1, 29).getMonth() !== 1) leapYear--;
    const at = (id, y, month, day, hour, minute, seconds) => ({ id, goalTitle: '年度统计测试', stepTitle: '保留真实历史格式', finishedAt: new Date(y, month - 1, day, hour, minute).getTime(), seconds });
    const data = {version:1,goals:[{id:'legacy-goal',title:'旧版目标',why:'保留旧数据',createdAt:Date.now(),steps:[{id:'legacy-step',text:'旧版行动',done:false,completedAt:null}]}],sessions:[],selectedGoal:'legacy-goal',selectedStep:'legacy-step',minutes:25,timer:null};
    data.sessions = [
      at('annual-jan-a', year, 1, 5, 0, 5, 600),
      at('annual-jan-b', year, 1, 5, 23, 55, 300),
      at('annual-mar', year, 3, 1, 0, 5, 1200),
      at('annual-dec', year - 1, 12, 31, 23, 55, 1800),
      at('annual-feb', year - 1, 2, 28, 12, 0, 600),
      at('annual-leap-a', leapYear, 2, 29, 0, 5, 600),
      at('annual-leap-b', leapYear, 2, 29, 23, 55, 300)
    ];
    return { year, leapYear, data };
  })()`);
  const annualBackup = path.join(qa, 'annual-v1.json');
  fs.writeFileSync(annualBackup, JSON.stringify(annualFixture.data));
  await inputFile(annualBackup);
  assert(await ev("document.querySelector('#confirm-dialog').open && JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===2"), 'annual backup import requires confirmation before changing existing records');
  await ev("document.querySelector('#confirm-yes').click()"); await delay(50);
  assert(await ev("(() => {const s=JSON.parse(localStorage.getItem(StepCore.key));return s.version===2 && s.sessions.length===7 && document.querySelector('#stat-minutes').textContent==='90' && s.goals[0].steps[0].dueDate===null && s.goals[0].steps[0].priority==='normal' && s.dates.length===0 && s.preferences.shortBreak===5 && s.preferences.longBreak===15 && s.preferences.cycles===4 && s.pomodoroCount===0 && s.mode==='focus';})()"), 'version-one import migrates legacy actions and defaults while retaining multi-year history');
  assert(await ev("!document.querySelector('#annual-stats').hidden && document.querySelector('#weekly-stats').hidden && document.querySelectorAll('#annual-chart .month-column').length===12 && document.querySelectorAll('#monthly-table-body tr').length===12 && document.querySelectorAll('#monthly-table-total tr').length===1"), 'annual view defaults to twelve month columns, twelve rows and one annual total');
  const currentIsLeap = annualFixture.year === annualFixture.leapYear;
  const currentMinutes = currentIsLeap ? 50 : 35, currentCount = currentIsLeap ? 5 : 3, currentDays = currentIsLeap ? 3 : 2;
  assert(await ev(`document.querySelector('#focus-year').value==='${annualFixture.year}' && document.querySelector('#annual-duration').textContent==='${currentMinutes} 分' && [...document.querySelector('#monthly-table-total tr').children].map(n=>n.textContent).join('|')==='全年合计|${currentMinutes} 分|${currentCount} 次|${currentDays} 天'`), 'current-year summary and total count all local months and deduplicate active dates');
  assert(await ev("[...document.querySelectorAll('#monthly-table-body tr')[0].children].map(n=>n.textContent).join('|')==='1 月|15 分|2 次|1 天' && [...document.querySelectorAll('#monthly-table-body tr')[2].children].map(n=>n.textContent).join('|')==='3 月|20 分|1 次|1 天'"), 'monthly detail separates local January and March and merges same-day activity');
  await ev("document.querySelector('#stats-week-view').click()");
  assert(await ev("!document.querySelector('#weekly-stats').hidden && document.querySelector('#annual-stats').hidden && document.querySelector('#stats-week-view').getAttribute('aria-pressed')==='true' && document.querySelectorAll('#week-chart .day').length===7"), 'recent-seven-days view remains available with correct selected state');
  await ev("document.querySelector('#stats-year-view').click()");
  assert(await ev("!document.querySelector('#annual-stats').hidden && document.querySelector('#weekly-stats').hidden && document.querySelector('#stats-year-view').getAttribute('aria-pressed')==='true' && document.querySelector('#year-next').disabled"), 'returning to year view preserves current-year upper navigation boundary');
  await ev("document.querySelector('#year-prev').click()");
  const previousIsLeap = annualFixture.year - 1 === annualFixture.leapYear;
  assert(await ev(`document.querySelector('#focus-year').value==='${annualFixture.year - 1}' && document.querySelector('#annual-duration').textContent==='${previousIsLeap ? 55 : 40} 分' && [...document.querySelectorAll('#monthly-table-body tr')[11].children].map(n=>n.textContent).join('|')==='12 月|30 分|1 次|1 天'`), 'previous-year navigation retains December records across the local new-year boundary');
  await ev("document.querySelector('#year-next').click()");
  assert(await ev(`document.querySelector('#focus-year').value==='${annualFixture.year}' && document.querySelector('#year-next').disabled`), 'next-year navigation returns to current year without offering future years');
  await ev(`document.querySelector('#focus-year').value='${annualFixture.leapYear}';document.querySelector('#focus-year').dispatchEvent(new Event('change'))`);
  const leapFebruaryMinutes = previousIsLeap ? 25 : 15, leapFebruaryCount = previousIsLeap ? 3 : 2, leapFebruaryDays = previousIsLeap ? 2 : 1;
  assert(await ev(`[...document.querySelectorAll('#monthly-table-body tr')[1].children].map(n=>n.textContent).join('|')==='2 月|${leapFebruaryMinutes} 分|${leapFebruaryCount} 次|${leapFebruaryDays} 天'`), 'leap-day sessions stay in February and count February 29 once');
  const yearsExpected = [...new Set([annualFixture.year, annualFixture.year - 1, annualFixture.leapYear])].sort((a, b) => a - b);
  assert(await ev(`JSON.stringify([...document.querySelector('#focus-year').options].map(o=>Number(o.value)))===${JSON.stringify(JSON.stringify(yearsExpected))}`), 'year selector lists only the current year and years with imported records');
  await ev("document.querySelector('#focus-year').selectedIndex=0;document.querySelector('#focus-year').dispatchEvent(new Event('change'))");
  assert(await ev("document.querySelector('#year-prev').disabled && !document.querySelector('#year-next').disabled"), 'earliest recorded year disables earlier navigation');
  await ev(`StepPages.show('footprints');document.querySelector('#focus-year').value='${annualFixture.year}';document.querySelector('#focus-year').dispatchEvent(new Event('change'));document.querySelector('.monthly-details').open=true`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await screenshot('desktop-year.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 760, deviceScaleFactor: 1, mobile: true });
  assert(await ev("document.documentElement.scrollWidth<=320 && document.querySelector('.monthly-table-scroll').scrollWidth>document.querySelector('.monthly-table-scroll').clientWidth"), 'expanded annual table scrolls within its container without overflowing the 320px page');
  await ev("document.querySelector('.monthly-table-scroll').scrollLeft=100");
  assert(await ev("document.querySelector('.monthly-table-scroll').scrollLeft>0 && window.scrollX===0"), 'mobile monthly table can move horizontally while the page stays fixed');
  await ev("document.querySelector('.monthly-table-scroll').scrollLeft=0");
  await screenshot('mobile-year.png');

  // Exercise the native export contract without writing to an Android device or user profile.
  await ev("window.nativeBackupCalls=[];window.NextStepAndroid={saveBackup:(contents,name)=>window.nativeBackupCalls.push({contents,name})};document.querySelector('#export-data').click()");
  await waitFor('nativeBackupCalls.length===1');
  assert(await ev("nativeBackupCalls.length===1 && JSON.parse(nativeBackupCalls[0].contents).data.version===2 && JSON.stringify(JSON.parse(nativeBackupCalls[0].contents).data)===JSON.stringify(JSON.parse(localStorage.getItem(StepCore.key))) && nativeBackupCalls[0].name.endsWith('.json')"), 'Android export bridge receives the unmodified version-two JSON and backup filename');
  assert(await ev("!document.querySelector('#toast').hidden && document.querySelector('#toast').textContent==='请选择备份的保存位置。'"), 'Android export waits for the save result instead of claiming early success');
  await ev("window.dispatchEvent(new CustomEvent('nextstep-backup-result',{detail:{status:'success'}}))");
  assert(await ev("document.querySelector('#toast').textContent==='备份已保存，可以用它迁移到其他设备。'"), 'Android successful save event displays the completion message');
  await ev("document.querySelector('#export-data').click()");
  await waitFor('nativeBackupCalls.length===2');
  await ev("window.dispatchEvent(new CustomEvent('nextstep-backup-result',{detail:{status:'cancelled'}}))");
  assert(await ev("document.querySelector('#toast').textContent==='已取消保存，当前数据没有改变。' && JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===7"), 'Android cancelled save event keeps all data and reports cancellation');
  await ev("delete window.NextStepAndroid;delete window.nativeBackupCalls");
  await ev("localStorage.setItem(StepCore.key,'broken json')"); await reload();
  assert(await ev("!document.querySelector('#storage-warning').hidden && localStorage.getItem(StepCore.key)==='broken json'"), 'corrupt storage is preserved instead of overwritten');
  assert(errors.length === 0, 'no browser runtime errors');
  fs.writeFileSync(path.join(qa, 'result.json'), JSON.stringify({ passed: count, errors, viewports: [1440,1024,390,320], downloads, screenshots: ['desktop-empty.png','mobile-empty.png','desktop-filled.png','mobile-filled.png','desktop-year.png','mobile-year.png'] }, null, 2));
  console.log(`${count} browser checks passed`);
  await cdp('Browser.close');
 } finally { ws?.close(); browser.kill(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
