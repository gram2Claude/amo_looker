// Сессионный LRU-кэш (src/cache.js) + интеграция с loader/рендерерами
// (спека 04, этап 3.2) + preconnect (этап 3.1).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cacheGet, cachePut, cacheClear, cacheStats } from '../src/cache.js';
import Loader from '../src/loader.js';
import legacyRender from '../src/renderers/legacy.js';
import officeRender from '../src/renderers/office.js';
import { warmConnections } from '../src/preconnect.js';
import $ from 'jquery';

beforeEach(() => cacheClear());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('cache: LRU и TTL', () => {
  it('put/get, LRU-bump при чтении', () => {
    cachePut('a', 1); cachePut('b', 2); cachePut('c', 3);
    expect(cacheGet('a')).toBe(1);          // bump: a теперь самый свежий
    for (let i = 0; i < 14; i++) cachePut('x' + i, i);   // добиваем до 16+
    expect(cacheGet('a')).toBe(1);          // выжил за счёт bump'а
    expect(cacheGet('b')).toBeNull();       // самый старый — вытеснен
  });

  it('вытеснение по суммарным байтам', () => {
    cachePut('big1', 'x', { bytes: 60 * 1024 * 1024 });
    cachePut('big2', 'y', { bytes: 60 * 1024 * 1024 });   // 120МБ > 100МБ
    expect(cacheGet('big1')).toBeNull();
    expect(cacheGet('big2')).toBe('y');
    expect(cacheStats().totalBytes).toBe(60 * 1024 * 1024);
  });

  it('гигант больше бюджета не вытесняет весь кэш', () => {
    cachePut('a', 1, { bytes: 10 });
    cachePut('huge', 'z', { bytes: 200 * 1024 * 1024 });
    expect(cacheGet('huge')).toBeNull();
    expect(cacheGet('a')).toBe(1);
  });

  it('TTL: запись умирает по сроку', () => {
    vi.useFakeTimers();
    cachePut('p', 'url', { ttlMs: 1000 });
    expect(cacheGet('p')).toBe('url');
    vi.advanceTimersByTime(1500);
    expect(cacheGet('p')).toBeNull();
  });
});

describe('cache: интеграция с Loader.fetchBuffer', () => {
  it('повторный fetchBuffer того же href не ходит в сеть', async () => {
    const data = new TextEncoder().encode('bytes');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, headers: { get: () => 'text/plain' }, arrayBuffer: async () => data.buffer
    });
    const l1 = new Loader();
    await l1.fetchBuffer('https://x/f.txt');
    const l2 = new Loader();                       // другой инстанс (другая модалка)
    const r2 = await l2.fetchBuffer('https://x/f.txt');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(r2.bytes).toBe(5);
  });

  it('кэш-хит уважает maxBytes рендерера', async () => {
    const big = new ArrayBuffer(1024);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, headers: { get: () => '' }, arrayBuffer: async () => big
    });
    const l = new Loader();
    await l.fetchBuffer('https://x/big');          // закэшировался (без лимита)
    await expect(new Loader().fetchBuffer('https://x/big', { maxBytes: 512 }))
      .rejects.toMatchObject({ langKey: 'too_large' });
  });

  it('неуспешная загрузка НЕ кэшируется', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) })
      .mockResolvedValueOnce({ ok: true, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(3) });
    await expect(new Loader().fetchBuffer('https://x/e')).rejects.toMatchObject({ langKey: 'fetch_failed' });
    const r = await new Loader().fetchBuffer('https://x/e');
    expect(r.bytes).toBe(3);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

function makeBody() { return $('<div/>'); }

describe('cache: legacy — повторное открытие без сети', () => {
  it('второй рендер берёт PDF из кэша (ни fetch, ни POST)', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:pdf');
    globalThis.URL.revokeObjectURL = vi.fn();
    const srcBuf = new ArrayBuffer(8);
    globalThis.fetch = vi.fn()
      // 1: fetch исходника из amo
      .mockResolvedValueOnce({ ok: true, headers: { get: () => '' }, arrayBuffer: async () => srcBuf })
      // 2: POST на конвертер
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => 'application/pdf' }, arrayBuffer: async () => new ArrayBuffer(4) });
    const file = { href: 'https://x/a.doc', name: 'a.doc' };

    const loader1 = new Loader();
    await legacyRender({ $, file, $body: makeBody(), loader: loader1 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    loader1.dispose();                                   // модалка закрыта, URL ревокнуты

    const loader2 = new Loader();
    await legacyRender({ $, file, $body: makeBody(), loader: loader2 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);   // сети больше не было
  }, 15000);   // pdf-рендерер в jsdom ждёт фолбэк load-таймера 4с на каждый рендер
});

describe('cache: office — реюз preview-url в пределах TTL', () => {
  it('второй рендер не аплоадит файл; протухший TTL — аплоадит заново', async () => {
    vi.useFakeTimers();
    const mkJson = (url) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ url, ttl_ms: 300000 }), arrayBuffer: async () => new ArrayBuffer(2) });
    // 3 мока, не 4: исходник из amo кэшируется src-слоем при первом рендере,
    // поэтому после протухания office-TTL сеть нужна только для POST.
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(2) })
      .mockResolvedValueOnce(mkJson('https://host/preview/u1.xlsx'))
      .mockResolvedValueOnce(mkJson('https://host/preview/u2.xlsx'));
    const file = { href: 'https://x/t.xlsx', name: 't.xlsx' };

    const $b1 = makeBody();
    await officeRender({ $, file, $body: $b1, loader: new Loader() });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect($b1.find('iframe').attr('src')).toContain(encodeURIComponent('u1.xlsx'));

    const $b2 = makeBody();
    await officeRender({ $, file, $body: $b2, loader: new Loader() });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);   // реюз url, без сети
    expect($b2.find('iframe').attr('src')).toContain(encodeURIComponent('u1.xlsx'));

    vi.advanceTimersByTime(300000);                       // TTL (300с) − зазор 60с давно позади
    const $b3 = makeBody();
    await officeRender({ $, file, $body: $b3, loader: new Loader() });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);   // протух — новый POST (исходник из src-кэша)
    expect($b3.find('iframe').attr('src')).toContain(encodeURIComponent('u2.xlsx'));
  });
});

describe('preconnect (этап 3.1)', () => {
  afterEach(() => $('link[rel=preconnect]').remove());

  it('legacy: только конвертер, С crossorigin (CORS-сокет для POST)', () => {
    warmConnections($, 'legacy');
    const $links = $('head link[rel=preconnect]');
    expect($links.length).toBe(1);
    expect($links.attr('href')).toBe('https://nexus-oko.naithon.one');
    expect($links.attr('crossorigin')).toBe('anonymous');
  });

  it('office: конвертер с crossorigin + viewer БЕЗ crossorigin (iframe)', () => {
    warmConnections($, 'office');
    const $links = $('head link[rel=preconnect]');
    expect($links.length).toBe(2);
    const viewer = $links.filter('[href="https://view.officeapps.live.com"]');
    expect(viewer.attr('crossorigin')).toBeUndefined();
  });

  it('повторный вызов не плодит дубли (ре-вставка)', () => {
    warmConnections($, 'office');
    warmConnections($, 'office');
    expect($('head link[rel=preconnect]').length).toBe(2);
  });

  it('локальные kind соединения не греют', () => {
    warmConnections($, 'pdf');
    warmConnections($, 'image');
    expect($('head link[rel=preconnect]').length).toBe(0);
  });
});
