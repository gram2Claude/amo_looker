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

export default function render({ file, $body, params }) {
  return Promise.all([
    ensureLib(params),
    // 'same-origin', НЕ 'include': кука нужна только на первом same-origin хопе;
    // на CORS-редиректе amo→drive→S3 credentialed-запрос несовместим с ACAO:*
    // (см. work_directory/01_specs/01_dom_recon_amocrm.md)
    fetch(file.href, { credentials: 'same-origin' }).then((r) => r.arrayBuffer())
  ]).then(([docx, buf]) => {
    const container = document.createElement('div');
    container.className = 'tk-render-docx';
    $body.empty().append(container);
    return docx.renderAsync(buf, container);
  });
}
