const MAX = 10 * 1024 * 1024;

function ensureLib(params) {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const cdnBase = (params && params.path) ? params.path : '';
    s.src = cdnBase + '/vendor/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Не удалось загрузить SheetJS'));
    document.head.appendChild(s);
  });
}

export default function render({ $, file, $body, params }) {
  return Promise.all([
    ensureLib(params),
    fetch(file.href, { credentials: 'same-origin' }).then((r) => {
      const len = r.headers.get('content-length');
      if (len && Number(len) > MAX) throw new Error('XLSX больше 10 МБ — скачайте файл');
      return r.arrayBuffer();
    })
  ]).then(([XLSX, buf]) => {
    const wb = XLSX.read(buf, { type: 'array' });
    const $wrap = $('<div class="tk-render-xlsx"/>');
    const $tabs = $('<div class="tk-xlsx-tabs"/>');
    const $sheet = $('<div class="tk-xlsx-sheet"/>');
    wb.SheetNames.forEach((name, i) => {
      const $tab = $('<button class="tk-xlsx-tab"/>').text(name).on('click', () => {
        $tabs.find('.tk-xlsx-tab').removeClass('is-active');
        $tab.addClass('is-active');
        $sheet.html(XLSX.utils.sheet_to_html(wb.Sheets[name]));
      });
      if (i === 0) $tab.addClass('is-active');
      $tabs.append($tab);
    });
    $sheet.html(XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]]));
    $wrap.append($tabs).append($sheet);
    $body.empty().append($wrap);
  });
}
