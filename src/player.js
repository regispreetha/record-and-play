const { chromium } = require('playwright');

class Player {
  constructor() {
    this.browser = null;
    this.page = null;
    this.playing = false;
  }

  async play(recording, options = {}) {
    const { speed = 1, onAction, onComplete, onError } = options;
    this.playing = true;

    try {
      this.browser = await chromium.launch({ headless: false });
      const context = await this.browser.newContext({ viewport: null });
      this.page = await context.newPage();

      for (let i = 0; i < recording.actions.length; i++) {
        if (!this.playing) break;

        const action = recording.actions[i];
        if (onAction) onAction({ action, index: i, total: recording.actions.length });

        try {
          await this._run(action, speed);
        } catch (err) {
          if (onError) onError({ action, index: i, error: err.message });
          // continue with remaining actions
        }
      }

      if (this.playing && onComplete) onComplete();
    } catch (err) {
      if (onError) onError({ error: err.message });
    } finally {
      this.playing = false;
    }
  }

  async _run(action, speed) {
    const wait = (ms) => new Promise((r) => setTimeout(r, Math.round(ms / speed)));
    const TIMEOUT = 8000;

    switch (action.type) {
      case 'navigate':
        await this.page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        break;

      case 'click': {
        // Resolve the frame where the action was recorded (handles iframes like TradingView widgets)
        const frame = this._resolveFrame(action.frameUrl);
        let clicked = false;

        if (action.text) {
          // Text is known — NEVER fall back to unfiltered CSS (risks clicking the wrong element
          // when selector like button:nth-of-type(5) is ambiguous across multiple containers)

          // S1: CSS selector filtered by text — most precise when selector + text agree
          if (!clicked) {
            try {
              const loc = frame.locator(action.selector)
                .filter({ hasText: action.text })
                .first();
              await loc.waitFor({ state: 'visible', timeout: 5000 });
              await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
              await loc.click({ timeout: TIMEOUT });
              clicked = true;
            } catch {}
          }

          // S2: Role-based — button/link with exact name match (avoids substring collisions)
          if (!clicked) {
            for (const role of ['button', 'link', 'option', 'menuitem', 'tab']) {
              try {
                const loc = frame.getByRole(role, { name: action.text, exact: true }).first();
                await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
                await loc.click({ timeout: TIMEOUT });
                clicked = true;
                break;
              } catch {}
            }
          }

          // S3: Exact text match
          if (!clicked) {
            try {
              const loc = frame.getByText(action.text, { exact: true }).first();
              await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
              await loc.click({ timeout: TIMEOUT });
              clicked = true;
            } catch {}
          }

          // S4: Partial text match
          if (!clicked) {
            try {
              const loc = frame.getByText(action.text, { exact: false }).first();
              await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
              await loc.click({ timeout: TIMEOUT });
              clicked = true;
            } catch {}
          }

          // S5: Search all other frames (e.g. TradingView iframes)
          if (!clicked) {
            for (const f of this.page.frames()) {
              if (f === frame) continue;
              try {
                const loc = f.getByText(action.text, { exact: false }).first();
                await loc.click({ timeout: 3000 });
                clicked = true;
                break;
              } catch {}
            }
          }

        } else {
          // No text recorded — CSS selector is the only guide

          // S1: CSS in target frame
          if (!clicked) {
            try {
              const loc = frame.locator(action.selector).first();
              await loc.waitFor({ state: 'visible', timeout: TIMEOUT });
              await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
              await loc.click({ timeout: TIMEOUT });
              clicked = true;
            } catch {}
          }

          // S2: CSS in all other frames (iframes)
          if (!clicked) {
            for (const f of this.page.frames()) {
              if (f === frame) continue;
              try {
                await f.locator(action.selector).first().click({ timeout: 3000 });
                clicked = true;
                break;
              } catch {}
            }
          }
        }

        if (!clicked) throw new Error(`Could not click "${action.text || action.selector}"`);
        await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        break;
      }

      case 'select': {
        const frame = this._resolveFrame(action.frameUrl);
        const loc = frame.locator(action.selector).first();
        await loc.waitFor({ state: 'visible', timeout: TIMEOUT });
        // Try by value first, fall back to visible label
        try {
          await loc.selectOption(action.value, { timeout: TIMEOUT });
        } catch {
          if (action.optionText) {
            await loc.selectOption({ label: action.optionText }, { timeout: TIMEOUT });
          } else {
            throw new Error(`Could not select "${action.value}" in ${action.selector}`);
          }
        }
        break;
      }

      case 'fill': {
        const frame = this._resolveFrame(action.frameUrl);
        const loc = frame.locator(action.selector).first();
        await loc.waitFor({ state: 'visible', timeout: TIMEOUT });
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
        // Detect <select> elements (old recordings stored them as fill)
        const tagName = await loc.evaluate((el) => el.tagName).catch(() => '');
        if (tagName === 'SELECT') {
          await loc.selectOption(action.value, { timeout: TIMEOUT });
        } else {
          await loc.fill(action.value, { timeout: TIMEOUT });
        }
        break;
      }

      case 'check': {
        const loc = this.page.locator(action.selector).first();
        await loc.waitFor({ timeout: TIMEOUT });
        if (action.checked) {
          await loc.check({ timeout: TIMEOUT });
        } else {
          await loc.uncheck({ timeout: TIMEOUT });
        }
        break;
      }

      case 'key': {
        if (action.selector) {
          const loc = this.page.locator(action.selector).first();
          await loc.waitFor({ state: 'visible', timeout: TIMEOUT }).catch(() => {});
          await loc.press(action.key, { timeout: TIMEOUT });
        } else {
          await this.page.keyboard.press(action.key);
        }
        break;
      }
    }

    await wait(400);
  }

  // Returns the frame matching the recorded frameUrl, falling back to main frame
  _resolveFrame(frameUrl) {
    if (!frameUrl) return this.page.mainFrame();
    const match = this.page.frames().find((f) => f.url() === frameUrl);
    return match || this.page.mainFrame();
  }

  async stop() {
    this.playing = false;
    try {
      if (this.browser) await this.browser.close();
    } catch {
      // already closed
    }
    this.browser = null;
    this.page = null;
  }

  isPlaying() {
    return this.playing;
  }
}

module.exports = Player;
