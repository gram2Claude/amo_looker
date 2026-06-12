// Nexus Looker — конвертер: entry point (Docker, за nginx https://nexus-oko.naithon.one).
//
// Контракты:
//   POST /convert       octet-stream + X-Filename → application/pdf  (legacy → PDF)
//   POST /preview-host  octet-stream + X-Filename → {url, ttl_ms}    (Office viewer)
//   GET  /health        → {status:"ok"}
// Авторизация: Origin кабинета amoCRM/Kommo ИЛИ X-Source-Token (служебный).
// Вся логика — converter/app.js (фабрика, тестируется supertest'ом из корня).

import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from './app.js';
import { convert as coldConvert } from './convert.js';
import { createWarmPool, makeHybridConvert } from './warm.js';

const PORT = Number(process.env.PORT || 8094);
const HOST = process.env.HOST || '0.0.0.0';  // в docker; изоляцию даёт publish на 127.0.0.1 хоста

// CONVERT_MODE=warm — прогретый пул unoserver (спека 04, этап 1.1);
// cold — старый per-request spawn (откат одним env'ом, образ не пересобирать).
//
// Гибрид внутри warm-режима (замер 12.06): UNO-конвертация ТЯЖЁЛЫХ файлов на
// ~25% медленнее прямого soffice (23с против 18с на 2.8МБ xlsx), а warm-выигрыш
// (~1.5с cold-start) на таких джобах — копейки. Файлы > WARM_MAX_BYTES идут
// холодным путём: быстрее сами по себе И не занимают тёплых воркеров, которые
// нужны частым small-файлам. p-limit(CONCURRENCY) в app.js капит суммарную
// конкурентность обоих путей.
const MODE = (process.env.CONVERT_MODE || 'cold').toLowerCase();
const WARM_MAX_BYTES = Number(process.env.WARM_MAX_BYTES || 2 * 1024 * 1024);
const pool = MODE === 'warm' ? createWarmPool() : null;
const convert = pool ? makeHybridConvert(pool.convert, coldConvert, WARM_MAX_BYTES) : coldConvert;

const { app, cfg } = createApp({ convert });

process.on('SIGTERM', () => { if (pool) pool.shutdown(); process.exit(0); });
process.on('SIGINT',  () => { if (pool) pool.shutdown(); process.exit(0); });

// TTL-очистка временных preview-файлов (ушедших к Microsoft) — каждую минуту
// (окно экспозиции = TTL; чаще уборка → меньше «хвост» при всплеске загрузок).
setInterval(async () => {
  try {
    const now = Date.now();
    const files = await readdir(cfg.PREVIEW_DIR).catch(() => []);
    for (const f of files) {
      const p = join(cfg.PREVIEW_DIR, f);
      const s = await stat(p).catch(() => null);
      if (s && (now - s.mtimeMs) > cfg.PREVIEW_TTL_MS) await unlink(p).catch(() => {});
    }
  } catch (e) { /* noop */ }
}, 60 * 1000);

app.listen(PORT, HOST, () => {
  console.log(`[nexus-converter] listening on ${HOST}:${PORT}, mode=${MODE}, concurrency=${cfg.CONCURRENCY}, max=${cfg.MAX_BYTES}B, origin=${cfg.ALLOWED_ORIGIN_PATTERN}`);
  if (!cfg.TOKEN) console.warn('[nexus-converter] CONVERTER_TOKEN не задан — служебный токен-путь отключён (Origin-путь работает)');
});
