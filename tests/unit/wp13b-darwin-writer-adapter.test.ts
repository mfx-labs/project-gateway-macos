/**
 * MAC-2C — Darwin completion-writer adapter tests (real Intel filesystem).
 *
 * Writer-position-specific behavior only: verified-descent open, the
 * DISTINCT `exists` result (routes to the inherited EEXIST recovery),
 * recovery open (fixed O_NONBLOCK flags), cleanup, identity evidence,
 * pure code mapping (unknown native codes fail closed), and the §17
 * recovery-anchor probe: create/recovery/cleanup through a RETAINED
 * parent fd must never bind to a lexical decoy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  openDirectoryAtWriter,
  identityOf,
  createExclusiveFileWriter,
  openExistingFileWriter,
  cleanupCreated,
  mapWriterDescent,
  mapWriterCreate,
  mapWriterRecovery,
} from '../../src/internal/darwin-fs/writer.js';

const O = fs.constants;

function makeWs() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac2c-adapter-')));
  const rootFd = fs.openSync(root, O.O_RDONLY | O.O_DIRECTORY);
  return {
    root,
    rootFd,
    remove() { try { fs.closeSync(rootFd); } catch {} fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test('openDirectoryAtWriter: success; missing -> missing-parent; non-directory -> parent-not-verified; symlink -> containment-denied', () => {
  const ws = makeWs();
  try {
    fs.mkdirSync(path.join(ws.root, 'd'));
    fs.writeFileSync(path.join(ws.root, 'f'), 'x');
    fs.mkdirSync(path.join(ws.root, 'real'));
    fs.symlinkSync(path.join(ws.root, 'real'), path.join(ws.root, 'link'));
    const ok = openDirectoryAtWriter(ws.rootFd, 'd');
    assert.equal(ok.ok, true);
    if (ok.ok) fs.closeSync(ok.fd);
    assert.deepEqual(openDirectoryAtWriter(ws.rootFd, 'nope'), { ok: false, code: 'missing-parent' });
    assert.deepEqual(openDirectoryAtWriter(ws.rootFd, 'f'), { ok: false, code: 'parent-not-verified' });
    const sym = openDirectoryAtWriter(ws.rootFd, 'link');
    assert.equal(sym.ok, false);
    if (!sym.ok) {
      // Darwin: O_DIRECTORY|O_NOFOLLOW on a symlink-to-directory yields
      // ENOTDIR -> parent-not-verified; a symlink-to-file yields ELOOP ->
      // containment-denied. Both fail closed (never followed).
      assert.ok(['containment-denied', 'parent-not-verified'].includes(sym.code), `code was ${sym.code}`);
    }
  } finally { ws.remove(); }
});

test('identityOf: exact equality passes; mismatch and closed fd fail closed', () => {
  const ws = makeWs();
  try {
    fs.mkdirSync(path.join(ws.root, 'd'));
    const r = openDirectoryAtWriter(ws.rootFd, 'd');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(identityOf(r.fd, path.join(ws.root, 'd')).ok, true);
      assert.deepEqual(identityOf(r.fd, path.join(ws.root, 'other')), { ok: false, code: 'parent-not-verified' });
      const closed = fs.openSync(ws.root, O.O_RDONLY);
      fs.closeSync(closed);
      assert.deepEqual(identityOf(closed, ws.root), { ok: false, code: 'parent-not-verified' });
      fs.closeSync(r.fd);
    }
  } finally { ws.remove(); }
});

test('createExclusiveFileWriter: creates at 0600; existing object is the DISTINCT exists result (recovery routing)', () => {
  const ws = makeWs();
  try {
    const prev = process.umask(0);
    try {
      const c = createExclusiveFileWriter(ws.rootFd, 'x.json');
      assert.equal(c.ok, true);
      if (c.ok) {
        assert.equal(fs.fstatSync(c.fd).mode & 0o777, 0o600);
        fs.closeSync(c.fd);
      }
    } finally { process.umask(prev); }
    assert.deepEqual(createExclusiveFileWriter(ws.rootFd, 'x.json'), { ok: false, code: 'exists' }, 'existing file is routed to recovery, not a silent conflict');
    fs.mkdirSync(path.join(ws.root, 'dir'));
    assert.deepEqual(createExclusiveFileWriter(ws.rootFd, 'dir'), { ok: false, code: 'exists' }, 'existing directory is EEXIST via openat O_EXCL');
    fs.symlinkSync('nowhere', path.join(ws.root, 'dangling'));
    assert.deepEqual(createExclusiveFileWriter(ws.rootFd, 'dangling'), { ok: false, code: 'exists' }, 'dangling symlink is EEXIST via openat O_EXCL');
    assert.deepEqual(createExclusiveFileWriter(ws.rootFd, 'nope/x.json'), { ok: false, code: 'io-failure' }, 'multi-component is invalid-input -> io-failure (defensive; JS validates first)');
  } finally { ws.remove(); }
});

test('openExistingFileWriter: regular file opens; symlink -> conflict; missing -> io-failure; FIFO opens nonblocking (writer fstat rejects)', () => {
  const ws = makeWs();
  try {
    fs.writeFileSync(path.join(ws.root, 'f'), 'payload');
    const r = openExistingFileWriter(ws.rootFd, 'f');
    assert.equal(r.ok, true);
    if (r.ok) {
      const buf = Buffer.alloc(7);
      assert.equal(fs.readSync(r.fd, buf, 0, 7, 0), 7);
      assert.equal(buf.toString(), 'payload');
      fs.closeSync(r.fd);
    }
    fs.writeFileSync(path.join(ws.root, 't'), 'x');
    fs.symlinkSync(path.join(ws.root, 't'), path.join(ws.root, 'l'));
    assert.deepEqual(openExistingFileWriter(ws.rootFd, 'l'), { ok: false, code: 'exclusive-create-conflict' });
    assert.deepEqual(openExistingFileWriter(ws.rootFd, 'missing'), { ok: false, code: 'io-failure' });
    // FIFO: fixed O_NONBLOCK guarantees prompt open; the writer-side fstat
    // is the gate that rejects it (never acceptance by open success).
    const fifo = path.join(ws.root, 'pipe');
    execFileSync('mkfifo', [fifo]);
    const opened = openExistingFileWriter(ws.rootFd, 'pipe');
    assert.equal(opened.ok, true, 'O_NONBLOCK open of a FIFO returns promptly');
    if (opened.ok) {
      assert.equal(fs.fstatSync(opened.fd).isFIFO(), true);
      fs.closeSync(opened.fd);
    }
  } finally { ws.remove(); }
});

test('cleanupCreated: removes through the fd; permission failure is typed failed', () => {
  const ws = makeWs();
  try {
    const c = createExclusiveFileWriter(ws.rootFd, 'x.json');
    assert.equal(c.ok, true);
    if (c.ok) fs.closeSync(c.fd);
    assert.equal(cleanupCreated(ws.rootFd, 'x.json'), 'removed');
    assert.equal(fs.existsSync(path.join(ws.root, 'x.json')), false);
    fs.mkdirSync(path.join(ws.root, 'ro'));
    fs.chmodSync(path.join(ws.root, 'ro'), 0o500);
    assert.equal(cleanupCreated(ws.rootFd, 'ro'), 'failed', 'directory cannot be removed and permission failure is typed failed');
    fs.chmodSync(path.join(ws.root, 'ro'), 0o700);
  } finally { ws.remove(); }
});

test('anchor (MAC-2C §17): recovery through the RETAINED parent fd adopts from the original — never from a lexical decoy', () => {
  const ws = makeWs();
  try {
    const exact = Buffer.from('{"exact":"retained-original"}');
    fs.mkdirSync(path.join(ws.root, 'attempt'));
    fs.writeFileSync(path.join(ws.root, 'attempt', 'execution-result.json'), exact);
    const attemptFd = openDirectoryAtWriter(ws.rootFd, 'attempt');
    assert.equal(attemptFd.ok, true);
    if (!attemptFd.ok) return;
    // Rename the retained object away and plant a decoy at the old name
    // holding DIFFERENT bytes.
    const moved = path.join(ws.root, 'attempt-moved');
    fs.renameSync(path.join(ws.root, 'attempt'), moved);
    fs.mkdirSync(path.join(ws.root, 'attempt'));
    fs.writeFileSync(path.join(ws.root, 'attempt', 'execution-result.json'), '{"decoy":true}');
    // Create through the retained fd: the original already holds the file.
    assert.deepEqual(createExclusiveFileWriter(attemptFd.fd, 'execution-result.json'), { ok: false, code: 'exists' });
    // Recovery through the retained fd: must read the RETAINED ORIGINAL's
    // exact bytes — never the decoy's conflicting bytes.
    const recovery = openExistingFileWriter(attemptFd.fd, 'execution-result.json');
    assert.equal(recovery.ok, true);
    if (recovery.ok) {
      const buf = Buffer.alloc(exact.byteLength);
      assert.equal(fs.readSync(recovery.fd, buf, 0, exact.byteLength, 0), exact.byteLength);
      assert.deepEqual(buf, exact, 'recovery bound to the retained original');
      assert.notDeepEqual(buf, Buffer.from('{"decoy":true}'));
      fs.closeSync(recovery.fd);
    }
    // Cleanup through the retained fd removes the ORIGINAL's file; the
    // decoy is untouched.
    assert.equal(cleanupCreated(attemptFd.fd, 'execution-result.json'), 'removed');
    assert.equal(fs.existsSync(path.join(moved, 'execution-result.json')), false);
    assert.equal(fs.readFileSync(path.join(ws.root, 'attempt', 'execution-result.json'), 'utf8'), '{"decoy":true}', 'decoy untouched');
    fs.closeSync(attemptFd.fd);
  } finally { ws.remove(); }
});

test('anchor (MAC-2C §17): create through the retained empty parent fd never lands in a decoy directory', () => {
  const ws = makeWs();
  try {
    fs.mkdirSync(path.join(ws.root, 'attempt'));
    const attemptFd = openDirectoryAtWriter(ws.rootFd, 'attempt');
    assert.equal(attemptFd.ok, true);
    if (!attemptFd.ok) return;
    const moved = path.join(ws.root, 'attempt-moved');
    fs.renameSync(path.join(ws.root, 'attempt'), moved);
    fs.mkdirSync(path.join(ws.root, 'attempt'));
    const c = createExclusiveFileWriter(attemptFd.fd, 'execution-result.json');
    assert.equal(c.ok, true);
    if (c.ok) {
      fs.writeSync(c.fd, Buffer.from('x'));
      fs.closeSync(c.fd);
    }
    assert.equal(fs.existsSync(path.join(moved, 'execution-result.json')), true, 'create stayed in the retained original');
    assert.equal(fs.existsSync(path.join(ws.root, 'attempt', 'execution-result.json')), false, 'decoy received nothing');
    assert.equal(identityOf(attemptFd.fd, moved).ok, true, 'fd still identifies the moved original');
    fs.closeSync(attemptFd.fd);
  } finally { ws.remove(); }
});

test('pure code mapping: writer positions map into the inherited completion vocabulary; unknown codes fail closed', () => {
  // Descent position (inherited mapOpenError: ENOENT->missing-parent,
  // ENOTDIR->parent-not-verified, ELOOP/EMLINK->containment-denied,
  // default->io-failure).
  assert.equal(mapWriterDescent('not-found'), 'missing-parent');
  assert.equal(mapWriterDescent('not-directory'), 'parent-not-verified');
  assert.equal(mapWriterDescent('symlink-refused'), 'containment-denied');
  assert.equal(mapWriterDescent('permission-denied'), 'io-failure', 'writer collapses permission into io-failure (inherited)');
  assert.equal(mapWriterDescent('read-only'), 'io-failure');
  assert.equal(mapWriterDescent('invalid-fd'), 'io-failure');
  assert.equal(mapWriterDescent('bogus-code' as never), 'io-failure');
  // Create position: exists is DISTINCT (recovery routing); the rest mirror
  // the inherited create catch.
  assert.equal(mapWriterCreate('exists'), 'exists');
  assert.equal(mapWriterCreate('not-found'), 'missing-parent');
  assert.equal(mapWriterCreate('not-directory'), 'parent-not-verified');
  assert.equal(mapWriterCreate('symlink-refused'), 'containment-denied');
  assert.equal(mapWriterCreate('permission-denied'), 'io-failure');
  assert.equal(mapWriterCreate('mystery' as never), 'io-failure');
  // Recovery position: symlink -> conflict; everything else -> io-failure.
  assert.equal(mapWriterRecovery('symlink-refused'), 'exclusive-create-conflict');
  assert.equal(mapWriterRecovery('not-found'), 'io-failure');
  assert.equal(mapWriterRecovery('permission-denied'), 'io-failure');
  assert.equal(mapWriterRecovery('weird' as never), 'io-failure');
});
