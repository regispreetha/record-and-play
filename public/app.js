/* ── State ─────────────────────────────────────────────────────────────── */
const state = {
  recordings: [],
  activeId: null,
  mode: 'welcome', // welcome | new | recording | detail | playback
};

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const panels = {
  welcome:   $('panel-welcome'),
  new:       $('panel-new'),
  recording: $('panel-recording'),
  detail:    $('panel-detail'),
  playback:  $('panel-playback'),
};

/* ── Panel switching ─────────────────────────────────────────────────────── */
function showPanel(name) {
  state.mode = name;
  for (const [k, el] of Object.entries(panels)) {
    el.classList.toggle('active', k === name);
  }
}

/* ── Status badge ────────────────────────────────────────────────────────── */
function setStatus(label, cls) {
  const el = $('status-badge');
  el.textContent = label;
  el.className = 'badge ' + cls;
}

/* ── Recordings sidebar ──────────────────────────────────────────────────── */
async function loadRecordings() {
  try {
    const res = await fetch('/api/recordings');
    state.recordings = await res.json();
    renderSidebar();
  } catch {
    // ignore
  }
}

function renderSidebar() {
  const list = $('recordings-list');
  if (state.recordings.length === 0) {
    list.innerHTML = '<p class="empty-msg">No recordings yet.<br>Click + New Recording to start.</p>';
    return;
  }
  list.innerHTML = state.recordings.map((r) => `
    <div class="rec-item ${r.id === state.activeId ? 'active' : ''}" data-id="${r.id}">
      <div class="rec-item-name">${esc(r.name)}</div>
      <div class="rec-item-meta">${r.actionCount} action${r.actionCount !== 1 ? 's' : ''} &middot; ${fmtDate(r.createdAt)}</div>
    </div>
  `).join('');

  list.querySelectorAll('.rec-item').forEach((el) => {
    el.addEventListener('click', () => openDetail(el.dataset.id));
  });
}

/* ── Open recording detail ───────────────────────────────────────────────── */
async function openDetail(id) {
  state.activeId = id;
  renderSidebar();
  try {
    const res = await fetch(`/api/recordings/${id}`);
    const rec = await res.json();
    $('detail-name').textContent = rec.name;
    $('detail-meta').innerHTML = `
      <span>${esc(rec.startUrl)}</span><br>
      <span>${fmtDate(rec.createdAt)} &middot; ${rec.actionCount} actions</span>
    `;
    const log = $('log-detail');
    log.innerHTML = rec.actions.map((a, i) => logLine(a, i)).join('');
    showPanel('detail');
  } catch {
    alert('Could not load recording.');
  }
}

/* ── Log helpers ─────────────────────────────────────────────────────────── */
function logLine(action, idx) {
  let text = '';
  switch (action.type) {
    case 'navigate': text = action.url; break;
    case 'click':    text = `${action.selector}${action.text ? ' — "' + esc(action.text) + '"' : ''}`; break;
    case 'fill':     text = `${action.selector} = "${esc(action.value)}"`; break;
    case 'select':   text = `${action.selector} → "${esc(action.optionText || action.value)}"`; break;
    case 'key':      text = `${action.key}${action.selector ? ' on ' + action.selector : ''}`; break;
    case 'check':    text = `${action.selector} → ${action.checked ? 'checked' : 'unchecked'}`; break;
    default:         text = JSON.stringify(action);
  }
  return `<div class="log-line"><span class="log-idx">${idx + 1}</span><span class="log-type ${action.type}">${action.type}</span><span class="log-text">${esc(text)}</span></div>`;
}

function appendLog(logEl, line) {
  logEl.insertAdjacentHTML('beforeend', line);
  logEl.scrollTop = logEl.scrollHeight;
}

/* ── New recording ───────────────────────────────────────────────────────── */
$('btn-new').addEventListener('click', openNewForm);
$('btn-new-welcome').addEventListener('click', openNewForm);
$('btn-cancel-new').addEventListener('click', () => showPanel(state.recordings.length ? 'welcome' : 'welcome'));
$('btn-start-rec').addEventListener('click', startRecording);

function openNewForm() {
  $('inp-name').value = '';
  $('inp-url').value = '';
  showPanel('new');
}

async function startRecording() {
  const url  = $('inp-url').value.trim();
  const name = $('inp-name').value.trim() || 'Untitled Recording';
  if (!url) { $('inp-url').focus(); return; }

  try {
    const res = await fetch('/api/record/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }

    $('rec-url').textContent = url;
    $('log-rec').innerHTML = '';
    showPanel('recording');
    setStatus('Recording', 'badge-rec');
    // Store name for stop
    $('btn-stop-rec').dataset.name = name;
  } catch (err) {
    alert('Failed to start recording: ' + err.message);
  }
}

/* ── Stop recording ──────────────────────────────────────────────────────── */
$('btn-stop-rec').addEventListener('click', stopRecording);

async function stopRecording() {
  const name = $('btn-stop-rec').dataset.name || 'Untitled Recording';
  try {
    const res = await fetch('/api/record/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    setStatus('Idle', 'badge-idle');
    await loadRecordings();
    openDetail(data.recording.id);
  } catch (err) {
    alert('Failed to stop recording: ' + err.message);
  }
}

/* ── Play ────────────────────────────────────────────────────────────────── */
$('btn-play').addEventListener('click', async () => {
  if (!state.activeId) return;
  const speed = parseFloat($('detail-speed').value) || 1;
  try {
    const res = await fetch(`/api/play/${state.activeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
  } catch (err) {
    alert('Failed to start playback: ' + err.message);
  }
});

$('btn-stop-play').addEventListener('click', async () => {
  await fetch('/api/play/stop', { method: 'POST' });
});

/* ── Delete ──────────────────────────────────────────────────────────────── */
$('btn-delete').addEventListener('click', async () => {
  if (!state.activeId) return;
  if (!confirm('Delete this recording?')) return;
  try {
    await fetch(`/api/recordings/${state.activeId}`, { method: 'DELETE' });
    state.activeId = null;
    await loadRecordings();
    showPanel('welcome');
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
});

/* ── Utilities ───────────────────────────────────────────────────────────── */
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch { return iso; }
}

/* ── WebSocket ───────────────────────────────────────────────────────────── */
let ws = null;

function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => {};

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleWS(msg);
  };

  ws.onclose = () => {
    // Reconnect after 2s
    setTimeout(connectWS, 2000);
  };
}

function handleWS(msg) {
  switch (msg.event) {

    case 'status':
      if (msg.recording) {
        setStatus('Recording', 'badge-rec');
        // Re-sync panel if we reconnected mid-recording
        if (state.mode !== 'recording') showPanel('recording');
      } else if (msg.playing) {
        setStatus('Playing', 'badge-play');
      } else {
        setStatus('Idle', 'badge-idle');
      }
      break;

    case 'action': {
      // Live action log during recording
      const log = $('log-rec');
      appendLog(log, logLine(msg.action, msg.action.index));
      break;
    }

    case 'recording_started':
      setStatus('Recording', 'badge-rec');
      break;

    case 'recording_stopped':
      setStatus('Idle', 'badge-idle');
      break;

    case 'recording_browser_closed':
      // Playwright window was closed by the user without clicking Stop
      setStatus('Idle', 'badge-idle');
      if (state.mode === 'recording') {
        loadRecordings().then(() => showPanel(state.recordings.length ? 'welcome' : 'welcome'));
      }
      break;

    case 'playback_started': {
      setStatus('Playing', 'badge-play');
      const rec = state.recordings.find((r) => r.id === msg.recordingId);
      $('pb-name').textContent = msg.name || (rec && rec.name) || 'Playing…';
      $('pb-progress-label').textContent = 'Starting…';
      $('pb-bar').style.width = '0%';
      $('log-pb').innerHTML = '';
      showPanel('playback');
      break;
    }

    case 'playback_action': {
      const pct = msg.total > 0 ? Math.round(((msg.index + 1) / msg.total) * 100) : 0;
      $('pb-bar').style.width = pct + '%';
      $('pb-progress-label').textContent = `Step ${msg.index + 1} / ${msg.total}`;
      appendLog($('log-pb'), `<div class="log-line ok">${logLine(msg.action, msg.index)}</div>`);
      break;
    }

    case 'playback_error': {
      const errText = `<div class="log-line err"><span class="log-idx">${(msg.index ?? '') + 1}</span><span class="log-type error">error</span><span class="log-text">${esc(msg.error)}</span></div>`;
      appendLog($('log-pb'), errText);
      break;
    }

    case 'playback_complete':
      setStatus('Idle', 'badge-idle');
      $('pb-bar').style.width = '100%';
      $('pb-progress-label').textContent = 'Complete';
      appendLog($('log-pb'), '<div class="log-line ok"><span class="log-text" style="color:#56d364">&#10003; Playback complete</span></div>');
      break;

    case 'playback_stopped':
      setStatus('Idle', 'badge-idle');
      if (state.activeId) openDetail(state.activeId);
      else showPanel('welcome');
      break;
  }
}

/* ── Init ─────────────────────────────────────────────────────────────────── */
(async () => {
  await loadRecordings();
  showPanel('welcome');
  connectWS();
})();
