const MAX = 2 * 1024 * 1024;

export default function render({ $, file, $body }) {
  return fetch(file.href, { credentials: 'same-origin' })
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const len = r.headers.get('content-length');
      if (len && Number(len) > MAX) throw new Error('Файл слишком большой для текстового предпросмотра');
      return r.text();
    })
    .then((txt) => {
      $body.empty().append($('<pre class="tk-render-text"/>').text(txt));
    });
}
