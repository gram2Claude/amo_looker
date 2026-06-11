// Картинка через loader: грузим байты (same-origin, abort-able) → blob: URL →
// <img>. Прямой src=href не используем — он не отменяется при закрытии модалки
// и не переживает редиректы amo→drive→S3 с Content-Disposition.
export default function render({ $, file, $body, loader }) {
  return loader.fetchBuffer(file.href).then(({ buf, contentType }) => {
    const url = loader.objectURL(buf, contentType || '');
    return new Promise((resolve) => {
      const $img = $('<img class="nx-render-image"/>').attr('src', url).attr('alt', file.name);
      $body.empty().append($img);
      $img.on('load', resolve).on('error', () => resolve());
    });
  });
}
