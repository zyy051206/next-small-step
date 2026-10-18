'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createUpdateService, updateInfo, isNewer } = require('./updates.cjs');
const data = Buffer.from('Verified test installer');
const sha512 = crypto.createHash('sha512').update(data).digest('base64');
function release(version = '2.1.0') {
  return { version, releaseNotes: '更新说明', files: [{ url: `next-small-step-${version}-windows-x64.exe`, size: data.length, sha512 }] };
}
function fixture(options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'next-step-update-unit-'));
  const file = path.join(folder, 'installer.exe');
  fs.writeFileSync(file, data);
  const updater = new EventEmitter();
  const notifications = [], installs = [];
  updater.checkForUpdates = async () => ({ updateInfo: release(), isUpdateAvailable: true });
  updater.downloadUpdate = async () => [file];
  updater.quitAndInstall = (...args) => installs.push(args);
  const service = createUpdateService({ currentVersion: '2.0.3', updater,
    notify: event => notifications.push(event), installDelayMs: 1, ...options });
  return { service, updater, notifications, installs, file };
}
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('numeric versions compare without downgrades or prereleases', () => {
  assert.equal(isNewer('2.0.10', '2.0.9'), true);
  assert.equal(isNewer('2.10.0', '2.9.9'), true);
  assert.equal(isNewer('2.0.3', '2.0.3'), false);
  assert.equal(isNewer('2.0.2', '2.0.3'), false);
  for (const invalid of ['2.1', '02.1.0', '2.1.0-beta', 'v2.1.0', '2.1.0\n']) assert.throws(() => isNewer(invalid, '2.0.3'));
});
test('only exact official NSIS filenames with valid SHA512 and size are accepted', () => {
  assert.equal(updateInfo(release(), '2.0.3').status, 'available');
  for (const patch of [{ url: 'https://evil.example/installer.exe' }, { url: 'file:///C:/bad.exe' },
    { url: 'next-small-step-2.0.0-windows-x64.exe' }, { sha512: 'bad' }, { size: 0 }, { size: 2 ** 32 }]) {
    const candidate = release(); Object.assign(candidate.files[0], patch);
    assert.throws(() => updateInfo(candidate, '2.0.3'));
  }
  assert.throws(() => updateInfo({ ...release(), packages: {} }, '2.0.3'));
  assert.throws(() => updateInfo({ ...release(), files: [] }, '2.0.3'));
});
test('already-current releases need no download and notes stay bounded', () => {
  assert.equal(updateInfo({ version: '2.0.2' }, '2.0.3').status, 'current');
  assert.equal(updateInfo({ ...release(), releaseNotes: 'x'.repeat(10000) }, '2.0.3').notes.length, 6000);
});
test('updates require explicit download and install; quit never auto-installs', () => {
  const { updater } = fixture();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.disableWebInstaller, true);
});
test('download and installation reject requests before a validated check', async () => {
  const { service, installs } = fixture();
  assert.equal((await service.download('download')).status, 'error');
  assert.equal((await service.install('install')).status, 'error');
  assert.equal(installs.length, 0);
});
test('check is deduplicated and raw errors are not exposed', async () => {
  const { service, updater } = fixture();
  let resolve, calls = 0;
  updater.checkForUpdates = () => { calls++; return new Promise(done => { resolve = done; }); };
  const first = service.check(), second = service.check();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ updateInfo: release(), isUpdateAvailable: true });
  assert.equal((await first).status, 'available'); await second;
  updater.checkForUpdates = async () => { throw new Error('secret-host/path'); };
  const result = await service.check();
  assert.equal(result.status, 'error');
  assert.ok(!result.message.includes('secret-host'));
});
test('bounded checking closes updater connections on a stalled request', async () => {
  const { service, updater } = fixture({ checkTimeoutMs: 10 });
  let closed = false;
  updater.netSession = { closeAllConnections: async () => { closed = true; } };
  updater.checkForUpdates = () => new Promise(() => {});
  assert.equal((await service.check()).status, 'error');
  assert.equal(closed, true);
});
test('download progress has its originating ID and ready state survives panel reopen', async () => {
  const { service, updater, notifications } = fixture();
  await service.check();
  let complete;
  const original = updater.downloadUpdate;
  updater.downloadUpdate = () => new Promise(resolve => { complete = async () => resolve(await original()); });
  const operation = service.download('dl1');
  await Promise.resolve();
  updater.emit('download-progress', { transferred: 10, total: data.length });
  assert.equal(service.state().status, 'progress');
  assert.equal(service.state().received, 10);
  assert.equal(notifications.at(-1).requestId, 'dl1');
  assert.equal(notifications.at(-1).action, 'download');
  await complete();
  assert.equal((await operation).status, 'ready');
  assert.equal(service.state().percent, 100);
  assert.equal((await service.check()).status, 'ready');
});
test('cancellation is reflected immediately and another download can retry', async () => {
  const { service, updater, file } = fixture();
  await service.check();
  updater.downloadUpdate = token => token.createPromise(() => {});
  const pending = service.download('cancel');
  await Promise.resolve();
  assert.equal(service.cancel().status, 'cancelled');
  assert.equal((await pending).status, 'cancelled');
  updater.downloadUpdate = async () => [file];
  assert.equal((await service.download('retry')).status, 'ready');
});
test('stalled downloads cancel within the native time limit', async () => {
  const { service, updater } = fixture({ downloadTimeoutMs: 10 });
  await service.check();
  updater.downloadUpdate = token => token.createPromise(() => {});
  const result = await service.download('timeout');
  assert.equal(result.status, 'error');
  assert.ok(result.message.includes('超时'));
});
test('bad downloaded bytes are never ready or installable', async () => {
  const { service, file, installs } = fixture();
  await service.check();
  fs.writeFileSync(file, Buffer.alloc(data.length));
  assert.equal((await service.download('bad')).status, 'error');
  assert.equal((await service.install('install')).status, 'error');
  assert.equal(installs.length, 0);
});
test('tampering after download is detected before installing', async () => {
  const { service, file, installs } = fixture();
  await service.check(); await service.download('good');
  fs.writeFileSync(file, Buffer.alloc(data.length));
  assert.equal((await service.install('tampered')).status, 'error');
  assert.equal(installs.length, 0);
});
test('explicit install flushes data and invokes NSIS restart once after UI acknowledgement', async () => {
  let flushed = false;
  const { service, installs } = fixture({ beforeInstall: async () => { flushed = true; } });
  await service.check(); await service.download('good');
  const first = service.install('install');
  const duplicate = service.install('install-again');
  assert.equal((await first).status, 'installing');
  assert.equal((await duplicate).status, 'installing');
  assert.equal(flushed, true);
  await sleep(15);
  assert.deepEqual(installs, [[true, true]]);
});
test('failed installer startup restores ready state with safe retry feedback', async () => {
  const { service, updater } = fixture();
  await service.check(); await service.download('good');
  updater.quitAndInstall = () => { throw new Error('private-executable-path'); };
  await service.install('install');
  await sleep(15);
  assert.equal(service.state().status, 'ready');
  assert.ok(!service.state().message.includes('private-executable-path'));
});
