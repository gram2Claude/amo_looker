// @vitest-environment node
// Тесты warm-пула (converter/warm.js) на DI-моках spawn: пул-логика, таймаут→restart
// воркера, abort НЕ убивает воркера, acquire-таймаут. Реальные kill process-group
// (POSIX-only) и параллелизм с живым LibreOffice проверяются серверным smoke
// (converter/test.sh) — решение ревью плана E4.
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createWarmPool, makeHybridConvert } from '../converter/warm.js';

let nextPid = 1000;

// Мок процесса: EventEmitter с pid/kill, как у ChildProcess.
function fakeProc() {
  const p = new EventEmitter();
  p.pid = nextPid++;
  p.killed = false;
  p.kill = vi.fn(() => { p.killed = true; p.emit('exit'); });
  return p;
}

// Мок spawn: unoserver-воркеры живут вечно (пока не убьют); unoconvert ведёт себя
// по сценарию behave(args, proc) — по умолчанию пишет output и завершается с 0.
function makeSpawn({ behave } = {}) {
  const calls = { unoserver: [], unoconvert: [] };
  const fn = vi.fn((bin, args) => {
    const proc = fakeProc();
    if (bin === 'unoserver') {
      calls.unoserver.push({ args, proc });
    } else {
      calls.unoconvert.push({ args, proc });
      const run = behave || (async (a, pr) => {
        await writeFile(a[a.length - 1], '%PDF-warm');
        pr.emit('close', 0);
      });
      setTimeout(() => { run(args, proc).catch(() => proc.emit('close', 1)); }, 5);
    }
    return proc;
  });
  fn.calls = calls;
  return fn;
}

function makePool(opts = {}) {
  return createWarmPool({
    poolSize: 2, basePort: 9100, timeoutMs: 300, acquireTimeoutMs: 200,
    bootGraceMs: 10, respawnDelayMs: 20, log: () => {},
    unoserverBin: 'unoserver', unoconvertBin: 'unoconvert',
    ...opts
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('warm-пул: базовый контракт', () => {
  it('конвертирует через unoconvert к прогретому воркеру', async () => {
    const _spawn = makeSpawn();
    const pool = makePool({ _spawn });
    const out = await pool.convert(Buffer.from('doc-bytes'), 'doc', () => false);
    expect(out.toString()).toBe('%PDF-warm');
    expect(_spawn.calls.unoserver.length).toBe(2);           // пул из 2 воркеров поднят
    expect(_spawn.calls.unoconvert.length).toBe(1);
    pool.shutdown();
  });

  it('isAborted на входе → отказ без захвата воркера', async () => {
    const _spawn = makeSpawn();
    const pool = makePool({ _spawn });
    await expect(pool.convert(Buffer.from('x'), 'doc', () => true)).rejects.toThrow('client aborted');
    expect(_spawn.calls.unoconvert.length).toBe(0);
    pool.shutdown();
  });

  it('2 параллельные конвертации идут на РАЗНЫЕ порты (воркеры не делятся)', async () => {
    const _spawn = makeSpawn({
      behave: async (a, pr) => { await wait(50); await writeFile(a[a.length - 1], '%PDF-warm'); pr.emit('close', 0); }
    });
    const pool = makePool({ _spawn });
    const [r1, r2] = await Promise.all([
      pool.convert(Buffer.from('a'), 'doc', () => false),
      pool.convert(Buffer.from('b'), 'xls', () => false)
    ]);
    expect(r1.toString()).toBe('%PDF-warm');
    expect(r2.toString()).toBe('%PDF-warm');
    const ports = _spawn.calls.unoconvert.map((c) => c.args[c.args.indexOf('--port') + 1]);
    expect(new Set(ports).size).toBe(2);
    pool.shutdown();
  });
});

describe('warm-пул: таймаут и abort-семантика', () => {
  it('зависший unoconvert → timeout, воркер убит и уходит в respawn', async () => {
    const _spawn = makeSpawn({ behave: async () => { /* висит вечно */ } });
    const pool = makePool({ _spawn, timeoutMs: 60 });
    await expect(pool.convert(Buffer.from('x'), 'doc', () => false)).rejects.toThrow('timeout');
    // воркер, обслуживавший job, перезапущен: появился третий spawn unoserver
    await wait(60);
    expect(_spawn.calls.unoserver.length).toBeGreaterThanOrEqual(3);
    pool.shutdown();
  });

  it('abort клиента ПОСЛЕ старта job НЕ убивает воркера (job дорабатывает)', async () => {
    let abortedFlag = false;
    const _spawn = makeSpawn({
      behave: async (a, pr) => { await wait(40); await writeFile(a[a.length - 1], '%PDF-warm'); pr.emit('close', 0); }
    });
    const pool = makePool({ _spawn });
    const p = pool.convert(Buffer.from('x'), 'doc', () => abortedFlag);
    await wait(15);
    abortedFlag = true;                       // клиент закрыл модалку в середине job
    const out = await p;                      // job дорабатывает до конца
    expect(out.toString()).toBe('%PDF-warm');
    // воркеры НЕ перезапускались: ровно 2 spawn'а unoserver за весь тест
    expect(_spawn.calls.unoserver.length).toBe(2);
    expect(_spawn.calls.unoserver.every(({ proc }) => !proc.killed)).toBe(true);
    // следующая конвертация идёт тёплым воркером сразу
    const out2 = await pool.convert(Buffer.from('y'), 'doc', () => false);
    expect(out2.toString()).toBe('%PDF-warm');
    pool.shutdown();
  });
});

describe('warm-пул: деградация', () => {
  it('нет свободного воркера дольше acquireTimeoutMs → pool unavailable', async () => {
    const _spawn = makeSpawn({ behave: async () => { /* висит — займёт оба воркера */ } });
    const pool = makePool({ _spawn, poolSize: 1, timeoutMs: 500, acquireTimeoutMs: 80 });
    const hang = pool.convert(Buffer.from('x'), 'doc', () => false).catch(() => {});
    await wait(20);
    await expect(pool.convert(Buffer.from('y'), 'doc', () => false)).rejects.toThrow('pool unavailable');
    pool.shutdown();
    await hang;
  });

  it('самолечение: 2 ошибки подряд → recycle воркера (анти-«illegal object»)', async () => {
    let failTimes = 2;
    const _spawn = makeSpawn({
      behave: async (a, pr) => {
        if (failTimes-- > 0) { pr.emit('close', 1); return; }   // деградировавший LO
        await writeFile(a[a.length - 1], '%PDF-warm');
        pr.emit('close', 0);
      }
    });
    const pool = makePool({ _spawn, poolSize: 1 });
    await expect(pool.convert(Buffer.from('a'), 'doc', () => false)).rejects.toThrow('unoconvert exit 1');
    expect(_spawn.calls.unoserver.length).toBe(1);   // одна ошибка — ещё не recycle
    await expect(pool.convert(Buffer.from('b'), 'doc', () => false)).rejects.toThrow('unoconvert exit 1');
    await wait(50);                                   // respawnDelayMs=20 + boot grace 10
    expect(_spawn.calls.unoserver.length).toBe(2);   // вторая подряд — воркер перезапущен
    const out = await pool.convert(Buffer.from('c'), 'doc', () => false);
    expect(out.toString()).toBe('%PDF-warm');        // свежий воркер работает
    pool.shutdown();
  });

  it('csv идёт с явным импорт-фильтром Calc и host-location local', async () => {
    const _spawn = makeSpawn();
    const pool = makePool({ _spawn });
    await pool.convert(Buffer.from('a;b'), 'csv', () => false, 'xlsx');
    const args = _spawn.calls.unoconvert[0].args;
    expect(args).toContain('--input-filter');
    expect(args[args.indexOf('--input-filter') + 1]).toBe('Text - txt - csv (StarCalc)');
    expect(args[args.indexOf('--host-location') + 1]).toBe('local');
    pool.shutdown();
  });

  it('ошибка ФС после acquire (ENOSPC) НЕ оставляет воркера busy навсегда (HIGH ревью E4)', async () => {
    let failMkdtemp = true;
    const _spawn = makeSpawn();
    const pool = makePool({
      _spawn, poolSize: 1,
      _mkdtemp: async (p) => {
        if (failMkdtemp) throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
        const { mkdtemp } = await import('node:fs/promises');
        return mkdtemp(p);
      }
    });
    await expect(pool.convert(Buffer.from('x'), 'doc', () => false)).rejects.toThrow('no space left');
    failMkdtemp = false;                       // «диск освободился»
    const out = await pool.convert(Buffer.from('y'), 'doc', () => false);
    expect(out.toString()).toBe('%PDF-warm');  // воркер вернулся в оборот, пул жив
    pool.shutdown();
  });

  it('профилактический recycle после MAX_JOBS джобов', async () => {
    const prev = process.env.POOL_MAX_JOBS;
    process.env.POOL_MAX_JOBS = '2';
    try {
      const _spawn = makeSpawn();
      const pool = makePool({ _spawn, poolSize: 1 });
      await pool.convert(Buffer.from('a'), 'doc', () => false);
      expect(_spawn.calls.unoserver.length).toBe(1);
      await pool.convert(Buffer.from('b'), 'doc', () => false);   // 2-й джоб → recycle
      await wait(50);
      expect(_spawn.calls.unoserver.length).toBe(2);
      const out = await pool.convert(Buffer.from('c'), 'doc', () => false);
      expect(out.toString()).toBe('%PDF-warm');
      pool.shutdown();
    } finally {
      if (prev === undefined) delete process.env.POOL_MAX_JOBS; else process.env.POOL_MAX_JOBS = prev;
    }
  });

  it('stale boot-таймер старого процесса не трогает перезапущенный воркер (generation guard)', async () => {
    const _spawn = makeSpawn();
    // большой grace: первый boot-таймер «висит», когда воркер умирает и перезапускается
    const pool = makePool({ _spawn, poolSize: 1, bootGraceMs: 80, respawnDelayMs: 10 });
    const w = pool._workers[0];
    _spawn.calls.unoserver[0].proc.emit('exit');   // умер во время booting
    await wait(30);                                 // respawn произошёл (новый proc)
    expect(_spawn.calls.unoserver.length).toBe(2);
    expect(w.state).toBe('booting');                // старый таймер (80мс) НЕ пометил ready
    await wait(80);                                 // новый таймер добежал
    expect(w.state).toBe('ready');
    pool.shutdown();
  });

  it('упавший unoserver-воркер сам уходит в respawn', async () => {
    const _spawn = makeSpawn();
    const pool = makePool({ _spawn });
    await wait(15);                            // воркеры ready
    _spawn.calls.unoserver[0].proc.emit('exit');   // воркер «умер»
    await wait(50);                            // respawnDelayMs=20 + запас
    expect(_spawn.calls.unoserver.length).toBe(3);
    // пул остаётся рабочим
    const out = await pool.convert(Buffer.from('x'), 'doc', () => false);
    expect(out.toString()).toBe('%PDF-warm');
    pool.shutdown();
  });
});

describe('makeHybridConvert: роутинг по размеру', () => {
  it('маленькие — warm, большие — cold; контракт передаётся целиком', () => {
    const calls = [];
    const warm = (...a) => { calls.push(['warm', a[1]]); return 'W'; };
    const cold = (...a) => { calls.push(['cold', a[1]]); return 'C'; };
    const hybrid = makeHybridConvert(warm, cold, 100);
    const small = Buffer.alloc(100);   // ровно порог — НЕ больше → warm
    const big = Buffer.alloc(101);
    expect(hybrid(small, 'doc', null, 'pdf')).toBe('W');
    expect(hybrid(big, 'xls', null, 'pdf')).toBe('C');
    expect(calls).toEqual([['warm', 'doc'], ['cold', 'xls']]);
  });
});
