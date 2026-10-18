(() => {
  'use strict';
  const bridge = window.NextStepUpdates;
  const methods = { check: 'checkUpdates', download: 'downloadUpdate', install: 'installUpdate', cancel: 'cancelUpdate', state: 'getUpdateState' };
  if (!bridge || ['getVersion', 'getPlatform', ...Object.values(methods)].some(key => typeof bridge[key] !== 'function')) return;
  let currentVersion, platform;
  try { currentVersion = bridge.getVersion(); platform = bridge.getPlatform(); } catch { return; }
  const validVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
  if (!validVersion(currentVersion) || !['windows', 'android'].includes(platform)) return;

  const entry = document.createElement('button');
  entry.id = 'updates-open'; entry.type = 'button'; entry.className = 'text-button';
  entry.setAttribute('aria-haspopup', 'dialog'); entry.setAttribute('aria-label', '检查更新'); entry.title = '检查更新';
  entry.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17"/></svg><span>检查更新</span><i hidden></i>';
  document.querySelector('.sidebar-bottom').insertBefore(entry, document.querySelector('#guide-open'));
  const dialog = document.createElement('dialog');
  dialog.id = 'updates-dialog'; dialog.setAttribute('aria-labelledby', 'updates-title');
  dialog.innerHTML = '<div class="dialog-heading"><span class="eyebrow">KEEP MOVING FORWARD</span><button id="updates-close" class="close-button" type="button" aria-label="关闭更新窗口">×</button></div><h2 id="updates-title">让下一步，保持新鲜。</h2><p class="updates-version"></p><p id="updates-status" role="status" aria-live="polite"></p><section id="updates-release" hidden><h3 id="updates-release-title"></h3><p id="updates-size"></p><pre id="updates-notes"></pre></section><div id="updates-transfer" hidden><progress id="updates-progress" max="100" value="0" aria-label="更新下载进度"></progress><p id="updates-progress-label"></p></div><div class="updates-actions"><button id="updates-check" class="button secondary" type="button">检查更新</button><button id="updates-download" class="button primary" type="button" hidden>下载更新</button><button id="updates-install" class="button primary" type="button" hidden></button><button id="updates-cancel" class="button secondary" type="button" hidden>取消下载</button></div><p id="updates-install-help" class="updates-help"></p><label class="updates-auto"><input id="updates-auto" type="checkbox"> 自动检查并提醒新版本</label><p class="updates-help">仅查询和下载公开的应用更新，不上传目标、专注记录或背景图片。离线时可以继续使用。</p>';
  document.body.append(dialog);
  const reminder = document.createElement('aside');
  reminder.id = 'updates-reminder'; reminder.hidden = true; reminder.setAttribute('aria-label', '新版本提醒');
  reminder.innerHTML = '<div role="status"><strong></strong><p>准备好时，再更新也不迟。</p></div><div><button id="updates-view" class="text-button" type="button">查看更新 ↗</button><button id="updates-dismiss" class="text-button" type="button">稍后</button></div>';
  document.body.append(reminder);

  const $ = id => document.getElementById(id);
  const status = $('updates-status'), checkButton = $('updates-check'), downloadButton = $('updates-download');
  const installButton = $('updates-install'), cancelButton = $('updates-cancel');
  dialog.querySelector('.updates-version').textContent = `${platform === 'windows' ? 'Windows 电脑版' : 'Android 安卓版'} · 当前版本 ${currentVersion}`;
  installButton.textContent = platform === 'windows' ? '重启并更新' : '安装更新';
  $('updates-install-help').textContent = platform === 'windows'
    ? '在应用内下载并校验，准备好后点击“重启并更新”。程序会自动完成更新并重新打开，保留本机记录和外观。'
    : '在应用内下载并校验，点击“安装更新”即可进入系统安装确认。首次可能需要允许本应用安装更新，返回后继续；无需查找 APK，也无需卸载旧版。';
  const preferenceKey = 'next-small-step.updates.v1';
  let automatic = true;
  try { automatic = JSON.parse(localStorage.getItem(preferenceKey))?.automatic !== false; } catch { /* Optional preference storage. */ }
  $('updates-auto').checked = automatic;
  let retryAfter = 0;
  let sequence = 0, epoch = 0, lastCheck = 0, checked = false, phase = 'idle';
  let offer = null, dismissedVersion = '', received = 0, total = 0;
  const requests = new Map();
  const busy = () => ['checking', 'progress', 'installing', 'permission', 'cancelling'].includes(phase);
  const hasAction = action => [...requests.values()].some(item => item.action === action);
  const mb = bytes => (bytes / 1024 / 1024).toFixed(1);
  function message(text, error = false) { status.textContent = text; status.dataset.tone = error ? 'error' : 'normal'; }
  function forget(id) { const request = requests.get(id); if (request) clearTimeout(request.timeout); requests.delete(id); }
  function clearAction(action) { for (const [id, request] of requests) if (request.action === action) forget(id); }
  function render() {
    checkButton.disabled = busy(); checkButton.textContent = phase === 'checking' ? '检查中…' : checked ? '再次检查' : '检查更新';
    downloadButton.hidden = !offer || !['available', 'cancelled'].includes(phase);
    downloadButton.disabled = busy();
    installButton.hidden = phase !== 'ready'; installButton.disabled = busy();
    cancelButton.hidden = !['progress', 'cancelling'].includes(phase);
    cancelButton.disabled = phase === 'cancelling'; cancelButton.textContent = phase === 'cancelling' ? '正在取消…' : '取消下载';
    $('updates-transfer').hidden = !['progress', 'cancelling', 'ready'].includes(phase);
    entry.querySelector('i').hidden = !offer;
    $('updates-release').hidden = !offer;
    if (offer) {
      $('updates-release-title').textContent = `新版本 ${offer.version}`;
      $('updates-size').textContent = offer.size > 0 ? `下载大小约 ${mb(offer.size)} MB` : '';
      $('updates-notes').textContent = offer.notes || '此版本暂未提供更新说明。';
    }
    if (phase === 'ready') {
      $('updates-progress').value = 100;
      $('updates-progress-label').textContent = '下载完成 · 已通过校验';
    } else {
      if (total > 0) $('updates-progress').value = Math.min(100, received / total * 100);
      else $('updates-progress').removeAttribute('value');
      $('updates-progress-label').textContent = total > 0 ? `${Math.floor(Math.min(100, received / total * 100))}% · ${mb(received)} / ${mb(total)} MB` : '正在连接下载…';
    }
  }
  function setOffer(result) {
    if (!validVersion(result.version)) return false;
    offer = { version: result.version, notes: typeof result.notes === 'string' ? result.notes.slice(0, 12000) : offer?.version === result.version ? offer.notes : '', size: Number.isFinite(result.size) && result.size > 0 ? result.size : offer?.version === result.version ? offer.size : 0 };
    return true;
  }
  function notifyReady(downloaded = false) {
    if (!offer) return;
    reminder.querySelector('strong').textContent = downloaded ? `新版本 ${offer.version} 已下载` : `发现新版本 ${offer.version}`;
    reminder.hidden = dialog.open || dismissedVersion === offer.version;
  }
  function send(action) {
    if (hasAction(action)) return;
    if (action === 'check' && busy()) return;
    if (action === 'check' && Date.now() < retryAfter) { message(`请在 ${Math.ceil((retryAfter-Date.now())/1000)} 秒后重试，避免频繁请求。`,true); return; }
    if (action === 'download' && (!offer || !['available', 'cancelled'].includes(phase))) return;
    if (action === 'install' && phase !== 'ready') return;
    if (action === 'cancel' && phase !== 'progress') return;
    if (action !== 'state') epoch++;
    const requestId = `update_${Date.now()}_${++sequence}`;
    const request = { action, epoch };
    // Downloads use native I/O timeouts, never the short metadata request timer.
    if (['check', 'state', 'cancel'].includes(action)) request.timeout = setTimeout(() => {
      forget(requestId);
      if (action === 'state') return;
      phase = action === 'cancel' ? 'progress' : 'error';
      message('连接超时，请稍后再试。', true); render();
    }, action === 'state' ? 10000 : 55000);
    requests.set(requestId, request);
    if (action === 'check') { lastCheck = Date.now(); checked = true; phase = 'checking'; offer = null; reminder.hidden = true; message('正在检查新版本…'); }
    if (action === 'download') { phase = 'progress'; received = 0; total = offer.size; message('正在应用内下载更新，可随时取消。'); }
    if (action === 'install') { phase = 'installing'; message(platform === 'windows' ? '正在准备重启更新…' : '正在准备系统安装确认…'); }
    if (action === 'cancel') { phase = 'cancelling'; message('正在取消下载…'); }
    render();
    try { bridge[methods[action]](requestId); }
    catch { forget(requestId); if (action !== 'state') { phase = action === 'download' ? 'available' : 'error'; message('暂时无法完成操作，请稍后重试。', true); render(); } }
  }
  addEventListener('nextstep-update-result', event => {
    const result = event.detail, request = result && requests.get(result.requestId);
    if (!request || request.action !== result.action) return;
    if (request.action === 'state' && request.epoch !== epoch) { forget(result.requestId); return; }
    if (request.action === 'state' || !['progress', 'permission'].includes(result.status)) forget(result.requestId);
    const action = request.action;
    if (action === 'state' && ['checking', 'cancelling'].includes(phase)) return;
    if (action === 'download' && phase === 'cancelling' && result.status === 'progress') return;
    if (result.status === 'error') {
      if(action==='check') retryAfter=Date.now()+60000;
      clearAction('download'); clearAction('install');
      phase = (action === 'download' && offer) ? 'available' : 'error';
      message(typeof result.message === 'string' ? result.message.slice(0, 240) : '更新失败，请检查网络后重试。', true);
    } else if (['available', 'progress', 'ready', 'permission', 'installing'].includes(result.status)) {
      // Only a native-ready response enables installation; 100% alone never does.
      if (!setOffer(result) && !offer) { phase = 'error'; message('版本信息暂时不可用，请重新检查。', true); render(); return; }
      const previous = phase;
      phase = result.status;
      if (phase === 'progress') {
        total = Number.isFinite(result.total) && result.total > 0 ? result.total : offer.size;
        const count = Number.isFinite(result.received) && result.received >= 0 ? result.received : 0;
        received = previous === 'progress' ? Math.max(received, count) : count;
        message('正在应用内下载更新，可随时取消。');
      } else if (phase === 'ready') {
        clearAction('download'); clearAction('install');
        message(platform === 'windows' ? '更新已下载并校验完成，准备好后即可重启更新。' : '更新已下载并校验完成，可以直接安装。');
        if (previous !== 'ready') notifyReady(true);
      } else if (phase === 'permission') message('请在系统设置中允许本应用安装更新，返回后会继续安装。');
      else if (phase === 'installing') message(platform === 'windows' ? '正在重启并安装更新…' : '请在系统安装窗口确认；取消后可以在这里再次安装。');
      else { checked = true; message('有新版本可用，可以直接在应用内下载。'); if (previous !== 'available') notifyReady(); }
    } else if (result.status === 'current') {
      checked = true; phase = 'current'; offer = null; reminder.hidden = true;
      message('已经是最新版本，安心开始下一步吧。');
    } else if (result.status === 'cancelled') {
      clearAction('download'); clearAction('cancel'); phase = offer ? 'cancelled' : 'idle';
      message('已取消下载，可以随时重新下载。');
    } else if (result.status === 'idle') {
      phase = 'idle'; offer = null; message('准备好时，检查一下新版本。');
    } else { phase = 'error'; message('更新状态暂时不可用，请重新检查。', true); }
    render();
  });
  function open() {
    reminder.hidden = true;
    if (!dialog.open) dialog.showModal();
    if (!checked && phase === 'idle') send('check'); else send('state');
  }
  entry.addEventListener('click', open);
  $('updates-view').addEventListener('click', open);
  $('updates-dismiss').addEventListener('click', () => { dismissedVersion = offer?.version || ''; reminder.hidden = true; });
  $('updates-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  checkButton.addEventListener('click', () => send('check'));
  downloadButton.addEventListener('click', () => send('download'));
  installButton.addEventListener('click', () => send('install'));
  cancelButton.addEventListener('click', () => send('cancel'));
  $('updates-auto').addEventListener('change', () => {
    automatic = $('updates-auto').checked;
    try { localStorage.setItem(preferenceKey, JSON.stringify({ automatic })); }
    catch { message('当前存储不可用，此设置只在本次使用中生效。', true); }
    if (automatic && !checked && phase === 'idle') send('check');
  });
  addEventListener('nextstep-settings-restored', () => { try { automatic=JSON.parse(localStorage.getItem(preferenceKey))?.automatic!==false; } catch { automatic=true; } $('updates-auto').checked=automatic; });
  function autoCheck() {
    if (automatic && !document.hidden && !busy() && phase !== 'ready' && !hasAction('state') && Date.now() - lastCheck > 6 * 60 * 60 * 1000) send('check');
  }
  function resume() { if (!document.hidden) { send('state'); autoCheck(); } }
  render(); send('state');
  setTimeout(autoCheck, 1200);
  setInterval(autoCheck, 6 * 60 * 60 * 1000);
  setInterval(() => { if (['progress', 'permission', 'installing'].includes(phase) && !document.hidden) send('state'); }, 1500);
  document.addEventListener('visibilitychange', resume);
  addEventListener('nextstep-resume', resume);
})();
