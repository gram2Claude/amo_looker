// Прогрев TLS-соединений к внешним сервисам (спека 04, этап 3.1): из дальних
// регионов рукопожатие стоит 2-3 RTT (до ~секунды), прогретый сокет снимает
// эту цену с последующего POST/iframe.
//
// Решающие детали (ревью спеки):
//  - для CORS-POST на конвертер нужен CORS-сокет → <link rel=preconnect crossorigin>;
//    без crossorigin браузер прогреет non-CORS-сокет и НЕ переиспользует его;
//  - для iframe Office viewer — наоборот, БЕЗ crossorigin (навигационный запрос);
//  - браузер закрывает неиспользованный сокет через ~10с — повторная вставка
//    link при каждом открытии модалки ре-триггерит прогрев; выигрыш в основном
//    для small-файлов (принятое ограничение спеки).
import { CONVERTER_ORIGIN, OFFICE_VIEWER_ORIGIN } from './endpoints.js';

export function warmConnections($, kind) {
  if (kind === 'legacy' || kind === 'office') addLink($, CONVERTER_ORIGIN, true);
  if (kind === 'office') addLink($, OFFICE_VIEWER_ORIGIN, false);
}

function addLink($, origin, cors) {
  const id = 'nx-preconnect-' + origin.replace(/[^a-z0-9]+/gi, '-');
  $('#' + id).remove();   // ре-вставка = повторный прогрев после idle-закрытия
  const $link = $('<link rel="preconnect">').attr({ id, href: origin });
  if (cors) $link.attr('crossorigin', 'anonymous');
  $('head').append($link);
}
