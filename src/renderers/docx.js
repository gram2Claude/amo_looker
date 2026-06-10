// Loads docx-preview UMD bundle from vendor/ via a <script> tag (RequireJS in
// amoCRM has quirks with named UMD bundles). The bundle exposes window.docx.
// module-level promise дедуплицирует параллельную загрузку vendor-скрипта.
let _libPromise = null;
function ensureLib(params) {
  if (window.docx) return Promise.resolve(window.docx);
  if (_libPromise) return _libPromise;
  _libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const cdnBase = (params && params.path) ? params.path : '';
    s.src = cdnBase + '/vendor/docx-preview.min.js';
    s.onload = () => {
      if (window.docx) resolve(window.docx);
      else { _libPromise = null; reject(new Error('docx-preview загружен, но window.docx пуст')); }
    };
    s.onerror = () => { _libPromise = null; reject(new Error('Не удалось загрузить docx-preview')); };
    document.head.appendChild(s);
  });
  return _libPromise;
}

export default function render({ file, $body, params, loader }) {
  return Promise.all([
    ensureLib(params),
    loader.fetchBuffer(file.href).then(({ buf }) => buf)
  ]).then(([docx, buf]) => {
    const container = document.createElement('div');
    container.className = 'nx-render-docx';
    $body.empty().append(container);
    return docx.renderAsync(buf, container);
  });
}
