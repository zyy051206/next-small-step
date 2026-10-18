'use strict';
// Rasterize the project's own SVG with Chromium, then wrap the PNG as an ICO.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'next-small-step-icon-')));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const svg = fs.readFileSync(path.join(__dirname, '../dist/icon.svg')).toString('base64');
  await window.loadURL('data:text/html,<meta charset="utf-8"><canvas width="256" height="256"></canvas>');
  const data = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const canvas=document.querySelector('canvas');canvas.getContext('2d').drawImage(image,0,0,256,256);resolve(canvas.toDataURL('image/png').split(',')[1]);};image.onerror=()=>reject(Error('SVG icon could not be rendered'));image.src='data:image/svg+xml;base64,${svg}';})`);
  const png = Buffer.from(data, 'base64');
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([header, png]));
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });
