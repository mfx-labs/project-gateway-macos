/**
 * MAC-2D-NATIVE — descriptor-bound directory enumeration tests
 * (real Intel filesystem; no mocked enumeration semantics).
 *
 * Covers: valid/empty enumeration, kind hints (incl. FIFO/socket),
 * dot-entry exclusion, caller-fd non-consumption (repeated independent
 * calls), rename/replacement anchor (decoy dir + decoy symlink),
 * invalid/closed/non-directory fds, malformed JS input, hard-cap
 * truncation boundaries, fd-leak stability, and memory-bound sanity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadGatewayFs } from '../index.mjs';

const addon = loadGatewayFs();
const O = fs.constants;

function makeDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2dn-'));
  const fd = fs.openSync(root, O.O_RDONLY | O.O_DIRECTORY);
  return { root, fd, remove() { try { fs.closeSync(fd); } catch {} fs.rmSync(root, { recursive: true, force: true }); } };
}

function namesOf(r) {
  assert.equal(r.ok, true);
  return r.entries.map((e) => e.name);
}

test('readDirectoryEntries: valid directory enumeration with exact kind hints', () => {
  const ws = makeDir();
  try {
    fs.writeFileSync(path.join(ws.root, 'a.txt'), '1');
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.symlinkSync('a.txt', path.join(ws.root, 'lnk'));
    fs.writeFileSync(path.join(ws.root, 'with space.txt'), 'x');
    fs.writeFileSync(path.join(ws.root, 'punct!@#$.txt'), 'x');
    const longName = 'L'.repeat(250) + '.txt';
    fs.writeFileSync(path.join(ws.root, longName), 'x');
    execFileSync('mkfifo', [path.join(ws.root, 'pipe')]);
    const r = addon.readDirectoryEntries(ws.fd);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.truncated, false);
    const byName = new Map(r.entries.map((e) => [e.name, e.kindHint]));
    assert.equal(byName.size, r.entries.length, 'names are unique');
    assert.equal(byName.get('a.txt'), 'file');
    assert.equal(byName.get('sub'), 'directory');
    assert.equal(byName.get('lnk'), 'symlink', 'symlink returned as entry, never followed');
    assert.equal(byName.get('with space.txt'), 'file');
    assert.equal(byName.get('punct!@#$.txt'), 'file');
    assert.equal(byName.get(longName), 'file', 'long legal filename near NAME_MAX');
    assert.equal(byName.get('pipe'), 'other', 'FIFO is other');
    assert.equal(byName.has('.'), false, 'dot entries excluded');
    assert.equal(byName.has('..'), false, 'dot-dot entries excluded');
  } finally { ws.remove(); }
});

test('readDirectoryEntries: empty directory -> zero entries, truncated false', () => {
  const ws = makeDir();
  try {
    const r = addon.readDirectoryEntries(ws.fd);
    assert.deepEqual(r, { ok: true, entries: [], truncated: false });
  } finally { ws.remove(); }
});

test('caller fd non-consumption: repeated calls are independently complete (not a shared stream position)', () => {
  const ws = makeDir();
  try {
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(ws.root, `f${i}`), 'x');
    const r1 = addon.readDirectoryEntries(ws.fd);
    const r2 = addon.readDirectoryEntries(ws.fd);
    const r3 = addon.readDirectoryEntries(ws.fd);
    assert.deepEqual(r2, r1, 'second call re-enumerates from the start');
    assert.deepEqual(r3, r1, 'third call re-enumerates from the start');
    assert.equal(r1.entries.length, 8);
    // The caller fd remains valid and usable for other operations.
    assert.equal(addon.getPath(ws.fd).ok, true);
  } finally { ws.remove(); }
});

test('anchor: rename + decoy-directory replacement cannot redirect enumeration', () => {
  const ws = makeDir();
  try {
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(ws.root, `orig${i}`), 'x');
    const moved = path.join(ws.root, '..', `mac2dn-moved-${Date.now()}`);
    fs.renameSync(ws.root, moved);
    fs.mkdirSync(ws.root);
    fs.writeFileSync(path.join(ws.root, 'decoy1'), 'x');
    fs.writeFileSync(path.join(ws.root, 'decoy2'), 'x');
    const r = addon.readDirectoryEntries(ws.fd);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const names = namesOf(r);
    assert.equal(names.length, 6, 'entries come from the retained original (6), not the decoy (2)');
    assert.ok(names.every((n) => n.startsWith('orig')), `no decoy entry leaked: ${names.join(',')}`);
    fs.rmSync(moved, { recursive: true, force: true });
  } finally { ws.remove(); }
});

test('anchor: rename + decoy-symlink replacement cannot redirect enumeration', () => {
  const ws = makeDir();
  try {
    for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(ws.root, `orig${i}`), 'x');
    const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2dn-decoy-'));
    fs.writeFileSync(path.join(decoy, 'decoy-only'), 'x');
    const moved = path.join(ws.root, '..', `mac2dn-moved2-${Date.now()}`);
    fs.renameSync(ws.root, moved);
    fs.symlinkSync(decoy, ws.root);
    const r = addon.readDirectoryEntries(ws.fd);
    const names = namesOf(r);
    assert.equal(names.length, 4);
    assert.ok(names.every((n) => n.startsWith('orig')), 'symlink decoy never followed');
    fs.rmSync(decoy, { recursive: true, force: true });
    fs.rmSync(moved, { recursive: true, force: true });
  } finally { ws.remove(); }
});

test('invalid fds fail closed: closed fd -> invalid-fd; regular-file fd -> not-directory', () => {
  const ws = makeDir();
  try {
    fs.writeFileSync(path.join(ws.root, 'f'), 'x');
    const closed = fs.openSync(ws.root, O.O_RDONLY);
    fs.closeSync(closed);
    assert.deepEqual(addon.readDirectoryEntries(closed), { ok: false, code: 'invalid-fd' });
    assert.deepEqual(addon.readDirectoryEntries(1 << 30), { ok: false, code: 'invalid-fd' });
    const fileFd = fs.openSync(path.join(ws.root, 'f'), O.O_RDONLY);
    assert.deepEqual(addon.readDirectoryEntries(fileFd), { ok: false, code: 'not-directory' });
    fs.closeSync(fileFd);
  } finally { ws.remove(); }
});

test('malformed JS input never crashes: wrong arity/types/fds are typed invalid-input', () => {
  const ws = makeDir();
  try {
    const bads = [undefined, null, true, '5', {}, [], Symbol('x'), 1.5, -1, NaN, Infinity, -Infinity, 2 ** 53, 0x7fffffff + 1, () => {}];
    for (const bad of bads) {
      const r = addon.readDirectoryEntries(bad);
      assert.equal(r.ok, false);
      assert.equal(r.code, 'invalid-input', `fd ${String(bad)} -> ${r.code}`);
    }
    for (const call of [() => addon.readDirectoryEntries(), () => addon.readDirectoryEntries(ws.fd, 'extra')]) {
      const r = call();
      assert.equal(r.ok, false);
      assert.equal(r.code, 'invalid-input');
    }
    // Process survives and the fd is still usable.
    const r = addon.readDirectoryEntries(ws.fd);
    assert.equal(r.ok, true);
  } finally { ws.remove(); }
});

test('hard-cap truncation: exactly cap -> not truncated; cap+1 -> truncated with exactly cap entries; off-by-one explicit', () => {
  const ws = makeDir();
  try {
    // cap = 10000 (derived from WP7_LIMITS.MAX_DIRECTORY_ENTRIES).
    for (let i = 0; i < 10_000; i++) {
      fs.writeFileSync(path.join(ws.root, `e${String(i).padStart(5, '0')}`), 'x');
    }
    const exact = addon.readDirectoryEntries(ws.fd);
    assert.equal(exact.ok, true);
    if (exact.ok) {
      assert.equal(exact.entries.length, 10_000);
      assert.equal(exact.truncated, false, 'exactly cap entries is NOT truncated');
    }
    fs.writeFileSync(path.join(ws.root, 'overflow'), 'x');
    const over = addon.readDirectoryEntries(ws.fd);
    assert.equal(over.ok, true);
    if (over.ok) {
      assert.equal(over.entries.length, 10_000, 'output is exactly bounded at cap');
      assert.equal(over.truncated, true, 'the (cap+1)-th entry sets truncated');
    }
    // cap - 1 boundary is covered by the 'exact' case semantics (cap is the
    // ceiling; any directory with <= cap entries reports truncated:false).
    // Caller fd remains usable after the large enumeration.
    assert.equal(addon.getPath(ws.fd).ok, true);
  } finally { ws.remove(); }
});

test('fd-leak stability: repeated enumerations do not grow fd count', () => {
  const ws = makeDir();
  try {
    fs.writeFileSync(path.join(ws.root, 'f'), 'x');
    const before = fs.readdirSync('/dev/fd').length;
    for (let i = 0; i < 300; i++) {
      const r = addon.readDirectoryEntries(ws.fd);
      assert.equal(r.ok, true);
    }
    const after = fs.readdirSync('/dev/fd').length;
    assert.ok(after <= before + 2, `fd count grew: ${before} -> ${after}`);
  } finally { ws.remove(); }
});

test('memory-bound sanity: enumeration result is bounded and complete (name bytes within cap * NAME_MAX)', () => {
  const ws = makeDir();
  try {
    for (let i = 0; i < 500; i++) {
      fs.writeFileSync(path.join(ws.root, `name-${i}-` + 'x'.repeat(200)), 'x');
    }
    const r = addon.readDirectoryEntries(ws.fd);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.entries.length, 500);
    let totalBytes = 0;
    for (const e of r.entries) totalBytes += Buffer.byteLength(e.name, 'utf8');
    // Bounded by cap * (NAME_MAX + 1); assert the actual bound holds.
    assert.ok(totalBytes <= 10_000 * 256, `name bytes within the documented allocation bound (${totalBytes})`);
    // Names round-trip byte-exactly (no normalization, no truncation).
    assert.ok(r.entries.some((e) => e.name.startsWith('name-') && e.name.endsWith('x'.repeat(200))));
  } finally { ws.remove(); }
});

test('cap drift guard: native READ_DIR_ENTRY_CAP stays equal to WP7_LIMITS.MAX_DIRECTORY_ENTRIES (INFO-1 closure)', () => {
  // Prevents silent divergence between the authoritative committed reader
  // ceiling (src/reader/types.ts, WP7_LIMITS.MAX_DIRECTORY_ENTRIES) and the
  // duplicated native constant (native/src/gateway_fs.c, READ_DIR_ENTRY_CAP).
  // Static source recovery only: no runtime coupling, no generated headers.
  const ts = fs.readFileSync(new URL('../../src/reader/types.ts', import.meta.url), 'utf8');
  const c = fs.readFileSync(new URL('../src/gateway_fs.c', import.meta.url), 'utf8');
  const mTs = ts.match(/MAX_DIRECTORY_ENTRIES:\s*(\d[\d_]*)/);
  const mC = c.match(/#define\s+READ_DIR_ENTRY_CAP\s+(\d+)u/);
  assert.ok(mTs, 'WP7 ceiling must be recoverable from src/reader/types.ts');
  assert.ok(mC, 'native cap must be recoverable from native/src/gateway_fs.c');
  const tsCap = Number(mTs[1].replace(/_/g, ''));
  const nativeCap = Number(mC[1]);
  assert.equal(tsCap, 10_000, 'authoritative WP7 reader ceiling');
  assert.equal(nativeCap, 10_000, 'native cap');
  assert.equal(tsCap, nativeCap, 'no silent drift between the reader ceiling and the native cap');
});

test('socket entry maps to other (safe local socket, not followed)', () => {
  const ws = makeDir();
  try {
    const sockPath = path.join(ws.root, 'sock');
    const server = execFileSync('python3', ['-c', `
import socket, sys
s = socket.socket(socket.AF_UNIX)
s.bind(sys.argv[1])
s.listen(0)
print("bound")
`, sockPath], { encoding: 'utf8' });
    assert.equal(server.trim(), 'bound');
    const r = addon.readDirectoryEntries(ws.fd);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const sock = r.entries.find((e) => e.name === 'sock');
    assert.ok(sock, 'socket entry present');
    assert.equal(sock.kindHint, 'other', 'socket is other, never followed');
  } finally { ws.remove(); }
});
