/**
 * MAC-2B — Darwin integration adapter tests (real Intel filesystem).
 *
 * Executor-relevant behavior only: single/multi-component descriptor
 * descent, intermediate-fd closure, typed failure mapping into the
 * inherited executor vocabulary, getPath identity, exclusive create,
 * at-most-one cleanup unlink, and the anchor sanity probe (retained
 * parent fd across lexical rename + replacement). The full native
 * primitive suite remains MAC-1's (native/test); this file does not
 * duplicate it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  descentToParent,
  verifyParentIdentity,
  createExclusiveFile,
  unlinkCreated,
  mapParentOpen,
  mapCreate,
} from '../../src/internal/darwin-fs/adapter.js';

const O = fs.constants;

function makeWs() {
  // realpath-canonical root (see helpers.ts note — F_GETPATH identity is
  // vnode-canonical; production canonical roots are symlink-resolved).
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac2b-adapter-')));;
  const rootFd = fs.openSync(root, O.O_RDONLY | O.O_DIRECTORY);
  return {
    root,
    rootFd,
    remove() { try { fs.closeSync(rootFd); } catch {} fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test('descentToParent: single-component descent returns a caller-owned directory fd', () => {
  const ws = makeWs();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    const r = descentToParent(ws.rootFd, 'sub');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(fs.fstatSync(r.parentFd).isDirectory(), true);
      assert.equal(verifyParentIdentity(r.parentFd, path.join(ws.root, 'sub')).ok, true);
      fs.closeSync(r.parentFd);
    }
  } finally { ws.remove(); }
});

test('descentToParent: multi-component descent composes single-component opens', () => {
  const ws = makeWs();
  try {
    fs.mkdirSync(path.join(ws.root, 'a'));
    fs.mkdirSync(path.join(ws.root, 'a', 'b'));
    const r = descentToParent(ws.rootFd, 'a/b');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(fs.fstatSync(r.parentFd).isDirectory(), true);
      assert.equal(verifyParentIdentity(r.parentFd, path.join(ws.root, 'a', 'b')).ok, true);
      fs.closeSync(r.parentFd);
    }
  } finally { ws.remove(); }
});

test('descentToParent: intermediate fds are closed on success (no leak)', () => {
  const ws = makeWs();
  try {
    fs.mkdirSync(path.join(ws.root, 'a'));
    fs.mkdirSync(path.join(ws.root, 'a', 'b'));
    const before = fs.readdirSync('/dev/fd').length;
    for (let i = 0; i < 100; i++) {
      const r = descentToParent(ws.rootFd, 'a/b');
      assert.equal(r.ok, true);
      if (r.ok) fs.closeSync(r.parentFd);
    }
    const after = fs.readdirSync('/dev/fd').length;
    assert.ok(after <= before + 2, `fd count grew: ${before} -> ${after}`);
  } finally { ws.remove(); }
});

test('descentToParent: missing component -> missing-parent, no intermediate leak', () => {
  const ws = makeWs();
  try {
    fs.mkdirSync(path.join(ws.root, 'a'));
    const before = fs.readdirSync('/dev/fd').length;
    const r = descentToParent(ws.rootFd, 'a/nope');
    assert.deepEqual(r, { ok: false, code: 'missing-parent' });
    fs.mkdirSync(path.join(ws.root, 'a', 'b'));
    const r2 = descentToParent(ws.rootFd, 'a/b/nope');
    assert.deepEqual(r2, { ok: false, code: 'missing-parent' });
    const after = fs.readdirSync('/dev/fd').length;
    assert.ok(after <= before + 2, `intermediate fds leaked: ${before} -> ${after}`);
  } finally { ws.remove(); }
});

test('descentToParent: non-directory component -> parent-not-directory', () => {
  const ws = makeWs();
  try {
    fs.writeFileSync(path.join(ws.root, 'f'), 'x');
    assert.deepEqual(descentToParent(ws.rootFd, 'f'), { ok: false, code: 'parent-not-directory' });
    fs.mkdirSync(path.join(ws.root, 'a'));
    fs.writeFileSync(path.join(ws.root, 'a', 'g'), 'x');
    assert.deepEqual(descentToParent(ws.rootFd, 'a/g'), { ok: false, code: 'parent-not-directory' });
  } finally { ws.remove(); }
});

test('descentToParent: symlink component fails closed (never followed)', () => {
  const ws = makeWs();
  try {
    fs.mkdirSync(path.join(ws.root, 'real'));
    fs.symlinkSync(path.join(ws.root, 'real'), path.join(ws.root, 'link'));
    const r = descentToParent(ws.rootFd, 'link');
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(['parent-not-directory', 'symlink-loop'].includes(r.code), true, `code was ${r.code}`);
    }
  } finally { ws.remove(); }
});

test('verifyParentIdentity: match passes; mismatch and failure fail closed as parent-not-verified', () => {
  const ws = makeWs();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    const r = descentToParent(ws.rootFd, 'sub');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(verifyParentIdentity(r.parentFd, path.join(ws.root, 'sub')).ok, true);
      assert.deepEqual(verifyParentIdentity(r.parentFd, path.join(ws.root, 'other')), { ok: false, code: 'parent-not-verified' });
      const closed = fs.openSync(ws.root, O.O_RDONLY);
      fs.closeSync(closed);
      assert.deepEqual(verifyParentIdentity(closed, path.join(ws.root, 'sub')), { ok: false, code: 'parent-not-verified' });
      fs.closeSync(r.parentFd);
    }
  } finally { ws.remove(); }
});

test('createExclusiveFile: creates with the seam-owned 0600 mode; existing target is exclusive-create-conflict', () => {
  const ws = makeWs();
  try {
    const prev = process.umask(0);
    try {
      const r = createExclusiveFile(ws.rootFd, 'task.json');
      assert.equal(r.ok, true);
      if (r.ok) {
        const st = fs.fstatSync(r.fd);
        assert.equal(st.mode & 0o777, 0o600, 'seam-owned fixed mode');
        fs.closeSync(r.fd);
      }
    } finally { process.umask(prev); }
    assert.deepEqual(createExclusiveFile(ws.rootFd, 'task.json'), { ok: false, code: 'exclusive-create-conflict' });
  } finally { ws.remove(); }
});

test('unlinkCreated: removes through the fd; failure is typed failed (indeterminate)', () => {
  const ws = makeWs();
  try {
    const c = createExclusiveFile(ws.rootFd, 'x.json');
    assert.equal(c.ok, true);
    if (c.ok) fs.closeSync(c.fd);
    assert.equal(unlinkCreated(ws.rootFd, 'x.json'), 'removed');
    assert.equal(fs.existsSync(path.join(ws.root, 'x.json')), false);
    // Permission failure: parent made read-only -> 'failed' (never a throw,
    // never a different path). unlinkCreated is single-component: the
    // parent fd must be the immediate parent of the target.
    fs.mkdirSync(path.join(ws.root, 'ro'));
    const ro = descentToParent(ws.rootFd, 'ro');
    assert.equal(ro.ok, true);
    if (!ro.ok) return;
    const c2 = createExclusiveFile(ro.parentFd, 'y.json');
    assert.equal(c2.ok, true);
    if (c2.ok) fs.closeSync(c2.fd);
    fs.chmodSync(path.join(ws.root, 'ro'), 0o500);
    assert.equal(unlinkCreated(ro.parentFd, 'y.json'), 'failed');
    fs.chmodSync(path.join(ws.root, 'ro'), 0o700);
    assert.equal(unlinkCreated(ro.parentFd, 'y.json'), 'removed');
    fs.closeSync(ro.parentFd);
  } finally { ws.remove(); }
});

test('anchor sanity (MAC-2B §15): retained parent fd survives rename + replacement; create never lands in the decoy', () => {
  const ws = makeWs();
  try {
    fs.mkdirSync(path.join(ws.root, 'parent'));
    const d = descentToParent(ws.rootFd, 'parent');
    assert.equal(d.ok, true);
    if (!d.ok) return;
    const parentFd = d.parentFd;
    const moved = path.join(ws.root, 'parent-moved');
    fs.renameSync(path.join(ws.root, 'parent'), moved);
    // Replacement A: a decoy directory at the old name.
    fs.mkdirSync(path.join(ws.root, 'parent'));
    const c = createExclusiveFile(parentFd, 'probe.txt');
    assert.equal(c.ok, true);
    if (c.ok) fs.closeSync(c.fd);
    assert.equal(fs.existsSync(path.join(moved, 'probe.txt')), true, 'create stayed in the retained original');
    assert.equal(fs.existsSync(path.join(ws.root, 'parent', 'probe.txt')), false, 'decoy received nothing');
    assert.equal(verifyParentIdentity(parentFd, moved).ok, true, 'fd still identifies the moved original');

    // Replacement B: old name replaced by a symlink to another directory;
    // unlink through the retained fd still targets the retained object.
    fs.rmSync(path.join(ws.root, 'parent'), { recursive: true, force: true });
    fs.mkdirSync(path.join(ws.root, 'decoy'));
    fs.writeFileSync(path.join(ws.root, 'decoy', 'probe.txt'), 'decoy-content');
    fs.symlinkSync(path.join(ws.root, 'decoy'), path.join(ws.root, 'parent'));
    assert.equal(unlinkCreated(parentFd, 'probe.txt'), 'removed');
    assert.equal(fs.existsSync(path.join(moved, 'probe.txt')), false, 'unlink targeted the retained original');
    assert.equal(fs.readFileSync(path.join(ws.root, 'decoy', 'probe.txt'), 'utf8'), 'decoy-content', 'symlink decoy untouched');
    fs.closeSync(parentFd);
  } finally { ws.remove(); }
});

test('pure code mapping: native codes map into the inherited executor vocabulary; unknown codes fail closed', () => {
  // Parent-descent position.
  assert.equal(mapParentOpen('not-found'), 'missing-parent');
  assert.equal(mapParentOpen('not-directory'), 'parent-not-directory');
  assert.equal(mapParentOpen('symlink-refused'), 'symlink-loop');
  assert.equal(mapParentOpen('permission-denied'), 'permission-denied');
  assert.equal(mapParentOpen('read-only'), 'readonly-filesystem');
  assert.equal(mapParentOpen('unsupported'), 'unsupported-filesystem');
  assert.equal(mapParentOpen('io-failure'), 'io-failure');
  // The native boundary is untyped JS at runtime; the switch must be total
  // over arbitrary strings (default branch fails closed).
  assert.equal(mapParentOpen('weird-unknown-code' as unknown as Parameters<typeof mapParentOpen>[0]), 'io-failure', 'unknown native code fails closed');
  // Final-create position.
  assert.equal(mapCreate('exists'), 'exclusive-create-conflict');
  assert.equal(mapCreate('symlink-refused'), 'exclusive-create-conflict');
  assert.equal(mapCreate('not-found'), 'missing-parent');
  assert.equal(mapCreate('not-directory'), 'parent-not-directory');
  assert.equal(mapCreate('permission-denied'), 'permission-denied');
  assert.equal(mapCreate('read-only'), 'readonly-filesystem');
  assert.equal(mapCreate('no-space'), 'no-space');
  assert.equal(mapCreate('quota'), 'quota-exceeded');
  assert.equal(mapCreate('unsupported'), 'unsupported-filesystem');
  assert.equal(mapCreate('mystery' as unknown as Parameters<typeof mapCreate>[0]), 'io-failure', 'unknown native code fails closed');
});
