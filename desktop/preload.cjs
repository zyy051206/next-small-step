'use strict';
const { contextBridge } = require('electron');

// Only advertise the shell; the renderer receives no Node or filesystem API.
contextBridge.exposeInMainWorld('NextStepDesktop', Object.freeze({ platform: 'windows' }));
