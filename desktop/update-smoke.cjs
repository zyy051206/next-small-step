'use strict';
// Loaded only for an explicit --smoke-test in an isolated profile. The actual
// updater downloads and verifies a local fixture; installer execution is trapped.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { NsisUpdater } = require('electron-updater');

async function createSmokeUpdater(app, root) {
  const filename = 'next-small-step-999.0.0-windows-x64.exe';
  const content = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(128 * 1024)]);
  const sha512 = crypto.createHash('sha512').update(content).digest('base64');
  const info = { version: '999.0.0', files: [{ url: filename, sha512, size: content.length }],
    path: filename, sha512, releaseDate: '2026-01-01T00:00:00.000Z', releaseNotes: 'Windows native updater verification' };
  let downloads = 0, installCommand = null, quitCalls = 0, corruptNext = false;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/latest.yml') {
      response.setHeader('Content-Type', 'application/yaml');
      response.end(JSON.stringify(info));
    } else if (pathname === '/' + filename) {
      downloads++;
      response.setHeader('Content-Length', content.length);
      if (corruptNext) {
        corruptNext = false;
        response.end(Buffer.alloc(content.length));
      } else response.end(content);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const feed = `http://127.0.0.1:${server.address().port}/`;
  const config = path.join(root, 'smoke-app-update.yml');
  fs.writeFileSync(config, JSON.stringify({ provider: 'generic', url: feed, updaterCacheDirName: 'updater-cache' }));
  const updater = new NsisUpdater({ provider: 'generic', url: feed });
  updater.app = {
    version: app.getVersion(), name: 'NextSmallStepSmoke', isPackaged: true,
    userDataPath: path.join(root, 'profile'), baseCachePath: path.join(root, 'cache'), appUpdateConfigPath: config,
    whenReady: () => app.whenReady(), quit: () => { quitCalls++; }, relaunch: () => {}, onQuit: () => {}
  };
  updater.disableDifferentialDownload = true;
  updater.spawnLog = async (file, args) => { installCommand = { file, args }; return true; };
  return {
    updater,
    corruptNextDownload() { corruptNext = true; },
    verifyInstall() {
      if (!installCommand || quitCalls !== 1 || !downloads
          || !installCommand.args.includes('/S') || !installCommand.args.includes('--force-run')
          || !installCommand.args.includes('--updated')) throw new Error('Native install/restart flow was not reached');
      const relative = path.relative(path.join(root, 'cache'), installCommand.file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Installer escaped its isolated update cache');
      if (crypto.createHash('sha512').update(fs.readFileSync(installCommand.file)).digest('base64') !== sha512) {
        throw new Error('Install command did not use the verified download');
      }
    },
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })
  };
}
module.exports = { createSmokeUpdater };
