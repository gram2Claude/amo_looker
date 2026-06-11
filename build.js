#!/usr/bin/env node
/* Build pipeline for the Nexus Looker amoCRM widget.
   - Bundles src/* ES modules into a single IIFE that exposes NXLooker.default
   - Wraps the IIFE in an AMD define(['jquery'], ...) so amoCRM RequireJS sees it
   - Copies static assets to dist/
   - Packages everything into a versioned zip in releases/
*/

const fs   = require('fs');
const path = require('path');
const esbuild  = require('esbuild');
const archiver = require('archiver');

const ROOT     = __dirname;
const DIST     = path.join(ROOT, 'dist');
const RELEASES = path.join(ROOT, 'releases');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version  = manifest.widget.version;

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function bundleScript() {
  const intermediate = path.join(DIST, '_bundle.js');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'script.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2017'],
    minify: false,
    globalName: 'NXLooker',
    outfile: intermediate,
    logLevel: 'info'
  });
  const inner = fs.readFileSync(intermediate, 'utf8');
  fs.unlinkSync(intermediate);

  const amd = [
    '// Nexus Looker — generated bundle, do not edit',
    `// version ${version}`,
    'define(["jquery"], function ($) {',
    inner,
    'var factory = (typeof NXLooker !== "undefined" && NXLooker.default) ? NXLooker.default : null;',
    'return factory ? factory($) : null;',
    '});'
  ].join('\n');

  guardBundle(amd);
  fs.writeFileSync(path.join(DIST, 'script.js'), amd, 'utf8');
}

// Build-guard: требования amoCRM к публичным интеграциям. Сборка падает, если
// в бандл просочился запрещённый паттерн (например, из новой npm-зависимости).
const FORBIDDEN_PATTERNS = [
  [/createElement\(\s*["']script["']\s*\)/, "createElement('script') — внешние зависимости только инлайном (п. 3.2)"],
  [/\beval\s*\(/,        'eval( — запрещён (п. 3.1.1)'],
  [/new\s+Function\s*\(/, 'new Function( — эквивалент eval'],
  [/\balert\s*\(/,        'alert( — запрещён (п. 3.1.1)'],
  [/\bconfirm\s*\(/,      'confirm( — запрещён (п. 3.1.1)'],
  [/define\.amd/,         'define.amd — живая AMD-ветка UMD-зависимости (конфликт с RequireJS amoCRM)']
];

function guardBundle(code) {
  for (const [re, label] of FORBIDDEN_PATTERNS) {
    const m = code.match(re);
    if (m) {
      const at = code.indexOf(m[0]);
      throw new Error(`build-guard: запрещённый паттерн в бандле: ${label}\n  …${code.slice(Math.max(0, at - 80), at + 80)}…`);
    }
  }
}

// В zip не должно попасть ни одного минифицированного файла и каталога vendor/.
function guardDist() {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  for (const f of walk(DIST)) {
    const rel = path.relative(DIST, f);
    if (/\.min\./.test(path.basename(f))) throw new Error('build-guard: минифицированный файл в dist: ' + rel);
    if (rel.split(path.sep)[0] === 'vendor') throw new Error('build-guard: каталог vendor/ в dist: ' + rel);
  }
}

function copyStatics() {
  fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
  fs.copyFileSync(path.join(ROOT, 'style.css'),     path.join(DIST, 'style.css'));
  copyDir(path.join(ROOT, 'i18n'),    path.join(DIST, 'i18n'));
  copyDir(path.join(ROOT, 'images'),  path.join(DIST, 'images'));
}

function pack() {
  fs.mkdirSync(RELEASES, { recursive: true });
  const outZip = path.join(RELEASES, `nexus-looker-${version}.zip`);
  return new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(outZip);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(outZip));
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(DIST, false);
    archive.finalize();
  });
}

(async () => {
  rmrf(DIST);
  fs.mkdirSync(DIST, { recursive: true });
  await bundleScript();
  copyStatics();
  guardDist();
  const zipPath = await pack();
  const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`\nBuilt ${path.relative(ROOT, zipPath)} (${sizeKb} KB)`);
})();
