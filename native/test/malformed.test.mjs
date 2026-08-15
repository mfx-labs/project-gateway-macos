/**
 * MAC-1 — malformed-input boundary tests (fuzz-like, §18).
 *
 * Ordinary invalid JS arguments must become typed failures
 * ({ok:false, code:'invalid-input' | 'invalid-fd'}), never a thrown
 * native error, never a crash. The process must survive every call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGatewayFs } from '../index.mjs';

const addon = loadGatewayFs();
const O = fs.constants;

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac1-mal-'));
  const rootFd = fs.openSync(root, O.O_RDONLY | O.O_DIRECTORY);
  return { root, rootFd, remove() { try { fs.closeSync(rootFd); } catch {} fs.rmSync(root, { recursive: true, force: true }); } };
}

const BAD_FDS = [undefined, null, true, false, '5', {}, [], Symbol('x'), 1.5, -1, -0.5, NaN, Infinity, -Infinity, 1e10, 2 ** 53, 0x7fffffff + 1, () => {}];
const BAD_COMPONENTS = [undefined, null, true, 5, {}, [], Symbol('x'), () => {}, '', '.', '..', '../', 'a/b', 'a//b', '/etc', 'a\0b', 'a\0', '\0', 'a'.repeat(300), 'a'.repeat(5000)];

test('every primitive survives malformed fd arguments with a typed failure', () => {
  const ws = makeRoot();
  try {
    for (const bad of BAD_FDS) {
      for (const call of [
        () => addon.openDirectoryAt(bad, 'x'),
        () => addon.createExclusiveFileAt(bad, 'x'),
        () => addon.openExistingFileAt(bad, 'x'),
        () => addon.unlinkAt(bad, 'x'),
        () => addon.getPath(bad),
      ]) {
        const r = call();
        assert.equal(r.ok, false);
        assert.ok(r.code === 'invalid-input' || r.code === 'invalid-fd', `fd ${String(bad)} -> ${r.code}`);
      }
    }
  } finally { ws.remove(); }
});

test('every primitive survives malformed component arguments with invalid-input', () => {
  const ws = makeRoot();
  try {
    for (const bad of BAD_COMPONENTS) {
      for (const call of [
        () => addon.openDirectoryAt(ws.rootFd, bad),
        () => addon.createExclusiveFileAt(ws.rootFd, bad),
        () => addon.openExistingFileAt(ws.rootFd, bad),
        () => addon.unlinkAt(ws.rootFd, bad),
      ]) {
        const r = call();
        assert.equal(r.ok, false);
        assert.equal(r.code, 'invalid-input', `component ${JSON.stringify(bad)} -> ${r.code}`);
      }
    }
  } finally { ws.remove(); }
});

test('createExclusiveFileAt: wrong arity is invalid-input — including any mode-like third argument (F-1)', () => {
  const ws = makeRoot();
  try {
    for (const third of [0o600, 0o777, '600', null, undefined, {}]) {
      const r = addon.createExclusiveFileAt(ws.rootFd, 'x', third);
      assert.equal(r.ok, false);
      assert.equal(r.code, 'invalid-input', `third arg ${String(third)} -> ${r.code}`);
    }
    assert.equal(fs.existsSync(path.join(ws.root, 'x')), false);
  } finally { ws.remove(); }
});

test('wrong argument count is invalid-input (never a crash)', () => {
  const ws = makeRoot();
  try {
    for (const call of [
      () => addon.openDirectoryAt(),
      () => addon.openDirectoryAt(ws.rootFd),
      () => addon.openDirectoryAt(ws.rootFd, 'a', 'extra'),
      () => addon.createExclusiveFileAt(),
      () => addon.createExclusiveFileAt(ws.rootFd),
      () => addon.createExclusiveFileAt(ws.rootFd, 'a', 0o600),
      () => addon.createExclusiveFileAt(ws.rootFd, 'a', 0o600, 'extra'),
      () => addon.openExistingFileAt(),
      () => addon.unlinkAt(),
      () => addon.getPath(),
      () => addon.getPath(1, 2),
    ]) {
      const r = call();
      assert.equal(r.ok, false);
      assert.equal(r.code, 'invalid-input');
    }
  } finally { ws.remove(); }
});

test('backslash is a legal POSIX filename character (native layer); no crash', () => {
  const ws = makeRoot();
  try {
    // POSIX-legal name; the Gateway JS lexical guard rejects backslash
    // BEFORE the native layer in production (inherited validateComponent).
    const r = addon.createExclusiveFileAt(ws.rootFd, 'a\\b');
    assert.equal(r.ok, true);
    assert.equal(fs.existsSync(path.join(ws.root, 'a\\b')), true);
    fs.closeSync(r.fd);
    assert.deepEqual(addon.unlinkAt(ws.rootFd, 'a\\b'), { ok: true });
  } finally { ws.remove(); }
});

test('randomized garbage inputs never crash the process (typed failures only)', () => {
  const ws = makeRoot();
  try {
    const alphabet = 'abcXYZ019./\\\0%$!';
    let seed = 0x5eed1234;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const randString = (maxLen) => {
      const len = rnd() % maxLen;
      let s = '';
      for (let i = 0; i < len; i++) s += alphabet[rnd() % alphabet.length];
      return s;
    };
    for (let i = 0; i < 500; i++) {
      const comp = randString(40);
      const calls = [
        () => addon.openDirectoryAt(ws.rootFd, comp),
        () => addon.createExclusiveFileAt(ws.rootFd, comp),
        () => addon.openExistingFileAt(ws.rootFd, comp),
        () => addon.unlinkAt(ws.rootFd, comp),
      ];
      const r = calls[rnd() % calls.length]();
      assert.equal(typeof r, 'object');
      assert.equal(typeof r.ok, 'boolean');
      assert.ok(r.ok === true || typeof r.code === 'string');
      if (r.ok === true && 'fd' in r) fs.closeSync(r.fd); // never leak fds
    }
  } finally { ws.remove(); }
});

test('fd leak check: many sequential operations leave fd count stable', () => {
  const ws = makeRoot();
  try {
    const before = fs.readdirSync('/dev/fd').length;
    for (let i = 0; i < 200; i++) {
      const r = addon.openDirectoryAt(ws.rootFd, '.');
      // '.' is rejected as invalid-input — no fd is created.
      assert.equal(r.ok, false);
      const c = addon.createExclusiveFileAt(ws.rootFd, `f${i}`);
      assert.equal(c.ok, true);
      fs.closeSync(c.fd);
    }
    const after = fs.readdirSync('/dev/fd').length;
    // count includes our own dirfd + test runner fds; only assert no growth.
    assert.ok(after <= before + 2, `fd count grew: ${before} -> ${after}`);
  } finally { ws.remove(); }
});
