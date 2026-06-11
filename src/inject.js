import { canPreview } from './fileUtils.js';

// Селекторы сняты с живого amoCRM (venskons78, сделка 3177663), 2026-06-10 —
// см. work_directory/01_specs/01_dom_recon_amocrm.md.
// Defensive: первый селектор — реальный из разведки, остальные — fallback на
// случай иных типов лент (письма/чат) или будущих изменений вёрстки amoCRM.

// Контейнер ленты — цель MutationObserver.
const FEED_ROOT_SELECTORS = [
  '.notes-wrapper__notes.js-notes',  // реальный (лента примечаний карточки)
  '.js-notes',
  '.notes-wrapper'
];

// Строка вложения — точка инъекции глазика.
const FILE_ROW_SELECTORS = [
  '.feed-note__joined-attach-item',  // реальный
  '.feed-note__joined-attach__link'  // fallback: сама ссылка, если структура иная
];

// Ссылка на файл внутри строки.
const FILE_LINK_SELECTOR = 'a.feed-note__joined-attach__link, a[href*="/download/"], a[href*="drive-a.amocrm"], a[href*="/download/drive/"]';

// Картинки amoCRM кладёт в ленту НЕ как файл-вложение, а как inline-превью
// (ссылка-обёртка js-image-resizer вокруг img). href ведёт на /download/drive/<uuid>
// БЕЗ расширения — поэтому тип форсируем 'image', detectKind по href не сработал бы.
const IMG_PREVIEW_SELECTORS = ['a.js-image-resizer', '.feed-note__media-preview a[href*="/download/"]'];

// На строку пишем href, под который уже вставлен глазик — устойчиво к
// перерендеру строки (если amoCRM пересоздал ссылку с новым href, переставим).
const INJECTED_ATTR = 'data-nx-injected';
const RETRY_MS = 800;

export default class Injector {
  constructor({ $, onEyeClick }) {
    this.$ = $;
    this.onEyeClick = onEyeClick;
    this.observer = null;
    this._retryTimer = null;
    this._onDocClick = this._onDocClick.bind(this);
  }

  start() {
    // Идемпотентность: повторный start() (init_once:false → init на каждое
    // открытие карточки) не должен плодить наблюдатели/таймеры.
    this._teardownObserver();

    const roots = this._findRoots();
    if (!roots.length) {
      // Лента ещё не отрендерилась — повтор. Хэндл сохраняем, чтобы stop()
      // мог отменить отложенный start (иначе observer воскреснет после destroy).
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        this.start();
      }, RETRY_MS);
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
    // Клик ловим НАТИВНЫМ листенером на document в фазе CAPTURE (true), а не
    // jQuery-делегированием в bubble: лента amoCRM глушит всплытие клика
    // (stopPropagation в своих обработчиках), и событие до document в bubble
    // не доходит — глазик «не нажимался». Capture идёт сверху вниз ДО bubble,
    // поэтому перехватываем клик раньше глушилки. removeEventListener в stop().
    document.removeEventListener('click', this._onDocClick, true);
    document.addEventListener('click', this._onDocClick, true);
  }

  stop() {
    this._teardownObserver();
    document.removeEventListener('click', this._onDocClick, true);
    this.$('.nx-eye').remove();
    this.$(`[${INJECTED_ATTR}]`).removeAttr(INJECTED_ATTR);
  }

  // Снять наблюдатель и отложенный retry, не трогая уже вставленные кнопки.
  _teardownObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  _findRoots() {
    const found = [];
    for (const sel of FEED_ROOT_SELECTORS) {
      this.$(sel).each(function () { found.push(this); });
      if (found.length) break;  // первый сработавший селектор — наш
    }
    return found;
  }

  _injectInto(node) {
    FILE_ROW_SELECTORS.forEach((sel) => {
      const matches = node.matches && node.matches(sel)
        ? [node]
        : (node.querySelectorAll ? node.querySelectorAll(sel) : []);
      Array.prototype.forEach.call(matches, (row) => this._injectRow(row));
    });
    // картинки-превью (другая разметка, тип форсируем image)
    IMG_PREVIEW_SELECTORS.forEach((sel) => {
      const matches = node.matches && node.matches(sel)
        ? [node]
        : (node.querySelectorAll ? node.querySelectorAll(sel) : []);
      Array.prototype.forEach.call(matches, (el) => this._injectImage(el));
    });
  }

  _injectRow(row) {
    // Якорь дедупа — сама ССЫЛКА, а не строка: селекторы FILE_ROW_SELECTORS
    // (контейнер + вложенная ссылка) пересекаются на одном вложении, и оба
    // пути приходят к одной ссылке — метка на ней исключает двойную вставку.
    const link = this._findLink(row);
    if (!link) return;
    const meta = { href: link.href, name: link.textContent.trim() || link.getAttribute('download') || 'file' };
    if (!meta.href || !canPreview(meta)) return;

    // Устойчиво к перерендеру: тот же href + кнопка на месте → пропуск;
    // иначе (href сменился / кнопку снесли) — чистим и пересоздаём.
    const host = link.parentNode || row;
    const marked = link.getAttribute(INJECTED_ATTR);
    const existing = host.querySelector(':scope > .nx-eye');
    if (marked === meta.href && existing) return;
    if (existing) existing.remove();

    link.setAttribute(INJECTED_ATTR, meta.href);
    host.appendChild(this._makeButton(meta));
  }

  // Картинка-превью: href ведёт на изображение, тип форсируем 'image'
  // (detectKind по href без расширения не сработал бы). Имя — из alt/title или дефолт.
  _injectImage(link) {
    if (!link || !link.href) return;
    const img = link.querySelector('img');
    const name = (img && (img.getAttribute('alt') || img.getAttribute('title'))) || 'Изображение';
    const meta = { href: link.href, name, kind: 'image' };

    const host = link.parentNode || link;
    const marked = link.getAttribute(INJECTED_ATTR);
    const existing = host.querySelector(':scope > .nx-eye');
    if (marked === meta.href && existing) return;
    if (existing) existing.remove();

    link.setAttribute(INJECTED_ATTR, meta.href);
    host.appendChild(this._makeButton(meta));
  }

  _findLink(row) {
    return row.matches && row.matches('a') ? row : row.querySelector(FILE_LINK_SELECTOR);
  }

  _makeButton(meta) {
    const btn = document.createElement('span');
    btn.className = 'nx-eye';
    btn.setAttribute('data-href', meta.href);
    btn.setAttribute('data-name', meta.name);
    if (meta.kind) btn.setAttribute('data-kind', meta.kind);
    btn.setAttribute('title', 'Предпросмотр');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 5c-7 0-11 7-11 7s4 7 11 7 11-7 11-7-4-7-11-7zm0 11a4 4 0 110-8 4 4 0 010 8zm0-2a2 2 0 100-4 2 2 0 000 4z"/>' +
      '</svg>';
    return btn;
  }

  // Нативный делегированный обработчик (capture). target может быть svg/path
  // внутри глазика → closest('.nx-eye') находит сам глазик.
  _onDocClick(e) {
    const eye = e.target && e.target.closest ? e.target.closest('.nx-eye') : null;
    if (!eye) return;
    e.preventDefault();
    e.stopPropagation();
    this.onEyeClick({
      href: eye.getAttribute('data-href'),
      name: eye.getAttribute('data-name'),
      kind: eye.getAttribute('data-kind') || undefined   // image для картинок-превью
    });
  }
}
