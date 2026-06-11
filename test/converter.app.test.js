// @vitest-environment node
// Тесты auth/лимитов/CORS конвертера (converter/app.js) — supertest + DI-мок convert.
// LibreOffice здесь не нужен: convert подменяется моком.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../converter/app.js';

const OK_ORIGIN = 'https://somecabinet.amocrm.ru';
const PDF = Buffer.from('%PDF-fake');

function makeApp(config = {}, convertImpl) {
  const { app } = createApp({
    convert: convertImpl || (async () => PDF),
    config: {
      TOKEN: 'secret-token',
      PREVIEW_DIR: mkdtempSync(join(tmpdir(), 'nxprev-')),
      PREVIEW_BASE_URL: 'https://host.example',
      RATE_LIMIT_PER_MIN: 100,
      RATE_LIMIT_PER_MIN_IP: 100,
      MAX_INFLIGHT: 16,
      ...config
    }
  });
  return app;
}

function post(app, path = '/convert') {
  return request(app).post(path)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Filename', 'test.doc');
}

describe('requireAuth: Origin-паттерн', () => {
  let app;
  beforeEach(() => { app = makeApp(); });

  it.each([
    'https://somecabinet.amocrm.ru',
    'https://x.amocrm.com',
    'https://my-account9.kommo.com'
  ])('валидный Origin %s без токена → 200', async (origin) => {
    const r = await post(app).set('Origin', origin).send(Buffer.from('x'));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.headers['access-control-allow-origin']).toBe(origin);
  });

  it.each([
    ['вложенный поддомен', 'https://a.b.amocrm.ru'],
    ['чужой домен', 'https://evil.com'],
    ['суффикс-фейк', 'https://amocrm.ru.evil.com'],
    ['без точки перед amocrm', 'https://xamocrm.ru'],
    ['http вместо https', 'http://x.amocrm.ru'],
    ['с портом', 'https://x.amocrm.ru:8443'],
    ['голый apex', 'https://amocrm.ru']
  ])('невалидный Origin (%s) без токена → 401 и без ACAO', async (_label, origin) => {
    const r = await post(app).set('Origin', origin).send(Buffer.from('x'));
    expect(r.status).toBe(401);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('без Origin и без токена → 401', async () => {
    const r = await post(app).send(Buffer.from('x'));
    expect(r.status).toBe(401);
  });

  it('валидный токен без Origin → 200 (служебный путь)', async () => {
    const r = await post(app).set('X-Source-Token', 'secret-token').send(Buffer.from('x'));
    expect(r.status).toBe(200);
  });

  it('невалидный токен → 401', async () => {
    const r = await post(app).set('X-Source-Token', 'wrong').send(Buffer.from('x'));
    expect(r.status).toBe(401);
  });

  it('auth ДО буферизации: тело больше лимита без auth → 401, а не 413', async () => {
    const app2 = makeApp({ MAX_BYTES: 1024 });
    const r = await post(app2).send(Buffer.alloc(8 * 1024));
    expect(r.status).toBe(401);
  });
});

describe('rate-limit', () => {
  it('per-origin: превышение → 429', async () => {
    const app = makeApp({ RATE_LIMIT_PER_MIN: 2, RATE_LIMIT_PER_MIN_IP: 100 });
    for (let i = 0; i < 2; i++) {
      const r = await post(app).set('Origin', OK_ORIGIN).send(Buffer.from('x'));
      expect(r.status).toBe(200);
    }
    const r3 = await post(app).set('Origin', OK_ORIGIN).send(Buffer.from('x'));
    expect(r3.status).toBe(429);
  });

  it('per-ip ловит ротацию поддоменов (разные Origin, один ip)', async () => {
    const app = makeApp({ RATE_LIMIT_PER_MIN: 100, RATE_LIMIT_PER_MIN_IP: 2 });
    for (let i = 0; i < 2; i++) {
      const r = await post(app).set('Origin', `https://rotated${i}.amocrm.ru`)
        .set('X-Real-IP', '10.0.0.7').send(Buffer.from('x'));
      expect(r.status).toBe(200);
    }
    const r3 = await post(app).set('Origin', 'https://rotated9.amocrm.ru')
      .set('X-Real-IP', '10.0.0.7').send(Buffer.from('x'));
    expect(r3.status).toBe(429);
  });

  it('OPTIONS preflight не расходует лимит и отвечает 204 с ACAO', async () => {
    const app = makeApp({ RATE_LIMIT_PER_MIN: 1, RATE_LIMIT_PER_MIN_IP: 1 });
    for (let i = 0; i < 5; i++) {
      const r = await request(app).options('/convert').set('Origin', OK_ORIGIN);
      expect(r.status).toBe(204);
      expect(r.headers['access-control-allow-origin']).toBe(OK_ORIGIN);
    }
    const r = await post(app).set('Origin', OK_ORIGIN).send(Buffer.from('x'));
    expect(r.status).toBe(200);
  });

  it('переполнение map ключей → 429 новым ключам (глобальная перегрузка)', async () => {
    const app = makeApp({ MAX_RATE_KEYS: 2, RATE_LIMIT_PER_MIN: 100, RATE_LIMIT_PER_MIN_IP: 100 });
    // первый запрос занимает ключи ip: и o: (map = 2 = кап)
    const r1 = await post(app).set('Origin', OK_ORIGIN).set('X-Real-IP', '10.0.0.1').send(Buffer.from('x'));
    expect(r1.status).toBe(200);
    // новый ip — новый ключ не помещается → 429
    const r2 = await post(app).set('Origin', OK_ORIGIN).set('X-Real-IP', '10.0.0.2').send(Buffer.from('x'));
    expect(r2.status).toBe(429);
  });
});

describe('inflight-кап (защита RAM до express.raw)', () => {
  it('сверх MAX_INFLIGHT одновременных запросов → 503', async () => {
    let release;
    const gate = new Promise((res) => { release = res; });
    const app = makeApp({ MAX_INFLIGHT: 2 }, async () => { await gate; return PDF; });

    // supertest ленивый: запрос уходит только на .then() — форсируем старт
    const p1 = post(app).set('Origin', OK_ORIGIN).send(Buffer.from('x')).then((r) => r);
    const p2 = post(app).set('Origin', OK_ORIGIN).send(Buffer.from('x')).then((r) => r);
    // даём двум первым дойти до express.raw (inflight = 2)
    await new Promise((r) => setTimeout(r, 150));
    const r3 = await post(app).set('Origin', OK_ORIGIN).send(Buffer.from('x'));
    expect(r3.status).toBe(503);

    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});

describe('валидация входа', () => {
  let app;
  beforeEach(() => { app = makeApp(); });

  it('неподдерживаемое расширение → 415', async () => {
    const r = await post(app).set('Origin', OK_ORIGIN).set('X-Filename', 'evil.exe').send(Buffer.from('x'));
    expect(r.status).toBe(415);
  });

  it('битый %xx в X-Filename → 400', async () => {
    const r = await post(app).set('Origin', OK_ORIGIN).set('X-Filename', '%zz.doc').send(Buffer.from('x'));
    expect(r.status).toBe(400);
  });

  it('пустое тело → 400', async () => {
    const r = await post(app).set('Origin', OK_ORIGIN).send();
    expect(r.status).toBe(400);
  });

  it('413 от body-парсера приходит С CORS-заголовками', async () => {
    const app2 = makeApp({ MAX_BYTES: 1024 });
    const r = await post(app2).set('Origin', OK_ORIGIN).send(Buffer.alloc(8 * 1024));
    expect(r.status).toBe(413);
    expect(r.headers['access-control-allow-origin']).toBe(OK_ORIGIN);
    expect(r.body).toEqual({ error: 'file too large' });
  });
});

describe('/preview-host', () => {
  it('xlsx публикуется как есть: 200 + uuid-url', async () => {
    const app = makeApp();
    const r = await post(app, '/preview-host').set('Origin', OK_ORIGIN)
      .set('X-Filename', 'table.xlsx').send(Buffer.from('xlsx-bytes'));
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/host\.example\/preview\/[0-9a-f-]{36}\.xlsx$/);
    expect(r.body.ttl_ms).toBeGreaterThan(0);
  });

  it('csv конвертируется в xlsx перед публикацией', async () => {
    let calledWith = null;
    const app = makeApp({}, async (buf, ext, isAborted, target) => {
      calledWith = { ext, target };
      return Buffer.from('converted-xlsx');
    });
    const r = await post(app, '/preview-host').set('Origin', OK_ORIGIN)
      .set('X-Filename', 'data.csv').send(Buffer.from('a;b;c'));
    expect(r.status).toBe(200);
    expect(calledWith).toEqual({ ext: 'csv', target: 'xlsx' });
    expect(r.body.url).toMatch(/\.xlsx$/);
  });

  it('неподдерживаемый формат → 415; без auth → 401', async () => {
    const app = makeApp();
    const r1 = await post(app, '/preview-host').set('Origin', OK_ORIGIN)
      .set('X-Filename', 'img.svg').send(Buffer.from('x'));
    expect(r1.status).toBe(415);
    const r2 = await post(app, '/preview-host').set('X-Filename', 'a.xlsx').send(Buffer.from('x'));
    expect(r2.status).toBe(401);
  });
});

describe('/health', () => {
  it('открыт без авторизации', async () => {
    const r = await request(makeApp()).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });
});
