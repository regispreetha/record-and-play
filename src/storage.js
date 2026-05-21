const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const RECORDINGS_DIR = path.join(__dirname, '..', 'recordings');

async function ensureDir() {
  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
}

async function saveRecording(name, startUrl, actions) {
  await ensureDir();
  const id = uuidv4();
  const recording = {
    id,
    name: name || 'Untitled Recording',
    startUrl,
    actions,
    createdAt: new Date().toISOString(),
    actionCount: actions.length,
  };
  await fs.writeFile(
    path.join(RECORDINGS_DIR, `${id}.json`),
    JSON.stringify(recording, null, 2)
  );
  return recording;
}

async function loadRecording(id) {
  const filePath = path.join(RECORDINGS_DIR, `${sanitizeId(id)}.json`);
  const data = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(data);
}

async function listRecordings() {
  await ensureDir();
  const files = await fs.readdir(RECORDINGS_DIR);
  const recordings = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = await fs.readFile(path.join(RECORDINGS_DIR, file), 'utf-8');
      const rec = JSON.parse(data);
      recordings.push({
        id: rec.id,
        name: rec.name,
        startUrl: rec.startUrl,
        createdAt: rec.createdAt,
        actionCount: rec.actionCount,
      });
    } catch {
      // skip corrupted files
    }
  }
  return recordings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function deleteRecording(id) {
  const filePath = path.join(RECORDINGS_DIR, `${sanitizeId(id)}.json`);
  await fs.unlink(filePath);
}

function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9-]/g, '');
}

module.exports = { saveRecording, loadRecording, listRecordings, deleteRecording };
