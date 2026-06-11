// Nexus Looker — конвертер legacy-офисных форматов (.doc/.xls/.ppt/.rtf/.odt) → PDF.
// Принимает бинарь файла, прогоняет через LibreOffice headless, отдаёт PDF.
// Запускается в docker на сервере 95.216.44.25, nginx проксирует https://nexus-oko.naithon.one → 127.0.0.1:8094.
//
// Контракт (как ожидает src/renderers/legacy.js):
//   POST /convert
//     Content-Type: application/octet-stream
//     X-Filename: <имя файла с расширением, urlencoded>
//     X-Source-Token: <shared secret>
//     body: <бинарь>
//   → 200 application/pdf | 4xx/5xx + JSON {error}
//   GET /health → 200 {status:"ok"}

import express from 'express';
import pLimit from 'p-limit';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timingSafeEqual, randomUUID } from 'node:crypto';

const PORT        = Number(process.env.PORT || 8094);
const HOST        = process.env.HOST || '0.0.0.0';  // в docker; изоляцию даёт publish на 127.0.0.1 хоста
const TOKEN       = process.env.CONVERTER_TOKEN || '';
const MAX_BYTES   = Number(process.env.MAX_BYTES || 50 * 1024 * 1024);   // 50 МБ
const TIMEOUT_MS  = Number(process.env.CONVERT_TIMEOUT_MS || 30000);     // 30 с
const CONCURRENCY = Number(process.env.CONCURRENCY || 2);                // 2 CPU
const SOFFICE     = process.env.SOFFICE_BIN || 'soffice';
// --- Office Online preview: временный публичный хостинг файла, откуда его
// скачивает Microsoft Office viewer. Файл уходит к MS — осознанное решение.
const PREVIEW_DIR      = process.env.PREVIEW_DIR || '/preview';
const PREVIEW_BASE_URL = process.env.PREVIEW_BASE_URL || 'https://nexus-oko.naithon.one';
const PREVIEW_TTL_MS   = Number(process.env.PREVIEW_TTL_MS || 15 * 60 * 1000);   // 15 мин
const PREVIEW_MAX_BYTES= Number(process.env.PREVIEW_MAX_BYTES || 15 * 1024 * 1024); // лимит Office viewer
// Office viewer открывает эти форматы напрямую; csv → конвертируем в xlsx.
const PREVIEW_EXT = new Set(['xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt']);
// Origin-allowlist: конкретные кабинеты, НЕ маска *.amocrm.ru.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ||
  'https://venskons78.amocrm.ru,https://toolkeeper.amocrm.ru').split(',').map((s) => s.trim());
// Whitelist форматов, которые шлёт виджет — сужает RCE-поверхность LibreOffice
// (клиент управляет расширением через X-Filename, не даём подсунуть произвольный фильтр импорта).
const ALLOWED_EXT = new Set(['doc', 'xls', 'ppt', 'rtf', 'odt', 'ods', 'odp', 'docx', 'xlsx', 'pptx']);

const limit = pLimit(CONCURRENCY);
const app = express();
app.disable('x-powered-by');

// Токен-гейт ДО body-parser: без валидного токена не буферизуем тело (до 50/15 МБ
// в RAM на запрос) — закрывает дешёвый DoS по памяти. Preflight (OPTIONS) без токена — пропускаем.
function requireToken(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  if (!tokenOk(req.get('X-Source-Token'))) { applyCors(req, res); return res.status(401).json({ error: 'unauthorized' }); }
  next();
}

app.use('/convert', requireToken, express.raw({ type: '*/*', limit: MAX_BYTES }));

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-Source-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// Константное по времени сравнение токена (без timing-leak).
function tokenOk(got) {
  if (!TOKEN || !got) return false;
  const a = Buffer.from(String(got));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Preflight приходит БЕЗ токена — отвечаем 204 без авторизации.
app.options('/convert', (req, res) => { applyCors(req, res); res.sendStatus(204); });

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/convert', async (req, res) => {
  applyCors(req, res);

  if (!tokenOk(req.get('X-Source-Token'))) return res.status(401).json({ error: 'unauthorized' });

  const body = req.body;
  if (!body || !body.length) return res.status(400).json({ error: 'empty body' });
  if (body.length > MAX_BYTES) return res.status(413).json({ error: 'file too large' });

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

// --- Office Online preview: принять файл, временно опубликовать, вернуть URL ---
// requireToken ДО raw: без токена тело не буферизуется (защита RAM от DoS).
app.use('/preview-host', requireToken, express.raw({ type: '*/*', limit: PREVIEW_MAX_BYTES }));
app.options('/preview-host', (req, res) => { applyCors(req, res); res.sendStatus(204); });

app.post('/preview-host', async (req, res) => {
  applyCors(req, res);
  if (!tokenOk(req.get('X-Source-Token'))) return res.status(401).json({ error: 'unauthorized' });
  const body = req.body;
  if (!body || !body.length) return res.status(400).json({ error: 'empty body' });
  if (body.length > PREVIEW_MAX_BYTES) return res.status(413).json({ error: 'file too large for preview' });

  let rawName;
  try { rawName = decodeURIComponent(req.get('X-Filename') || 'file'); }
  catch (e) { return res.status(400).json({ error: 'bad filename' }); }
  let ext = (rawName.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  if (ext !== 'csv' && !PREVIEW_EXT.has(ext)) return res.status(415).json({ error: 'unsupported type' });

  let aborted = false;
  req.on('aborted', () => { aborted = true; });
  res.on('close', () => { aborted = true; });

  try {
    // Всю тяжёлую работу (csv→xlsx конвертацию И запись на диск) гоним через тот же
    // p-limit(CONCURRENCY), что и /convert — иначе всплеск запросов с валидным токеном
    // (а он есть у каждого клиента) положил бы диск/IO неограниченным параллелизмом.
    const result = await limit(async () => {
      if (aborted) throw new Error('aborted');
      let data = body, outExt = ext;
      if (ext === 'csv') {              // Office viewer не открывает csv → конвертируем в xlsx
        data = await convert(body, 'csv', () => aborted, 'xlsx');
        outExt = 'xlsx';
      }
      await mkdir(PREVIEW_DIR, { recursive: true });
      const name = randomUUID() + '.' + outExt;   // непредсказуемое имя (uuid v4); TTL чистит
      await writeFile(join(PREVIEW_DIR, name), data);
      return name;
    });
    if (aborted) return;
    res.json({ url: PREVIEW_BASE_URL + '/preview/' + result, ttl_ms: PREVIEW_TTL_MS });
  } catch (err) {
    if (aborted) return;
    console.error('[preview-host] failed:', String(err && err.code || err && err.message || 'error'));
    res.status(502).json({ error: 'preview hosting failed' });
  }
});

// TTL-очистка временных preview-файлов (ушедших к Microsoft) — каждую минуту
// (окно экспозиции = TTL; чаще уборка → меньше «хвост» при всплеске загрузок).
setInterval(async () => {
  try {
    const now = Date.now();
    const files = await readdir(PREVIEW_DIR).catch(() => []);
    for (const f of files) {
      const p = join(PREVIEW_DIR, f);
      const s = await stat(p).catch(() => null);
      if (s && (now - s.mtimeMs) > PREVIEW_TTL_MS) await unlink(p).catch(() => {});
    }
  } catch (e) { /* noop */ }
}, 60 * 1000);

// Одна конвертация: свой tmp + свой профиль LibreOffice (иначе блокировки при
// конкурентности), kill process tree по таймауту/abort, гарантированный cleanup.
// target — целевой формат ('pdf' для просмотра legacy; 'xlsx' для csv→Office viewer).
async function convert(buf, ext, isAborted, target = 'pdf') {
  const dir = await mkdtemp(join(tmpdir(), 'nxconv-'));
  const profile = join(dir, 'profile');
  const input = join(dir, `input.${ext}`);
  const output = join(dir, `input.${target}`);
  try {
    await writeFile(input, buf);
    await runSoffice(input, dir, profile, isAborted, target);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runSoffice(input, outdir, profile, isAborted, target = 'pdf') {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless', '--norestore', '--nodefault', '--nofirststartwizard', '--nolockcheck',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to', target, '--outdir', outdir, input
    ];
    // detached → своя process group, чтобы по таймауту/abort убить всё дерево
    // stdio полностью ignore: не читаем pipe (иначе при полном буфере soffice
    // завис бы до таймаута, занимая слот) и не логируем содержимое/имя файла.
    const proc = spawn(SOFFICE, args, { stdio: 'ignore', detached: true });
    let done = false;
    const killTree = () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) { try { proc.kill('SIGKILL'); } catch (e2) {} } };
    const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); clearInterval(abortPoll); fn(arg); };

    const timer = setTimeout(() => { killTree(); finish(reject, new Error('timeout')); }, TIMEOUT_MS);
    // если клиент отвалился во время конвертации — убиваем процесс
    const abortPoll = setInterval(() => { if (isAborted && isAborted()) { killTree(); finish(reject, new Error('client aborted')); } }, 1000);

    proc.on('error', (e) => finish(reject, e));
    proc.on('close', (code) => finish(code === 0 ? resolve : reject, code === 0 ? undefined : new Error('soffice exit ' + code)));
  });
}

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

app.listen(PORT, HOST, () => {
  console.log(`[nexus-converter] listening on ${HOST}:${PORT}, concurrency=${CONCURRENCY}, max=${MAX_BYTES}B`);
  if (!TOKEN) console.warn('[nexus-converter] WARNING: CONVERTER_TOKEN не задан — все запросы будут 401');
});
