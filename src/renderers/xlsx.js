import { loadVendorScripts } from '../vendorLoader.js';

const MAX = 10 * 1024 * 1024;
const MAX_ROWS = 2000;   // кап рендера: распакованный лист из 10МБ-архива может дать
                         // миллионы ячеек и заморозить вкладку синхронным построением DOM

// SheetJS — NAMED define("xlsx"): без зануления define (vendorLoader) RequireJS
// оставит window.XLSX пустой заглушкой {}. Guard проверяет именно .read, а не
// просто truthy — иначе заглушка навсегда замаскировала бы проблему.
let _libPromise = null;
function ensureLib(params) {
  if (window.XLSX && window.XLSX.read) return Promise.resolve(window.XLSX);
  if (_libPromise) return _libPromise;
  const base = (params && params.path) ? params.path : '';
  _libPromise = loadVendorScripts([base + '/vendor/xlsx.full.min.js'])
    .then(() => {
      if (window.XLSX && window.XLSX.read) return window.XLSX;
      throw new Error('SheetJS загружен, но window.XLSX.read недоступен');
    })
    .catch((e) => { _libPromise = null; throw e; });
  return _libPromise;
}

// Построение таблицы листа через DOM (а НЕ XLSX.utils.sheet_to_html + innerHTML):
// содержимое ячеек книги может содержать HTML/скрипты → XSS внутри страницы
// amoCRM. .text()/textContent экранирует — безопасно.
function renderSheet($, XLSX, sheet) {
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  const rows = allRows.slice(0, MAX_ROWS);
  const $wrap = $('<div/>');
  const $table = $('<table/>');
  rows.forEach((row) => {
    const $tr = $('<tr/>');
    (Array.isArray(row) ? row : [row]).forEach((cell) => {
      $tr.append($('<td/>').text(cell == null ? '' : String(cell)));
    });
    $table.append($tr);
  });
  $wrap.append($table);
  if (allRows.length > MAX_ROWS) {
    $wrap.append($('<div class="nx-xlsx-truncated"/>').text(
      'Показаны первые ' + MAX_ROWS + ' строк из ' + allRows.length + '. Скачайте файл для полного просмотра.'));
  }
  return $wrap;
}

export default function render({ $, file, $body, params, loader }) {
  return Promise.all([
    ensureLib(params),
    loader.fetchBuffer(file.href, { maxBytes: MAX }).then(({ buf }) => buf)
  ]).then(([XLSX, buf]) => {
    const wb = XLSX.read(buf, { type: 'array' });
    const $wrap = $('<div class="nx-render-xlsx"/>');
    const $tabs = $('<div class="nx-xlsx-tabs"/>');
    const $sheet = $('<div class="nx-xlsx-sheet"/>');
    const show = (name) => { $sheet.empty().append(renderSheet($, XLSX, wb.Sheets[name])); };
    wb.SheetNames.forEach((name, i) => {
      const $tab = $('<button class="nx-xlsx-tab"/>').text(name).on('click', () => {
        $tabs.find('.nx-xlsx-tab').removeClass('is-active');
        $tab.addClass('is-active');
        show(name);
      });
      if (i === 0) $tab.addClass('is-active');
      $tabs.append($tab);
    });
    show(wb.SheetNames[0]);
    $wrap.append($tabs).append($sheet);
    $body.empty().append($wrap);
  });
}
