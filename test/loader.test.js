import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Loader, { keyedError } from '../src/loader.js';

describe('keyedError', () => {
  it('навешивает langKey и langParams', () => {
    const e = keyedError('too_large', 'detail', { limit: '10 МБ' });
    expect(e).toBeInstanceOf(Error);
    expect(e.langKey).toBe('too_large');
    expect(e.langParams).toEqual({ limit: '10 МБ' });
  });
});

describe('Loader.fetchBuffer', () => {
  let loader;
  beforeEach(() => { loader = new Loader(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('возвращает buf/bytes/contentType на 200', async () => {
    const data = new TextEncoder().encode('hello');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/plain' },
      arrayBuffer: async () => data.buffer
    });
    const r = await loader.fetchBuffer('https://x/a.txt');
    expect(r.bytes).toBe(5);
    expect(r.contentType).toBe('text/plain');
    expect(globalThis.fetch).toHaveBeenCalledWith('https://x/a.txt', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('fetch_failed на не-200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(loader.fetchBuffer('https://x/a')).rejects.toMatchObject({ langKey: 'fetch_failed' });
  });

  it('too_large при превышении maxBytes', async () => {
    const big = new ArrayBuffer(1024);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, headers: { get: () => '' }, arrayBuffer: async () => big });
    await expect(loader.fetchBuffer('https://x/a', { maxBytes: 512 }))
      .rejects.toMatchObject({ langKey: 'too_large', langParams: expect.any(Object) });
  });

  it('AbortError пробрасывается как есть (не маппится в fetch_failed)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(loader.fetchBuffer('https://x/a')).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Loader: disposed-гейт (ревью E4 — кэш-хиты после закрытия модалки)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('objectURL на disposed-лоадере → AbortError, URL не создаётся', () => {
    const createURL = vi.fn(() => 'blob:leak');
    globalThis.URL.createObjectURL = createURL;
    globalThis.URL.revokeObjectURL = vi.fn();
    const loader = new Loader();
    loader.dispose();
    expect(() => loader.objectURL(new ArrayBuffer(4), 'application/pdf'))
      .toThrowError(expect.objectContaining({ name: 'AbortError' }));
    expect(createURL).not.toHaveBeenCalled();
  });

  it('fetchBuffer/post на disposed-лоадере → AbortError без сети', async () => {
    globalThis.fetch = vi.fn();
    const loader = new Loader();
    loader.dispose();
    await expect(loader.fetchBuffer('https://x/a')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(loader.post('https://x/b', new ArrayBuffer(1), {})).rejects.toMatchObject({ name: 'AbortError' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('Loader.dispose', () => {
  it('отменяет незавершённые загрузки и ревокает objectURL', async () => {
    const revoke = vi.fn();
    const createURL = vi.fn(() => 'blob:fake');
    globalThis.URL.createObjectURL = createURL;
    globalThis.URL.revokeObjectURL = revoke;
    // fetch, который никогда не резолвится, но реагирует на abort
    globalThis.fetch = vi.fn((url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const loader = new Loader();
    const p = loader.fetchBuffer('https://x/a').catch((e) => e);
    loader.objectURL(new ArrayBuffer(4), 'application/pdf');
    loader.dispose();
    const err = await p;
    expect(err.name).toBe('AbortError');
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });
});
