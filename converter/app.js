// Nexus Looker — Express-приложение конвертера (фабрика, DI convert для тестов).
//
// Публичная схема авторизации (v0.2, для маркетплейса):
//   запрос пропускается, если Origin — кабинет amoCRM/Kommo (однометочный
//   поддомен, паттерн ALLOWED_ORIGIN_PATTERN), ЛИБО валидный X-Source-Token
//   (служебный путь: curl/мониторинг; браузерный виджет токен не шлёт).
// Origin подделывается не-браузерным клиентом — это принятый риск
// (public_integration/01_spec.md §8); реальная защита — эшелон лимитов:
//   1) MAX_INFLIGHT — глобальный кап одновременных запросов с телом (503),
//      стоит ДО express.raw: неавторизованное/лишнее тело не буферизуется;
//   2) rate-limit окно 60с по ДВУМ ключам — origin И ip (ротация поддоменов
//      не обходит ip-ключ); map ограничена MAX_RATE_KEYS, окно сбрасывается
//      целиком (компактное состояние, без утечек);
//   3) nginx limit_req / client_max_body_size — внешний эшелон.

import express from 'express';
import pLimit from 'p-limit';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Whitelist форматов, которые шлёт виджет — сужает RCE-поверхность LibreOffice
// (клиент управляет расширением через X-Filename, не даём подсунуть произвольный фильтр импорта).
const ALLOWED_EXT = new Set(['doc', 'xls', 'ppt', 'rtf', 'odt', 'ods', 'odp', 'docx', 'xlsx', 'pptx']);
// Office viewer открывает эти форматы напрямую; csv → конвертируем в xlsx.
const PREVIEW_EXT = new Set(['xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt']);

export function createApp({ convert, config = {} } = {}) {
  if (typeof convert !== 'function') throw new Error('createApp: convert обязателен');

  const cfg = {
    TOKEN:            process.env.CONVERTER_TOKEN || '',
    MAX_BYTES:        Number(process.env.MAX_BYTES || 50 * 1024 * 1024),
    CONCURRENCY:      Number(process.env.CONCURRENCY || 2),
    PREVIEW_DIR:      process.env.PREVIEW_DIR || '/preview',
    PREVIEW_BASE_URL: process.env.PREVIEW_BASE_URL || 'https://nexus-oko.naithon.one',
    PREVIEW_TTL_MS:   Number(process.env.PREVIEW_TTL_MS || 5 * 60 * 1000),   // 5 мин (окно экспозиции)
    PREVIEW_MAX_BYTES: Number(process.env.PREVIEW_MAX_BYTES || 15 * 1024 * 1024),
    // Однометочный поддомен кабинета: без вложенных уровней, без порта, только https.
    ALLOWED_ORIGIN_PATTERN: process.env.ALLOWED_ORIGIN_PATTERN ||
      '^https://[a-z0-9][a-z0-9-]{0,62}\\.(amocrm\\.(ru|com)|kommo\\.com)$',
    RATE_LIMIT_PER_MIN:    Number(process.env.RATE_LIMIT_PER_MIN || 30),
    RATE_LIMIT_PER_MIN_IP: Number(process.env.RATE_LIMIT_PER_MIN_IP || 60),
    RATE_LIMIT_PREVIEW_PER_MIN: Number(process.env.RATE_LIMIT_PREVIEW_PER_MIN || 0) || null, // null → общий лимит
    MAX_RATE_KEYS: Number(process.env.MAX_RATE_KEYS || 5000),
    MAX_INFLIGHT:  Number(process.env.MAX_INFLIGHT || 16),
    // Кап глубины очереди p-limit: тело уже буферизовано (до 50/15 МБ), а слот
    // inflight освобождается на close сокета — оборванные запросы иначе копили бы
    // body-буферы в ожидании soffice. Отклоняем 503 до постановки в очередь.
    MAX_QUEUE: Number(process.env.MAX_QUEUE || 24),
    ...config
  };
  const originRe = new RegExp(cfg.ALLOWED_ORIGIN_PATTERN, 'i');
  const limit = pLimit(cfg.CONCURRENCY);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);   // за nginx на loopback

  function originOk(origin) {
    return typeof origin === 'string' && originRe.test(origin);
  }

  // Константное по времени сравнение токена (без timing-leak).
  function tokenOk(got) {
    if (!cfg.TOKEN || !got) return false;
    const a = Buffer.from(String(got));
    const b = Buffer.from(cfg.TOKEN);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ACAO отражает только Origin, прошедший паттерн. Токен в CORS-заголовках
  // не нужен — браузерный клиент его не шлёт.
  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (originOk(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  // Auth-gate ДО body-parser: без авторизации не буферизуем тело (до 50/15 МБ
  // в RAM на запрос). Preflight (OPTIONS) — пропускаем (CORS-ответ без тела).
  function requireAuth(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (originOk(origin)) { req.auth = { via: 'origin', origin }; return next(); }
    if (tokenOk(req.get('X-Source-Token'))) { req.auth = { via: 'token' }; return next(); }
    applyCors(req, res);
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Фиксированное окно 60 с: одна Map на все ключи, сброс целиком по границе
  // окна (компактно, без утечек). Переполнение map после очистки = глобальная
  // перегрузка → отказ новым ключам.
  let windowStart = Date.now();
  let counts = new Map();
  function take(key, max) {
    const now = Date.now();
    if (now - windowStart >= 60000) { windowStart = now; counts = new Map(); }
    const cur = counts.get(key);
    if (cur === undefined && counts.size >= cfg.MAX_RATE_KEYS) return false;
    const n = (cur || 0) + 1;
    counts.set(key, n);
    return n <= max;
  }

  // ip берём из X-Real-IP, который наш nginx ВСЕГДА перезаписывает на $remote_addr
  // (proxy_set_header X-Real-IP $remote_addr) — клиентский заголовок не доверяется.
  // Контейнер опубликован только на 127.0.0.1, прямого доступа в обход nginx нет.
  // Фолбэк req.ip (с trust proxy) — на случай иного фронта.
  function makeRateLimit({ preview } = {}) {
    return function rateLimit(req, res, next) {
      if (req.method === 'OPTIONS') return next();   // preflight не расходует лимит
      const ip = req.headers['x-real-ip'] || req.ip || 'unknown';
      let ok = take('ip:' + ip, cfg.RATE_LIMIT_PER_MIN_IP);
      if (ok && req.auth && req.auth.via === 'origin') {
        ok = take('o:' + req.auth.origin, cfg.RATE_LIMIT_PER_MIN);
        if (ok && preview && cfg.RATE_LIMIT_PREVIEW_PER_MIN) {
          ok = take('po:' + req.auth.origin, cfg.RATE_LIMIT_PREVIEW_PER_MIN);
        }
      }
      if (!ok) { applyCors(req, res); return res.status(429).json({ error: 'rate limited' }); }
      next();
    };
  }

  // Глобальный кап одновременных запросов с телом: N×50МБ параллельных
  // буферизаций не положат RAM. Стоит ДО express.raw.
  let inflight = 0;
  function inflightGuard(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    if (inflight >= cfg.MAX_INFLIGHT) { applyCors(req, res); return res.status(503).json({ error: 'busy' }); }
    inflight++;
    let released = false;
    const release = () => { if (!released) { released = true; inflight--; } };
    res.on('finish', release);
    res.on('close', release);
    next();
  }

  // Preflight отвечаем ДО body-parser. Иначе express.raw(type:'*/*') прочитал бы
  // тело и для OPTIONS — а OPTIONS пропускается всеми гейтами (auth/лимиты/inflight),
  // что дало бы анонимную буферизацию до MAX_BYTES в обход кап-лимитов (RAM-DoS).
  app.options('/convert', (req, res) => { applyCors(req, res); res.sendStatus(204); });
  app.options('/preview-host', (req, res) => { applyCors(req, res); res.sendStatus(204); });

  // type-предикат: тело не парсим для OPTIONS даже если запрос как-то дошёл сюда
  // (defense-in-depth к app.options выше).
  const notPreflight = (req) => req.method !== 'OPTIONS';
  app.use('/convert', requireAuth, makeRateLimit(), inflightGuard, express.raw({ type: notPreflight, limit: cfg.MAX_BYTES }));
  app.use('/preview-host', requireAuth, makeRateLimit({ preview: true }), inflightGuard, express.raw({ type: notPreflight, limit: cfg.PREVIEW_MAX_BYTES }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/convert', async (req, res) => {
    applyCors(req, res);
    // defense-in-depth: хендлер не работает без пройденного requireAuth
    if (!req.auth) return res.status(401).json({ error: 'unauthorized' });

    const body = req.body;
    if (!body || !body.length) return res.status(400).json({ error: 'empty body' });
    if (body.length > cfg.MAX_BYTES) return res.status(413).json({ error: 'file too large' });

    let rawName;
    try { rawName = decodeURIComponent(req.get('X-Filename') || 'file'); }
    catch (e) { return res.status(400).json({ error: 'bad filename' }); }   // битый %xx в заголовке
    const ext = (rawName.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return res.status(415).json({ error: 'unsupported type' });

    // Клиент закрыл модалку → loader отменил POST. Не запускаем soffice впустую
    // и не пишем в мёртвый сокет (иначе очередь забьётся мертвыми конвертациями).
    let aborted = false;
    req.on('aborted', () => { aborted = true; });
    res.on('close', () => { aborted = true; });

    // Очередь p-limit переполнена → не копим body-буфер в ожидании, отвечаем сразу.
    if (limit.pendingCount >= cfg.MAX_QUEUE) return res.status(503).json({ error: 'busy' });

    try {
      const pdf = await limit(() => {
        if (aborted) throw new Error('client aborted');
        return convert(body, ext, () => aborted);
      });
      if (aborted) return;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', pdf.length);
      res.end(pdf);
    } catch (err) {
      if (aborted) return;
      // не логируем содержимое/имя файла — только техническую причину (без stderr LibreOffice)
      console.error('[convert] failed:', String(err && err.code || err && err.message || 'error'));
      res.status(502).json({ error: 'conversion failed' });
    }
  });

  // Office Online preview: принять файл, временно опубликовать, вернуть URL.
  app.post('/preview-host', async (req, res) => {
    applyCors(req, res);
    if (!req.auth) return res.status(401).json({ error: 'unauthorized' });

    const body = req.body;
    if (!body || !body.length) return res.status(400).json({ error: 'empty body' });
    if (body.length > cfg.PREVIEW_MAX_BYTES) return res.status(413).json({ error: 'file too large for preview' });

    let rawName;
    try { rawName = decodeURIComponent(req.get('X-Filename') || 'file'); }
    catch (e) { return res.status(400).json({ error: 'bad filename' }); }
    let ext = (rawName.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
    if (ext !== 'csv' && !PREVIEW_EXT.has(ext)) return res.status(415).json({ error: 'unsupported type' });

    let aborted = false;
    req.on('aborted', () => { aborted = true; });
    res.on('close', () => { aborted = true; });

    if (limit.pendingCount >= cfg.MAX_QUEUE) return res.status(503).json({ error: 'busy' });

    try {
      // Всю тяжёлую работу (csv→xlsx конвертацию И запись на диск) гоним через тот же
      // p-limit(CONCURRENCY), что и /convert — всплеск аплоадов не положит диск/IO.
      const result = await limit(async () => {
        if (aborted) throw new Error('aborted');
        let data = body, outExt = ext;
        if (ext === 'csv') {              // Office viewer не открывает csv → конвертируем в xlsx
          data = await convert(body, 'csv', () => aborted, 'xlsx');
          outExt = 'xlsx';
        }
        await mkdir(cfg.PREVIEW_DIR, { recursive: true });
        const name = randomUUID() + '.' + outExt;   // непредсказуемое имя (uuid v4); TTL чистит
        await writeFile(join(cfg.PREVIEW_DIR, name), data);
        return name;
      });
      if (aborted) return;
      res.json({ url: cfg.PREVIEW_BASE_URL + '/preview/' + result, ttl_ms: cfg.PREVIEW_TTL_MS });
    } catch (err) {
      if (aborted) return;
      console.error('[preview-host] failed:', String(err && err.code || err && err.message || 'error'));
      res.status(502).json({ error: 'preview hosting failed' });
    }
  });

  // Ошибки body-парсера (напр. 413 от express.raw при превышении limit) случаются
  // ДО хендлера — без этого middleware ответ ушёл бы без CORS и браузер увидел бы
  // opaque/CORS-ошибку вместо нормального 413.
  app.use((err, req, res, next) => {
    applyCors(req, res);
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({ error: 'file too large' });
    }
    return res.status(400).json({ error: 'bad request' });
  });

  return { app, cfg };
}
