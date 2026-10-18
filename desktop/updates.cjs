'use strict';
const https = require('node:https');

const REPOSITORY = 'zyy051206/next-small-step';
const LATEST_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MAX_METADATA_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15000;

class UpdateError extends Error {}

function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value)) return null;
  return value.split('.').map(Number);
}

function isNewer(version, currentVersion) {
  const candidate = versionParts(version);
  const current = versionParts(currentVersion);
  if (!candidate || !current) throw new UpdateError('版本信息无效，请稍后重试。');
  for (let index = 0; index < 3; index++) {
    if (candidate[index] !== current[index]) return candidate[index] > current[index];
  }
  return false;
}

function releaseInfo(release, currentVersion) {
  if (!release || release.draft !== false || release.prerelease !== false
      || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) {
    throw new UpdateError('暂时没有可用的正式版本，请稍后重试。');
  }
  const version = release.tag_name.slice(1);
  if (!versionParts(version)) throw new UpdateError('版本信息无效，请稍后重试。');
  if (!isNewer(version, currentVersion)) return { status: 'current', currentVersion, version };
  const name = `next-small-step-${version}-windows-x64.exe`;
  const url = `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
  const asset = Array.isArray(release.assets) ? release.assets.find(item => item?.name === name) : null;
  if (!asset || asset.state !== 'uploaded' || asset.browser_download_url !== url
      || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new UpdateError('新版 Windows 下载文件尚未准备好，请稍后重试。');
  }
  return { status: 'available', currentVersion, version, url, size: asset.size,
    notes: typeof release.body === 'string' ? release.body.slice(0, 6000) : '' };
}

// Only this fixed public endpoint is contacted. No credentials, user data or
// renderer-provided URLs are sent, and HTTP redirects are never followed.
function fetchLatestRelease({ get = https.get, timeoutMs = TIMEOUT_MS, maxBytes = MAX_METADATA_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const fail = message => {
      finish(new UpdateError(message));
      request?.destroy();
    };
    const timer = setTimeout(() => fail('检查更新超时，请检查网络后重试。'), timeoutMs);
    try {
      request = get(LATEST_URL, { headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'NextSmallStep-Windows-Update-Check',
        'X-GitHub-Api-Version': '2022-11-28'
      } }, response => {
        if (response.statusCode !== 200) {
          response.resume();
          fail(response.statusCode === 403 || response.statusCode === 429
            ? '更新服务暂时繁忙，请稍后重试。' : '暂时无法获取更新，请检查网络后重试。');
          return;
        }
        if (Number(response.headers['content-length']) > maxBytes) {
          response.resume();
          fail('更新信息异常，请稍后重试。');
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on('data', chunk => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > maxBytes) { fail('更新信息异常，请稍后重试。'); return; }
          chunks.push(chunk);
        });
        response.on('error', () => fail('检查更新失败，请检查网络后重试。'));
        response.on('aborted', () => fail('检查更新中断，请检查网络后重试。'));
        response.on('end', () => {
          if (settled) return;
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { fail('更新信息异常，请稍后重试。'); }
        });
      });
      request.on('error', () => fail('检查更新失败，请检查网络后重试。'));
    } catch { fail('检查更新失败，请检查网络后重试。'); }
  });
}

function createUpdateService({ currentVersion, loadRelease = fetchLatestRelease, openExternal }) {
  if (!versionParts(currentVersion)) throw new Error('Invalid application version');
  let available = null;
  let pending = null;
  let opening = false;
  const errorResult = (error, fallback) => ({ status: 'error', currentVersion,
    message: error instanceof UpdateError ? error.message : fallback });
  return {
    check() {
      if (pending) return pending;
      available = null;
      pending = Promise.resolve().then(loadRelease).then(release => {
        const result = releaseInfo(release, currentVersion);
        if (result.status === 'available') available = result;
        const { url, ...publicResult } = result;
        return publicResult;
      }).catch(error => errorResult(error, '检查更新失败，请检查网络后重试。'))
        .finally(() => { pending = null; });
      return pending;
    },
    async download() {
      if (!available) return errorResult(new UpdateError('请先检查更新，再下载新版。'));
      if (opening) return errorResult(new UpdateError('正在打开下载，请稍候。'));
      const selected = available;
      opening = true;
      try {
        await openExternal(selected.url);
        return { status: 'opened', currentVersion, version: selected.version,
          message: '已在系统浏览器打开下载。下载完成后退出当前应用，打开新版 EXE；进度会保留。' };
      } catch { return errorResult(null, '无法打开系统浏览器，请稍后重试。'); }
      finally { opening = false; }
    }
  };
}

module.exports = { createUpdateService, fetchLatestRelease, releaseInfo, isNewer, versionParts, LATEST_URL };
