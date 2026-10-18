'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const dev = process.argv.includes('--dev');
const exe = dev ? require('electron') : path.resolve(process.argv[2] || path.join(__dirname, `release/next-small-step-${require('./package.json').version}-windows-x64.exe`));
const token = crypto.randomUUID();
const profile = path.join(os.tmpdir(), `next-small-step-smoke-${token}`);
const output = path.join(__dirname, '.qa');
fs.mkdirSync(output, { recursive: true });

async function launch(phase) {
  const args = [...(dev ? [__dirname] : []), '--smoke-test', `--smoke-token=${token}`, `--smoke-phase=${phase}`];
  await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-4000); });
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${phase} timed out after 150 seconds`)); }, 150000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}: ${errors}`)); });
  });
  const report = JSON.parse(fs.readFileSync(path.join(profile, `${phase}.json`), 'utf8'));
  if (!report.success) throw new Error(report.error);
  fs.copyFileSync(path.join(profile, `${phase}.png`), path.join(output, `windows-${phase}.png`));
  return report;
}

(async () => {
  const seed = await launch('seed');
  const verify = await launch('verify');
  fs.writeFileSync(path.join(output, 'windows-smoke.json'), JSON.stringify({ success: true, packagedExecutable: !dev, seed, verify }, null, 2));
  console.log(`PASS Windows app: ${seed.checks.length + verify.checks.length} checks across two independent launches.`);
})().catch(error => {
  for (const phase of ['seed', 'verify']) {
    const report = path.join(profile, `${phase}.json`);
    if (fs.existsSync(report)) fs.copyFileSync(report, path.join(output, `failed-${phase}.json`));
  }
  fs.writeFileSync(path.join(output, 'windows-smoke.json'), JSON.stringify({ success: false, error: error.message }, null, 2));
  console.error(error.message);
  process.exitCode = 1;
});
