#!/usr/bin/env node
/*
  check-raw-hex.cjs (CommonJS)
  See scripts/check-raw-hex.js for original notes. Implemented as .cjs because the repo uses ESM.
*/

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (err) {
    return '';
  }
}

const gitBaseEnv = process.env.GIT_BASE;
let files = [];
if (gitBaseEnv) {
  files = run(`git diff --name-only ${gitBaseEnv}...HEAD`).split('\n').filter(Boolean);
} else {
  const hasOriginMain = run('git rev-parse --verify origin/main');
  if (hasOriginMain) {
    files = run('git diff --name-only origin/main...HEAD').split('\n').filter(Boolean);
  } else {
    files = run('git diff --name-only --staged').split('\n').filter(Boolean);
  }
}

if (!files || files.length === 0) {
  console.log('check-raw-hex: no changed files detected — nothing to check.');
  process.exit(0);
}

files = files.filter((f) => f.startsWith('client/src/') && /\.(js|jsx|ts|tsx|css|scss)$/.test(f));
if (files.length === 0) {
  console.log('check-raw-hex: no changed files under client/src — nothing to check.');
  process.exit(0);
}

const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?=[^0-9a-fA-F]|$)/g;
const IGNORED_PATHS = ['client/src/index.css'];

let matches = [];
for (const f of files) {
  if (IGNORED_PATHS.includes(f)) continue;
  try {
    const content = fs.readFileSync(path.resolve(f), 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      while ((m = HEX_RE.exec(line)) !== null) {
        matches.push({ file: f, line: i + 1, match: m[0], context: line.trim() });
      }
    }
  } catch (err) {
    // ignore unreadable files
  }
}

if (matches.length === 0) {
  console.log('✅ check-raw-hex: no new raw hex color literals detected in changed files.');
  process.exit(0);
}

console.error('❌ check-raw-hex: found raw hex color literals in changed files (forbid new raw hex in client/src).');
for (const r of matches) {
  console.error(` - ${r.file}:${r.line}  =>  ${r.match}    // ${r.context}`);
}
console.error('\nHex-Wert gefunden! Bitte nutze stattdessen unsere Design-Tokens (siehe tailwind.config.ts oder client/src/STYLE_GUIDE.md).');
console.error('Tip: keep semantic color tokens in `client/src/index.css` and use Tailwind mapping or token classes.');
process.exit(1);
