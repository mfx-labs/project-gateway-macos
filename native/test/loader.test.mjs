/**
 * MAC-1 — loader fail-closed tests (native seam packaging behavior).
 *
 * Proves: missing binary -> explicit failure; invalid binary ->
 * explicit failure; wrong architecture -> explicit failure; no fallback
 * to a weaker pure-Node path, no /proc fallback, no /dev/fd fallback.
 * The loader is NOT wired into Gateway production composition (MAC-2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGatewayFs, resolveAddonPath, NativeAddonError, SUPPORTED_ADDON_LANES } from '../index.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mac1-loader-'));
}

test('supported lanes are exactly darwin-x64 and darwin-arm64', () => {
  assert.deepEqual(SUPPORTED_ADDON_LANES, ['darwin-x64', 'darwin-arm64']);
  assert.equal(resolveAddonPath('darwin', 'x64', '/r'), '/r/native/darwin-x64/gateway_fs.node');
  assert.equal(resolveAddonPath('darwin', 'arm64', '/r'), '/r/native/darwin-arm64/gateway_fs.node');
});

test('unsupported platform/arch fails closed (linux, win32, unknown arch)', () => {
  for (const [platform, arch] of [['linux', 'x64'], ['win32', 'x64'], ['darwin', 'ia32'], ['freebsd', 'arm64'], ['darwin', 'ppc64']]) {
    assert.throws(
      () => loadGatewayFs({ platform, arch, baseDir: tmpdir() }),
      (e) => e instanceof NativeAddonError && e.code === 'unsupported-platform',
      `${platform}-${arch} must fail closed`,
    );
  }
});

test('missing native binary -> explicit missing-addon failure', () => {
  const dir = tmpdir();
  const missing = path.join(dir, 'native', 'darwin-x64', 'gateway_fs.node');
  assert.throws(
    () => loadGatewayFs({ baseDir: dir }),
    (e) => e instanceof NativeAddonError && e.code === 'missing-addon',
  );
  assert.equal(fs.existsSync(missing), false);
});

test('invalid binary (garbage bytes) -> explicit invalid-addon failure', () => {
  const dir = tmpdir();
  const fake = path.join(dir, 'native', 'darwin-x64', 'gateway_fs.node');
  fs.mkdirSync(path.dirname(fake), { recursive: true });
  fs.writeFileSync(fake, Buffer.from('this is not a mach-o binary at all, definitely not', 'utf8'));
  assert.throws(
    () => loadGatewayFs({ baseDir: dir }),
    (e) => e instanceof NativeAddonError && e.code === 'invalid-addon',
  );
});

test('wrong architecture binary -> explicit invalid-addon failure (real arm64 Mach-O if the MAC-1 arm64 candidate exists, else a minimal arm64 Mach-O stub)', () => {
  const dir = tmpdir();
  const fake = path.join(dir, 'native', 'darwin-x64', 'gateway_fs.node');
  fs.mkdirSync(path.dirname(fake), { recursive: true });

  // Prefer the REAL arm64 cross-build candidate from native/darwin-arm64/;
  // fall back to a minimal arm64 Mach-O (MH_MAGIC_64 | CPU_TYPE_ARM64)
  // stub that dlopen must reject on this x86_64 host.
  const repoArm64 = new URL('../../darwin-arm64/gateway_fs.node', import.meta.url);
  let bytes;
  if (fs.existsSync(repoArm64)) {
    bytes = fs.readFileSync(repoArm64);
  } else {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
    header.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
    header.writeUInt32LE(0, 8);          // CPU_SUBTYPE_ANY
    header.writeUInt32LE(6, 12);         // MH_DYLIB
    bytes = header;
  }
  fs.writeFileSync(fake, bytes);

  assert.throws(
    () => loadGatewayFs({ baseDir: dir }),
    (e) => e instanceof NativeAddonError && e.code === 'invalid-addon',
    'an arm64 binary in the x64 slot must fail closed on an x86_64 host',
  );
});

test('a file at an absolute path is never accepted as the default addon (explicit path override only)', () => {
  // options.path is the documented test seam; the DEFAULT selection is
  // always <baseDir>/native/<lane>/gateway_fs.node — an absolute path
  // can never be selected implicitly.
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'evil.node'), Buffer.from('x'));
  assert.throws(
    () => loadGatewayFs({ baseDir: dir }),
    (e) => e instanceof NativeAddonError && e.code === 'missing-addon',
  );
});

test('no fallback exists: loader never returns a pure-Node or /proc or /dev/fd shim', () => {
  const dir = tmpdir();
  assert.throws(() => loadGatewayFs({ baseDir: dir }), NativeAddonError);
  // The loader's CODE must not reference procfs/fdescfs at all (comments
  // are documentation and are stripped before scanning).
  const source = stripComments(fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8'));
  assert.equal(source.includes('/proc'), false);
  assert.equal(source.includes('/dev/fd'), false);
});

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

test('real x64 addon loads and exposes exactly the six primitives', () => {
  const addon = loadGatewayFs();
  assert.deepEqual(Object.keys(addon).sort(), ['createExclusiveFileAt', 'getPath', 'openDirectoryAt', 'openExistingFileAt', 'readDirectoryEntries', 'unlinkAt']);
});
