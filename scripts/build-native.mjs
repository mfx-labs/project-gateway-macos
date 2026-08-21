/**
 * build-native.mjs (MAC-1) — developer/build-host build + staging of the
 * gateway-fs addon. End-user compilation is never required (MAC-0 §6).
 *
 *   node scripts/build-native.mjs x64     # build + stage native/darwin-x64/
 *   node scripts/build-native.mjs arm64   # cross-build candidate, native/darwin-arm64/
 *
 * Stages native/build/Release/gateway_fs.node to native/darwin-<arch>/
 * and prints the SHA-256 of the staged binary.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARCH = process.argv[2];
if (ARCH !== 'x64' && ARCH !== 'arm64') {
  console.error('usage: node scripts/build-native.mjs <x64|arm64>');
  process.exit(2);
}

const gyp = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'), '--directory', 'native', 'rebuild', '--arch', ARCH], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (gyp.status !== 0) {
  console.error(`node-gyp rebuild (${ARCH}) failed`);
  process.exit(gyp.status ?? 1);
}

const src = join(ROOT, 'native', 'build', 'Release', 'gateway_fs.node');
const destDir = join(ROOT, 'native', `darwin-${ARCH}`);
mkdirSync(destDir, { recursive: true });
const dest = join(destDir, 'gateway_fs.node');
rmSync(dest, { force: true });
copyFileSync(src, dest);

// Release-binary hygiene (build-path metadata): strip non-runtime local
// symbol/debug metadata from the STAGED binary so the packaged artifact does
// not embed the build host's absolute path (e.g. STABS N_SO file-path records
// such as /Users/<user>/.../native/src/gateway_fs.c). The addon's exported
// NAPI entry symbols are global and are preserved by `strip -x`; local symbols
// and stab/debug records that carry the build path are removed. A failure to
// strip fails the build (fail closed) — never continue with an unstripped
// release binary.
const strip = spawnSync('/usr/bin/strip', ['-x', dest], { stdio: 'inherit' });
if (strip.status !== 0) {
  console.error(`strip -x failed (${ARCH}) — refusing to stage an unstripped release binary`);
  process.exit(strip.status ?? 1);
}

const sha = createHash('sha256').update(readFileSync(dest)).digest('hex');
console.log(`staged ${dest}`);
console.log(`sha256 ${sha}`);
