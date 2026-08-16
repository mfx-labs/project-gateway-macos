/**
 * MAC-3D — reader/enumeration hostile verification, filesystem layer
 * (real Intel filesystem; deterministic structural sequencing only).
 *
 * Evidence class: B — structural descriptor-first sequencing. The
 * retained descriptor is obtained FIRST, the lexical state is replaced,
 * then the next descriptor-relative operation runs. There is NO accepted
 * reader seam (the reader has no hooks by accepted design — MAC-3A §8),
 * and no new production seam is added merely to make a test possible.
 * Zero sleeps, zero retry-until-win, zero scheduler dependence.
 *
 * Rows covered (MAC-3A §20):
 *   - W-R1 (RACE-I09): the pre-open residual race is not claimed atomic —
 *     the accepted bind-time semantics are LOCKED: a different regular
 *     file at the accepted pathname is bound at decision time
 *     (Linux-identical); a directory at the target fails the type gate
 *     with the exact `unsupported-type` code.
 *   - W-R3 (RACE-I03): a final-component symlink substitution before the
 *     open fails closed as `not-found` (O_NOFOLLOW); the decoy is never
 *     read; a dangling symlink is refused identically.
 *   - W-R4 (RACE-I09): after the descriptor opens, the exported S-07
 *     evidence functions (statResolvedTarget / statIdentity /
 *     verifyDescriptorIdentity) expose the post-open mismatch against the
 *     re-resolved decision — the fail-closed boundary the service routes
 *     to ERR-CON-DENIED (see mac3d-service-hostile.test.ts).
 *   - W-R9 (RACE-I01, I09): the retained ORIGINAL root descriptor keeps
 *     authority across root rename + decoy-root replacement for reads AND
 *     enumeration — the decoy root is never consulted.
 *   - RACE-I12 carry: repeated enumeration from the same caller fd stays
 *     anchored to the opened vnode across rename + replacement churn;
 *     passes are independent (no shared stream position, caller fd not
 *     consumed or repositioned).
 *   - RACE-I13 / MAC-3A §15: reader-layer enumeration fd-stability
 *     (repeated passes and repeated enumeration-open failures).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bindWorkspaceRoot,
  openForRead,
  openForListDirectory,
  readFileBytes,
  listDirectoryEntries,
  statResolvedTarget,
  statIdentity,
  verifyDescriptorIdentity,
} from '../../../src/reader/fs.js';

const roots: string[] = [];
function makeRoot(): { root: string; remove: () => void } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac3d-reader-')));
  const cleanup = () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort fixture cleanup
    }
  };
  roots.push(root);
  return { root, remove: cleanup };
}

function fdCount(): number {
  return fs.readdirSync('/dev/fd').length;
}

after(() => {
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

// ─────────────────── W-R1 — accepted bind-time semantics lock (B-type) ───────────────────

test('mac3d W-R1: a different regular file at the accepted pathname is bound at decision time (accepted S-07 semantics LOCK)', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'DECISION-TIME-BYTES');
    const bound = await bindWorkspaceRoot(ws.root);
    // Same-path replacement BEFORE the open: the object at the accepted
    // resolved pathname is now a DIFFERENT regular file. The accepted
    // contract does NOT claim the pre-open window atomic (RACE-I09):
    // the descent binds the bind-time object at the accepted pathname.
    fs.rmSync(path.join(ws.root, 'sub', 'file.txt'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'BIND-TIME-BYTES');
    const opened = await openForRead(bound, 'sub/file.txt', 'sub/file.txt');
    assert.equal(opened.ok, true, 'the bind-time regular file is opened (decision-time pathname semantics)');
    if (!opened.ok) return;
    const { bytes } = await readFileBytes(opened.target, 64);
    assert.equal(bytes.toString(), 'BIND-TIME-BYTES', 'the object bound is the object present at the accepted pathname at open time');
    opened.target.close();
    await bound.close();
  } finally {
    ws.remove();
  }
});

test('mac3d W-R1: a directory at the target before open fails the type gate — exact unsupported-type, never read', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'DECISION-TIME-BYTES');
    const bound = await bindWorkspaceRoot(ws.root);
    // Same-path replacement with a DIRECTORY before the open.
    fs.rmSync(path.join(ws.root, 'sub', 'file.txt'));
    fs.mkdirSync(path.join(ws.root, 'sub', 'file.txt'));
    const opened = await openForRead(bound, 'sub/file.txt', 'sub/file.txt');
    assert.deepEqual(opened, { ok: false, code: 'unsupported-type' }, 'directory target fails the inherited type gate');
    assert.equal(fs.lstatSync(path.join(ws.root, 'sub', 'file.txt')).isDirectory(), true, 'directory untouched');
    await bound.close();
  } finally {
    ws.remove();
  }
});

// ─────────────────── W-R3 — final-component symlink substitution (B-type) ───────────────────

test('mac3d W-R3: a final-component symlink swap before open fails closed as not-found; decoy never read', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'ORIGINAL');
    const bound = await bindWorkspaceRoot(ws.root);
    const decoy = path.join(ws.root, 'decoy-target.txt');
    fs.writeFileSync(decoy, 'DECOY-BYTES');
    // Substitution BEFORE the open: the final component becomes a symlink
    // to a decoy file (in-root). The seam's fixed O_NOFOLLOW refuses it at
    // open time — earlier fail-closed than the inherited Linux path.
    fs.rmSync(path.join(ws.root, 'sub', 'file.txt'));
    fs.symlinkSync(decoy, path.join(ws.root, 'sub', 'file.txt'));
    const opened = await openForRead(bound, 'sub/file.txt', 'sub/file.txt');
    assert.deepEqual(opened, { ok: false, code: 'not-found' }, 'symlink final component fails closed in the accepted reader vocabulary');
    assert.deepEqual(fs.readFileSync(decoy, 'utf8'), 'DECOY-BYTES', 'decoy never read (byte-identical)');
    assert.equal(fs.readlinkSync(path.join(ws.root, 'sub', 'file.txt')), decoy, 'symlink untouched');
    await bound.close();
  } finally {
    ws.remove();
  }
});

test('mac3d W-R3: a dangling-symlink final component before open fails closed as not-found', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'ORIGINAL');
    const bound = await bindWorkspaceRoot(ws.root);
    fs.rmSync(path.join(ws.root, 'sub', 'file.txt'));
    fs.symlinkSync('nowhere', path.join(ws.root, 'sub', 'file.txt'));
    const opened = await openForRead(bound, 'sub/file.txt', 'sub/file.txt');
    assert.deepEqual(opened, { ok: false, code: 'not-found' }, 'dangling symlink refused, never followed');
    assert.equal(fs.readlinkSync(path.join(ws.root, 'sub', 'file.txt')), 'nowhere', 'symlink untouched');
    await bound.close();
  } finally {
    ws.remove();
  }
});

// ─────────── W-R4 — post-open S-07 identity mismatch (exported evidence functions) ───────────

test('mac3d W-R4: post-open replacement exposes the S-07 mismatch — bind-time stat sees the decoy, the retained fd holds the original', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'ORIGINAL-BYTES');
    const bound = await bindWorkspaceRoot(ws.root);
    const opened = await openForRead(bound, 'sub/file.txt', 'sub/file.txt');
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    // Post-open churn: the opened object is renamed away and a decoy takes
    // the accepted pathname.
    fs.renameSync(path.join(ws.root, 'sub', 'file.txt'), path.join(ws.root, 'sub', 'file-moved.txt'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'DECOY-BYTES');

    // The accepted bind-time evidence (a trusted stat of the resolved
    // target, taken immediately around descriptor acquisition) now sees the
    // DECOY; the opened descriptor still holds the ORIGINAL object.
    const accepted = statResolvedTarget(path.join(ws.root, 'sub', 'file.txt'));
    assert.notEqual(accepted, null, 'bind-time stat resolves the current pathname object');
    const openedIdentity = statIdentity(fs.fstatSync(opened.target.fd));
    if (accepted === null) return;
    assert.equal(
      verifyDescriptorIdentity(openedIdentity, accepted),
      false,
      'dev/ino identity mismatch detected — this is the fail-closed boundary the service routes to ERR-CON-DENIED',
    );
    // No path rediscovery after binding: the retained fd still reads the
    // ORIGINAL object; the decoy at the pathname is never adopted.
    const { bytes } = await readFileBytes(opened.target, 64);
    assert.equal(bytes.toString(), 'ORIGINAL-BYTES', 'the retained descriptor keeps the original object');
    assert.equal(fs.readFileSync(path.join(ws.root, 'sub', 'file.txt'), 'utf8'), 'DECOY-BYTES', 'decoy byte-identical');
    opened.target.close();
    await bound.close();
  } finally {
    ws.remove();
  }
});

// ─────────────── W-R9 — retained root descriptor across root churn (B-type) ───────────────

test('mac3d W-R9 fs: reads continue from the retained ORIGINAL root after rename + decoy-root replacement', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'ORIGINAL-ROOT-BYTES');
    const bound = await bindWorkspaceRoot(ws.root);
    // Root churn: the root pathname now holds a DECOY tree; the retained
    // root fd pins the original vnode.
    const moved = `${ws.root}-moved`;
    fs.renameSync(ws.root, moved);
    fs.mkdirSync(ws.root, { recursive: true });
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'DECOY-ROOT-BYTES');

    const opened = await openForRead(bound, 'sub/file.txt', 'sub/file.txt');
    assert.equal(opened.ok, true, 'descent continues through the retained root descriptor');
    if (!opened.ok) return;
    const { bytes } = await readFileBytes(opened.target, 64);
    assert.equal(bytes.toString(), 'ORIGINAL-ROOT-BYTES', 'bytes come from the retained original root');
    assert.equal(fs.readFileSync(path.join(ws.root, 'sub', 'file.txt'), 'utf8'), 'DECOY-ROOT-BYTES', 'decoy root untouched');
    opened.target.close();
    await bound.close();
  } finally {
    ws.remove();
  }
});

test('mac3d W-R9 fs: enumeration continues from the retained ORIGINAL root after rename + decoy-root replacement', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'orig-only'), 'x');
    const bound = await bindWorkspaceRoot(ws.root);
    const moved = `${ws.root}-moved`;
    fs.renameSync(ws.root, moved);
    fs.mkdirSync(ws.root, { recursive: true });
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'decoy-only'), 'x');

    const opened = await openForListDirectory(bound, 'sub', 'sub');
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const { entries, truncated } = listDirectoryEntries(opened.target, 100);
    assert.equal(truncated, false);
    const names = entries.map((e) => e.name);
    assert.deepEqual(names, ['orig-only'], 'entries come from the retained original root');
    assert.ok(!names.includes('decoy-only'), 'the decoy root is never enumerated');
    opened.target.close();
    await bound.close();
  } finally {
    ws.remove();
  }
});

// ─────────── RACE-I12 carry — enumeration anchor across churn; caller fd untouched ───────────

test('mac3d RACE-I12: repeated enumeration from one caller fd re-anchors to the opened vnode across rename + replacement churn', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(ws.root, 'sub', `orig${i}`), 'x');
    const bound = await bindWorkspaceRoot(ws.root);
    const opened = await openForListDirectory(bound, 'sub', 'sub');
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    // Pass 1: baseline entries from the retained fd.
    const pass1 = listDirectoryEntries(opened.target, 100);
    assert.equal(pass1.truncated, false);

    // Churn: rename the opened directory away, plant a decoy directory at
    // the old name.
    const moved = path.join(ws.root, 'sub-moved');
    fs.renameSync(path.join(ws.root, 'sub'), moved);
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'decoy-only'), 'x');

    // Pass 2 and pass 3 on the SAME caller fd: every call re-anchors via
    // the seam's private openat(fd, ".") descriptor — independent stream
    // offsets, no repositioning, no consumption of the caller fd.
    const pass2 = listDirectoryEntries(opened.target, 100);
    const pass3 = listDirectoryEntries(opened.target, 100);
    for (const pass of [pass2, pass3]) {
      assert.equal(pass.truncated, false);
      assert.deepEqual(
        pass.entries.map((e) => e.name),
        ['orig0', 'orig1', 'orig2'],
        'enumeration stays anchored to the opened vnode (original entries, sorted)',
      );
      assert.ok(!pass.entries.some((e) => e.name === 'decoy-only'), 'the decoy directory is never enumerated');
    }
    opened.target.close();
    await bound.close();
  } finally {
    ws.remove();
  }
});

// ─────────── RACE-I13 / MAC-3A §15 — reader-layer enumeration fd-stability ───────────

test('mac3d fd-stability: repeated enumeration passes from one target fd are independent and leak-free', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(ws.root, 'sub', `entry${i}`), 'x');
    const bound = await bindWorkspaceRoot(ws.root);
    const opened = await openForListDirectory(bound, 'sub', 'sub');
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const before = fdCount();
    const expected = ['entry0', 'entry1', 'entry2', 'entry3', 'entry4'];
    for (let i = 0; i < 100; i++) {
      const { entries, truncated } = listDirectoryEntries(opened.target, 100);
      assert.equal(truncated, false);
      assert.deepEqual(entries.map((e) => e.name), expected, 'every pass is a complete independent enumeration');
    }
    const afterCount = fdCount();
    assert.ok(afterCount <= before + 2, `reader enumeration fd count stable: ${before} -> ${afterCount}`);
    opened.target.close();
    await bound.close();
  } finally {
    ws.remove();
  }
});

test('mac3d fd-stability: repeated enumeration-open failures are leak-free with exact typed codes', async () => {
  const ws = makeRoot();
  try {
    const bound = await bindWorkspaceRoot(ws.root);
    const before = fdCount();
    for (let i = 0; i < 60; i++) {
      const r = await openForListDirectory(bound, 'nope/deeper', 'nope/deeper');
      assert.deepEqual(r, { ok: false, code: 'not-found' }, 'missing intermediate fails closed (list op)');
    }
    const afterCount = fdCount();
    assert.ok(afterCount <= before + 2, `enumeration-open failure fd count stable: ${before} -> ${afterCount}`);
    await bound.close();
  } finally {
    ws.remove();
  }
});
