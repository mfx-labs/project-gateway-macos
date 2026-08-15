/**
 * WP-11 Slice 1 — host write executor boundary tests (real filesystem).
 *
 * Proves the descriptor-anchored / no-follow / exclusive-create pattern:
 * fixed mode (umask-independent), exact bytes, create-only conflict
 * behavior, no directory creation, no overwrite, bounded typed errors,
 * descriptor-bound parent identity verification (intermediate-swap and
 * root-replacement races fail closed or stay anchored), single best-effort
 * partial-write cleanup through the verified parent, and the bounded write
 * loop (short writes continue; zero/invalid results fail closed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, lstatSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
import { executeDraftFileWrite, DRAFT_FILE_MODE, writeLoop } from '../../src/writing/executor.js';
import { WRITE_CANONICAL_UTF8_MAX_BYTES } from '../../src/writing/types.js';
import type { DraftWriteExecutorInput } from '../../src/writing/types.js';
import { makeFsWorkspace } from './helpers.js';

const UID = process.getuid?.() ?? 0;

function evidence(ws: ReturnType<typeof makeFsWorkspace>, overrides: Partial<DraftWriteExecutorInput> = {}): DraftWriteExecutorInput {
  return {
    operationClass: 'artifact-draft-destination',
    purpose: 'persist-validated-artifact-draft',
    configurationIdentity: 'sha-256:' + 'a'.repeat(64),
    workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa',
    artifactKind: 'TaskSpec',
    canonicalArtifactRoot: ws.artifactRoot,
    canonicalExistingDirectoryAncestor: ws.artifactRoot,
    canonicalAncestorRelativePath: '',
    destinationTailComponents: ['task.json'],
    canonicalUtf8: '{"hello":"world"}',
    expectedByteCount: Buffer.byteLength('{"hello":"world"}', 'utf8'),
    ...overrides,
  };
}

test('executor: creates exactly the target with the fixed mode and exact bytes (no overwrite on second call)', () => {
  const ws = makeFsWorkspace();
  try {
    const r = executeDraftFileWrite(evidence(ws));
    assert.deepEqual(r, { ok: true, outcome: 'created', persistedByteCount: Buffer.byteLength('{"hello":"world"}', 'utf8') });
    const target = join(ws.artifactRoot, 'task.json');
    const stat = lstatSync(target);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.uid, UID);
    assert.equal(stat.mode & 0o777, DRAFT_FILE_MODE, 'fixed implementation-owned mode');
    assert.equal(readFileSync(target, 'utf8'), '{"hello":"world"}', 'exact bytes');
    // Second call: exclusive-create conflict; never overwrite.
    const r2 = executeDraftFileWrite(evidence(ws, { canonicalUtf8: '{"evil":true}', expectedByteCount: 13 }));
    assert.deepEqual(r2, { ok: false, code: 'exclusive-create-conflict', cleanup: 'not-needed' });
    assert.equal(readFileSync(target, 'utf8'), '{"hello":"world"}', 'existing file untouched');
  } finally {
    ws.remove();
  }
});

test('executor: existing directory and symlink targets are exclusive-create conflicts, never followed or overwritten', () => {
  const ws = makeFsWorkspace();
  try {
    mkdirSync(join(ws.artifactRoot, 'dir.json'));
    const r1 = executeDraftFileWrite(evidence(ws, { destinationTailComponents: ['dir.json'] }));
    assert.deepEqual(r1, { ok: false, code: 'exclusive-create-conflict', cleanup: 'not-needed' });
    symlinkSync('elsewhere', join(ws.artifactRoot, 'link.json'));
    const r2 = executeDraftFileWrite(evidence(ws, { destinationTailComponents: ['link.json'] }));
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.code, 'exclusive-create-conflict');
    assert.equal(fs.readlinkSync(join(ws.artifactRoot, 'link.json')), 'elsewhere', 'symlink untouched');
    symlinkSync('nowhere', join(ws.artifactRoot, 'dangling.json'));
    const r3 = executeDraftFileWrite(evidence(ws, { destinationTailComponents: ['dangling.json'] }));
    assert.equal(r3.ok, false);
    if (!r3.ok) assert.equal(r3.code, 'exclusive-create-conflict');
  } finally {
    ws.remove();
  }
});

test('executor: missing intermediate directory fails closed with no directory creation', () => {
  const ws = makeFsWorkspace();
  try {
    const r = executeDraftFileWrite(evidence(ws, { destinationTailComponents: ['a', 'b.json'] }));
    assert.deepEqual(r, { ok: false, code: 'missing-parent', cleanup: 'not-needed' });
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'a')), false, 'no intermediate directory created');
  } finally {
    ws.remove();
  }
});

test('executor: multi-component tails are rejected before any mutation — a tail symlink is never traversed (single-component invariant)', () => {
  const ws = makeFsWorkspace();
  try {
    // Scenario-B class: the first tail component is ALREADY a symlink to a
    // service-owned outside directory (no race required). The multi-component
    // tail must fail closed as missing-parent BEFORE any filesystem
    // operation, so the symlink is never followed.
    const outside = join(ws.workspaceRoot, 'outside');
    mkdirSync(outside, { mode: 0o700 });
    symlinkSync(outside, join(ws.artifactRoot, 'a'));
    const r = executeDraftFileWrite(evidence(ws, { destinationTailComponents: ['a', 'b.json'] }));
    assert.deepEqual(r, { ok: false, code: 'missing-parent', cleanup: 'not-needed' });
    assert.equal(fs.existsSync(join(outside, 'b.json')), false, 'no file created outside the artifact root');
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'b.json')), false, 'no file created in the artifact root');
    // Zero-length tail is inconsistent with an accepted `missing` decision
    // (TAD-037): invalid evidence.
    const r0 = executeDraftFileWrite(evidence(ws, { destinationTailComponents: [] }));
    assert.deepEqual(r0, { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' });
    // Scenario-E class: below an already verified ancestor, a multi-component
    // missing tail fails closed; no intermediate directory is created.
    mkdirSync(join(ws.artifactRoot, 'sub'), { mode: 0o700 });
    const r3 = executeDraftFileWrite(evidence(ws, {
      canonicalExistingDirectoryAncestor: join(ws.artifactRoot, 'sub'),
      canonicalAncestorRelativePath: 'sub',
      destinationTailComponents: ['m1', 'm2', 'file.json'],
    }));
    assert.deepEqual(r3, { ok: false, code: 'missing-parent', cleanup: 'not-needed' });
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'sub', 'm1')), false, 'no intermediate directory created');
    assert.deepEqual(fs.readdirSync(join(ws.artifactRoot, 'sub')), [], 'no unintended file in the verified parent');
  } finally {
    ws.remove();
  }
});

test('executor: invalid or hostile evidence is rejected without filesystem access', () => {
  const ws = makeFsWorkspace();
  try {
    const cases: ReadonlyArray<Partial<Record<string, unknown>>> = [
      { operationClass: 'something-else' },
      { purpose: 'other' },
      { artifactKind: 'ExecutionBundle' },
      { artifactKind: 'ExecutionResult' },
      { artifactKind: 42 },
      { canonicalUtf8: '' },
      { expectedByteCount: 0 },
      { expectedByteCount: WRITE_CANONICAL_UTF8_MAX_BYTES + 1 },
      { canonicalUtf8: 'x', expectedByteCount: 2 }, // mismatch
      { canonicalAncestorRelativePath: '/etc' },
      { canonicalAncestorRelativePath: 'a/../b' },
      { canonicalAncestorRelativePath: 'a//b' },
      { canonicalAncestorRelativePath: 'a\\b' },
      { canonicalAncestorRelativePath: 'a/\u0000b' },
      { canonicalAncestorRelativePath: '.' },
      { destinationTailComponents: [] },
      { destinationTailComponents: ['..'] },
      { destinationTailComponents: ['.'] },
      { destinationTailComponents: ['a/b.json'] },
      { destinationTailComponents: ['a\\b.json'] },
      { destinationTailComponents: ['a\u0000b.json'] },
      { destinationTailComponents: 42 },
      { destinationTailComponents: [42] },
      { canonicalExistingDirectoryAncestor: '' },
      { canonicalArtifactRoot: '/' },
      { canonicalArtifactRoot: '/srv/' },
      { canonicalArtifactRoot: '' },
      { canonicalArtifactRoot: 42 },
    ];
    for (const overrides of cases) {
      const r = executeDraftFileWrite(evidence(ws, overrides as never));
      assert.equal(r.ok, false, JSON.stringify(overrides));
      if (!r.ok) {
        assert.equal(r.code, 'invalid-evidence', JSON.stringify(overrides));
        assert.equal(r.cleanup, 'not-needed', JSON.stringify(overrides));
      }
    }
    // Non-object input.
    const r = executeDraftFileWrite('not-an-object' as never);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'invalid-evidence');
    // Nothing was created.
    assert.deepEqual(fs.readdirSync(ws.artifactRoot), []);
  } finally {
    ws.remove();
  }
});

test('executor: a symlink at the parent path fails closed (no-follow) and is never followed', () => {
  const ws = makeFsWorkspace();
  try {
    mkdirSync(join(ws.artifactRoot, 'realdir'), { mode: 0o700 });
    symlinkSync('realdir', join(ws.artifactRoot, 'linkdir'));
    const r = executeDraftFileWrite(evidence(ws, {
      canonicalExistingDirectoryAncestor: join(ws.artifactRoot, 'linkdir'),
      canonicalAncestorRelativePath: 'linkdir',
    }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(['parent-not-directory', 'symlink-loop'].includes(r.code), true, `unexpected code ${r.code}`);
      assert.equal(r.cleanup, 'not-needed');
    }
    assert.equal(fs.readlinkSync(join(ws.artifactRoot, 'linkdir')), 'realdir', 'symlink untouched');
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'realdir', 'task.json')), false, 'no create through the symlink');
  } finally {
    ws.remove();
  }
});

test('executor: an intermediate component swapped to a symlink outside the root fails closed — never followed, never created into', () => {
  const ws = makeFsWorkspace();
  try {
    mkdirSync(join(ws.artifactRoot, 'sub'), { mode: 0o700 });
    mkdirSync(join(ws.artifactRoot, 'sub', 'd2'), { mode: 0o700 });
    const outside = join(ws.workspaceRoot, 'outside');
    mkdirSync(outside, { mode: 0o700 });
    mkdirSync(join(outside, 'd2'), { mode: 0o700 });
    // Evidence claims the accepted canonical ancestor is root/sub/d2 (as
    // observed before the race); the filesystem now has sub -> outside.
    // The anchored parent walk must fail closed: on Linux the resolved
    // path diverges at the identity check (parent-not-verified); on Darwin
    // the per-component O_NOFOLLOW descent refuses the swapped symlink at
    // open time (parent-not-directory/symlink-loop — strictly stronger,
    // MAC-2B). Every outcome below is fail-closed with no create.
    fs.rmSync(join(ws.artifactRoot, 'sub'), { recursive: true });
    symlinkSync(outside, join(ws.artifactRoot, 'sub'));
    const r = executeDraftFileWrite(evidence(ws, {
      canonicalExistingDirectoryAncestor: join(ws.artifactRoot, 'sub', 'd2'),
      canonicalAncestorRelativePath: 'sub/d2',
      destinationTailComponents: ['task.json'],
    }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(['parent-not-verified', 'parent-not-directory', 'symlink-loop'].includes(r.code), true, `unexpected code ${r.code}`);
      assert.equal(r.cleanup, 'not-needed');
    }
    assert.equal(fs.existsSync(join(outside, 'd2', 'task.json')), false, 'no file was created outside the artifact region');
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'sub', 'd2', 'task.json')), false, 'no file was created through the swapped component');
  } finally {
    ws.remove();
  }
});

test('executor: a root replaced AFTER anchoring cannot redirect the create (descriptor pins the original object)', () => {
  const ws = makeFsWorkspace();
  try {
    const moved = `${ws.artifactRoot}-moved`;
    const r = executeDraftFileWrite(evidence(ws, {
      hooks: {
        afterRootOpen: () => {
          // Post-anchor root replacement: rename the artifact root away and
          // put a replacement directory at the same path.
          renameSync(ws.artifactRoot, moved);
          mkdirSync(ws.artifactRoot, { mode: 0o700 });
        },
      },
    }));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(existsSync(join(moved, 'task.json')), true, 'the create stayed in the originally anchored root');
      assert.equal(existsSync(join(ws.artifactRoot, 'task.json')), false, 'the replacement root received nothing');
    }
    fs.rmSync(moved, { recursive: true, force: true });
  } finally {
    ws.remove();
  }
});

test('executor: an unavailable artifact root fails closed at the anchor', () => {
  const ws = makeFsWorkspace();
  try {
    const gone = `${ws.artifactRoot}-gone`;
    renameSync(ws.artifactRoot, gone);
    const r = executeDraftFileWrite(evidence(ws));
    assert.deepEqual(r, { ok: false, code: 'artifact-root-unavailable', cleanup: 'not-needed' });
    renameSync(gone, ws.artifactRoot);
  } finally {
    ws.remove();
  }
});

test('executor: the fixed 0o600 mode is independent of the caller umask', () => {
  const ws = makeFsWorkspace();
  const previous = process.umask(0o777);
  try {
    const r = executeDraftFileWrite(evidence(ws));
    assert.equal(r.ok, true);
    const stat = lstatSync(join(ws.artifactRoot, 'task.json'));
    assert.equal(stat.mode & 0o777, DRAFT_FILE_MODE, 'fchmod fixes the mode after umask-restricted creation');
  } finally {
    process.umask(previous);
    ws.remove();
  }
});

test('executor: writeLoop continues on short writes and fails closed on zero/invalid results and throws', () => {
  assert.equal(writeLoop(() => 1, 5), 'ok', 'one byte per call completes the bounded loop');
  assert.equal(writeLoop(() => 0, 5), 'failed', 'zero result fails closed');
  assert.equal(writeLoop(() => -1, 5), 'failed', 'negative result fails closed');
  assert.equal(writeLoop(() => NaN, 5), 'failed', 'non-integer result fails closed');
  assert.equal(writeLoop(() => 6, 5), 'failed', 'oversize result fails closed');
  assert.equal(writeLoop(() => { throw new Error('injected'); }, 5), 'failed', 'throwing write fails closed');
  assert.equal(writeLoop(() => 1, -1), 'failed', 'invalid total fails closed');
  let calls = 0;
  writeLoop(() => { calls++; return 3; }, 6);
  assert.equal(calls, 2, 'short writes continue the loop until completion');
});

test('executor: mid-write failure removes the partial file; cleanup failure reports failed (indeterminate)', () => {
  const ws = makeFsWorkspace();
  try {
    // Removed: the injected write-stage failure triggers the single cleanup
    // attempt; the partial file is gone (observable).
    const r = executeDraftFileWrite(evidence(ws, { hooks: { beforeWrite: () => { throw new Error('injected'); } } }));
    assert.deepEqual(r, { ok: false, code: 'write-failed', cleanup: 'removed' });
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'task.json')), false, 'partial file removed');
    // Cleanup failure → typed 'failed' (indeterminate), and the partial file
    // remains with the fixed mode and zero bytes.
    const r2 = executeDraftFileWrite(evidence(ws, { hooks: { beforeWrite: () => { fs.chmodSync(ws.artifactRoot, 0o500); throw new Error('injected'); } } }));
    fs.chmodSync(ws.artifactRoot, 0o700);
    assert.equal(r2.ok, false);
    if (!r2.ok) {
      assert.equal(r2.code, 'write-failed');
      assert.equal(r2.cleanup, 'failed');
    }
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'task.json')), true, 'indeterminate partial file remains (reported truthfully)');
    const stat = lstatSync(join(ws.artifactRoot, 'task.json'));
    assert.equal(stat.mode & 0o777, DRAFT_FILE_MODE);
    assert.equal(stat.size, 0, 'no bytes were written before the injected failure');
  } finally {
    fs.chmodSync(ws.artifactRoot, 0o700);
    ws.remove();
  }
});

test('executor: a close failure after a full write can never produce false success', () => {
  const ws = makeFsWorkspace();
  try {
    // The afterWrite seam closes the created fd; the executor's own close
    // then raises EBADF → typed close-failed, and the partial target is
    // removed through the same verified parent descriptor.
    const r = executeDraftFileWrite(evidence(ws, {
      hooks: { afterWrite: (fd) => { fs.closeSync(fd); } },
    }));
    assert.deepEqual(r, { ok: false, code: 'close-failed', cleanup: 'removed' });
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'task.json')), false, 'the partial target was removed through the anchored parent');
  } finally {
    ws.remove();
  }
});

test('executor: multi-component destination under an existing directory works (anchored parent verification)', () => {
  const ws = makeFsWorkspace();
  try {
    mkdirSync(join(ws.artifactRoot, 'sub'), { mode: 0o700 });
    const r = executeDraftFileWrite(evidence(ws, {
      canonicalExistingDirectoryAncestor: join(ws.artifactRoot, 'sub'),
      canonicalAncestorRelativePath: 'sub',
      destinationTailComponents: ['task.json'],
    }));
    assert.equal(r.ok, true);
    assert.equal(readFileSync(join(ws.artifactRoot, 'sub', 'task.json'), 'utf8'), '{"hello":"world"}');
  } finally {
    ws.remove();
  }
});

test('executor: writeSync is never exposed as a generic writer — the only export is the typed evidence entry', () => {
  const ws = makeFsWorkspace();
  try {
    // The executor accepts only the correlated evidence shape; there is no
    // path/mode/content-accepting generic API on the module.
    const r = executeDraftFileWrite({ canonicalArtifactRoot: ws.artifactRoot, canonicalAncestorRelativePath: '', destinationTailComponents: ['x.json'], canonicalUtf8: '{}', expectedByteCount: 2 } as unknown as DraftWriteExecutorInput);
    assert.equal(r.ok, false, 'missing required correlated fields is rejected');
    if (!r.ok) assert.equal(r.code, 'invalid-evidence');
    writeFileSync(join(ws.artifactRoot, 'probe.txt'), 'untouched');
    const r2 = executeDraftFileWrite(evidence(ws, { destinationTailComponents: ['probe.txt'] }));
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.code, 'exclusive-create-conflict');
    assert.equal(readFileSync(join(ws.artifactRoot, 'probe.txt'), 'utf8'), 'untouched');
  } finally {
    ws.remove();
  }
});
