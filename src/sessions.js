const fs   = require('fs').promises;
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');

function domainKey(url) {
  try { return new URL(url).hostname; }
  catch { return 'default'; }
}

async function save(url, storageState) {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  await fs.writeFile(
    path.join(SESSIONS_DIR, `${domainKey(url)}.json`),
    JSON.stringify(storageState, null, 2)
  );
}

async function load(url) {
  try {
    const data = await fs.readFile(path.join(SESSIONS_DIR, `${domainKey(url)}.json`), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function remove(url) {
  await fs.unlink(path.join(SESSIONS_DIR, `${domainKey(url)}.json`)).catch(() => {});
}

module.exports = { save, load, remove, domainKey };
