import pdfRender from './pdf.js';
import { keyedError } from '../loader.js';
import { cacheGet, cachePut } from '../cache.js';
import { CONVERTER_ORIGIN } from '../endpoints.js';

// Конвертер на нашем сервере. Авторизация — по Origin кабинета (см. office.js).
const ENDPOINT = CONVERTER_ORIGIN + '/convert';
const MAX = 50 * 1024 * 1024;   // лимит конвертера

// legacy .doc/.xls/.ppt/.rtf/.odt → POST на конвертер → PDF → pdf-рендерер.
// Кэш-слой 'pdf:' (спека 04, этап 3.2): повторное открытие не гоняет файл на
// конвертер заново — готовый PDF-буфер берётся из сессионного кэша.
export default function render({ $, file, $body, loader }) {
  const cached = cacheGet('pdf:' + file.href);
  const ready = cached ? Promise.resolve(cached) : loader.fetchBuffer(file.href, { maxBytes: MAX })
    .then(({ buf }) => loader.post(ENDPOINT, buf, {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
      'Accept': 'application/pdf'
    }))
    .then(async (r) => {
      if (r.status === 429) throw keyedError('rate_limited', 'HTTP 429');
      if (!r.ok) throw keyedError('converter_failed', 'HTTP ' + r.status);
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('pdf')) {
        // конвертер вернул не PDF (HTML/JSON ошибки) — не пытаемся это рендерить
        throw keyedError('converter_failed', 'content-type ' + ct);
      }
      const pdfBuf = await r.arrayBuffer();
      cachePut('pdf:' + file.href, pdfBuf, { bytes: pdfBuf.byteLength });
      return pdfBuf;
    });

  return ready.then((pdfBuf) => {
    const url = loader.objectURL(pdfBuf, 'application/pdf');
    return pdfRender({ $, file: { href: url, name: file.name + '.pdf' }, $body, loader });
  });
}
