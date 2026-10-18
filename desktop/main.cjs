'use strict';
const { app, BrowserWindow, Menu, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const START_URL = 'nextstep://app/index.html';
const smoke = process.argv.includes('--smoke-test');
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const token = argument('smoke-token') || crypto.randomUUID();
if (smoke && !/^[a-f0-9-]{36}$/i.test(token)) throw new Error('Invalid smoke-test token');
const smokeRoot = smoke ? path.join(os.tmpdir(), `next-small-step-smoke-${token}`) : null;
const smokePhase = argument('smoke-phase') || 'full';
// Never use the portable EXE's temporary extraction path for progress data.
const userData = smoke ? path.join(smokeRoot, 'profile') : path.join(app.getPath('appData'), 'NextSmallStep');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.setPath('sessionData', userData);
app.setName('下一小步');
app.setAppUserModelId('io.github.zyy051206.nextstep.desktop');

protocol.registerSchemesAsPrivileged([{ scheme: 'nextstep', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true
} }]);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
let window;
let smokeDownloadMode = 'save';
const pageErrors = [];

function localUrl(value, pageOnly = false) {
  try {
    const url = new URL(value);
    return url.protocol === 'nextstep:' && url.hostname === 'app' && !url.port && !url.username && !url.password
      && (!pageOnly || url.pathname === '/index.html' || url.pathname === '/');
  } catch { return false; }
}

function reportBackup(contents, status, message) {
  if (!contents || contents.isDestroyed()) return;
  const detail = JSON.stringify({ status, message });
  contents.executeJavaScript(`window.dispatchEvent(new CustomEvent('nextstep-backup-result',{detail:${detail}}));`).catch(() => {});
}

async function configureSession() {
  const assets = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '../dist');
  protocol.handle('nextstep', async request => {
    if (!localUrl(request.url) || request.method !== 'GET') return new Response('', { status: 403 });
    try {
      const name = decodeURIComponent(new URL(request.url).pathname);
      const file = path.resolve(assets, '.' + (name === '/' ? '/index.html' : name));
      const relative = path.relative(assets, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('', { status: 403 });
      return new Response(await fs.promises.readFile(file), {
        headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' }
      });
    } catch { return new Response('', { status: 404 }); }
  });
  const current = session.defaultSession;
  current.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  current.setPermissionCheckHandler(() => false);
  current.webRequest.onBeforeRequest((details, callback) => {
    const allowed = localUrl(details.url) || details.url.startsWith('blob:nextstep://app/')
      || (details.resourceType === 'image' && details.url.startsWith('data:image/'));
    callback({ cancel: !allowed });
  });
  current.on('will-download', (event, item, contents) => {
    if (item.getInitiatorOrigin() !== 'nextstep://app' || !item.getURL().startsWith('blob:nextstep://app/')) {
      event.preventDefault();
      reportBackup(contents, 'error', '只允许保存本应用生成的备份。');
      return;
    }
    const filename = item.getFilename().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 150);
    item.once('done', (_event, state) => {
      const status = state === 'completed' ? 'success' : state === 'cancelled' ? 'cancelled' : 'error';
      reportBackup(contents, status, status === 'success' ? '备份已保存。' : status === 'cancelled' ? '已取消保存备份。' : '备份保存失败，请重新选择保存位置。');
    });
    if (smoke) {
      // Automated tests only write into their isolated temporary directory.
      if (smokeDownloadMode === 'cancel') item.cancel();
      else item.setSavePath(path.join(smokeRoot, 'exported-backup.json'));
      return;
    }
    // Do not setSavePath here: Electron shows the native dialog, including the
    // Windows confirmation before replacing any existing file of the same name.
    item.setSaveDialogOptions({
      title: '保存下一小步备份', buttonLabel: '保存备份',
      defaultPath: path.join(app.getPath('documents'), filename.endsWith('.json') ? filename : '下一小步-备份.json'),
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    });
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1360, height: 900, minWidth: 860, minHeight: 640,
    title: '下一小步', backgroundColor: '#f5f4ed', show: false,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false, spellcheck: false }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', details => { if (!localUrl(details.url, true)) details.preventDefault(); });
  window.webContents.on('will-frame-navigate', details => { if (!details.isMainFrame || !localUrl(details.url, true)) details.preventDefault(); });
  window.webContents.on('will-redirect', details => { if (!localUrl(details.url, true)) details.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('preload-error', (_event, _file, error) => pageErrors.push(error.message));
  if (smoke) window.webContents.on('console-message', details => { if (details.level === 'error') pageErrors.push(details.message); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '退出', role: 'quit' }] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
      { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
    { label: '视图', submenu: [{ label: '重新载入', role: 'reload' }, { type: 'separator' },
      { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { label: '实际大小', role: 'resetZoom' }, { label: '全屏', role: 'togglefullscreen' }] }
  ]));
  await window.loadURL(START_URL);
  if (!smoke) window.show();
  return window;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(script, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(script)) return;
    await wait(120);
  }
  throw new Error(`Timed out: ${label}`);
}

async function runSmoke() {
  const checks = [];
  const evaluate = script => window.webContents.executeJavaScript(script);
  async function check(script, label) {
    if (!await evaluate(script)) throw new Error(label);
    checks.push(label);
  }
  await waitFor("document.readyState==='complete' && typeof StepCore==='object' && typeof document.querySelector('#new-goal')?.onclick==='function' && document.querySelectorAll('#annual-chart .month-column').length===12", 'application readiness');
  await check("location.origin==='nextstep://app' && typeof NextStepDesktop==='object'", 'stable local origin and desktop marker');
  await check("typeof require==='undefined' && typeof process==='undefined'", 'renderer has no Node access');
  await check("!!document.querySelector('#planner') && !!document.querySelector('#important-dates')", 'calendar and important-date panels loaded');
  if (smokePhase === 'seed' || smokePhase === 'full') {
    await evaluate("document.querySelector('#new-goal').click();document.querySelector('#goal-name').value='桌面启动验证';document.querySelector('#goal-steps').value='完成一次真实计时';document.querySelector('#goal-form').requestSubmit();document.querySelector('[data-minutes=\"10\"]').click();document.querySelector('#timer-start').click()");
    await check("JSON.parse(localStorage.getItem(StepCore.key)).timer?.status==='running'", 'goal, action and running timer created through UI');
    fs.writeFileSync(path.join(smokeRoot, 'expected.json'), JSON.stringify(await evaluate("({endsAt:JSON.parse(localStorage.getItem(StepCore.key)).timer.endsAt})")));
    await evaluate("window.backupStatus=null;window.addEventListener('nextstep-backup-result',event=>{window.backupStatus=event.detail.status});document.querySelector('#export-data').click()");
    await waitFor("window.backupStatus==='success'", 'real Blob backup completion');
    const exported = JSON.parse(fs.readFileSync(path.join(smokeRoot, 'exported-backup.json'), 'utf8'));
    if (exported.goals[0]?.title !== '桌面启动验证') throw new Error('Exported backup does not contain real progress');
    checks.push('Blob export writes a real JSON backup before reporting success');
    smokeDownloadMode = 'cancel';
    await evaluate("window.backupStatus=null;document.querySelector('#export-data').click()");
    await waitFor("window.backupStatus==='cancelled'", 'backup cancellation feedback');
    checks.push('cancelled backup is reported as cancelled');
    if (smokePhase === 'full') {
      await window.loadURL(START_URL);
      await waitFor("typeof StepCore==='object' && !!document.querySelector('#goal-title')?.textContent", 'reloaded application');
    }
  }
  if (smokePhase === 'verify' || smokePhase === 'full') {
    const expected = JSON.parse(fs.readFileSync(path.join(smokeRoot, 'expected.json'), 'utf8'));
    await check("document.querySelector('#goal-title').textContent==='桌面启动验证'", 'goal survives full application restart');
    await check(`JSON.parse(localStorage.getItem(StepCore.key)).timer?.endsAt===${expected.endsAt}`, 'timer deadline survives restart');
    await check("document.querySelectorAll('#annual-chart .month-column').length===12", 'all twelve months are rendered');
    await check("document.documentElement.scrollWidth<=window.innerWidth", 'desktop page does not overflow horizontally');
  }
  if (pageErrors.length) throw new Error(`Renderer error: ${pageErrors.join('; ')}`);
  session.defaultSession.flushStorageData();
  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync(path.join(smokeRoot, `${smokePhase}.png`), screenshot.toPNG());
  fs.writeFileSync(path.join(smokeRoot, `${smokePhase}.json`), JSON.stringify({ success: true, version: app.getVersion(), phase: smokePhase, checks }, null, 2));
  app.quit();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(configureSession).then(createWindow).then(() => smoke ? runSmoke() : undefined).catch(error => {
    if (smokeRoot) fs.writeFileSync(path.join(smokeRoot, `${smokePhase}.json`), JSON.stringify({ success: false, error: error.message, pageErrors }, null, 2));
    console.error(error.message);
    app.exit(1);
  });
}
