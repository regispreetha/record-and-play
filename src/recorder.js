const { chromium } = require('playwright');

// Injected into every page to capture user interactions
const CAPTURE_SCRIPT = `
(function() {
  if (window.__rnp_injected) return;
  window.__rnp_injected = true;

  function getSelector(el) {
    if (!el || el.nodeType !== 1) return null;

    if (el.id) return '#' + el.id;

    var testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy');
    if (testId) return '[data-testid="' + testId + '"]';

    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return el.tagName.toLowerCase() + '[aria-label="' + ariaLabel.replace(/"/g, '\\"') + '"]';

    var name = el.getAttribute('name');
    if (name && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) {
      return el.tagName.toLowerCase() + '[name="' + name.replace(/"/g, '\\"') + '"]';
    }

    var placeholder = el.getAttribute('placeholder');
    if (placeholder && /^(INPUT|TEXTAREA)$/.test(el.tagName)) {
      return el.tagName.toLowerCase() + '[placeholder="' + placeholder.replace(/"/g, '\\"') + '"]';
    }

    // Build a short CSS path
    var parts = [];
    var cur = el;
    while (cur && cur !== document.documentElement) {
      var part = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      var siblings = cur.parentNode
        ? Array.from(cur.parentNode.children).filter(function(s) { return s.tagName === cur.tagName; })
        : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
      parts.unshift(part);
      cur = cur.parentElement;
      if (parts.length >= 4) break;
    }
    return parts.join(' > ');
  }

  var frameUrl = window.location.href;

  document.addEventListener('click', function(e) {
    if (!e.isTrusted) return;
    var tag = e.target.tagName;
    // Skip plain text inputs — covered by fill/change
    if (tag === 'INPUT' && !/^(checkbox|radio|button|submit|reset|file)$/i.test(e.target.type || '')) return;
    // Skip selects — covered by the change handler which records the chosen value
    if (tag === 'SELECT') return;
    var selector = getSelector(e.target);
    if (!selector) return;
    var text = (e.target.innerText || e.target.value || '').trim().slice(0, 100);
    window.__rnpRecord({ type: 'click', selector: selector, text: text, frameUrl: frameUrl });
  }, true);

  document.addEventListener('change', function(e) {
    if (!e.isTrusted) return;
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    var selector = getSelector(e.target);
    if (!selector) return;
    if (e.target.type === 'checkbox' || e.target.type === 'radio') {
      window.__rnpRecord({ type: 'check', selector: selector, checked: e.target.checked, frameUrl: frameUrl });
    } else if (e.target.tagName === 'SELECT') {
      // Record selects with both the option value and its visible label
      var selectedOption = e.target.options[e.target.selectedIndex];
      var optionText = selectedOption ? selectedOption.text.trim() : '';
      window.__rnpRecord({ type: 'select', selector: selector, value: e.target.value, optionText: optionText, frameUrl: frameUrl });
    } else {
      window.__rnpRecord({ type: 'fill', selector: selector, value: e.target.value, frameUrl: frameUrl });
    }
  }, true);

  document.addEventListener('keydown', function(e) {
    if (!e.isTrusted) return;
    if (!['Enter', 'Tab', 'Escape'].includes(e.key)) return;
    var selector = getSelector(e.target);
    window.__rnpRecord({ type: 'key', key: e.key, selector: selector, frameUrl: frameUrl });
  }, true);
})();
`;

class Recorder {
  constructor() {
    this._reset();
  }

  _reset() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.actions = [];
    this.recording = false;
    this.startUrl = null;
    this.onAction = null;
    this.lastNavUrl = null;
  }

  async start(url, onAction, onDisconnect) {
    if (this.recording) throw new Error('Already recording');

    this.recording = true;
    try {
      this.actions = [];
      this.startUrl = url;
      this.onAction = onAction;
      this.lastNavUrl = null;

      this.browser = await chromium.launch({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'],
      });
      this.context = await this.browser.newContext({
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      // Hide webdriver flag so reCAPTCHA / bot-detection doesn't block the session
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      await this.context.exposeFunction('__rnpRecord', (action) => {
        if (!this.recording) return;
        this._push(action);
      });

      await this.context.addInitScript(CAPTURE_SCRIPT);

      this.page = await this.context.newPage();

      this.page.on('framenavigated', (frame) => {
        if (!this.recording || frame !== this.page.mainFrame()) return;
        const navUrl = frame.url();
        if (!navUrl || navUrl === 'about:blank' || navUrl === this.lastNavUrl) return;
        this.lastNavUrl = navUrl;
        this._push({ type: 'navigate', url: navUrl });
      });

      this.browser.on('disconnected', () => {
        if (this.recording) {
          this._reset();
          if (onDisconnect) onDisconnect();
        }
      });

      await this.page.goto(url);
    } catch (err) {
      this._reset();
      throw err;
    }
    return this;
  }

  _push(action) {
    // Deduplicate consecutive navigate actions to the same URL
    if (action.type === 'navigate') {
      const last = this.actions[this.actions.length - 1];
      if (last && last.type === 'navigate' && last.url === action.url) return;
    }
    const enriched = { ...action, timestamp: Date.now(), index: this.actions.length };
    this.actions.push(enriched);
    if (this.onAction) this.onAction(enriched);
  }

  async stop() {
    this.recording = false;
    const actions = [...this.actions];
    const startUrl = this.startUrl;
    try {
      if (this.browser) await this.browser.close();
    } catch {
      // browser may already be closed by the user
    }
    this._reset();
    return { actions, startUrl };
  }

  async forceReset() {
    try {
      if (this.browser) await this.browser.close();
    } catch {
      // ignore
    }
    this._reset();
  }

  isRecording() {
    return this.recording;
  }
}

module.exports = Recorder;
