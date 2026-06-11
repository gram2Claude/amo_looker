// Загрузка UMD-библиотек из vendor/ внутри amoCRM.
//
// Проблема: amoCRM использует RequireJS с глобальным window.define (.amd).
// docx-preview/jszip делают ANONYMOUS define(), xlsx — NAMED define("xlsx").
// RequireJS перехватывает define и НЕ выставляет глобал (window.docx/JSZip/XLSX).
// Лечение: на время загрузки vendor-скрипта прячем window.define, чтобы либа
// ушла в ветку «глобальный браузер», затем возвращаем define.
//
// РИСК (учтён): пока define занулён, ЧУЖОЙ define() из RequireJS amoCRM ушёл бы
// в никуда. Поэтому окно зануления минимизируем:
//   1) Загрузки СЕРИАЛИЗОВАНЫ (общая очередь) — окна docx и xlsx не складываются,
//      define занулён максимум на время ОДНОЙ цепочки за раз.
//   2) ТАЙМАУТ на каждый скрипт — зависший onload не оставит define занулённым
//      навсегда (иначе RequireJS на всей вкладке сломался бы до перезагрузки).

const SCRIPT_TIMEOUT_MS = 20000;

let _hideDepth = 0;
let _savedDefine;
function hideDefine() {
  if (_hideDepth === 0) { _savedDefine = window.define; if (_savedDefine) window.define = undefined; }
  _hideDepth++;
}
function restoreDefine() {
  if (_hideDepth > 0) _hideDepth--;
  if (_hideDepth === 0 && _savedDefine) { window.define = _savedDefine; _savedDefine = undefined; }
}

// Последовательная очередь: следующий набор скриптов грузится только после
// предыдущего, чтобы окна зануления define не перекрывались.
let _chain = Promise.resolve();

export function loadVendorScripts(srcs) {
  const run = () => _loadSequential(srcs);
  _chain = _chain.then(run, run);   // запускать независимо от исхода предыдущего
  return _chain;
}

function _loadSequential(srcs) {
  return new Promise((resolve, reject) => {
    hideDefine();
    let i = 0, settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; restoreDefine(); fn(arg); };
    const next = () => {
      if (settled) return;                         // после timeout/ошибки не продолжаем цепочку
      if (i >= srcs.length) { finish(resolve); return; }
      const src = srcs[i++];
      const s = document.createElement('script');
      // запоздавший onload после timeout НЕ должен грузить следующий скрипт уже
      // при видимом define (иначе RequireJS перехватит UMD) — гасим handlers и guard settled.
      const timer = setTimeout(() => { s.onload = s.onerror = null; s.remove(); finish(reject, new Error('vendor load timeout: ' + src)); }, SCRIPT_TIMEOUT_MS);
      s.onload = () => { if (settled) return; clearTimeout(timer); next(); };
      s.onerror = () => { if (settled) return; clearTimeout(timer); s.remove(); finish(reject, new Error('vendor load failed: ' + src)); };
      s.src = src;
      document.head.appendChild(s);
    };
    next();
  });
}
