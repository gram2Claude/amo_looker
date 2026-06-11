// Картинка через loader: грузим байты (same-origin, abort-able) → blob: URL →
// <img>. Прямой src=href не используем — он не отменяется при закрытии модалки
// и не переживает редиректы amo→drive→S3 с Content-Disposition.
const MAX = 25 * 1024 * 1024;   // не грузим в RAM вкладки гигантские картинки

export default function render({ $, file, $body, loader }) {
  return loader.fetchBuffer(file.href, { maxBytes: MAX }).then(({ buf, contentType }) => {
    // svg надёжно показываем как image/svg+xml (amo может отдать octet-stream);
    // blob в <img> не исполняет скрипты внутри svg — безопасно.
    let type = contentType || '';
    if (/\.svg(?:$|\?)/i.test(file.name || '') || /\.svg(?:$|\?)/i.test(file.href || '')) type = 'image/svg+xml';
    const url = loader.objectURL(buf, type);
    return new Promise((resolve) => {
      const $img = $('<img class="nx-render-image"/>').attr('src', url).attr('alt', file.name);
      $body.empty().append($img);
      $img.on('load', resolve).on('error', () => resolve());
    });
  });
}
