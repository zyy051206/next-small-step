'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Only advertise the shell; the renderer receives no Node or filesystem API.
contextBridge.exposeInMainWorld('NextStepDesktop', Object.freeze({ platform: 'windows' }));

// Every privileged action has a dedicated channel. The renderer cannot choose
// a URL, executable or file path, and never receives the Electron IPC object.
const version = process.argv.find(value => value.startsWith('--nextstep-version='))?.slice(19) || '';
ipcRenderer.on('nextstep-update-progress', (_event, detail) => {
  window.dispatchEvent(new CustomEvent('nextstep-update-result', { detail }));
});
function requestUpdate(action, requestId) {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(requestId)) return;
  ipcRenderer.invoke(`nextstep-update-${action}`, requestId).then(detail => {
    window.dispatchEvent(new CustomEvent('nextstep-update-result', { detail }));
  }).catch(() => {
    window.dispatchEvent(new CustomEvent('nextstep-update-result', { detail: {
      requestId, action, status: 'error', currentVersion: version,
      message: '更新服务暂时不可用，请重新打开应用后重试。'
    } }));
  });
}
contextBridge.exposeInMainWorld('NextStepUpdates', Object.freeze({
  getVersion: () => version,
  getPlatform: () => 'windows',
  checkUpdates: requestId => requestUpdate('check', requestId),
  downloadUpdate: requestId => requestUpdate('download', requestId),
  installUpdate: requestId => requestUpdate('install', requestId),
  cancelUpdate: requestId => requestUpdate('cancel', requestId),
  getUpdateState: requestId => requestUpdate('state', requestId)
}));
