#!/usr/bin/env node
/* Build pipeline for the Toolkeeper Looker amoCRM widget.
   - Bundles src/* ES modules into a single IIFE that exposes TKLooker.default
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
    globalName: 'TKLooker',
    outfile: intermediate,
    logLevel: 'info'
  });
  const inner = fs.readFileSync(intermediate, 'utf8');
  fs.unlinkSync(intermediate);

  const amd = [
    '// Toolkeeper Looker — generated bundle, do not edit',
    `// version ${version}`,
    'define(["jquery"], function ($) {',
    inner,
    'var factory = (typeof TKLooker !== "undefined" && TKLooker.default) ? TKLooker.default : null;',
    'return factory ? factory($) : null;',
    '});'
  ].join('\n');

  fs.writeFileSync(path.join(DIST, 'script.js'), amd, 'utf8');
}

function copyStatics() {
  fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
  fs.copyFileSync(path.join(ROOT, 'style.css'),     path.join(DIST, 'style.css'));
  copyDir(path.join(ROOT, 'i18n'),    path.join(DIST, 'i18n'));
  copyDir(path.join(ROOT, 'images'),  path.join(DIST, 'images'));
  if (fs.existsSync(path.join(ROOT, 'vendor'))) {
    copyDir(path.join(ROOT, 'vendor'), path.join(DIST, 'vendor'));
  }
}

function pack() {
  fs.mkdirSync(RELEASES, { recursive: true });
  const outZip = path.join(RELEASES, `toolkeeper-looker-${version}.zip`);
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
  const zipPath = await pack();
  const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`\nBuilt ${path.relative(ROOT, zipPath)} (${sizeKb} KB)`);
})();
