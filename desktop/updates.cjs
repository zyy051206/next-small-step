'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { CancellationToken } = require('builder-util-runtime');

const REPOSITORY = 'zyy051206/next-small-step';
const CHECK_TIMEOUT_MS = 25000;
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value)) return null;
  return value.split('.').map(Number);
}
function isNewer(version, currentVersion) {
  const next = versionParts(version), current = versionParts(currentVersion);
  if (!next || !current) throw new Error('Invalid version');
  for (let index = 0; index < 3; index++) if (next[index] !== current[index]) return next[index] > current[index];
  return false;
}
function updateInfo(info, currentVersion) {
  if (!info || !versionParts(info.version)) throw new Error('Invalid stable release');
  if (!isNewer(info.version, currentVersion)) return { status: 'current', currentVersion, version: info.version };
  const filename = `next-small-step-${info.version}-windows-x64.exe`;
  const canonical = `https://github.com/${REPOSITORY}/releases/download/v${info.version}/${filename}`;
  // NSIS web installers and arbitrary metadata URLs are not accepted.
  if (info.packages || !Array.isArray(info.files) || info.files.length !== 1) throw new Error('Invalid installer metadata');
  const file = info.files[0];
  if (![filename, canonical].includes(file.url) || !Number.isSafeInteger(file.size) || file.size <= 0
      || file.size > 1024 * 1024 * 1024 || typeof file.sha512 !== 'string'
      || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) throw new Error('Invalid installer metadata');
  return { status: 'available', currentVersion, version: info.version, size: file.size,
    notes: typeof info.releaseNotes === 'string' ? info.releaseNotes.slice(0, 6000) : '', sha512: file.sha512 };
}
async function verifyFile(file, expected) {
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size !== expected.size) throw new Error('Installer file changed');
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  if (hash.digest('base64') !== expected.sha512) throw new Error('Installer checksum mismatch');
}

function createUpdateService({ currentVersion, updater, notify = () => {}, beforeInstall = async () => {},
    checkTimeoutMs = CHECK_TIMEOUT_MS, downloadTimeoutMs = DOWNLOAD_TIMEOUT_MS, installDelayMs = 250 }) {
  if (!versionParts(currentVersion)) throw new Error('Invalid application version');
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  updater.disableWebInstaller = true;
  updater.logger = null;
  let state = { status: 'idle', currentVersion };
  let expected = null, installer = null, checking = null, downloading = null, token = null;
  let downloadId = null, installId = null, timedOut = false;
  const snapshot = () => ({ ...state });
  const set = (status, extra = {}) => {
    const base = expected ? { version: expected.version, notes: expected.notes, size: expected.size } : {};
    state = { currentVersion, ...base, status, ...extra };
    return snapshot();
  };
  const emit = (requestId, action) => { if (requestId) notify({ requestId, action, ...snapshot() }); };
  const failure = message => set('error', { message });
  const locked = () => ['progress', 'ready', 'installing'].includes(state.status);
  updater.on('download-progress', progress => {
    if (!downloading || !token || token.cancelled || state.status !== 'progress') return;
    const total = Math.max(0, Number(progress.total) || expected.size);
    const received = Math.min(total, Math.max(0, Number(progress.transferred) || 0));
    set('progress', { total, received, percent: total ? Math.min(100, received * 100 / total) : 0 });
    emit(downloadId, 'download');
  });
  // Check/download failures are handled by their promises. Installation errors
  // can arrive asynchronously after quitAndInstall, so keep their status visible.
  updater.on('error', () => {
    if (state.status === 'installing') {
      set('ready', { message: '安装未能启动，请重试。' });
      emit(installId, 'install');
    }
  });
  return {
    state: snapshot,
    check() {
      if (locked() || downloading) return Promise.resolve(snapshot());
      if (checking) return checking;
      expected = null;
      installer = null;
      let timeout;
      checking = Promise.race([
        Promise.resolve().then(() => updater.checkForUpdates()).catch(async error => {
          if (typeof updater.setFeedURL !== 'function') throw error;
          updater.setFeedURL({ provider:'generic', url:'https://github.com/zyy051206/next-small-step/releases/latest/download/', useMultipleRangeRequest:false });
          return updater.checkForUpdates();
        }),
        new Promise((_, reject) => { timeout = setTimeout(() => {
          updater.netSession?.closeAllConnections().catch(() => {});
          reject(new Error('timeout'));
        }, checkTimeoutMs); })
      ]).then(result => {
        if (!result) return failure('请使用已安装的正式版检查更新。');
        const info = updateInfo(result.updateInfo, currentVersion);
        if (info.status === 'available' && result.isUpdateAvailable !== false) {
          expected = info;
          return set('available');
        }
        return set('current', { version: info.version });
      }).catch(error => failure(/403|429|rate.?limit/i.test(String(error?.message)) ? '更新服务请求过多，请一分钟后重试或切换网络。' : /timeout|timed.?out/i.test(String(error?.message)) ? '连接更新服务超时，请稍后重试或切换网络。' : '更新服务暂时不可用，请稍后重试或检查网络设置。'))
        .finally(() => { clearTimeout(timeout); checking = null; });
      return checking;
    },
    download(requestId) {
      if (state.status === 'ready' || state.status === 'installing') return Promise.resolve(snapshot());
      if (downloading) return Promise.resolve(snapshot());
      if (!expected || checking) return Promise.resolve(failure('请先检查更新，再下载新版。'));
      downloadId = requestId;
      timedOut = false;
      installer = null;
      token = new CancellationToken();
      set('progress', { received: 0, total: expected.size, percent: 0 });
      emit(downloadId, 'download');
      const downloadToken = token;
      const timeout = setTimeout(() => { timedOut = true; downloadToken.cancel(); }, downloadTimeoutMs);
      downloading = Promise.resolve().then(() => updater.downloadUpdate(downloadToken)).then(async files => {
        if (downloadToken.cancelled) throw new Error('cancelled');
        if (!Array.isArray(files) || files.length !== 1 || typeof files[0] !== 'string') throw new Error('Missing installer');
        // electron-updater verifies SHA512 during download/cache reuse. Recheck
        // before marking ready, and once more before the explicit installation.
        await verifyFile(files[0], expected);
        if (downloadToken.cancelled) throw new Error('cancelled');
        installer = files[0];
        return set('ready', { received: expected.size, total: expected.size, percent: 100 });
      }).catch(() => {
        installer = null;
        if (downloadToken.cancelled && !timedOut) return set('cancelled', { message: '已取消下载，可随时重新下载。' });
        return failure(timedOut ? '下载超时，请检查网络后重试。' : '下载或文件校验失败，请重试。');
      }).finally(() => { clearTimeout(timeout); downloading = null; token = null; downloadId = null; });
      return downloading;
    },
    cancel() {
      if (token && downloading) {
        token.cancel();
        return set('cancelled', { message: '已取消下载，可随时重新下载。' });
      }
      return snapshot();
    },
    async install(requestId) {
      if (state.status === 'installing') return snapshot();
      if (state.status !== 'ready' || !installer || !expected) return failure('请先完成新版下载，再安装更新。');
      installId = requestId;
      set('installing', { message: '正在校验安装文件并保存进度。' });
      try {
        await verifyFile(installer, expected);
        await beforeInstall();
      } catch {
        installer = null;
        return failure('安装文件校验失败，请重新下载。');
      }
      const result = set('installing', { message: '正在退出应用并安装新版，完成后会重新打开。' });
      // Deliver the UI result before the updater exits this process.
      setTimeout(() => {
        try { updater.quitAndInstall(true, true); }
        catch { set('ready', { message: '安装未能启动，请重试。' }); emit(installId, 'install'); }
      }, installDelayMs);
      return result;
    }
  };
}

module.exports = { createUpdateService, updateInfo, versionParts, isNewer, verifyFile };
