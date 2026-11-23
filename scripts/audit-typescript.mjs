#!/usr/bin/env node
/**
 * DERMA-SHIELD · audit-typescript.mjs
 * -----------------------------------------------------------------------------
 * Enforces the 0.0 % TypeScript mandate and reports the real language ledger
 * that Module 05's inspector renders. Run standalone or from CI:
 *
 *   node scripts/audit-typescript.mjs           # human summary
 *   node scripts/audit-typescript.mjs --json    # machine readable
 *   node scripts/audit-typescript.mjs --emit    # rewrite src/lib/data/language-ledger.js
 *
 * Exit code 1 if any forbidden artifact exists:
 *   *.ts / *.tsx source, tsconfig.json, or <script lang="ts"> inside a .svelte file.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const argv = new Set(process.argv.slice(2));

const LANGUAGE_BY_EXT = {
  '.svelte': 'Svelte',
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.kt': 'Kotlin',
  '.glsl': 'GLSL',
  '.css': 'CSS',
  '.html': 'HTML',
  '.json': 'JSON',
  '.xml': 'XML',
  '.kts': 'Kotlin'
};

const TONE_BY_LANGUAGE = {
  Svelte: 'accent',
  JavaScript: 'ok',
  Python: 'warn',
  Kotlin: 'danger',
  GLSL: 'accent',
  CSS: 'ok'
};

/**
 * Walk the working tree (not `git ls-files`): this repository is authored as a
 * fresh branch, so most files are still untracked while the product is built.
 * Build output, dependencies and generated Android resources are excluded.
 */
const SKIP_DIRS = /(^|\/)(node_modules|dist|\.svelte-kit|\.git|android\/app\/build|build|coverage)(\/|$)/;

function sourceFiles() {
  return globSync('**/*.{svelte,js,mjs,cjs,py,kt,kts,glsl,css,html}', { cwd: root })
    .filter((p) => !SKIP_DIRS.test(p))
    .filter((p) => !p.startsWith('android/app/src/main/res/'))
    .sort();
}

const files = sourceFiles();

/* ------------------------------------------------- 1. forbidden TypeScript */
const offenders = [];
for (const file of files) {
  const ext = extname(file);
  if (ext === '.ts' || ext === '.tsx' || /(^|\/)tsconfig(\.[\w-]+)?\.json$/.test(file)) {
    offenders.push({ file, reason: ext === '.tsx' ? '.tsx source' : ext === '.ts' ? '.ts source' : 'tsconfig' });
  }
}
// Svelte files must never declare lang="ts"
for (const file of files.filter((f) => f.endsWith('.svelte'))) {
  let text = '';
  try {
    text = readFileSync(resolve(root, file), 'utf8');
  } catch {
    continue;
  }
  if (/<script[^>]*\blang=["']ts["']/.test(text)) {
    offenders.push({ file, reason: '<script lang="ts">' });
  }
  if (/<script[^>]*\blang=["']typescript["']/.test(text)) {
    offenders.push({ file, reason: '<script lang="typescript">' });
  }
}

/* ------------------------------------------------------ 2. language ledger */
const ledger = new Map();
let totalBytes = 0;

for (const file of files) {
  const ext = extname(file);
  const language = LANGUAGE_BY_EXT[ext];
  if (!language) continue;
  // Skip generated Android resources and vendored shaders copies.
  if (file.startsWith('android/app/src/main/res/')) continue;
  let text;
  try {
    text = readFileSync(resolve(root, file), 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n').length;
  const bytes = Buffer.byteLength(text, 'utf8');
  totalBytes += bytes;
  const row = ledger.get(language) ?? { language, files: 0, lines: 0, bytes: 0, paths: [] };
  row.files += 1;
  row.lines += lines;
  row.bytes += bytes;
  if (row.paths.length < 8) row.paths.push(file);
  ledger.set(language, row);
}

const rows = [...ledger.values()]
  .map((r) => ({
    ...r,
    sharePct: Number(((r.bytes / totalBytes) * 100).toFixed(1)),
    tone: TONE_BY_LANGUAGE[r.language] ?? 'default'
  }))
  .sort((a, b) => b.bytes - a.bytes);

const summary = {
  generatedAt: new Date().toISOString(),
  typeScriptFiles: offenders.length,
  offenders,
  totalFiles: rows.reduce((n, r) => n + r.files, 0),
  totalLines: rows.reduce((n, r) => n + r.lines, 0),
  totalBytes,
  languages: rows.map(({ language, tone, files: f, lines, bytes, sharePct, paths }) => ({
    language, tone, files: f, lines, bytes, sharePct, paths
  }))
};

/* ------------------------------------------------------------- 3. output */
if (argv.has('--emit')) {
  const target = resolve(root, 'src/lib/data/language-ledger.js');
  const body = `/**
 * DERMA-SHIELD · language-ledger.js
 * -----------------------------------------------------------------------------
 * GENERATED FILE — do not edit by hand.
 * Regenerate with:  node scripts/audit-typescript.mjs --emit
 *
 * Measured ${summary.generatedAt} across ${summary.totalFiles} tracked source files
 * (${summary.totalLines.toLocaleString()} lines). Byte share is used rather than line
 * count so minified/generated files cannot skew the ledger.
 */

export const LANGUAGE_LEDGER = Object.freeze(${JSON.stringify(summary.languages, null, 2)});

export const LEDGER_TOTALS = Object.freeze(${JSON.stringify(
    {
      files: summary.totalFiles,
      lines: summary.totalLines,
      bytes: summary.totalBytes,
      typeScriptFiles: summary.typeScriptFiles,
      generatedAt: summary.generatedAt
    },
    null,
    2
  )});

export const LEDGER_AS_OF = ${JSON.stringify(summary.generatedAt)};
`;
  writeFileSync(target, body, 'utf8');
  console.log(`✔ wrote ${target.replace(root + '/', '')}`);
}

if (argv.has('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else if (!argv.has('--emit')) {
  console.log('DERMA-SHIELD · TypeScript audit');
  console.log(`  source files scanned  : ${summary.totalFiles}`);
  console.log(`  source lines          : ${summary.totalLines.toLocaleString()}`);
  console.log(`  TypeScript artifacts  : ${summary.typeScriptFiles}`);
  console.log('\n  language ledger (byte share)');
  for (const r of summary.languages) {
    const bar = '█'.repeat(Math.max(1, Math.round(r.sharePct / 1.6)));
    console.log(
      `   ${r.language.padEnd(12)} ${String(r.sharePct).padStart(5)}%  ${String(r.files).padStart(3)} files  ${String(r.lines).padStart(7)} lines  ${bar}`
    );
  }
  if (offenders.length) {
    console.log('\n  ✗ FORBIDDEN ARTIFACTS');
    for (const o of offenders) console.log(`   · ${o.file} — ${o.reason}`);
    process.exitCode = 1;
  } else {
    console.log('\n  ✅ 0.0 % TypeScript — mandate satisfied');
  }
}

if (offenders.length) process.exitCode = 1;
