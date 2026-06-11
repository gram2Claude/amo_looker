import { loadVendorScripts } from '../vendorLoader.js';

// docx-preview (UMD) зависит от глобального JSZip → грузим jszip ПЕРЕД ним,
// оба с занулённым define (см. vendorLoader). module-level promise дедуплицирует
// параллельную загрузку.
let _libPromise = null;
function ensureLib(params) {
  if (window.docx) return Promise.resolve(window.docx);
  if (_libPromise) return _libPromise;
  const base = (params && params.path) ? params.path : '';
  _libPromise = loadVendorScripts([base + '/vendor/jszip.min.js', base + '/vendor/docx-preview.min.js'])
    .then(() => {
      if (window.docx) return window.docx;
      throw new Error('docx-preview загружен, но window.docx пуст');
    })
    .catch((e) => { _libPromise = null; throw e; });
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
