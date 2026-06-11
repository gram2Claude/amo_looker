import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadVendorScripts } from '../src/vendorLoader.js';

// Подменяем document.createElement('script') так, чтобы onload вызывался
// синхронно-асинхронно, и фиксируем, было ли занулено window.define в момент
// «загрузки» каждого скрипта.
function installScriptStub(onAppend) {
  const orig = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag !== 'script') return orig(tag);
    const el = orig('script');
    Object.defineProperty(el, 'src', {
      set(v) { this._src = v; queueMicrotask(() => onAppend(this)); },
      get() { return this._src; }
    });
    return el;
  });
  vi.spyOn(document.head, 'appendChild').mockImplementation((el) => el);
}

describe('loadVendorScripts', () => {
  let defineCalls;
  beforeEach(() => {
    defineCalls = [];
    window.define = function fakeRequireDefine() {};
    window.define.amd = true;
  });
  afterEach(() => { vi.restoreAllMocks(); delete window.define; });

  it('зануляет window.define на время загрузки и восстанавливает после', async () => {
    const saved = window.define;
    installScriptStub((el) => {
      defineCalls.push(window.define);   // во время загрузки define должен быть undefined
      el.onload();
    });
    await loadVendorScripts(['/vendor/a.js', '/vendor/b.js']);
    expect(defineCalls).toHaveLength(2);
    expect(defineCalls[0]).toBeUndefined();
    expect(defineCalls[1]).toBeUndefined();
    expect(window.define).toBe(saved);   // восстановлен
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
});
