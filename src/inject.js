import { canPreview } from './fileUtils.js';

// TODO(step-0): replace with real selectors captured from a live amoCRM lead
// card by inspecting attachments in: chat, notes, e-mail.
// Defensive: keep multiple selectors; the first that matches wins on a node.
const FILE_ROW_SELECTORS = [
  '.feed-compose-attach',
  '.feed__item__attach',
  '.feed-note__attach-file',
  '.task-detail__notes-attach',
  '.notes-wrapper [data-id]',
  'a[href*="/download/files/"]',
  'a[href*="drive.amocrm"]'
];

const FEED_ROOT_SELECTORS = [
  '.feed-container',
  '.card-feed',
  '.notes-wrapper',
  '.linked-forms__contacts'
];

const INJECTED_ATTR = 'data-tk-injected';

export default class Injector {
  constructor({ $, onEyeClick }) {
    this.$ = $;
    this.onEyeClick = onEyeClick;
    this.observer = null;
    this._click = this._click.bind(this);
  }

  start() {
    const roots = this._findRoots();
    if (!roots.length) {
      setTimeout(() => this.start(), 800);
      return;
    }
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) this._injectInto(n);
        });
      });
    });
    roots.forEach((root) => {
      this.observer.observe(root, { childList: true, subtree: true });
      this._injectInto(root);
    });
    this.$(document).on('click.tkLooker', '.tk-eye', this._click);
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.$(document).off('click.tkLooker');
    this.$('.tk-eye').remove();
    this.$(`[${INJECTED_ATTR}]`).removeAttr(INJECTED_ATTR);
  }

  _findRoots() {
    const found = [];
    FEED_ROOT_SELECTORS.forEach((sel) => {
      this.$(sel).each(function () { found.push(this); });
    });
    return found;
  }

  _injectInto(node) {
    FILE_ROW_SELECTORS.forEach((sel) => {
      const matches = node.matches && node.matches(sel)
        ? [node]
        : (node.querySelectorAll ? node.querySelectorAll(sel) : []);
      Array.prototype.forEach.call(matches, (row) => {
        if (row.getAttribute(INJECTED_ATTR)) return;
        const meta = this._extractMeta(row);
        if (!meta || !meta.href) return;
        if (!canPreview(meta)) return;
        row.setAttribute(INJECTED_ATTR, '1');
        row.appendChild(this._makeButton(meta));
      });
    });
  }

  _extractMeta(row) {
    const link = row.matches && row.matches('a') ? row : row.querySelector('a[href]');
    if (!link) return null;
    return {
      href: link.href,
      name: link.textContent.trim() || link.getAttribute('download') || 'file'
    };
  }

  _makeButton(meta) {
    const btn = document.createElement('span');
    btn.className = 'tk-eye';
    btn.setAttribute('data-href', meta.href);
    btn.setAttribute('data-name', meta.name);
    btn.setAttribute('title', 'Предпросмотр');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 5c-7 0-11 7-11 7s4 7 11 7 11-7 11-7-4-7-11-7zm0 11a4 4 0 110-8 4 4 0 010 8zm0-2a2 2 0 100-4 2 2 0 000 4z"/>' +
      '</svg>';
    return btn;
  }

  _click(e) {
    e.preventDefault();
    e.stopPropagation();
    const $btn = this.$(e.currentTarget);
    this.onEyeClick({
      href: $btn.data('href'),
      name: $btn.data('name')
    });
  }
}
