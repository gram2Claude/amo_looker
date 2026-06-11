// Загрузка UMD-библиотек из vendor/ внутри amoCRM.
//
// Проблема: amoCRM использует RequireJS, у которого глобальный window.define
// с .amd. docx-preview/jszip делают ANONYMOUS define(), xlsx — NAMED
// define("xlsx", ...). В обоих случаях RequireJS перехватывает define и НЕ
// выставляет ожидаемый глобал (window.docx / JSZip / XLSX): docx-preview даёт
// "Mismatched anonymous define()", а xlsx молча оставляет window.XLSX пустой
// заглушкой. Лечение: на время загрузки vendor-скриптов прячем window.define,
// чтобы библиотеки ушли в ветку «глобальный браузер» и выставили глобал, затем
// возвращаем define на место.
//
// Скрипты грузятся ПОСЛЕДОВАТЕЛЬНО (порядок важен: jszip до docx-preview).
// Зануление define — короткое (только на время вставки vendor); риск гонки с
// собственными AMD-загрузками amoCRM низкий, т.к. происходит разово при первом
// открытии модалки соответствующего формата.

let _hideDepth = 0;
let _savedDefine;

function hideDefine() {
  if (_hideDepth === 0) { _savedDefine = window.define; if (_savedDefine) window.define = undefined; }
  _hideDepth++;
}
function restoreDefine() {
  _hideDepth--;
  if (_hideDepth === 0 && _savedDefine) { window.define = _savedDefine; _savedDefine = undefined; }
}

export function loadVendorScripts(srcs) {
  return new Promise((resolve, reject) => {
    hideDefine();
    let i = 0;
    const next = () => {
      if (i >= srcs.length) { restoreDefine(); resolve(); return; }
      const s = document.createElement('script');
      s.src = srcs[i++];
      s.onload = next;
      s.onerror = () => { restoreDefine(); reject(new Error('vendor load failed: ' + s.src)); };
      document.head.appendChild(s);
    };
    next();
  });
}
