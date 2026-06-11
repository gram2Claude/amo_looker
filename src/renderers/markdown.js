import { loadVendorScripts } from '../vendorLoader.js';

const MAX = 2 * 1024 * 1024;

// markdown-it (UMD, anonymous define) грузим через vendorLoader (зануление define
// для RequireJS amoCRM). Глобал — window.markdownit.
let _libPromise = null;
function ensureLib(params) {
  if (window.markdownit) return Promise.resolve(window.markdownit);
  if (_libPromise) return _libPromise;
  const base = (params && params.path) ? params.path : '';
  _libPromise = loadVendorScripts([base + '/vendor/markdown-it.min.js'])
    .then(() => {
      if (window.markdownit) return window.markdownit;
      throw new Error('markdown-it загружен, но window.markdownit пуст');
    })
    .catch((e) => { _libPromise = null; throw e; });
  return _libPromise;
}

// Markdown → HTML с разметкой. Безопасность: html:false (raw HTML/<script> в .md
// НЕ исполняется, экранируется), markdown-it дефолтно фильтрует опасные ссылки
// (javascript:/data:) — XSS закрыт без доп. санитайзера.
export default function render({ $, file, $body, params, loader }) {
  return Promise.all([
    ensureLib(params),
    loader.fetchBuffer(file.href, { maxBytes: MAX }).then(({ buf }) => buf)
  ]).then(([markdownit, buf]) => {
    const text = new TextDecoder('utf-8').decode(buf);
    const md = markdownit({ html: false, linkify: true, typographer: true, breaks: false });
    const container = document.createElement('div');
    container.className = 'nx-render-md';
    container.innerHTML = md.render(text);
    // ссылки — в новой вкладке, безопасный rel
    container.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    // внешние картинки в .md (![](url)) не должны утекать origin/referrer кабинета amoCRM
    container.querySelectorAll('img').forEach((img) => { img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; });
    $body.empty().append(container);
  });
}
