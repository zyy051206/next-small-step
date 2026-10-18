const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
if (process.platform === 'win32') { process.env.SystemRoot ||= 'C:\\Windows'; process.env.WINDIR ||= 'C:\\Windows'; }

const root = path.resolve(__dirname, '..');
const qa = path.join(root, '.qa');
fs.mkdirSync(qa, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--disable-extensions', '--disable-gpu', '--no-first-run', '--remote-debugging-port=19363',
    '--user-data-dir=' + path.join(qa, 'updates-browser-' + Date.now()), 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let ws, count = 0;
  const errors = [];
  try {
    let tabs;
    for (let n = 0; n < 40; n++) {
      try { tabs = await (await fetch('http://127.0.0.1:19363/json/list', { signal: AbortSignal.timeout(1000) })).json(); break; }
      catch { await delay(250); }
    }
    if (!tabs) throw Error('Headless Edge unavailable');
    ws = new WebSocket(tabs.find(tab => tab.type === 'page' && tab.url === 'about:blank').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map();
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
      for (let n = 0; n < 80; n++) { if (await ev(expression)) return; await delay(100); }
      throw Error('Timed out: ' + label + ' ' + JSON.stringify(await ev("({url:location.href,visibility:document.visibilityState,calls:window.updatesTest?.calls,automatic:localStorage.getItem('next-small-step.updates.v1'),status:document.querySelector('#updates-status')?.textContent})")));
    };
    const ready = "document.readyState==='complete' && !!window.StepPages && !!window.StepApp && !!window.StepAppearance";
    const visible = selector => `(() => {const node=document.querySelector(${JSON.stringify(selector)});return !!node && !node.hidden && node.getClientRects().length>0})()`;
    const viewport = async width => {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 600 });
      await delay(100);
    };
    const click = async selector => {
      await ev(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node || !node.getClientRects().length || node.disabled) throw Error('Click target unavailable: '+${JSON.stringify(selector)}); node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}); })()`);
      // Scrolling can change whether the existing floating focus timer is shown.
      await delay(80);
      const point = await ev(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      if (!(await ev(`!!document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)})`))) throw Error('Click target obscured: ' + selector + ' ' + JSON.stringify(await ev(`({point:${JSON.stringify(point)},actual:document.elementFromPoint(${point.x},${point.y})?.outerHTML.slice(0,500),scroll:scrollY,viewport:{height:innerHeight,visualHeight:visualViewport.height,visualTop:visualViewport.offsetTop},modals:[...document.querySelectorAll('dialog[open]')].map(n=>n.id)})`)));
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      await delay(80);
    };
    const escape = async selector => {
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await waitFor(`!document.querySelector(${JSON.stringify(selector)}).open`, 'close dialog');
    };
    const navigate = async suffix => {
      await cdp('Page.navigate', { url: url + suffix });
      await delay(100); await waitFor(ready); await ev('StepAppearance.ready');
    };
    const reply = (status, extra = {}, action) => ev(`window.updatesTest.reply(${JSON.stringify(status)},${JSON.stringify(extra)},${JSON.stringify(action)})`);
    const callsFor = action => `window.updatesTest.calls.filter(call=>call.action===${JSON.stringify(action)})`;
    const statusText = () => ev("document.querySelector('#updates-status').textContent");
    const screenshot = async name => {
      await ev("window.scrollTo({top:0,left:0,behavior:'instant'});document.querySelector('#toast').style.visibility='hidden'");
      await delay(100);
      const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(qa, name), Buffer.from(result.data, 'base64'));
      screenshots.push(name);
      await ev("document.querySelector('#toast').style.visibility=''");
    };
    await cdp('Runtime.enable'); await cdp('Page.enable');
    // Other packaging/browser checks may run concurrently on this desktop.
    // Keep this isolated headless page foregrounded for native-resume polling.
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      if (!new URL(location.href).searchParams.has('native')) return;
      const calls=[];
      const platform=new URL(location.href).searchParams.get('platform') || 'windows';
      const stateKey='updates-test-native-'+platform;
      let state=JSON.parse(sessionStorage.getItem(stateKey)||'null') || {status:'idle'};
      const setState=value=>{state=value;sessionStorage.setItem(stateKey,JSON.stringify(state));};
      const emit=(call,value)=>window.dispatchEvent(new CustomEvent('nextstep-update-result',{detail:{...call,currentVersion:'2.0.3',...value}}));
      window.updatesTest={calls,setState,getState:()=>state,reply(status,extra={},action) {
        const call=action?calls.findLast(call=>call.action===action):calls.findLast(call=>call.action!=='state');
        if(!call) throw Error('No native updater request');
        setState({...state,status,...extra});
        emit(call,{status,...extra});
      }};
      window.NextStepUpdates=Object.freeze({getVersion:()=> '2.0.3',getPlatform:()=>platform,
        checkUpdates(requestId){calls.push({requestId,action:'check'})},
        downloadUpdate(requestId){calls.push({requestId,action:'download'})},
        installUpdate(requestId){calls.push({requestId,action:'install'})},
        cancelUpdate(requestId){calls.push({requestId,action:'cancel'})},
        getUpdateState(requestId){const call={requestId,action:'state'};calls.push(call);setTimeout(()=>emit(call,state),0)}
      });
    })();` });

    await viewport(1440); await navigate('');
    await delay(1200);
    assert(!(await ev(visible('#updates-open'))), 'ordinary browser has no native update entry');
    assert(!(await ev("!!document.querySelector('#updates-dialog')")), 'ordinary browser creates no native update dialog');
    assert(!(await ev("!!document.querySelector('#updates-reminder')")), 'ordinary browser creates no native update reminder');

    await navigate('?native=1');
    await waitFor(`!!document.querySelector('#updates-open') && ${callsFor('check')}.length===1`, 'native startup check');
    assert(await ev(visible('#updates-open')), 'native build exposes its update entry');
    assert(await ev(`${callsFor('state')}.length>=1 && ${callsFor('check')}.length===1`), 'native launch restores download state before checking versions');
    assert(!(await ev("document.querySelector('#updates-dialog').open")), 'automatic check does not open a modal');
    await click('#quick-task-open');
    await ev("document.querySelector('#task-title').value='更新后继续保留的专注任务';document.querySelector('#task-form').requestSubmit();document.querySelector('[data-minutes=\"10\"]').click();document.querySelector('#timer-start').click()");
    const business = await ev('localStorage.getItem(StepCore.key)');
    const deadline = await ev('StepApp.getState().timer.endsAt');
    assert(Number.isFinite(deadline), 'update fixture has a real running focus deadline');
    await click('#appearance-open');
    await waitFor("document.querySelector('#appearance-dialog').open", 'existing settings dialog');
    const focus = await ev('document.activeElement.id');
    const notes = '改善更新体验\n<img src=x onerror="window.updatesTestInjected=true">\n' + '这是用于验证长文字换行的更新说明。'.repeat(20);
    await reply('available', { version: '2.0.4', notes, size: 109664568 }, 'check');
    assert(await ev("document.querySelector('#appearance-dialog').open && !document.querySelector('#updates-dialog').open"), 'new version reminder does not interrupt an existing dialog');
    assert(await ev(`document.activeElement.id===${JSON.stringify(focus)}`), 'new version reminder does not steal keyboard focus');
    assert(await ev(`StepApp.getState().timer.endsAt===${JSON.stringify(deadline)} && document.querySelector('#focus-state').textContent==='正在专注'`), 'new version reminder preserves the running focus timer');
    assert(await ev(visible('#updates-reminder')), 'available version creates a nonmodal reminder');
    await escape('#appearance-dialog');
    for (const width of [1440, 390, 320]) {
      await viewport(width);
      assert(await ev(`document.documentElement.scrollWidth<=${width} && document.querySelector('#updates-reminder').scrollWidth<=document.querySelector('#updates-reminder').clientWidth`), `${width}px native navigation and reminder have no horizontal overflow`);
      await screenshot(`updates-reminder-${width}.png`);
    }
    await click('#updates-view');
    await waitFor("document.querySelector('#updates-dialog').open", 'open update details');
    assert(await ev("document.querySelector('#updates-dialog').textContent.includes('2.0.3') && document.querySelector('#updates-dialog').textContent.includes('2.0.4')"), 'update details show native installed and available versions');
    assert(await ev(`document.querySelector('#updates-notes').textContent===${JSON.stringify(notes)} && !document.querySelector('#updates-notes img') && !window.updatesTestInjected`), 'release notes are literal text and cannot inject HTML');
    assert(await ev("!document.querySelector('#updates-download').hidden && !document.querySelector('#updates-download').disabled"), 'available version offers a download action');

    const beforeForged = await statusText();
    await ev("window.dispatchEvent(new CustomEvent('nextstep-update-result',{detail:{requestId:'unmatched',action:'check',status:'current',currentVersion:'9.9.9'}}))");
    assert(await statusText() === beforeForged, 'unmatched native result cannot overwrite the update state');
    await click('#updates-download');
    assert(await ev(`${callsFor('download')}.length===1`), 'download action is delegated to the native updater');
    await reply('progress', { version: '2.0.4', received: 25000000, total: 100000000, percent: 25 }, 'download');
    assert(await ev(visible('#updates-progress')) && await ev("Number(document.querySelector('#updates-progress').value)===25"), 'native download progress is shown inside the app');
    assert(await ev(visible('#updates-cancel')) && await ev("document.querySelector('#updates-check').disabled"), 'download offers cancellation and prevents a conflicting version check');
    assert(!(await ev(visible('#updates-install'))) || await ev("document.querySelector('#updates-install').disabled"), 'partially downloaded content cannot be installed');
    await screenshot('updates-progress-320.png');
    await escape('#updates-dialog');
    const progressChecks = await ev(`${callsFor('check')}.length`);
    await ev("window.dispatchEvent(new Event('nextstep-resume'));document.dispatchEvent(new Event('visibilitychange'))");
    await click('#updates-open');
    await waitFor("Number(document.querySelector('#updates-progress').value)===25", 'restore visible download progress');
    assert(await ev(`${callsFor('download')}.length===1 && ${callsFor('check')}.length===${progressChecks}`), 'closing, resuming and reopening preserves the active download without starting another check');
    await reply('progress', { version: '2.0.4', received: 70000000, total: 100000000, percent: 70 }, 'download');
    assert(await ev("Number(document.querySelector('#updates-progress').value)===70"), 'successive progress events update the same download');
    await reply('progress', { version: '2.0.4', received: 100000000, total: 100000000, percent: 100 }, 'download');
    assert(!(await ev(visible('#updates-install'))) || await ev("document.querySelector('#updates-install').disabled"), '100 percent transferred still cannot install before native validation finishes');
    await click('#updates-cancel'); await reply('cancelled', { version: '2.0.4' }, 'cancel');
    assert(/取消/.test(await statusText()), 'download cancellation is acknowledged');
    assert(!(await ev(visible('#updates-install'))) || await ev("document.querySelector('#updates-install').disabled"), 'cancelled partial download cannot be installed');
    await click('#updates-download');
    await reply('error', { message: '文件校验失败，请重新下载。', version: '2.0.4' }, 'download');
    assert(/校验失败/.test(await statusText()), 'failed package validation is reported');
    assert(!(await ev(visible('#updates-install'))) || await ev("document.querySelector('#updates-install').disabled"), 'unverified package cannot enable installation');
    await ev("window.dispatchEvent(new CustomEvent('nextstep-update-result',{detail:{requestId:'unmatched',action:'download',status:'ready',version:'2.0.4'}}))");
    assert(!(await ev(visible('#updates-install'))) || await ev("document.querySelector('#updates-install').disabled"), 'unmatched ready event cannot enable installation');
    await click('#updates-download');
    await reply('progress', { version: '2.0.4', received: 10000000, total: 100000000, percent: 10 }, 'download');
    // Actual elapsed time catches the former generic 35-second command timeout.
    console.log('Waiting 36 seconds to verify a real download does not time out like a version query.');
    await delay(36000);
    assert(await ev("Number(document.querySelector('#updates-progress').value)===10 && !document.querySelector('#updates-cancel').disabled") && !/超时/.test(await statusText()), 'active native download remains usable beyond the version-query timeout');
    await cdp('Page.reload'); await delay(150); await waitFor(ready); await delay(1500);
    assert(await ev(`${callsFor('check')}.length===0 && ${callsFor('download')}.length===0 && Number(document.querySelector('#updates-progress').value)===10`), 'reload recovers an active native download without starting a duplicate download or automatic check');
    await click('#updates-open');
    await ev(`window.updatesTest.setState(${JSON.stringify({ status: 'ready', version: '2.0.4', notes, size: 100000000, received: 100000000, total: 100000000, percent: 100 })});window.dispatchEvent(new Event('nextstep-resume'))`);
    await waitFor("!document.querySelector('#updates-install').hidden && !document.querySelector('#updates-install').disabled", 'native download finishes after UI reload');
    assert(await ev(visible('#updates-install')) && await ev("!document.querySelector('#updates-install').disabled && document.querySelector('#updates-install').textContent.includes('重启')"), 'verified Windows package offers restart and update');
    assert(!/浏览器/.test(await ev("document.querySelector('#updates-install-help').textContent")), 'Windows update instructions stay within the app');
    await screenshot('updates-ready-windows-320.png');
    await cdp('Page.reload'); await delay(150); await waitFor(ready); await delay(1500);
    assert(await ev(`${callsFor('state')}.length>=1 && ${callsFor('check')}.length===0 && ${callsFor('download')}.length===0`), 'cached ready package restores after reload without another check or download');
    await click('#updates-open'); await waitFor(visible('#updates-install'), 'restored install button');
    assert(await ev("!document.querySelector('#updates-install').disabled"), 'restored verified package remains installable');
    await click('#updates-install');
    assert(await ev(`${callsFor('install')}.length===1`), 'Windows restart-update action is delegated to the native installer');
    await reply('installing', { version: '2.0.4', message: '正在准备更新…' }, 'install');
    assert(/更新|安装|重启/.test(await statusText()) && !/更新完成|安装成功/.test(await statusText()), 'installer launch does not prematurely claim successful replacement');

    // Start another app session with no pending package for current/error checks.
    await ev("window.updatesTest.setState({status:'idle'})");
    await cdp('Page.reload'); await delay(150); await waitFor(ready);
    await waitFor(`${callsFor('check')}.length===1`, 'version check without a cached package');
    await reply('current', { version: '2.0.3' }, 'check');
    await click('#updates-open'); await waitFor("document.querySelector('#updates-dialog').open");
    await click('#updates-check');
    assert(await ev(`${callsFor('check')}.length===2 && document.querySelector('#updates-check').disabled`), 'manual version check disables duplicate requests');
    await reply('current', { version: '2.0.3' }, 'check');
    assert(/最新|当前/.test(await statusText()), 'already-current result is explained');
    assert(!(await ev(visible('#updates-download'))) || await ev("document.querySelector('#updates-download').disabled"), 'already-current result cannot download an old build');
    await click('#updates-check'); await reply('error', { message: '网络暂时不可用，请稍后重试。' }, 'check');
    assert(/网络|重试|失败/.test(await statusText()) && await ev("!document.querySelector('#updates-check').disabled"), 'offline error remains recoverable through retry');
    const beforeRetry=await ev(`${callsFor('check')}.length`);
    await click('#updates-check');
    assert(await ev(`${callsFor('check')}.length`)===beforeRetry, 'failed checks respect a cooldown instead of repeatedly contacting the service');
    await ev("window.originalNow=Date.now;Date.now=()=>originalNow()+61000");
    await click('#updates-check'); await reply('available', { version: '2.0.4', notes, size: 109664568 }, 'check');
    assert(await ev("!document.querySelector('#updates-download').disabled"), 'retry can recover from network failure and offer the new version');
    for (const width of [1440, 390, 320]) {
      await viewport(width);
      assert(await ev(`document.documentElement.scrollWidth<=${width} && document.querySelector('#updates-dialog').scrollWidth<=document.querySelector('#updates-dialog').clientWidth`), `${width}px update details have no horizontal overflow`);
      assert(await ev("(() => {const r=document.querySelector('#updates-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()"), `${width}px update dialog fits the viewport`);
      await screenshot(`updates-details-${width}.png`);
      await escape('#updates-dialog');
      assert(await ev(`document.documentElement.scrollWidth<=${width}`), `${width}px native navigation has no horizontal overflow after opening update details`);
      await click('#updates-open'); await waitFor("document.querySelector('#updates-dialog').open");
    }
    // A fresh check completed while details are closed can show a new reminder.
    await click('#updates-check');
    await escape('#updates-dialog');
    await reply('available', { version: '2.0.5', notes: '下一版更新说明', size: 109664568 }, 'check');
    if (await ev(visible('#updates-reminder'))) {
      await waitFor("document.querySelector('#toast').hidden", 'temporary task-added toast to clear');
      await click('#updates-dismiss');
      assert(!(await ev(visible('#updates-reminder'))), 'later action dismisses the new version reminder');
    } else throw Error('Available version reminder missing before dismiss test');
    assert(await ev(`localStorage.getItem(StepCore.key)===${JSON.stringify(business)}`), 'all update interactions preserve the saved task and focus data exactly');
    await ev("window.updatesTest.setState({status:'idle'})");
    await cdp('Page.reload'); await delay(150); await waitFor(ready);
    await waitFor(`${callsFor('check')}.length===1`, 'fresh startup check after reload');
    assert(await ev("NextStepUpdates.getVersion()==='2.0.3'"), 'reload still reads the installed version from the native bridge');
    await reply('error', { message: '网络暂时不可用，请稍后重试。' }, 'check');
    assert(!(await ev("document.querySelector('#updates-dialog').open")) && !(await ev(visible('#updates-reminder'))), 'automatic network failure stays quiet while the app remains usable');
    assert(await ev(`localStorage.getItem(StepCore.key)===${JSON.stringify(business)}`), 'automatic offline check preserves persisted task and timer state');

    await click('#updates-open'); await waitFor("document.querySelector('#updates-dialog').open");
    await click('#updates-auto');
    assert(await ev("!document.querySelector('#updates-auto').checked && JSON.parse(localStorage.getItem('next-small-step.updates.v1')).automatic===false"), 'automatic update checks can be turned off independently of task data');
    await ev("window.updatesTest.setState({status:'idle'})");
    await cdp('Page.reload'); await delay(150); await waitFor(ready); await delay(1500);
    assert(await ev(`${callsFor('check')}.length===0 && !document.querySelector('#updates-auto').checked`), 'disabled automatic checks stay disabled after reload');
    await click('#updates-open');
    await waitFor(`${callsFor('check')}.length===1`, 'manual check with automatic checks disabled');
    assert(await ev(`${callsFor('check')}.length===1`), 'manual check remains available when automatic checks are disabled');
    await reply('current', { version: '2.0.3' }, 'check');
    await click('#updates-auto');
    assert(await ev("document.querySelector('#updates-auto').checked && JSON.parse(localStorage.getItem('next-small-step.updates.v1')).automatic===true"), 'automatic checks can be enabled again');
    assert(await ev(`localStorage.getItem(StepCore.key)===${JSON.stringify(business)}`), 'update preference changes do not alter task or focus storage');

    await navigate('?native=1&platform=android');
    await waitFor(`${callsFor('check')}.length===1`, 'Android startup check');
    await reply('available', { version: '2.0.4', notes: '安卓版本更新说明', size: 1024000 }, 'check');
    await click('#updates-open'); await waitFor("document.querySelector('#updates-dialog').open");
    assert(await ev("document.querySelector('#updates-dialog').textContent.includes('2.0.4') && document.querySelector('#updates-notes').textContent==='安卓版本更新说明'"), 'Android bridge uses the same update details and release notes');
    await click('#updates-download');
    await reply('progress', { version: '2.0.4', received: 512000, total: 1024000, percent: 50 }, 'download');
    assert(await ev(`${callsFor('download')}.length===1 && Number(document.querySelector('#updates-progress').value)===50`), 'Android download uses the native bridge and displays progress');
    await reply('ready', { version: '2.0.4', size: 1024000, received: 1024000, total: 1024000, percent: 100 }, 'download');
    assert(await ev("!document.querySelector('#updates-install').disabled && document.querySelector('#updates-install').textContent.includes('安装')"), 'verified Android package offers installation');
    assert(!/浏览器/.test(await ev("document.querySelector('#updates-install-help').textContent")), 'Android update instructions stay within the app');
    await click('#updates-install');
    await reply('permission', { version: '2.0.4', message: '请允许安装此来源的应用，然后返回继续安装。' }, 'install');
    assert(/允许|授权|权限|来源/.test(await statusText()), 'Android install permission request is explained');
    assert(!/安装成功|更新完成/.test(await statusText()), 'permission request is not mistaken for a finished update');
    await screenshot('updates-permission-android-320.png');
    await ev("window.updatesTest.setState({status:'ready',version:'2.0.4',notes:'安卓版本更新说明',size:1024000});window.dispatchEvent(new Event('nextstep-resume'))");
    await waitFor("!document.querySelector('#updates-install').hidden && !document.querySelector('#updates-install').disabled", 'ready package after Android permission return');
    assert(await ev(`${callsFor('download')}.length===1`), 'returning from Android settings reuses the verified APK');
    await click('#updates-install'); await reply('installing', { version: '2.0.4', message: '已打开系统安装界面，请按提示安装。' }, 'install');
    assert(await ev(`${callsFor('install')}.length===2`) && !/安装成功|更新完成/.test(await statusText()), 'Android installation opens through the native bridge without claiming completion');
    await ev("window.updatesTest.setState({status:'ready',version:'2.0.4',notes:'安卓版本更新说明',size:1024000});window.dispatchEvent(new Event('nextstep-resume'))");
    await waitFor("!document.querySelector('#updates-install').hidden && !document.querySelector('#updates-install').disabled", 'APK remains available after cancelled installer');
    assert(await ev(`${callsFor('download')}.length===1`), 'cancelled Android installer preserves the APK for another installation attempt');
    await screenshot('updates-ready-android-320.png');
    await ev("window.updatesTest.setState({status:'current',version:'2.0.3'});window.dispatchEvent(new Event('nextstep-resume'))");
    await waitFor("document.querySelector('#updates-install').hidden || document.querySelector('#updates-install').disabled", 'clear stale install action on native current result');
    assert(/最新|当前/.test(await statusText()), 'native current result clears a stale install action');
    assert(await ev(`localStorage.getItem(StepCore.key)===${JSON.stringify(business)}`), 'download, cancellation, validation, permission and installation flows preserve task and focus data exactly');
    assert(errors.length === 0, 'no updater or browser runtime errors');
    fs.writeFileSync(path.join(qa, 'updates-result.json'), JSON.stringify({ passed: count, errors, viewports: [1440, 390, 320], screenshots }, null, 2));
    console.log(`${count} updater checks passed`);
    await cdp('Browser.close');
  } finally { ws?.close(); browser.kill(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
