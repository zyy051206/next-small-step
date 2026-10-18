'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateService, fetchLatestRelease, releaseInfo, isNewer, LATEST_URL } = require('./updates.cjs');

function release(version = '2.1.0') {
  const name = `next-small-step-${version}-windows-x64.exe`;
  return { tag_name: `v${version}`, draft: false, prerelease: false, body: '更新说明',
    assets: [{ name, state: 'uploaded', size: 123456,
      browser_download_url: `https://github.com/zyy051206/next-small-step/releases/download/v${version}/${name}` }] };
}

function fakeRequest({ status = 200, body = JSON.stringify(release()), headers = {}, error, stall = false } = {}) {
  const state = { calls: 0, destroyed: false };
  state.get = (url, options, onResponse) => {
    state.calls++;
    state.url = url;
    state.headers = options.headers;
    const request = new EventEmitter();
    request.destroy = () => { state.destroyed = true; };
    queueMicrotask(() => {
      if (error) { request.emit('error', error); return; }
      if (stall) return;
      const response = new EventEmitter();
      response.statusCode = status;
      response.headers = headers;
      response.resume = () => {};
      onResponse(response);
      response.emit('data', Buffer.from(body));
      response.emit('end');
    });
    return request;
  };
  return state;
}

test('numeric semantic versions handle patch, minor, major and no downgrade', () => {
  assert.equal(isNewer('2.0.10', '2.0.9'), true);
  assert.equal(isNewer('2.10.0', '2.9.9'), true);
  assert.equal(isNewer('3.0.0', '2.99.99'), true);
  assert.equal(isNewer('2.0.2', '2.0.2'), false);
  assert.equal(isNewer('2.0.1', '2.0.2'), false);
});

test('rejects prerelease, malformed, padded and unsafe version numbers', () => {
  for (const value of ['2.1', 'v2.1.0', '2.1.0-beta', '2.1.0+build', '02.1.0', '2.1.0\n', '9999999999.0.0']) {
    assert.throws(() => isNewer(value, '2.0.2'));
  }
});

test('new release requires the exact available Windows asset', () => {
  const candidate = release();
  const result = releaseInfo(candidate, '2.0.2');
  assert.equal(result.status, 'available');
  assert.equal(result.url, candidate.assets[0].browser_download_url);
  assert.equal(result.size, 123456);
  candidate.assets[0].name = 'next-small-step-2.1.0.apk';
  assert.throws(() => releaseInfo(candidate, '2.0.2'));
});

test('download URL cannot redirect the bridge to other origins, paths or protocols', () => {
  const canonical = release().assets[0].browser_download_url;
  const invalidUrls = [
    canonical.replace('github.com', 'github.com.evil.example'),
    canonical.replace('zyy051206', 'different-owner'),
    canonical.replace('v2.1.0', 'v2.0.1'),
    canonical.replace('https:', 'http:'), canonical + '?redirect=elsewhere',
    'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)',
    canonical.replace('github.com', 'evil@github.com')
  ];
  for (const url of invalidUrls) {
    const candidate = release();
    candidate.assets[0].browser_download_url = url;
    assert.throws(() => releaseInfo(candidate, '2.0.2'));
  }
});

test('drafts, prereleases, missing status and incomplete files are not offered', () => {
  for (const patch of [{ draft: true }, { prerelease: true }, { draft: undefined }, { assets: [] }, { tag_name: '2.1.0' }]) {
    assert.throws(() => releaseInfo({ ...release(), ...patch }, '2.0.2'));
  }
  for (const patch of [{ state: 'new' }, { size: 0 }, { size: -1 }, { size: '123' }]) {
    const candidate = release();
    Object.assign(candidate.assets[0], patch);
    assert.throws(() => releaseInfo(candidate, '2.0.2'));
  }
});

test('current or older release does not offer a downgrade or require an asset', () => {
  assert.equal(releaseInfo({ ...release('2.0.2'), assets: [] }, '2.0.2').status, 'current');
  assert.equal(releaseInfo({ ...release('2.0.1'), assets: [] }, '2.0.2').status, 'current');
});

test('release notes are bounded and left as plain text for the frontend', () => {
  const candidate = release();
  candidate.body = '<script>alert(1)</script>' + 'x'.repeat(10000);
  const result = releaseInfo(candidate, '2.0.2');
  assert.equal(result.notes.length, 6000);
  assert.ok(result.notes.startsWith('<script>'));
});

test('service only downloads a previously validated cached update', async () => {
  const opened = [];
  const updater = createUpdateService({ currentVersion: '2.0.2', loadRelease: async () => release(), openExternal: async url => opened.push(url) });
  assert.equal((await updater.download()).status, 'error');
  assert.equal(opened.length, 0);
  const result = await updater.check();
  assert.equal(result.status, 'available');
  assert.equal('url' in result, false);
  assert.equal((await updater.download('https://evil.example')).status, 'opened');
  assert.deepEqual(opened, [release().assets[0].browser_download_url]);
});

test('a failed recheck clears a previously offered update and hides raw errors', async () => {
  let fail = false;
  const updater = createUpdateService({ currentVersion: '2.0.2', loadRelease: async () => {
    if (fail) throw new Error('sensitive-network-details');
    return release();
  }, openExternal: async () => { throw new Error('must not open'); } });
  await updater.check();
  fail = true;
  const result = await updater.check();
  assert.equal(result.status, 'error');
  assert.ok(!result.message.includes('sensitive'));
  assert.equal((await updater.download()).status, 'error');
});

test('simultaneous checks share a single request and downloads prevent duplicate browser launches', async () => {
  let completeCheck, completeOpen, calls = 0, opens = 0;
  const updater = createUpdateService({ currentVersion: '2.0.2',
    loadRelease: () => { calls++; return new Promise(resolve => { completeCheck = resolve; }); },
    openExternal: () => { opens++; return new Promise(resolve => { completeOpen = resolve; }); } });
  const first = updater.check();
  const second = updater.check();
  await Promise.resolve();
  assert.equal(calls, 1);
  completeCheck(release());
  await Promise.all([first, second]);
  const opening = updater.download();
  assert.equal((await updater.download()).status, 'error');
  completeOpen();
  assert.equal((await opening).status, 'opened');
  assert.equal(opens, 1);
});

test('failure to open a system browser is reported safely and can be retried', async () => {
  let fail = true;
  const updater = createUpdateService({ currentVersion: '2.0.2', loadRelease: async () => release(), openExternal: async () => {
    if (fail) throw new Error('private-path');
  } });
  await updater.check();
  const result = await updater.download();
  assert.equal(result.status, 'error');
  assert.ok(!result.message.includes('private-path'));
  fail = false;
  assert.equal((await updater.download()).status, 'opened');
});

test('HTTPS metadata fetch contacts only the fixed public endpoint without credentials', async () => {
  const request = fakeRequest();
  assert.deepEqual(await fetchLatestRelease({ get: request.get }), release());
  assert.equal(request.url, LATEST_URL);
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('HTTP redirects and server errors are rejected without following locations', async () => {
  for (const status of [301, 302, 403, 404, 429, 500]) {
    const request = fakeRequest({ status, headers: { location: 'https://evil.example' } });
    await assert.rejects(fetchLatestRelease({ get: request.get }));
    assert.equal(request.calls, 1);
    assert.equal(request.destroyed, true);
  }
});

test('oversized, malformed, stalled and offline responses fail within bounds', async () => {
  for (const options of [
    { body: 'not-json' }, { body: 'x'.repeat(65) },
    { headers: { 'content-length': '1000000' } }, { error: new Error('private-host-name') }
  ]) {
    const request = fakeRequest(options);
    await assert.rejects(fetchLatestRelease({ get: request.get, maxBytes: 64 }), error => !error.message.includes('private-host-name'));
    assert.equal(request.destroyed, true);
  }
  const stalled = fakeRequest({ stall: true });
  await assert.rejects(fetchLatestRelease({ get: stalled.get, timeoutMs: 15 }), /超时/);
  assert.equal(stalled.destroyed, true);
});
