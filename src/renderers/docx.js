// Loads docx-preview UMD bundle from vendor/ via a <script> tag (RequireJS in
// amoCRM has quirks with named UMD bundles). The bundle exposes window.docx.
function ensureLib(params) {
  if (window.docx) return Promise.resolve(window.docx);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const cdnBase = (params && params.path) ? params.path : '';
    s.src = cdnBase + '/vendor/docx-preview.min.js';
    s.onload = () => resolve(window.docx);
    s.onerror = () => reject(new Error('Не удалось загрузить docx-preview'));
    document.head.appendChild(s);
  });
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
