const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const Recorder = require('./recorder');
const Player = require('./player');
const storage = require('./storage');

let wss = null;
const recorder = new Recorder();
const player = new Player();

function broadcast(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

async function startServer(port) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ── Recordings ────────────────────────────────────────────────────────────

  app.get('/api/recordings', async (req, res) => {
    try {
      res.json(await storage.listRecordings());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/recordings/:id', async (req, res) => {
    try {
      res.json(await storage.loadRecording(req.params.id));
    } catch {
      res.status(404).json({ error: 'Recording not found' });
    }
  });

  app.delete('/api/recordings/:id', async (req, res) => {
    try {
      await storage.deleteRecording(req.params.id);
      res.json({ success: true });
    } catch {
      res.status(404).json({ error: 'Recording not found' });
    }
  });

  // ── Record ─────────────────────────────────────────────────────────────────

  app.post('/api/record/start', async (req, res) => {
    if (recorder.isRecording()) return res.status(400).json({ error: 'Already recording' });
    if (player.isPlaying()) return res.status(400).json({ error: 'Playback is running' });

    const { url, name } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    try {
      await recorder.start(
        url,
        (action) => broadcast({ event: 'action', action }),
        () => broadcast({ event: 'recording_browser_closed' })
      );
      broadcast({ event: 'recording_started', url, name });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/record/stop', async (req, res) => {
    if (!recorder.isRecording()) return res.status(400).json({ error: 'Not recording' });

    const { name } = req.body;
    try {
      const { actions, startUrl } = await recorder.stop();
      const recording = await storage.saveRecording(name || 'Untitled Recording', startUrl, actions);
      broadcast({ event: 'recording_stopped', recording });
      res.json({ recording });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Force-clears stuck recording state (recovery escape hatch)
  app.post('/api/record/reset', async (req, res) => {
    await recorder.forceReset();
    broadcast({ event: 'recording_browser_closed' });
    res.json({ success: true });
  });

  // ── Playback ───────────────────────────────────────────────────────────────

  // NOTE: named routes must come before /:id so Express doesn't match them as ids
  app.post('/api/play/stop', async (req, res) => {
    await player.stop();
    broadcast({ event: 'playback_stopped' });
    res.json({ success: true });
  });

  app.post('/api/play/pause', (req, res) => {
    player.pause();
    broadcast({ event: 'playback_paused' });
    res.json({ success: true });
  });

  app.post('/api/play/resume', (req, res) => {
    player.resume();
    broadcast({ event: 'playback_resumed' });
    res.json({ success: true });
  });

  app.post('/api/play/save-session', async (req, res) => {
    try {
      const url = await player.saveSession();
      broadcast({ event: 'session_saved', url });
      res.json({ success: true, url });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/play/:id', async (req, res) => {
    if (recorder.isRecording()) return res.status(400).json({ error: 'Recording is running' });
    if (player.isPlaying()) return res.status(400).json({ error: 'Already playing' });

    const { speed = 1 } = req.body;
    try {
      const recording = await storage.loadRecording(req.params.id);
      res.json({ success: true });

      broadcast({ event: 'playback_started', recordingId: recording.id, name: recording.name });

      player.play(recording, {
        speed: Math.min(Math.max(Number(speed) || 1, 0.25), 4),
        onAction: ({ action, index, total }) =>
          broadcast({ event: 'playback_action', action, index, total }),
        onComplete: () => broadcast({ event: 'playback_complete' }),
        onError: ({ action, index, error }) =>
          broadcast({ event: 'playback_error', action, index, error }),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Status ─────────────────────────────────────────────────────────────────

  app.get('/api/status', (req, res) => {
    res.json({ recording: recorder.isRecording(), playing: player.isPlaying(), paused: player.isPaused() });
  });

  // ── Server ─────────────────────────────────────────────────────────────────

  const server = http.createServer(app);
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
      event: 'status',
      recording: recorder.isRecording(),
      playing: player.isPlaying(),
    }));
  });

  await new Promise((resolve) => server.listen(port, resolve));
  return server;
}

module.exports = { startServer };
