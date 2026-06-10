export default function render({ $, file, $body }) {
  return new Promise((resolve) => {
    const $img = $('<img class="tk-render-image"/>').attr('src', file.href).attr('alt', file.name);
    $body.empty().append($img);
    $img.on('load', resolve).on('error', () => {
      $body.empty().append($('<div class="tk-modal__error"/>').text('Не удалось загрузить картинку'));
      resolve();
    });
  });
}
