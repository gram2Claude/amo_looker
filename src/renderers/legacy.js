import pdfRender from './pdf.js';
import { keyedError } from '../loader.js';

// Конвертер на нашем сервере (env при сборке / advanced_settings переопределяют).
const DEFAULT_ENDPOINT = 'https://nexus-oko.naithon.one/convert';
const MAX = 50 * 1024 * 1024;   // лимит конвертера

// legacy .doc/.xls/.ppt/.rtf/.odt → POST на конвертер → PDF → pdf-рендерер.
export default function render({ $, file, $body, settings, loader }) {
  const endpoint = (settings && settings.converter_url) || DEFAULT_ENDPOINT;
  const token    = (settings && settings.converter_token) || '';

  return loader.fetchBuffer(file.href, { maxBytes: MAX })
    .then(({ buf }) => loader.post(endpoint, buf, {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
      'X-Source-Token': token,
      'Accept': 'application/pdf'
    }))
    .then(async (r) => {
      if (!r.ok) throw keyedError('converter_failed', 'HTTP ' + r.status);
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('pdf')) {
        // конвертер вернул не PDF (HTML/JSON ошибки) — не пытаемся это рендерить
        throw keyedError('converter_failed', 'content-type ' + ct);
      }
      const pdfBuf = await r.arrayBuffer();
      const url = loader.objectURL(pdfBuf, 'application/pdf');
      return pdfRender({ $, file: { href: url, name: file.name + '.pdf' }, $body, loader });
    });
}
