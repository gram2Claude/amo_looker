// Прогретый пул LibreOffice через unoserver (спека 01_specs/04_geo_performance_spec.md, этап 1.1).
//
// Холодный старт soffice на каждый запрос (convert.js) стоит секунды CPU; здесь
// N долгоживущих unoserver-воркеров (каждый со СВОИМ профилем LO и портом), а
// конвертация — короткий клиентский процесс unoconvert к свободному воркеру.
//
// Инварианты (зафиксированы спекой и ревью, не ослаблять):
//  - размер пула = CONCURRENCY (p-limit в app.js не пустит больше параллельных job);
//  - per-job tmp-каталог, cleanup в finally;
//  - жёсткий таймаут: kill unoconvert + KILL+RESTART воркера (мог зависнуть LO);
//  - abort клиента воркера НЕ убивает: job дорабатывает, результат выбрасывает
//    app.js (потолок потерь 30с CPU). Иначе open/close-щёлканье устраивает
//    restart-шторм и обнуляет тёплую ёмкость (находка ревью спеки);
//  - имена файлов/содержимое НЕ логируются.
//
// Контракт convert(buf, ext, isAborted, target) идентичен convert.js — server.js
// выбирает реализацию по CONVERT_MODE=warm|cold (cold = откат одним env'ом).

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TIMEOUT_MS      = Number(process.env.CONVERT_TIMEOUT_MS || 30000);
const ACQUIRE_TIMEOUT = Number(process.env.POOL_ACQUIRE_TIMEOUT_MS || 10000);
const BOOT_GRACE_MS   = Number(process.env.POOL_BOOT_GRACE_MS || 3000);

export function createWarmPool({
  poolSize = Number(process.env.CONCURRENCY || 2),
  basePort = Number(process.env.UNOSERVER_BASE_PORT || 2003),
  unoserverBin = process.env.UNOSERVER_BIN || 'unoserver',
  unoconvertBin = process.env.UNOCONVERT_BIN || 'unoconvert',
  timeoutMs = TIMEOUT_MS,
  acquireTimeoutMs = ACQUIRE_TIMEOUT,
  bootGraceMs = BOOT_GRACE_MS,
  respawnDelayMs = 1000,
  _spawn = spawn,            // DI для тестов
  log = (line) => console.log(line)
} = {}) {

  // --- воркеры -------------------------------------------------------------
  // state: 'booting' | 'ready' | 'dead'; busy — занят текущим job'ом.
  const workers = [];

  function bootWorker(w) {
    w.state = 'booting';
    w.proc = _spawn(unoserverBin, [
      '--port', String(w.port),
      '--interface', '127.0.0.1',
      '--user-installation', w.profile
    ], { stdio: 'ignore', detached: true });
    w.proc.on('error', () => { w.state = 'dead'; scheduleRespawn(w); });
    w.proc.on('exit', () => { if (!w.killing) { w.state = 'dead'; scheduleRespawn(w); } });
    // unoserver поднимает LO за секунды; готовность не проверяем RPC'ом —
    // первый unoconvert сам дождётся/упадёт, таймаут и restart нас страхуют.
    setTimeout(() => { if (w.state === 'booting') { w.state = 'ready'; pump(); } }, bootGraceMs).unref();
  }

  function killWorker(w) {
    w.killing = true;
    try { process.kill(-w.proc.pid, 'SIGKILL'); } catch (e) { try { w.proc.kill('SIGKILL'); } catch (e2) {} }
    w.state = 'dead';
    w.killing = false;
    scheduleRespawn(w);
  }

  function scheduleRespawn(w) {
    if (w.respawnTimer) return;
    w.respawnTimer = setTimeout(() => { w.respawnTimer = null; bootWorker(w); }, respawnDelayMs);
    w.respawnTimer.unref();
  }

  for (let i = 0; i < poolSize; i++) {
    // ВАЖНО: --user-installation ждёт ОБЫЧНЫЙ путь (unoserver сам делает Path().as_uri();
    // передача file:// URI роняет его с "relative path can't be expressed as a file URI").
    const w = { id: i, port: basePort + i, profile: `/tmp/uno-profile-${i}`, busy: false, state: 'dead', proc: null, respawnTimer: null, killing: false };
    workers.push(w);
    bootWorker(w);
  }

  // --- очередь на свободного воркера ---------------------------------------
  const waiters = [];
  function pump() {
    while (waiters.length) {
      const w = workers.find((x) => x.state === 'ready' && !x.busy);
      if (!w) return;
      w.busy = true;
      const { resolve, timer } = waiters.shift();
      clearTimeout(timer);
      resolve(w);
    }
  }
  function acquire() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((x) => x.resolve === resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error('pool unavailable'));
      }, acquireTimeoutMs);
      timer.unref();
      waiters.push({ resolve, timer });
      pump();
    });
  }
  function release(w) { w.busy = false; pump(); }

  // --- конвертация ----------------------------------------------------------
  // isAborted сознательно НЕ прерывает работу (см. шапку) — только начальный гейт.
  async function convert(buf, ext, isAborted, target = 'pdf') {
    if (isAborted && isAborted()) throw new Error('client aborted');
    const w = await acquire();
    const dir = await mkdtemp(join(tmpdir(), 'nxwarm-'));
    const input = join(dir, `input.${ext}`);
    const output = join(dir, `output.${target}`);
    try {
      await writeFile(input, buf);
      await runUnoconvert(w, input, output, target);
      return await readFile(output);
    } finally {
      release(w);
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function runUnoconvert(w, input, output, target) {
    return new Promise((resolve, reject) => {
      const proc = _spawn(unoconvertBin, [
        '--port', String(w.port), '--host-location', 'remote',
        '--convert-to', target, input, output
      ], { stdio: 'ignore' });
      let done = false;
      const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); fn(arg); };
      // Таймаут = завис unoconvert ИЛИ LO-воркер: убиваем обоих, воркер уходит
      // в respawn (единственный легитимный повод убить тёплого воркера).
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (e) {}
        killWorker(w);
        log(JSON.stringify({ evt: 'pool', action: 'worker-restart', worker: w.id, reason: 'timeout' }));
        finish(reject, new Error('timeout'));
      }, timeoutMs);
      proc.on('error', (e) => finish(reject, e));
      proc.on('close', (code) => finish(code === 0 ? resolve : reject, code === 0 ? undefined : new Error('unoconvert exit ' + code)));
    });
  }

  function shutdown() {
    for (const w of workers) {
      if (w.respawnTimer) { clearTimeout(w.respawnTimer); w.respawnTimer = null; }
      w.killing = true;
      if (w.proc) { try { process.kill(-w.proc.pid, 'SIGKILL'); } catch (e) { try { w.proc.kill('SIGKILL'); } catch (e2) {} } }
      w.state = 'dead';
    }
  }

  return { convert, shutdown, _workers: workers, _waiters: waiters };
}
