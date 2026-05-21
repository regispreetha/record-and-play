# Record & Play — Browser Automation Tool

Record your browser interactions and replay them automatically.  
Built with [Playwright](https://playwright.dev/) + Node.js.

![dashboard](https://img.shields.io/badge/UI-Web%20Dashboard-blue)
![node](https://img.shields.io/badge/Node.js-18%2B-green)
![playwright](https://img.shields.io/badge/Playwright-Chromium-orange)

---

## What it does

| Feature | Details |
|---|---|
| **Record** | Opens a real browser — interact normally, every click/fill/select is captured |
| **Playback** | Replays recordings automatically with smart fallback strategies |
| **Dropdowns** | Handles `<select>` elements correctly |
| **Iframes** | Tracks which frame each action happened in (e.g. TradingView widgets) |
| **Speed control** | Play back at 0.5×, 1×, 2×, or 4× speed |
| **Live log** | Dashboard shows every action in real time during record and playback |

---

## Quick Start

### 1. Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Git](https://git-scm.com/)

### 2. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/record-and-play.git
cd record-and-play
npm install
npm run install-browsers
```

### 3. Run

```bash
npm start
```

Open **http://localhost:3000** in your browser.

---

## How to use

1. Click **+ New Recording** — enter a name and start URL
2. A Chromium window opens — interact with the site as normal
3. Click **Stop** in the dashboard when done
4. Select the recording from the sidebar → click **▶ Play**

---

## Project structure

```
record-and-play/
├── main.js              # Entry point
├── src/
│   ├── server.js        # Express + WebSocket server
│   ├── recorder.js      # Playwright recording engine
│   ├── player.js        # Playwright playback engine
│   └── storage.js       # JSON file storage for recordings
├── public/
│   ├── index.html       # Dashboard UI
│   ├── styles.css       # Dark theme styles
│   └── app.js           # Dashboard JavaScript
└── recordings/          # Your saved recordings (gitignored — stays local)
```

---

## Troubleshooting

**"Already recording" on startup**
```bash
# Force-reset stuck state (or just restart the server)
curl -X POST http://localhost:3000/api/record/reset
```

**Browser doesn't open**
Make sure Chromium is installed:
```bash
npm run install-browsers
```

**Port already in use**
```bash
PORT=3001 npm start
```

---

## License

MIT — free to use, modify, and share.
