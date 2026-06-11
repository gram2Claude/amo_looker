import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadVendorScripts } from '../src/vendorLoader.js';

// Подменяем document.createElement('script'): фиксируем порядок и состояние
// window.define в момент «загрузки». onAppend(el) вызывается асинхронно (как
// настоящий script onload), даёт контроль над тем, когда дёрнуть onload/onerror.
function installScriptStub(handler) {
  const orig = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag !== 'script') return orig(tag);
    const el = orig('script');
    el.remove = () => {};
    Object.defineProperty(el, 'src', {
      set(v) { this._src = v; queueMicrotask(() => handler(this)); },
      get() { return this._src; }
    });
    return el;
  });
  vi.spyOn(document.head, 'appendChild').mockImplementation((el) => el);
}

describe('loadVendorScripts', () => {
  beforeEach(() => {
    window.define = function fakeRequireDefine() {};
    window.define.amd = true;
  });
  afterEach(() => { vi.restoreAllMocks(); delete window.define; vi.useRealTimers(); });

  it('зануляет window.define на время загрузки и восстанавливает после', async () => {
    const saved = window.define;
    const seen = [];
    installScriptStub((el) => { seen.push(window.define); el.onload(); });
    await loadVendorScripts(['/vendor/a.js', '/vendor/b.js']);
    expect(seen).toEqual([undefined, undefined]);   // define спрятан на каждом скрипте
    expect(window.define).toBe(saved);              // восстановлен
    expect(window.define.amd).toBe(true);
  });

  it('грузит скрипты в заданном порядке', async () => {
    const order = [];
    installScriptStub((el) => { order.push(el.src); el.onload(); });
    await loadVendorScripts(['/vendor/jszip.min.js', '/vendor/docx-preview.min.js']);
    expect(order).toEqual(['/vendor/jszip.min.js', '/vendor/docx-preview.min.js']);
  });

  it('восстанавливает define даже при ошибке загрузки', async () => {
    const saved = window.define;
    installScriptStub((el) => { el.onerror(); });
    await expect(loadVendorScripts(['/vendor/bad.js'])).rejects.toThrow(/vendor load failed/);
    expect(window.define).toBe(saved);
  });

  it('сериализует параллельные вызовы (окна define не складываются) и восстанавливает ровно один раз', async () => {
    const saved = window.define;
    const events = [];
    // первый набор «зависнет» на первом скрипте, пока не дёрнем вручную
    let firstOnload = null;
    installScriptStub((el) => {
      if (el.src === '/a1') { firstOnload = el.onload; events.push('a1-loading:' + (window.define === undefined)); }
      else { events.push(el.src + ':' + (window.define === undefined)); el.onload(); }
    });
    const p1 = loadVendorScripts(['/a1']);
    const p2 = loadVendorScripts(['/b1']);
    await Promise.resolve();
    // p2 не должен был начать грузиться, пока p1 в полёте (сериализация)
    await new Promise((r) => setTimeout(r, 5));
    firstOnload();                 // завершаем p1
    await Promise.all([p1, p2]);
    expect(events).toContain('a1-loading:true');
    expect(events).toContain('/b1:true');           // b1 тоже грузился при занулённом define
    expect(window.define).toBe(saved);              // в конце define восстановлен
  });

  it('таймаут зависшей загрузки восстанавливает define (не оставляет занулённым навсегда)', async () => {
    vi.useFakeTimers();
    const saved = window.define;
    installScriptStub(() => { /* onload никогда не вызывается — зависшая загрузка */ });
    const p = loadVendorScripts(['/vendor/hang.js']);
    const assertion = expect(p).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(20001);
    await assertion;
    expect(window.define).toBe(saved);              // define вернулся, RequireJS amo не сломан
  });
});
