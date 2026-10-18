(() => {
  'use strict';
  const bridge = window.NextStepUpdates;
  if (!bridge || ['getVersion', 'getPlatform', 'checkUpdates', 'downloadUpdate'].some(key => typeof bridge[key] !== 'function')) return;
  let currentVersion, platform;
  try { currentVersion = bridge.getVersion(); platform = bridge.getPlatform(); } catch { return; }
  if (!/^\d+\.\d+\.\d+$/.test(currentVersion) || !['windows', 'android'].includes(platform)) return;

  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17"/></svg>';
  const entry = document.createElement('button');
  entry.id = 'updates-open'; entry.type = 'button'; entry.className = 'text-button';
  entry.setAttribute('aria-haspopup', 'dialog'); entry.setAttribute('aria-label', '检查更新'); entry.title = '检查更新';
  entry.innerHTML = icon + '<span>检查更新</span><i hidden></i>';
  document.querySelector('.sidebar-bottom').insertBefore(entry, document.querySelector('#guide-open'));

  const dialog = document.createElement('dialog');
  dialog.id = 'updates-dialog'; dialog.setAttribute('aria-labelledby', 'updates-title');
  dialog.innerHTML = '<div class="dialog-heading"><span class="eyebrow">KEEP MOVING FORWARD</span><button id="updates-close" class="close-button" type="button" aria-label="关闭更新窗口">×</button></div><h2 id="updates-title">让下一步，保持新鲜。</h2><p class="updates-version"></p><p id="updates-status" role="status" aria-live="polite"></p><section id="updates-release" hidden><h3 id="updates-release-title"></h3><p id="updates-size"></p><pre id="updates-notes"></pre></section><div class="updates-actions"><button id="updates-check" class="button secondary" type="button">检查更新</button><button id="updates-download" class="button primary" type="button" hidden>下载新版</button></div><p id="updates-install-help" class="updates-help"></p><label class="updates-auto"><input id="updates-auto" type="checkbox"> 自动检查并提醒新版本</label><p class="updates-help">仅查询公开版本信息，不上传目标、专注记录或背景图片。离线时可以继续使用。</p>';
  document.body.append(dialog);
  const reminder = document.createElement('aside');
  reminder.id = 'updates-reminder'; reminder.hidden = true; reminder.setAttribute('aria-label', '新版本提醒');
  reminder.innerHTML = '<div role="status"><strong></strong><p>准备好时，再更新也不迟。</p></div><div><button id="updates-view" class="text-button" type="button">查看更新 ↗</button><button id="updates-dismiss" class="text-button" type="button">稍后</button></div>';
  document.body.append(reminder);

  const $ = id => document.getElementById(id);
  const status = $('updates-status'), checkButton = $('updates-check'), downloadButton = $('updates-download');
  dialog.querySelector('.updates-version').textContent = `${platform === 'windows' ? 'Windows 电脑版' : 'Android 安卓版'} · 当前版本 ${currentVersion}`;
  $('updates-install-help').textContent = platform === 'windows'
    ? '点击下载后，由系统浏览器保存 EXE。关闭当前应用，再打开新版 EXE 即可；本机记录和外观会继续保留。'
    : '点击下载后，由系统浏览器保存 APK。打开下载的文件，按系统提示覆盖安装；本机记录和外观会继续保留。无需卸载旧版。';
  const preferenceKey = 'next-small-step.updates.v1';
  let automatic = true;
  try { automatic = JSON.parse(localStorage.getItem(preferenceKey))?.automatic !== false; } catch { /* Storage is optional. */ }
  $('updates-auto').checked = automatic;
  let request = null, sequence = 0, lastCheck = 0, available = false, checked = false;
  let dismissedVersion = '', offeredVersion = '';

  function message(text, error = false) {
    status.textContent = text;
    status.dataset.tone = error ? 'error' : 'normal';
  }
  function finish() {
    if (request) clearTimeout(request.timeout);
    request = null;
    checkButton.disabled = false;
    checkButton.textContent = '再次检查';
    downloadButton.disabled = !available;
  }
  function send(action, manual = false) {
    if (request) return;
    const requestId = `update_${Date.now()}_${++sequence}`;
    request = { requestId, action, manual, timeout: setTimeout(() => {
      finish(); message('连接超时，请稍后再试。', true);
    }, 35000) };
    checkButton.disabled = true; downloadButton.disabled = true;
    if (action === 'check') {
      lastCheck = Date.now(); checked = true;
      available = false; downloadButton.hidden = true;
      $('updates-release').hidden = true;
      message('正在检查新版本…'); checkButton.textContent = '检查中…';
    } else message('正在打开新版下载…');
    try { bridge[action === 'check' ? 'checkUpdates' : 'downloadUpdate'](requestId); }
    catch { finish(); message('暂时无法连接更新服务，请稍后再试。', true); }
  }
  function open() {
    reminder.hidden = true;
    if (!dialog.open) dialog.showModal();
    if (!checked) send('check', true);
  }
  addEventListener('nextstep-update-result', event => {
    const result = event.detail;
    if (!request || !result || result.requestId !== request.requestId || result.action !== request.action) return;
    const action = request.action;
    finish();
    if (result.status === 'error') {
      message(typeof result.message === 'string' ? result.message.slice(0, 240) : '暂时无法检查更新，请检查网络后重试。', true);
      return;
    }
    if (action === 'download') {
      message(result.status === 'opened' ? '已打开系统浏览器，请在浏览器中查看下载进度。' : '未能打开下载，请重试。', result.status !== 'opened');
      return;
    }
    if (result.status === 'current') {
      entry.querySelector('i').hidden = true; reminder.hidden = true;
      message('已经是最新版本，安心开始下一步吧。');
    } else if (result.status === 'available' && /^\d+\.\d+\.\d+$/.test(result.version)) {
      available = true; offeredVersion = result.version;
      entry.querySelector('i').hidden = false;
      $('updates-release').hidden = false;
      $('updates-release-title').textContent = `新版本 ${offeredVersion}`;
      $('updates-size').textContent = Number.isFinite(result.size) && result.size > 0 ? `下载大小约 ${(result.size / 1024 / 1024).toFixed(1)} MB` : '';
      // Release notes are untrusted text, never HTML or executable Markdown.
      $('updates-notes').textContent = typeof result.notes === 'string' && result.notes.trim() ? result.notes.slice(0, 12000) : '此版本暂未提供更新说明。';
      downloadButton.hidden = false; downloadButton.disabled = false;
      downloadButton.textContent = `下载 ${platform === 'windows' ? 'EXE' : 'APK'}`;
      message('有新版本可用。你可以先查看说明，再下载更新。');
      reminder.querySelector('strong').textContent = `发现新版本 ${offeredVersion}`;
      reminder.hidden = dialog.open || dismissedVersion === offeredVersion;
    } else message('版本信息暂时不可用，请稍后再试。', true);
  });
  entry.addEventListener('click', open);
  $('updates-view').addEventListener('click', open);
  $('updates-dismiss').addEventListener('click', () => { dismissedVersion = offeredVersion; reminder.hidden = true; });
  $('updates-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  checkButton.addEventListener('click', () => send('check', true));
  downloadButton.addEventListener('click', () => { if (available) send('download', true); });
  $('updates-auto').addEventListener('change', () => {
    automatic = $('updates-auto').checked;
    try { localStorage.setItem(preferenceKey, JSON.stringify({ automatic })); }
    catch { message('当前存储不可用，此设置只在本次使用中生效。', true); }
    if (automatic && !checked) send('check');
  });
  function autoCheck() {
    if (automatic && !document.hidden && !request && Date.now() - lastCheck > 6 * 60 * 60 * 1000) send('check');
  }
  setTimeout(autoCheck, 1200);
  setInterval(autoCheck, 6 * 60 * 60 * 1000);
  document.addEventListener('visibilitychange', autoCheck);
  addEventListener('nextstep-resume', autoCheck);
})();
