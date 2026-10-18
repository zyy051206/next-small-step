const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isDeepStrictEqual } = require('node:util');
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
    '--headless=new', '--disable-extensions', '--disable-gpu', '--no-first-run', '--remote-debugging-port=19361',
    '--user-data-dir=' + path.join(qa, 'appearance-browser-' + Date.now()), 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let ws, count = 0;
  try {
    let tabs;
    for (let n = 0; n < 40; n++) {
      try { tabs = await (await fetch('http://127.0.0.1:19361/json/list', { signal: AbortSignal.timeout(1000) })).json(); break; }
      catch { await delay(250); }
    }
    if (!tabs) throw Error('Headless Edge unavailable');
    ws = new WebSocket(tabs.find(tab => tab.type === 'page' && tab.url === 'about:blank').webSocketDebuggerUrl);
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
      for (let n = 0; n < 80; n++) { if (await ev(expression)) return; await delay(100); }
      throw Error('Timed out: ' + label);
    };
    const ready = "document.readyState==='complete' && !!window.StepPages && !!window.StepApp && !!window.StepAppearance";
    const background = "getComputedStyle(document.body,'::before').backgroundImage!=='none'";
    const viewport = async width => {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 600 });
      await delay(100);
    };
    const click = async selector => {
      const point = await ev(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node || !node.getClientRects().length || node.disabled) throw Error('Click target unavailable: '+${JSON.stringify(selector)}); node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}); const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      await delay(80);
    };
    const open = async () => { await click('#appearance-open'); await waitFor("document.querySelector('#appearance-dialog').open", 'appearance dialog'); };
    const close = async () => {
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await waitFor("!document.querySelector('#appearance-dialog').open", 'close appearance dialog');
    };
    const reload = async () => {
      await cdp('Page.reload'); await delay(150); await waitFor(ready); await ev('StepAppearance.ready');
    };
    const upload = async file => {
      const { root: documentNode } = await cdp('DOM.getDocument');
      const { nodeId } = await cdp('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#appearance-bg-file' });
      await cdp('DOM.setFileInputFiles', { nodeId, files: [file] });
    };
    const imageRecord = () => ev(`new Promise((resolve,reject)=>{const request=indexedDB.open('next-small-step.appearance',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const read=db.transaction('images').objectStore('images').get('background');read.onerror=()=>{db.close();reject(read.error)};read.onsuccess=async()=>{const value=read.result;db.close();resolve(value?{name:value.name,size:value.blob.size,type:value.blob.type}:null)}}})`);
    const color = () => ev("document.querySelector('#appearance-icon-color').value.toLowerCase()");
    const screenshot = async name => {
      await ev("window.scrollTo({top:0,left:0,behavior:'instant'});document.querySelector('#toast').style.visibility='hidden'");
      await delay(100);
      const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(qa, name), Buffer.from(result.data, 'base64'));
      screenshots.push(name);
      await ev("document.querySelector('#toast').style.visibility=''");
    };

    await cdp('Runtime.enable'); await cdp('Page.enable'); await viewport(1440);
    await cdp('Page.navigate', { url }); await waitFor(ready); await ev('StepAppearance.ready');
    // Give the appearance checks meaningful existing task data to protect.
    await click('#quick-task-open');
    await ev("document.querySelector('#task-title').value='外观调整后仍需保留的待办';document.querySelector('#task-date').value=StepCore.dayKey(Date.now());document.querySelector('#task-form').requestSubmit()");
    const business = await ev('JSON.stringify(StepApp.getState())');
    const businessStorage = await ev('localStorage.getItem(StepCore.key)');
    assert(!(await ev(background)), 'fresh installation has no custom image background');
    await open();
    assert(await color() === '#315b46', 'fresh installation uses the default icon color');
    assert(await ev("document.querySelector('#appearance-shade').value==='72'"), 'fresh installation uses the default readability overlay');

    // Create a test image locally through SVG-to-canvas; it contains no user data.
    const pngData = await ev(`new Promise((resolve,reject)=>{const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g"><stop stop-color="#739ba6"/><stop offset="1" stop-color="#edc8b5"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="900" cy="170" r="90" fill="#f6ecbc"/><path d="M0 600L300 260 650 640 960 340 1200 680V800H0Z" fill="#486954"/></svg>';const image=new Image();image.onerror=reject;image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;canvas.getContext('2d').drawImage(image,0,0);resolve(canvas.toDataURL('image/png').split(',')[1])};image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)})`);
    const pngPath = path.join(qa, 'appearance-landscape.png');
    fs.writeFileSync(pngPath, Buffer.from(pngData, 'base64'));
    const invalidPath = path.join(qa, 'appearance-invalid.txt');
    const corruptPath = path.join(qa, 'appearance-corrupt.png');
    const oversizedPath = path.join(qa, 'appearance-oversized.png');
    fs.writeFileSync(invalidPath, 'This is not an image.');
    fs.writeFileSync(corruptPath, 'This has a PNG extension but no image pixels.');
    fs.writeFileSync(oversizedPath, Buffer.from(pngData, 'base64').subarray(0, 64));
    fs.truncateSync(oversizedPath, 20 * 1024 * 1024 + 1);
    await upload(pngPath);
    await waitFor(background + " && document.querySelector('#appearance-bg-preview').naturalWidth>0 && !document.querySelector('#appearance-bg-remove').disabled", 'uploaded background');
    assert(await ev("document.querySelector('#appearance-bg-name').textContent.includes('appearance-landscape.png')"), 'selected image name appears in settings');
    const storedImage = await imageRecord();
    assert(storedImage?.name === 'appearance-landscape.png' && storedImage.size === fs.statSync(pngPath).size, 'original image blob is saved in IndexedDB');
    assert(await ev("!localStorage.getItem('next-small-step.appearance.v1')?.includes('data:image')"), 'background image does not consume localStorage task quota');
    await close();
    assert(await ev(background), 'background remains visible after closing settings');
    await reload();
    assert(await ev(background), 'background restores after refresh');
    assert(JSON.stringify(await imageRecord()) === JSON.stringify(storedImage), 'refresh keeps the same saved image');
    await open();

    for (const [file, label] of [[invalidPath, 'text file'], [corruptPath, 'corrupt PNG'], [oversizedPath, 'file larger than 20 MiB']]) {
      const oldStatus = await ev("document.querySelector('#appearance-status').textContent");
      await upload(file);
      await waitFor(`document.querySelector('#appearance-status').textContent!==${JSON.stringify(oldStatus)} && document.querySelector('#appearance-status').dataset.tone==='error'`, `reject ${label}`);
      assert(await ev(background), `${label} is rejected while the existing background remains visible`);
      assert(JSON.stringify(await imageRecord()) === JSON.stringify(storedImage), `${label} does not replace the saved background`);
    }
    await ev("window.appearanceTestPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('Simulated full image storage','QuotaExceededError')}");
    await upload(pngPath);
    await waitFor("document.querySelector('#appearance-status').textContent.includes('背景保存失败')", 'image storage failure');
    assert(await ev(background), 'image storage failure preserves the visible background');
    assert(JSON.stringify(await imageRecord()) === JSON.stringify(storedImage), 'image storage failure preserves the previously saved image');
    await ev('IDBObjectStore.prototype.put=window.appearanceTestPut;delete window.appearanceTestPut');

    await ev("document.querySelector('#appearance-shade').value='51';document.querySelector('#appearance-shade').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#appearance-shade').dispatchEvent(new Event('change',{bubbles:true}))");
    await waitFor("JSON.parse(localStorage.getItem('next-small-step.appearance.v1')).shade===51", 'overlay persistence');
    assert(await ev("document.querySelector('#appearance-shade-value').textContent.includes('51')"), 'overlay adjustment updates its visible value');
    await close(); await reload(); await open();
    assert(await ev("document.querySelector('#appearance-shade').value==='51'"), 'overlay preference restores after refresh');

    const chosenSwatch = await ev("[...document.querySelectorAll('[data-icon-color]')].find(node=>node.dataset.iconColor.toLowerCase()!=='#315b46').dataset.iconColor.toLowerCase()");
    await click(`[data-icon-color="${chosenSwatch}"]`);
    assert(await color() === chosenSwatch, 'preset swatch updates the icon color picker');
    assert(await ev(`JSON.parse(localStorage.getItem('next-small-step.appearance.v1')).iconColor.toLowerCase()===${JSON.stringify(chosenSwatch)}`), 'preset swatch is persisted');
    await ev("document.querySelector('#appearance-icon-color').value='#a13ac2';document.querySelector('#appearance-icon-color').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#appearance-icon-color').dispatchEvent(new Event('change',{bubbles:true}))");
    await waitFor("JSON.parse(localStorage.getItem('next-small-step.appearance.v1')).iconColor.toLowerCase()==='#a13ac2'", 'custom color persistence');
    assert(await ev("document.querySelector('#appearance-color-value').textContent.toLowerCase().includes('#a13ac2')"), 'custom color is reflected in its visible value');
    assert(await ev("getComputedStyle(document.querySelector('.header nav svg')).stroke==='rgb(161, 58, 194)' && getComputedStyle(document.querySelector('.brand-mark rect')).fill==='rgb(161, 58, 194)'"), 'custom color changes the rendered navigation icons and Logo');
    await close(); await reload(); await open();
    assert(await color() === '#a13ac2', 'custom icon color restores after refresh');
    assert(await ev("getComputedStyle(document.querySelector('.header nav svg')).stroke==='rgb(161, 58, 194)' && getComputedStyle(document.querySelector('.brand-mark rect')).fill==='rgb(161, 58, 194)'"), 'restored color is applied to the rendered icons and Logo');
    await ev("document.querySelector('#appearance-icon-color').value='#ffffff';document.querySelector('#appearance-icon-color').dispatchEvent(new Event('input',{bubbles:true}))");
    assert(await ev("getComputedStyle(document.querySelector('.header nav svg')).stroke==='rgb(255, 255, 255)' && getComputedStyle(document.querySelector('.header nav svg')).backgroundColor==='rgb(52, 66, 58)' && getComputedStyle(document.querySelector('.brand-mark path[fill]')).fill==='rgb(0, 0, 0)'"), 'white icon color uses a contrasting surface and readable Logo detail');
    await ev("document.querySelector('#appearance-icon-color').value='#a13ac2';document.querySelector('#appearance-icon-color').dispatchEvent(new Event('input',{bubbles:true}))");

    for (const width of [1440, 390, 320]) {
      await viewport(width);
      assert(await ev(`document.documentElement.scrollWidth<=${width} && document.querySelector('#appearance-dialog').scrollWidth<=document.querySelector('#appearance-dialog').clientWidth`), `${width}px appearance settings have no horizontal overflow`);
      assert(await ev("(() => {const dialog=document.querySelector('#appearance-dialog').getBoundingClientRect();return dialog.left>=0&&dialog.right<=innerWidth&&dialog.top>=0&&dialog.bottom<=innerHeight})()"), `${width}px appearance dialog fits the viewport`);
      await screenshot(`appearance-settings-${width}.png`);
      await close();
      for (const page of ['workspace', 'planner', 'important-dates', 'footprints']) {
        await click(`.header nav a[href="#${page}"]`);
        assert(await ev(`${background} && document.documentElement.scrollWidth<=${width}`), `${width}px ${page} keeps its background without horizontal overflow`);
      }
      await click('.header nav a[href="#workspace"]');
      await screenshot(`appearance-workspace-${width}.png`);
      await open();
    }

    await ev("StepPages.show('planner')");
    assert(await ev("!document.querySelector('#appearance-dialog').open && !document.querySelector('#planner').hidden"), 'page navigation closes appearance settings');
    await open(); await click('#appearance-color-reset');
    assert(await color() === '#315b46', 'restore-default control resets icon color');
    assert(await ev(background), 'resetting icon color preserves the chosen background');
    await close(); await reload(); await open();
    assert(await color() === '#315b46', 'default icon color persists after refresh');
    await click('#appearance-bg-remove');
    await waitFor('!(' + background + ')', 'background removal');
    assert((await imageRecord()) === null, 'removing the background deletes its IndexedDB record');
    await close(); await reload();
    assert(!(await ev(background)), 'removed background does not reappear after refresh');
    await ev("localStorage.setItem('next-small-step.appearance.v1','{broken appearance preferences')");
    await reload(); await open();
    assert(await ev("document.querySelector('#appearance-status').dataset.tone==='error' && localStorage.getItem('next-small-step.appearance.v1')==='{broken appearance preferences'"), 'unreadable appearance settings show a warning and preserve the original stored value');
    assert(await ev("StepBackup.create(StepApp.getState()).then(()=>false,()=>true)"), 'corrupt appearance settings prevent a misleading complete backup');
    await click('#appearance-color-reset');
    assert(await ev("JSON.parse(localStorage.getItem('next-small-step.appearance.v1')).iconColor==='#315b46' && document.querySelector('#appearance-status').dataset.tone!=='error'"), 'explicit reset recovers from unreadable appearance settings');
    await close(); await reload();
    assert(await color() === '#315b46', 'recovered settings remain valid after refresh');
    assert(isDeepStrictEqual(await ev('StepApp.getState()'), JSON.parse(business)) && await ev(`localStorage.getItem(StepCore.key)===${JSON.stringify(businessStorage)}`), 'appearance changes preserve all task and focus data exactly');

    // Display modes, scaled mobile layouts, complete backup round-trip and rollback.
    await open(); await upload(pngPath); await waitFor(background);
    await ev("document.querySelector('#appearance-theme').value='dark';document.querySelector('#appearance-theme').dispatchEvent(new Event('change'));document.querySelector('#appearance-font').value='130';document.querySelector('#appearance-font').dispatchEvent(new Event('input'));document.querySelector('#appearance-shade').value='100';document.querySelector('#appearance-shade').dispatchEvent(new Event('input'))");
    assert(await ev("document.documentElement.dataset.theme==='dark' && getComputedStyle(document.body).fontSize==='18.2px'"), 'dark theme and 130 percent text are applied');
    await close(); await reload();
    assert(await ev("document.documentElement.dataset.theme==='dark' && document.querySelector('#appearance-font').value==='130' && document.querySelector('#appearance-shade').value==='100'"), 'theme, font and full overlay survive reload');
    for(const width of [1440,390,320]) {
      await viewport(width);
      for(const route of ['workspace','planner','important-dates','footprints']) {
        await ev(`location.hash=${JSON.stringify(route)}`);await delay(100);
        assert(await ev('document.documentElement.scrollWidth<=innerWidth+1'), `dark large-text ${route} fits ${width}px`);
      }
      await screenshot(`display-dark-${width}.png`);
    }
    await open(); await screenshot('display-settings-dark.png'); await close();
    await ev("(async()=>{localStorage.setItem('next-small-step.reminders.v1',JSON.stringify({enabled:true,sound:false}));localStorage.setItem('next-small-step.updates.v1',JSON.stringify({automatic:false}));window.fullBackup=await StepBackup.create(StepApp.getState());window.preRestore=await StepBackup.parse(fullBackup)})()");
    assert(await ev("fullBackup.format==='next-small-step.full-backup' && fullBackup.appearance.image.data.startsWith('data:image/png;base64,') && fullBackup.appearance.preferences.theme==='dark' && fullBackup.reminders.sound===false"), 'full backup includes business, image and settings');
    await open();await click('#appearance-bg-remove');await waitFor('!('+background+')');await close();
    await ev('StepBackup.restore(preRestore)');
    assert(await ev(background), 'complete backup restores the actual wallpaper');
    assert(await ev("localStorage.getItem(StepCore.key)===JSON.stringify(fullBackup.data) && JSON.parse(localStorage.getItem('next-small-step.updates.v1')).automatic===false"), 'complete backup restores progress and update settings');
    assert(await ev("StepBackup.parse(fullBackup.data).then(value=>value.legacy===true)"), 'old progress-only backups remain supported');
    assert(await ev("(async()=>{const bad=structuredClone(fullBackup);bad.appearance.image.data='data:image/png;base64,AAAA';try{await StepBackup.parse(bad);return false;}catch{return true;}})()"), 'corrupt image is rejected before mutation');
    assert(await ev("(async()=>{const bad=structuredClone(fullBackup);bad.appearance.preferences.fontScale=900;try{await StepBackup.parse(bad);return false;}catch{return true;}})()"), 'out-of-range appearance settings are rejected');
    assert(await ev("(async()=>{const before=localStorage.getItem(StepCore.key);const bundle=await StepBackup.parse(fullBackup);bundle.data.minutes=45;const original=Storage.prototype.setItem;let failed=false;Storage.prototype.setItem=function(k,v){if(k==='next-small-step.appearance.v1'&&!failed){failed=true;throw Error('simulated quota');}return original.call(this,k,v)};let rejected=false;try{await StepBackup.restore(bundle)}catch{rejected=true}finally{Storage.prototype.setItem=original}return rejected&&localStorage.getItem(StepCore.key)===before&&(await StepAppearance.snapshot()).image?.name===fullBackup.appearance.image.name})()"), 'failed restore rolls back progress and wallpaper');
    await ev("window.reminderCalls=[];window.NextStepReminders={schedule:value=>reminderCalls.push(JSON.parse(value)),getStatus:()=>JSON.stringify({permission:'granted',exact:true,platform:'android'}),requestPermission:()=>{},requestExactPermission:()=>{}};");
    // Native mock must be captured by the module as it initializes.
    await ev("new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='reminders.js';s.onload=resolve;s.onerror=reject;document.querySelector('.reminder-settings').remove();document.body.append(s)})");
    await ev("document.querySelector('#reminder-enabled').checked=true;document.querySelector('#reminder-enabled').dispatchEvent(new Event('change'));StepReminders.sync({status:'running',endsAt:Date.now()+60000,kind:'focus'})");
    assert(await ev("reminderCalls.at(-1).title==='专注结束了'"), 'running focus schedules a native reminder');
    await ev("StepReminders.sync({status:'paused',endsAt:Date.now()+60000,kind:'focus'})");
    assert(await ev('reminderCalls.at(-1)===null'), 'pausing cancels the pending native reminder');

    const localUrl = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
    await cdp('Page.navigate', { url: localUrl }); await delay(150); await waitFor(ready); await ev('StepAppearance.ready');
    await open(); await upload(pngPath); await waitFor(background, 'local file background upload');
    assert(await ev("location.protocol==='file:' && document.querySelector('#appearance-bg-preview').naturalWidth>0"), 'local HTML supports choosing a background image');
    await close(); await reload();
    assert(await ev(background), 'local HTML restores its background after refresh');
    await open(); await click('#appearance-bg-remove'); await waitFor('!(' + background + ')', 'local file background removal');
    await close(); await reload();
    assert(!(await ev(background)), 'local HTML keeps its background removed after refresh');
    assert(errors.length === 0, 'no appearance or browser runtime errors');
    fs.writeFileSync(path.join(qa, 'appearance-result.json'), JSON.stringify({ passed: count, errors, viewports: [1440, 390, 320], screenshots }, null, 2));
    console.log(`${count} appearance checks passed`);
    await cdp('Browser.close');
  } finally { ws?.close(); browser.kill(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
