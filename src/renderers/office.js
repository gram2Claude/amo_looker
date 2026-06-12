import { keyedError } from '../loader.js';
import { cacheGet, cachePut } from '../cache.js';
import { CONVERTER_ORIGIN, OFFICE_VIEWER_ORIGIN } from '../endpoints.js';

// Предпросмотр через Microsoft Office Online viewer — Excel-вид для xlsx/csv.
// ВАЖНО: файл при этом уходит на серверы Microsoft (MS скачивает его по
// публичному URL с нашего сервера). Осознанное решение проекта, раскрыто
// в политике конфиденциальности и описании интеграции.
//
// Поток: loader качает файл из amoCRM (same-origin, кука) → POST байты на наш
// /preview-host (он временно публикует файл, csv конвертит в xlsx) → получаем
// публичный URL → отдаём его в Office viewer embed в <iframe>.
//
// Авторизация конвертера — по Origin кабинета (*.amocrm.ru / *.kommo.com),
// токенов в публичном виджете нет (любой токен в zip — не секрет).
const PREVIEW_HOST = CONVERTER_ORIGIN;
const OFFICE_EMBED = OFFICE_VIEWER_ORIGIN + '/op/embed.aspx?src=';
const MAX = 15 * 1024 * 1024;   // лимит Office viewer
const TTL_MARGIN_MS = 60 * 1000;   // страховочный зазор: не реюзаем url на излёте TTL

// Кэш-слой 'office:' (спека 04, этап 3.2): повторное открытие в пределах TTL
// (сервер отдаёт ttl_ms) не качает файл из amo и не аплоадит его заново.
export default function render({ $, file, $body, loader }) {
  const cached = cacheGet('office:' + file.href);
  const ready = cached ? Promise.resolve(cached) : loader.fetchBuffer(file.href, { maxBytes: MAX })
    .then(({ buf }) => loader.post(PREVIEW_HOST + '/preview-host', buf, {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name)
    }))
    .then((r) => {
      if (r.status === 429) throw keyedError('rate_limited', 'host 429');
      if (!r.ok) throw keyedError('preview_failed', 'host ' + r.status);
      return r.json();
    })
    .then((j) => {
      if (!j || !j.url) throw keyedError('preview_failed', 'no url');
      const ttl = Math.max(0, Number(j.ttl_ms || 0) - TTL_MARGIN_MS);
      if (ttl > 0) cachePut('office:' + file.href, j.url, { ttlMs: ttl });
      return j.url;
    });

  return ready.then((url) => {
    const src = OFFICE_EMBED + encodeURIComponent(url);
    const $iframe = $('<iframe class="nx-render-office"/>').attr('src', src);
    $body.empty().append($iframe);
  });
}
