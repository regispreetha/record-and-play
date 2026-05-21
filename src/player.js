const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const sessions = require('./sessions');
chromium.use(StealthPlugin());

class Player {
  constructor() {
    this.browser  = null;
    this.context  = null;
    this.page     = null;
    this.playing  = false;
    this.paused   = false;
    this._resumeFn = null;
    this._mouseX  = null;
    this._mouseY  = null;
    this._startUrl = null;
  }

  async play(recording, options = {}) {
    const { speed = 1, onAction, onComplete, onError, onPaused } = options;
    this.playing   = true;
    this.paused    = false;
    this._mouseX   = null;
    this._mouseY   = null;
    this._startUrl = recording.startUrl;

    try {
      this.browser = await chromium.launch({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'],
      });

      // Load saved session cookies if available (skips login for protected sites)
      const savedSession = await sessions.load(recording.startUrl);

      this.context = await this.browser.newContext({
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        storageState: savedSession || undefined,
      });

      this.page = await this.context.newPage();

      // Auto-switch to new tabs/windows opened by the site (e.g. OAuth popups, underwriting tools)
      this.context.on('page', async (newPage) => {
        try {
          await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 });
          this.page    = newPage;
          this._mouseX = null;
          this._mouseY = null;
          if (options.onNewPage) options.onNewPage({ url: newPage.url() });
        } catch {}
      });

      for (let i = 0; i < recording.actions.length; i++) {
        if (!this.playing) break;

        // ── Pause gate ────────────────────────────────────────────────────
        if (this.paused) {
          if (onPaused) onPaused({ index: i });
          await new Promise((resolve) => { this._resumeFn = resolve; });
        }

        const action = recording.actions[i];
        if (onAction) onAction({ action, index: i, total: recording.actions.length });

        try {
          await this._run(action, speed);
        } catch (err) {
          if (onError) onError({ action, index: i, error: err.message });
        }
      }

      if (this.playing && onComplete) onComplete();
    } catch (err) {
      if (onError) onError({ error: err.message });
    } finally {
      this.playing = false;
      this.paused  = false;
    }
  }

  pause() {
    if (this.playing) this.paused = true;
  }

  resume() {
    this.paused = false;
    if (this._resumeFn) { this._resumeFn(); this._resumeFn = null; }
  }

  async saveSession() {
    if (!this.context) throw new Error('No active browser session');
    const state = await this.context.storageState();
    await sessions.save(this._startUrl, state);
    return this._startUrl;
  }

  // ── Human-like mouse movement ──────────────────────────────────────────────
  async _humanMouseMove(loc) {
    try {
      const box = await loc.boundingBox({ timeout: 3000 });
      if (!box) return;

      const targetX = box.x + box.width  * (0.25 + Math.random() * 0.5);
      const targetY = box.y + box.height * (0.25 + Math.random() * 0.5);
      const fromX   = this._mouseX ?? (150 + Math.random() * 500);
      const fromY   = this._mouseY ?? (150 + Math.random() * 350);

      const cp1X = fromX + (targetX - fromX) * (0.2 + Math.random() * 0.2) + (Math.random() - 0.5) * 160;
      const cp1Y = fromY + (targetY - fromY) * (0.2 + Math.random() * 0.2) + (Math.random() - 0.5) * 160;
      const cp2X = fromX + (targetX - fromX) * (0.6 + Math.random() * 0.2) + (Math.random() - 0.5) * 160;
      const cp2Y = fromY + (targetY - fromY) * (0.6 + Math.random() * 0.2) + (Math.random() - 0.5) * 160;

      const steps = 22 + Math.floor(Math.random() * 18);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, mt = 1 - t;
        const x = mt**3*fromX + 3*mt**2*t*cp1X + 3*mt*t**2*cp2X + t**3*targetX;
        const y = mt**3*fromY + 3*mt**2*t*cp1Y + 3*mt*t**2*cp2Y + t**3*targetY;
        await this.page.mouse.move(x + (Math.random()-0.5)*1.5, y + (Math.random()-0.5)*1.5);
        const eased = Math.sin(t * Math.PI);
        await new Promise((r) => setTimeout(r, Math.round(7 + (1-eased)*14)));
      }
      await this.page.mouse.move(targetX, targetY);
      this._mouseX = targetX;
      this._mouseY = targetY;
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 80));
    } catch {}
  }

  async _idleMouseDrift() {
    try {
      const x = (this._mouseX ?? 400) + (Math.random() - 0.5) * 60;
      const y = (this._mouseY ?? 300) + (Math.random() - 0.5) * 40;
      await this.page.mouse.move(x, y);
      this._mouseX = x; this._mouseY = y;
    } catch {}
  }

  // ── Action runner ──────────────────────────────────────────────────────────
  async _run(action, speed) {
    const wait    = (ms) => new Promise((r) => setTimeout(r, Math.round(ms / speed)));
    const TIMEOUT = 8000;

    switch (action.type) {

      case 'navigate':
        await this.page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await this._idleMouseDrift();
        await wait(300 + Math.random() * 400);
        break;

      case 'click': {
        const frame = this._resolveFrame(action.frameUrl);
        let clicked = false;

        const moveAndClick = async (loc) => {
          await this._humanMouseMove(loc);
          await loc.click({ timeout: TIMEOUT });
        };

        if (action.text) {
          // S1: CSS + text filter
          if (!clicked) { try {
            const loc = frame.locator(action.selector).filter({ hasText: action.text }).first();
            await loc.waitFor({ state: 'visible', timeout: 5000 });
            await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
            await moveAndClick(loc); clicked = true;
          } catch {} }

          // S2: Role + exact name
          if (!clicked) {
            for (const role of ['button', 'link', 'option', 'menuitem', 'tab']) { try {
              const loc = frame.getByRole(role, { name: action.text, exact: true }).first();
              await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
              await moveAndClick(loc); clicked = true; break;
            } catch {} }
          }

          // S3: Exact text
          if (!clicked) { try {
            const loc = frame.getByText(action.text, { exact: true }).first();
            await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
            await moveAndClick(loc); clicked = true;
          } catch {} }

          // S4: Partial text
          if (!clicked) { try {
            const loc = frame.getByText(action.text, { exact: false }).first();
            await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
            await moveAndClick(loc); clicked = true;
          } catch {} }

          // S5: All other frames
          if (!clicked) {
            for (const f of this.page.frames()) { if (f === frame) continue; try {
              const loc = f.getByText(action.text, { exact: false }).first();
              await this._humanMouseMove(loc); await loc.click({ timeout: 3000 });
              clicked = true; break;
            } catch {} }
          }

        } else {
          // S1: CSS in target frame
          if (!clicked) { try {
            const loc = frame.locator(action.selector).first();
            await loc.waitFor({ state: 'visible', timeout: TIMEOUT });
            await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
            await moveAndClick(loc); clicked = true;
          } catch {} }

          // S2: CSS in all frames
          if (!clicked) {
            for (const f of this.page.frames()) { if (f === frame) continue; try {
              const loc = f.locator(action.selector).first();
              await this._humanMouseMove(loc); await loc.click({ timeout: 3000 });
              clicked = true; break;
            } catch {} }
          }
        }

        if (!clicked) throw new Error(`Could not click "${action.text || action.selector}"`);
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        break;
      }

      case 'select': {
        const frame = this._resolveFrame(action.frameUrl);
        const loc   = frame.locator(action.selector).first();
        await loc.waitFor({ state: 'visible', timeout: TIMEOUT });
        await this._humanMouseMove(loc);
        try {
          await loc.selectOption(action.value, { timeout: TIMEOUT });
        } catch {
          if (action.optionText) await loc.selectOption({ label: action.optionText }, { timeout: TIMEOUT });
          else throw new Error(`Could not select "${action.value}" in ${action.selector}`);
        }
        break;
      }

      case 'fill': {
        const frame   = this._resolveFrame(action.frameUrl);
        const loc     = frame.locator(action.selector).first();
        await loc.waitFor({ state: 'visible', timeout: TIMEOUT });
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
        const tagName = await loc.evaluate((el) => el.tagName).catch(() => '');
        if (tagName === 'SELECT') {
          await this._humanMouseMove(loc);
          await loc.selectOption(action.value, { timeout: TIMEOUT });
        } else {
          await this._humanMouseMove(loc);
          await loc.click({ timeout: TIMEOUT });
          await loc.selectText({ timeout: 3000 }).catch(() => {});
          await this.page.keyboard.press('Control+a');
          await this.page.keyboard.press('Delete');
          await loc.pressSequentially(action.value, { delay: 80 + Math.random() * 40 });
        }
        break;
      }

      case 'check': {
        const loc = this.page.locator(action.selector).first();
        await loc.waitFor({ timeout: TIMEOUT });
        await this._humanMouseMove(loc);
        if (action.checked) await loc.check({ timeout: TIMEOUT });
        else await loc.uncheck({ timeout: TIMEOUT });
        break;
      }

      case 'key': {
        if (action.selector) {
          const loc = this.page.locator(action.selector).first();
          await loc.waitFor({ state: 'visible', timeout: TIMEOUT }).catch(() => {});
          if (action.key === 'Tab') {
            const currentVal = await loc.inputValue().catch(() => null);
            if (currentVal === '' || currentVal === null) break;
          }
          await loc.press(action.key, { timeout: TIMEOUT });
        } else {
          await this.page.keyboard.press(action.key);
        }
        break;
      }
    }

    await wait(300 + Math.random() * 200);
  }

  _resolveFrame(frameUrl) {
    if (!frameUrl) return this.page.mainFrame();
    return this.page.frames().find((f) => f.url() === frameUrl) || this.page.mainFrame();
  }

  async stop() {
    this.playing = false;
    this.paused  = false;
    if (this._resumeFn) { this._resumeFn(); this._resumeFn = null; }
    try { if (this.browser) await this.browser.close(); } catch {}
    this.browser = null; this.context = null; this.page = null;
  }

  isPlaying()  { return this.playing; }
  isPaused()   { return this.paused;  }
}

module.exports = Player;
