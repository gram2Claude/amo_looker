// PDF-рендерер. Решение (T8): план A2 — fetch байтов через loader → Blob с
// type=application/pdf → blob: URL → <iframe>. Почему не A1 (iframe прямо на
// file.href): amo-вложения могут отдаваться с Content-Disposition: attachment,
// и тогда iframe инициирует СКАЧИВАНИЕ вместо рендера. Через blob с явным
// mime браузер всегда рендерит инлайн. pdf.js (A3, ~2МБ в vendor) не понадобился.
//
// file.href может быть уже blob: URL (приходит от legacy.js после конвертации) —
// тогда повторно не грузим, отдаём как есть.
export default function render({ $, file, $body, loader }) {
  const ready = (file.href || '').startsWith('blob:')
    ? Promise.resolve(file.href)
    : loader.fetchBuffer(file.href).then(({ buf }) => loader.objectURL(buf, 'application/pdf'));

  return ready.then((url) => new Promise((resolve) => {
    const $iframe = $('<iframe class="nx-render-pdf"/>').attr('src', url);
    $body.empty().append($iframe);
    $iframe.on('load', resolve);
    setTimeout(resolve, 4000);
  }));
}
