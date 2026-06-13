'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const { execSync, spawn } = require('child_process');

// ─── Heroku HTTP keep-alive ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('MOON-X is running 🌙\n');
}).listen(PORT);

// ─── Config ───────────────────────────────────────────────────────────────
const ZIP_URL   = 'https://github.com/mrjustin99/keyz1234/archive/refs/heads/main.zip';
const DEST_DIR  = path.join(__dirname, 'bot');
const ZIP_PATH  = path.join(__dirname, '_payload.zip');
const DONE_FLAG = path.join(__dirname, '.extracted');

// ─── Helpers ──────────────────────────────────────────────────────────────
function log(msg) { process.stdout.write(msg + '\n'); }

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get  = url.startsWith('https') ? https : http;
    get.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { try { fs.unlinkSync(dest); } catch (_) {} reject(err); });
  });
}

function ensureAdmZip() {
  try { require('adm-zip'); return; } catch (_) {}
  execSync('npm install adm-zip --no-save --silent', { stdio: 'ignore' });
}

async function extractPayload() {
  // Already done on a previous run
  if (fs.existsSync(DONE_FLAG) && fs.existsSync(DEST_DIR)) return;

  log('Extracting ZIP');

  await download(ZIP_URL, ZIP_PATH);
  ensureAdmZip();

  const AdmZip = require('adm-zip');
  const zip    = new AdmZip(ZIP_PATH);

  if (fs.existsSync(DEST_DIR)) fs.rmSync(DEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEST_DIR, { recursive: true });

  // GitHub archives wrap everything in a top-level folder (repo-branch/)
  // We strip that prefix so files land directly in DEST_DIR
  const entries  = zip.getEntries();
  const topDir   = entries[0]?.entryName.split('/')[0] || '';

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const rel      = topDir ? entry.entryName.replace(topDir + '/', '') : entry.entryName;
    if (!rel) continue;
    const outPath  = path.join(DEST_DIR, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, entry.getData());
  }

  try { fs.unlinkSync(ZIP_PATH); } catch (_) {}

  // Copy .env into bot/ so settings.js picks it up
  const envSrc = path.join(__dirname, '.env');
  const envDst = path.join(DEST_DIR, '.env');
  if (fs.existsSync(envSrc) && !fs.existsSync(envDst)) {
    fs.copyFileSync(envSrc, envDst);
  }

  // Write done flag so we skip extraction on next restart
  fs.writeFileSync(DONE_FLAG, new Date().toISOString());
}

async function installDeps() {
  const pkgPath = path.join(DEST_DIR, 'package.json');
  const nmPath  = path.join(DEST_DIR, 'node_modules');
  if (!fs.existsSync(pkgPath)) return;
  if (fs.existsSync(nmPath)) return; // already installed
  execSync('npm install --production --legacy-peer-deps', {
    cwd: DEST_DIR,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

async function main() {
  await extractPayload();
  await installDeps();

  // Hand off to the real bot index.js inside bot/
  const botIndex = path.join(DEST_DIR, 'index.js');
  if (!fs.existsSync(botIndex)) {
    log('ERROR: bot/index.js not found after extraction');
    process.exit(1);
  }

  // Change working directory and require the real bot
  process.chdir(DEST_DIR);
  require(botIndex);
}

main().catch(err => {
  console.error('MOON-X loader fatal:', err.message);
  process.exit(1);
});
