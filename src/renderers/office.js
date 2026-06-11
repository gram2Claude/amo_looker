import { keyedError } from '../loader.js';

// Предпросмотр через Microsoft Office Online viewer — Excel-вид для xlsx/csv.
// ВАЖНО: файл при этом уходит на серверы Microsoft (MS скачивает его по
// публичному URL с нашего сервера). Осознанное решение проекта.
//
// Поток: loader качает файл из amoCRM (same-origin, кука) → POST байты на наш
// /preview-host (он временно публикует файл, csv конвертит в xlsx) → получаем
// публичный URL → отдаём его в Office viewer embed в <iframe>.
const DEFAULT_HOST = 'https://nexus-oko.naithon.one';
const OFFICE_EMBED = 'https://view.officeapps.live.com/op/embed.aspx?src=';
const MAX = 15 * 1024 * 1024;   // лимит Office viewer

export default function render({ $, file, $body, settings, loader }) {
  const base  = (settings && settings.preview_host_url) || DEFAULT_HOST;
  const token = (settings && settings.converter_token) || '';

  return loader.fetchBuffer(file.href, { maxBytes: MAX })
    .then(({ buf }) => loader.post(base + '/preview-host', buf, {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
      'X-Source-Token': token
    }))
    .then((r) => {
      if (!r.ok) throw keyedError('preview_failed', 'host ' + r.status);
      return r.json();
    })
    .then((j) => {
      if (!j || !j.url) throw keyedError('preview_failed', 'no url');
      const src = OFFICE_EMBED + encodeURIComponent(j.url);
      const $iframe = $('<iframe class="nx-render-office"/>').attr('src', src);
      $body.empty().append($iframe);
    });
}
