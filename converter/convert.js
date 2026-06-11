// Одна конвертация LibreOffice: свой tmp + свой профиль (иначе блокировки при
// конкурентности), kill process tree по таймауту/abort, гарантированный cleanup.
// Вынесено из server.js для DI в createApp (тесты подменяют convert моком).

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TIMEOUT_MS = Number(process.env.CONVERT_TIMEOUT_MS || 30000);   // 30 с
const SOFFICE    = process.env.SOFFICE_BIN || 'soffice';

// target — целевой формат ('pdf' для просмотра legacy; 'xlsx' для csv→Office viewer).
export async function convert(buf, ext, isAborted, target = 'pdf') {
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
