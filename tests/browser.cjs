const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const qa = path.join(root, '.qa'); fs.mkdirSync(qa, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
const server = createServer((req, res) => { try { const file = req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1); res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html'); res.end(fs.readFileSync(path.join(root, 'dist', file))); } catch { res.statusCode = 404; res.end(); } });
(async () => {
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const url = `http://127.0.0.1:${server.address().port}/`;
 const profile = path.join(qa, 'browser-' + Date.now());
 const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=19347', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
 let ws, count = 0;
 try {
  let tabs;
  for (let n = 0; n < 20; n++) { try { tabs = await (await fetch('http://127.0.0.1:19347/json/list', { signal: AbortSignal.timeout(1000) })).json(); break; } catch { await delay(250); } }
  if (!tabs) throw Error('Headless Edge unavailable');
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, m => m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result)); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const assert = (v, message) => { if (!v) throw Error(message); count++; console.log('PASS ' + message); };
  const reload = async () => { await cdp('Page.reload'); await delay(450); };
  const screenshot = async name => { const s = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(qa, name), Buffer.from(s.data, 'base64')); };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url }); await delay(500);
  assert(await ev("document.querySelector('#stat-steps').textContent==='0' && document.querySelector('#timer-start').disabled"), 'honest empty state');
  await screenshot('desktop-empty.png');
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
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===1 && JSON.parse(localStorage.getItem(StepCore.key)).sessions[0].seconds===600 && !JSON.parse(localStorage.getItem(StepCore.key)).timer"), 'deadline completion records exactly one full session');
  await ev('Date.now=originalNow');
  assert(await ev("document.querySelector('#stat-steps').textContent==='0'"), 'timer does not falsely complete a task');
  await reload();
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===1"), 'refresh does not duplicate finished session');
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
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: qa });
  await ev("document.querySelector('#export-data').click()"); await delay(600);
  const exported = fs.readdirSync(qa).find(n => n.startsWith('下一小步-备份-') && n.endsWith('.json'));
  assert(!!exported && JSON.parse(fs.readFileSync(path.join(qa, exported), 'utf8')).sessions.length === 1, 'downloaded backup contains real records');
  const backup = path.join(qa, exported);
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

  // Import a version-one fixture through the real file picker; only this isolated profile is changed.
  const annualFixture = await ev(`(() => {
    const year = new Date().getFullYear();
    let leapYear = year;
    while (new Date(leapYear, 1, 29).getMonth() !== 1) leapYear--;
    const at = (id, y, month, day, hour, minute, seconds) => ({ id, goalTitle: '年度统计测试', stepTitle: '保留真实历史格式', finishedAt: new Date(y, month - 1, day, hour, minute).getTime(), seconds });
    const data = StepCore.initial();
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
  assert(await ev("document.querySelector('#confirm-dialog').open && JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===1"), 'annual backup import requires confirmation before changing existing records');
  await ev("document.querySelector('#confirm-yes').click()"); await delay(50);
  assert(await ev("JSON.parse(localStorage.getItem(StepCore.key)).version===1 && JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===7 && document.querySelector('#stat-minutes').textContent==='90'"), 'version-one import retains multi-year history and lifetime focus total');
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
  await ev(`document.querySelector('#focus-year').value='${annualFixture.year}';document.querySelector('#focus-year').dispatchEvent(new Event('change'));document.querySelector('.monthly-details').open=true`);
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
  assert(await ev("nativeBackupCalls.length===1 && JSON.stringify(JSON.parse(nativeBackupCalls[0].contents))===JSON.stringify(JSON.parse(localStorage.getItem(StepCore.key))) && nativeBackupCalls[0].name.endsWith('.json')"), 'Android export bridge receives the unmodified version-one JSON and backup filename');
  assert(await ev("!document.querySelector('#toast').hidden && document.querySelector('#toast').textContent==='请选择备份的保存位置。'"), 'Android export waits for the save result instead of claiming early success');
  await ev("window.dispatchEvent(new CustomEvent('nextstep-backup-result',{detail:{status:'success'}}))");
  assert(await ev("document.querySelector('#toast').textContent==='备份已保存，可以用它迁移到其他设备。'"), 'Android successful save event displays the completion message');
  await ev("document.querySelector('#export-data').click();window.dispatchEvent(new CustomEvent('nextstep-backup-result',{detail:{status:'cancelled'}}))");
  assert(await ev("document.querySelector('#toast').textContent==='已取消保存，当前数据没有改变。' && JSON.parse(localStorage.getItem(StepCore.key)).sessions.length===7"), 'Android cancelled save event keeps all data and reports cancellation');
  await ev("delete window.NextStepAndroid;delete window.nativeBackupCalls");
  await ev("localStorage.setItem(StepCore.key,'broken json')"); await reload();
  assert(await ev("!document.querySelector('#storage-warning').hidden && localStorage.getItem(StepCore.key)==='broken json'"), 'corrupt storage is preserved instead of overwritten');
  assert(errors.length === 0, 'no browser runtime errors');
  fs.writeFileSync(path.join(qa, 'result.json'), JSON.stringify({ passed: count, errors, viewports: [1440,390,320] }, null, 2));
  console.log(`${count} browser checks passed`);
  await cdp('Browser.close');
 } finally { ws?.close(); browser.kill(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
