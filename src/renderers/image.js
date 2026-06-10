export default function render({ $, file, $body }) {
  return new Promise((resolve) => {
    const $img = $('<img class="nx-render-image"/>').attr('src', file.href).attr('alt', file.name);
    $body.empty().append($img);
    $img.on('load', resolve).on('error', () => {
      $body.empty().append($('<div class="nx-modal__error"/>').text('Не удалось загрузить картинку'));
      resolve();
    });
  });
}
