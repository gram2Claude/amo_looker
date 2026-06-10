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
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const PORT        = Number(process.env.PORT || 8094);
const HOST        = process.env.HOST || '0.0.0.0';  // в docker; изоляцию даёт publish на 127.0.0.1 хоста
const TOKEN       = process.env.CONVERTER_TOKEN || '';
const MAX_BYTES   = Number(process.env.MAX_BYTES || 50 * 1024 * 1024);   // 50 МБ
const TIMEOUT_MS  = Number(process.env.CONVERT_TIMEOUT_MS || 30000);     // 30 с
const CONCURRENCY = Number(process.env.CONCURRENCY || 2);                // 2 CPU
const SOFFICE     = process.env.SOFFICE_BIN || 'soffice';
// Origin-allowlist: конкретные кабинеты, НЕ маска *.amocrm.ru.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ||
  'https://venskons78.amocrm.ru,https://toolkeeper.amocrm.ru').split(',').map((s) => s.trim());
// Whitelist форматов, которые шлёт виджет — сужает RCE-поверхность LibreOffice
// (клиент управляет расширением через X-Filename, не даём подсунуть произвольный фильтр импорта).
const ALLOWED_EXT = new Set(['doc', 'xls', 'ppt', 'rtf', 'odt', 'ods', 'odp', 'docx', 'xlsx', 'pptx']);

const limit = pLimit(CONCURRENCY);
const app = express();
app.disable('x-powered-by');

app.use('/convert', express.raw({ type: '*/*', limit: MAX_BYTES }));

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

  const rawName = decodeURIComponent(req.get('X-Filename') || 'file');
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

// Одна конвертация: свой tmp + свой профиль LibreOffice (иначе блокировки при
// конкурентности), kill process tree по таймауту/abort, гарантированный cleanup.
async function convert(buf, ext, isAborted) {
  const dir = await mkdtemp(join(tmpdir(), 'nxconv-'));
  const profile = join(dir, 'profile');
  const input = join(dir, `input.${ext}`);
  const output = join(dir, 'input.pdf');
  try {
    await writeFile(input, buf);
    await runSoffice(input, dir, profile, isAborted);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runSoffice(input, outdir, profile, isAborted) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless', '--norestore', '--nodefault', '--nofirststartwizard', '--nolockcheck',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to', 'pdf', '--outdir', outdir, input
    ];
    // detached → своя process group, чтобы по таймауту/abort убить всё дерево
    const proc = spawn(SOFFICE, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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

app.listen(PORT, HOST, () => {
  console.log(`[nexus-converter] listening on ${HOST}:${PORT}, concurrency=${CONCURRENCY}, max=${MAX_BYTES}B`);
  if (!TOKEN) console.warn('[nexus-converter] WARNING: CONVERTER_TOKEN не задан — все запросы будут 401');
});
