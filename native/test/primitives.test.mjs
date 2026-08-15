/**
 * MAC-1 — real Intel filesystem primitive tests (native seam, real
 * syscalls; no mocked filesystem semantics). Host lane for this run:
 * darwin-x86_64 (see process.platform/arch guard below).
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac1-prim-'));
  const rootFd = fs.openSync(root, O.O_RDONLY | O.O_DIRECTORY);
  return { root, rootFd, remove() { try { fs.closeSync(rootFd); } catch {} fs.rmSync(root, { recursive: true, force: true }); } };
}

test('host lane is darwin x86_64 (this gate runs on real Intel hardware)', () => {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'x64');
});

test('openDirectoryAt: child directory opens relative to the retained parent fd', () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'child'));
    const r = addon.openDirectoryAt(ws.rootFd, 'child');
    assert.equal(r.ok, true);
    const st = fs.fstatSync(r.fd);
    assert.equal(st.isDirectory(), true);
    // getPath must equal the canonical child path (realpath of tmpdir)
    const expect = fs.realpathSync(path.join(ws.root, 'child'));
    assert.equal(addon.getPath(r.fd).path, expect);
    fs.closeSync(r.fd);
  } finally { ws.remove(); }
});

test('openDirectoryAt: missing child is typed not-found', () => {
  const ws = makeRoot();
  try {
    assert.deepEqual(addon.openDirectoryAt(ws.rootFd, 'nope'), { ok: false, code: 'not-found' });
  } finally { ws.remove(); }
});

test('openDirectoryAt: symlink child is refused (no-follow)', () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'real'));
    fs.symlinkSync(path.join(ws.root, 'real'), path.join(ws.root, 'link'));
    const r = addon.openDirectoryAt(ws.rootFd, 'link');
    assert.equal(r.ok, false);
    // Observed on this Darwin host: openat(O_RDONLY|O_DIRECTORY|O_NOFOLLOW)
    // on a symlink-to-directory fails with ENOTDIR; a symlink-to-file path
    // without O_DIRECTORY yields ELOOP (see openExistingFileAt symlink test).
    // Both codes are closed, fail-closed refusals — never a followed open.
    assert.ok(['symlink-refused', 'not-directory'].includes(r.code), `code was ${r.code}`);
  } finally { ws.remove(); }
});

test('openDirectoryAt: non-directory child is typed not-directory', () => {
  const ws = makeRoot();
  try {
    fs.writeFileSync(path.join(ws.root, 'f'), 'x');
    assert.deepEqual(addon.openDirectoryAt(ws.rootFd, 'f'), { ok: false, code: 'not-directory' });
  } finally { ws.remove(); }
});

test('createExclusiveFileAt: new target succeeds with the fixed 0600 mode (umask 0)', () => {
  const ws = makeRoot();
  try {
    const prev = process.umask(0);
    try {
      const r = addon.createExclusiveFileAt(ws.rootFd, 'task.json');
      assert.equal(r.ok, true);
      const st = fs.fstatSync(r.fd);
      assert.equal(st.isFile(), true);
      assert.equal(st.mode & 0o777, 0o600, 'fixed implementation-owned 0600');
      assert.equal(addon.getPath(r.fd).path, fs.realpathSync(path.join(ws.root, 'task.json')));
      fs.closeSync(r.fd);
    } finally { process.umask(prev); }
  } finally { ws.remove(); }
});

test('createExclusiveFileAt: umask can never broaden the fixed 0600 mode', () => {
  const ws = makeRoot();
  try {
    const prev = process.umask(0o077);
    try {
      const r = addon.createExclusiveFileAt(ws.rootFd, 'masked.json');
      assert.equal(r.ok, true);
      const st = fs.fstatSync(r.fd);
      assert.equal(st.mode & 0o777, 0o600, '0600 & ~077 == 0600; umask only removes bits');
      fs.closeSync(r.fd);
    } finally { process.umask(prev); }
  } finally { ws.remove(); }
});

test('createExclusiveFileAt: caller cannot request a broader mode (third argument rejected, nothing created)', () => {
  const ws = makeRoot();
  try {
    for (const attempt of [0o777, 0o7777, 0o4755, 0o6755, 0o1777]) {
      const r = addon.createExclusiveFileAt(ws.rootFd, 'x', attempt);
      assert.deepEqual(r, { ok: false, code: 'invalid-input' }, `mode ${attempt.toString(8)} must be rejected`);
    }
    assert.equal(fs.existsSync(path.join(ws.root, 'x')), false, 'no file may be created by a rejected call');
  } finally { ws.remove(); }
});

test('createExclusiveFileAt: existing regular file refused (never overwrite)', () => {
  const ws = makeRoot();
  try {
    fs.writeFileSync(path.join(ws.root, 'f'), 'original');
    assert.deepEqual(addon.createExclusiveFileAt(ws.rootFd, 'f'), { ok: false, code: 'exists' });
    assert.equal(fs.readFileSync(path.join(ws.root, 'f'), 'utf8'), 'original');
  } finally { ws.remove(); }
});

test('createExclusiveFileAt: existing directory refused', () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'd'));
    assert.deepEqual(addon.createExclusiveFileAt(ws.rootFd, 'd'), { ok: false, code: 'exists' });
  } finally { ws.remove(); }
});

test('createExclusiveFileAt: existing symlink refused (dangling and live)', () => {
  const ws = makeRoot();
  try {
    fs.symlinkSync('missing-target', path.join(ws.root, 'dangling'));
    fs.writeFileSync(path.join(ws.root, 'target'), 'x');
    fs.symlinkSync(path.join(ws.root, 'target'), path.join(ws.root, 'live'));
    assert.deepEqual(addon.createExclusiveFileAt(ws.rootFd, 'dangling'), { ok: false, code: 'exists' });
    assert.deepEqual(addon.createExclusiveFileAt(ws.rootFd, 'live'), { ok: false, code: 'exists' });
  } finally { ws.remove(); }
});

test('openExistingFileAt: regular file opens with fixed flags; Node reads through the fd', () => {
  const ws = makeRoot();
  try {
    fs.writeFileSync(path.join(ws.root, 'f'), 'payload');
    const r = addon.openExistingFileAt(ws.rootFd, 'f');
    assert.equal(r.ok, true);
    const buf = Buffer.alloc(7);
    assert.equal(fs.readSync(r.fd, buf, 0, 7, 0), 7);
    assert.equal(buf.toString(), 'payload');
    fs.closeSync(r.fd);
  } finally { ws.remove(); }
});

test('openExistingFileAt: symlink refused (O_NOFOLLOW)', () => {
  const ws = makeRoot();
  try {
    fs.writeFileSync(path.join(ws.root, 't'), 'x');
    fs.symlinkSync(path.join(ws.root, 't'), path.join(ws.root, 'l'));
    assert.deepEqual(addon.openExistingFileAt(ws.rootFd, 'l'), { ok: false, code: 'symlink-refused' });
  } finally { ws.remove(); }
});

test('openExistingFileAt: missing file typed not-found', () => {
  const ws = makeRoot();
  try {
    assert.deepEqual(addon.openExistingFileAt(ws.rootFd, 'nope'), { ok: false, code: 'not-found' });
  } finally { ws.remove(); }
});

test('unlinkAt: removes only the requested final component below the retained fd', () => {
  const ws = makeRoot();
  try {
    fs.writeFileSync(path.join(ws.root, 'a'), '1');
    fs.writeFileSync(path.join(ws.root, 'b'), '2');
    assert.deepEqual(addon.unlinkAt(ws.rootFd, 'a'), { ok: true });
    assert.equal(fs.existsSync(path.join(ws.root, 'a')), false);
    assert.equal(fs.existsSync(path.join(ws.root, 'b')), true);
  } finally { ws.remove(); }
});

test('unlinkAt: directory cannot be deleted (no AT_REMOVEDIR, typed failure)', () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'd'));
    const r = addon.unlinkAt(ws.rootFd, 'd');
    assert.equal(r.ok, false);
    assert.equal(typeof r.code, 'string');
    assert.equal(fs.statSync(path.join(ws.root, 'd')).isDirectory(), true);
  } finally { ws.remove(); }
});

test('unlinkAt: missing target typed not-found', () => {
  const ws = makeRoot();
  try {
    assert.deepEqual(addon.unlinkAt(ws.rootFd, 'nope'), { ok: false, code: 'not-found' });
  } finally { ws.remove(); }
});

test('getPath: valid directory descriptor returns the expected canonical path', () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'd'));
    const r = addon.openDirectoryAt(ws.rootFd, 'd');
    assert.equal(addon.getPath(r.fd).path, fs.realpathSync(path.join(ws.root, 'd')));
    fs.closeSync(r.fd);
  } finally { ws.remove(); }
});

test('getPath: file descriptors are supported', () => {
  const ws = makeRoot();
  try {
    fs.writeFileSync(path.join(ws.root, 'f'), 'x');
    const fd = fs.openSync(path.join(ws.root, 'f'), O.O_RDONLY);
    assert.equal(addon.getPath(fd).path, fs.realpathSync(path.join(ws.root, 'f')));
    fs.closeSync(fd);
  } finally { ws.remove(); }
});

test('getPath: rename updates the reported path (vnode identity, not lexical)', () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'd'));
    const r = addon.openDirectoryAt(ws.rootFd, 'd');
    const moved = path.join(ws.root, 'd-moved');
    fs.renameSync(path.join(ws.root, 'd'), moved);
    // F_GETPATH reports the vnode's CURRENT path — the rename target.
    assert.equal(addon.getPath(r.fd).path, fs.realpathSync(moved));
    fs.closeSync(r.fd);
  } finally { ws.remove(); }
});

test('getPath: invalid/closed fd fails closed', () => {
  const ws = makeRoot();
  try {
    const fd = fs.openSync(ws.root, O.O_RDONLY);
    fs.closeSync(fd); // closed
    assert.deepEqual(addon.getPath(fd), { ok: false, code: 'invalid-fd' });
    assert.deepEqual(addon.getPath(1 << 30), { ok: false, code: 'invalid-fd' });
  } finally { ws.remove(); }
});
