/**
 * MAC-3C — writing-executor hostile-race verification (deterministic only).
 *
 * Evidence classes (MAC-3A §10): A = deterministic boundary pause through an
 * accepted executor seam (`afterRootOpen`/`beforeWrite`, MAC-2B accepted
 * pattern); B = structural sequencing (retained descriptor opened FIRST, then
 * lexical state replaced, then the next descriptor-relative operation). NO
 * sleeps, no retry-until-win, no scheduler races — every test here is
 * deterministic by construction.
 *
 * Rows covered (MAC-3A §20):
 *   - W-W2 (RACE-I02): retained intermediate descriptor under rename AND
 *     same-path replacement — direct native-primitive sequencing (B-type).
 *   - W-W3 (RACE-I05): rename divergence fails closed at the identity gate;
 *     same-path replacement binds the accepted pathname (semantics LOCK, D7).
 *   - W-W6: the write stays bound to the created fd under lexical churn of
 *     the file name and of the parent (A-type `beforeWrite`).
 *   - W-W7 (RACE-I06): name-bound cleanup after a final-name swap — the
 *     attacker-placed decoy at the created component is unlinked, the
 *     operation-created object (renamed away) survives. Boundary LOCK.
 *   - §14 dir-at-name: `unlinkat` with no AT_REMOVEDIR never deletes a
 *     directory planted at the created name — truthful `failed` disposition.
 *   - RACE-I01 carry: symlink-decoy root replacement AFTER anchoring cannot
 *     redirect the create (A-type `afterRootOpen`).
 *   - RACE-I03 carry: dangling symlink at the ancestor component fails
 *     closed, never followed, nothing created.
 *
 * The reentrant same-destination evidence (W-C7) and the completion-writer
 * windows live in mac3c-completion-hostile.test.ts.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  openSync,
  closeSync,
  renameSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  readlinkSync,
  readdirSync,
  lstatSync,
  existsSync,
  realpathSync,
  mkdtempSync,
  rmSync,
  constants as O,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGatewayFs } from '#gateway-native';
import { descentToParent, verifyParentIdentity } from '../../src/internal/darwin-fs/adapter.js';
import { executeDraftFileWrite } from '../../src/writing/executor.js';
import type { DraftWriteExecutorInput } from '../../src/writing/types.js';
import { makeFsWorkspace } from '../writing/helpers.js';
const PAYLOAD = '{"hello":"world"}';
const PAYLOAD_BYTES = Buffer.byteLength(PAYLOAD, 'utf8');

const roots: string[] = [];
function newRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

after(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort fixture cleanup
    }
  }
});

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
    canonicalUtf8: PAYLOAD,
    expectedByteCount: PAYLOAD_BYTES,
    ...overrides,
  };
}

// ─────────────────────────── W-W2 / RACE-I02 (B-type) ───────────────────────────

test('mac3c W-W2: a retained intermediate descriptor keeps authority across rename AND replacement (decoy never touched)', () => {
  // Direct primitive sequencing, exactly per MAC-3A §6 W-W2:
  // openDirectoryAt(root,'a') -> churn 'a' -> openDirectoryAt(retained,'b')
  // -> the next component opens in the ORIGINAL object.
  const addon = loadGatewayFs();

  // Phase 1 — rename divergence: 'a' renamed away, decoy directory at 'a'.
  {
    const root = newRoot('mac3c-ww2-rename-');
    const rootFd = openSync(root, O.O_RDONLY | O.O_DIRECTORY | O.O_NOFOLLOW);
    try {
      mkdirSync(path.join(root, 'a'));
      mkdirSync(path.join(root, 'a', 'b'));
      const rA = addon.openDirectoryAt(rootFd, 'a');
      assert.equal(rA.ok, true, 'first descent step opens the original');
      if (!rA.ok) return;
      const fdA = rA.fd;
      renameSync(path.join(root, 'a'), path.join(root, 'a-moved'));
      mkdirSync(path.join(root, 'a'), { mode: 0o700 }); // decoy at the old name
      const rB = addon.openDirectoryAt(fdA, 'b');
      assert.equal(rB.ok, true, 'next component opens through the RETAINED fd');
      if (rB.ok) {
        const gp = addon.getPath(rB.fd);
        assert.equal(gp.ok, true);
        if (gp.ok) {
          assert.equal(gp.path, path.join(root, 'a-moved', 'b'), 'descriptor authority follows the moved original, not the decoy');
        }
        closeSync(rB.fd);
      }
      assert.deepEqual(readdirSync(path.join(root, 'a')), [], 'decoy directory at the old name received nothing');
      closeSync(fdA);
    } finally {
      closeSync(rootFd);
    }
  }

  // Phase 2 — same-path replacement (rm + recreate): the retained fd pins
  // the ORIGINAL (now destroyed) object. Authority NEVER falls back to the
  // replacement decoy at the same name: the next-component open fails closed
  // inside the pinned object instead of opening inside the decoy.
  {
    const root = newRoot('mac3c-ww2-replace-');
    const rootFd = openSync(root, O.O_RDONLY | O.O_DIRECTORY | O.O_NOFOLLOW);
    try {
      mkdirSync(path.join(root, 'a'));
      mkdirSync(path.join(root, 'a', 'b'));
      const rA = addon.openDirectoryAt(rootFd, 'a');
      assert.equal(rA.ok, true);
      if (!rA.ok) return;
      const fdA = rA.fd;
      rmSync(path.join(root, 'a'), { recursive: true, force: true });
      mkdirSync(path.join(root, 'a'), { mode: 0o700 }); // replacement decoy at the same name
      const rB = addon.openDirectoryAt(fdA, 'b');
      assert.equal(rB.ok, false, 'the destroyed original offers no component — no redirect into the replacement decoy');
      if (!rB.ok) assert.equal(rB.code, 'not-found', 'typed closed native failure, never a fallback open');
      assert.deepEqual(readdirSync(path.join(root, 'a')), [], 'replacement decoy untouched');
      closeSync(fdA);
    } finally {
      closeSync(rootFd);
    }
  }
});

// ─────────────────────── W-W3 / RACE-I05 (B-type semantics lock) ───────────────────────

test('mac3c W-W3: rename divergence fails closed at the identity gate; same-path replacement binds the accepted pathname (D7 lock)', () => {
  const root = newRoot('mac3c-ww3-');
  const rootFd = openSync(root, O.O_RDONLY | O.O_DIRECTORY | O.O_NOFOLLOW);
  try {
    // Divergence: fd obtained, then the parent renamed away.
    mkdirSync(path.join(root, 'a'));
    const d = descentToParent(rootFd, 'a');
    assert.equal(d.ok, true);
    if (!d.ok) return;
    const parentFd = d.parentFd;
    renameSync(path.join(root, 'a'), path.join(root, 'a-moved'));
    assert.deepEqual(
      verifyParentIdentity(parentFd, path.join(root, 'a')),
      { ok: false, code: 'parent-not-verified' },
      'F_GETPATH diverges from the accepted canonical ancestor -> fail closed',
    );
    // Divergence evidence: the retained descriptor now reports the NEW path
    // (the rename divergence property, native primitives 219).
    assert.equal(verifyParentIdentity(parentFd, path.join(root, 'a-moved')).ok, true);
    closeSync(parentFd);

    // Same-path replacement (D7): NO rename — the directory at the accepted
    // canonical ancestor is deleted and a service-owned decoy directory is
    // recreated at the SAME pathname. A FRESH decision-time descent opens the
    // decoy, and the identity gate passes (path string equality). This is the
    // frozen accepted boundary: same-path replacement is decision-time
    // pathname semantics (RACE-I05/D7, Linux-identical); the WP-6 decision +
    // service-UID gates are the accepted defense. LOCKED here, not redesigned.
    mkdirSync(path.join(root, 'b'));
    const preChurn = descentToParent(rootFd, 'b');
    assert.equal(preChurn.ok, true);
    if (!preChurn.ok) return;
    rmSync(path.join(root, 'b'), { recursive: true, force: true });
    mkdirSync(path.join(root, 'b'), { mode: 0o700 });
    const fresh = descentToParent(rootFd, 'b');
    assert.equal(fresh.ok, true, 'fresh descent opens the object at the accepted pathname');
    if (fresh.ok) {
      assert.equal(verifyParentIdentity(fresh.parentFd, path.join(root, 'b')).ok, true, 'identity passes against the accepted pathname (decision-time semantics)');
      closeSync(fresh.parentFd);
    }
    closeSync(preChurn.parentFd);
  } finally {
    closeSync(rootFd);
  }
});

// ─────────────────────────── W-W6 (A-type beforeWrite) ───────────────────────────

test('mac3c W-W6: the write stays bound to the created fd when the final name is swapped before write (decoy never receives bytes)', () => {
  const ws = makeFsWorkspace();
  try {
    const moved = path.join(ws.artifactRoot, 'moved.json');
    const r = executeDraftFileWrite(evidence(ws, {
      hooks: {
        beforeWrite: () => {
          // Lexical churn of the created name: rename the created file away
          // and plant a decoy at the old name.
          renameSync(path.join(ws.artifactRoot, 'task.json'), moved);
          writeFileSync(path.join(ws.artifactRoot, 'task.json'), 'DECOY');
        },
      },
    }));
    assert.deepEqual(r, { ok: true, outcome: 'created', persistedByteCount: PAYLOAD_BYTES });
    assert.equal(readFileSync(moved, 'utf8'), PAYLOAD, 'the ORIGINAL created object received the exact bytes');
    assert.equal(readFileSync(path.join(ws.artifactRoot, 'task.json'), 'utf8'), 'DECOY', 'the decoy at the name received nothing');
  } finally {
    ws.remove();
  }
});

test('mac3c W-W6: the write stays bound to the created fd when the parent is renamed and replaced before write', () => {
  const ws = makeFsWorkspace();
  try {
    const moved = `${ws.artifactRoot}-moved`;
    const r = executeDraftFileWrite(evidence(ws, {
      hooks: {
        beforeWrite: () => {
          renameSync(ws.artifactRoot, moved);
          mkdirSync(ws.artifactRoot, { mode: 0o700 }); // decoy parent at the old path
        },
      },
    }));
    assert.deepEqual(r, { ok: true, outcome: 'created', persistedByteCount: PAYLOAD_BYTES });
    assert.equal(readFileSync(path.join(moved, 'task.json'), 'utf8'), PAYLOAD, 'bytes landed in the ORIGINAL parent object');
    assert.deepEqual(readdirSync(ws.artifactRoot), [], 'the decoy parent received nothing');
    rmSync(moved, { recursive: true, force: true });
  } finally {
    ws.remove();
  }
});

// ─────────────── W-W7 / RACE-I06 + dir-at-name (A-type beforeWrite) ───────────────

test('mac3c W-W7: final-name swap before failure cleanup — name-bound unlink removes the decoy, keeps the created object (I06 boundary lock)', () => {
  const ws = makeFsWorkspace();
  try {
    const kept = path.join(ws.artifactRoot, 'kept.json');
    const r = executeDraftFileWrite(evidence(ws, {
      hooks: {
        beforeWrite: () => {
          // The created file is renamed away and a decoy is planted at the
          // created component, then the write stage fails.
          renameSync(path.join(ws.artifactRoot, 'task.json'), kept);
          writeFileSync(path.join(ws.artifactRoot, 'task.json'), 'DECOY');
          throw new Error('injected write-stage failure');
        },
      },
    }));
    assert.deepEqual(r, { ok: false, code: 'write-failed', cleanup: 'removed' });
    // Accepted I06 boundary: cleanup is NAME-bound within the retained
    // verified parent — the attacker-placed decoy at the created component is
    // unlinked; the operation-created object (renamed away) survives.
    assert.equal(existsSync(path.join(ws.artifactRoot, 'task.json')), false, 'the decoy at the created component was unlinked');
    assert.equal(existsSync(kept), true, 'the operation-created object survives (no authority to chase the rename)');
    assert.equal(readFileSync(kept, 'utf8'), '', 'no bytes reached the created object before the injected failure');
  } finally {
    ws.remove();
  }
});

test('mac3c cleanup: a directory planted at the created name is never deleted — truthful failed disposition', () => {
  const ws = makeFsWorkspace();
  try {
    const kept = path.join(ws.artifactRoot, 'kept.json');
    const r = executeDraftFileWrite(evidence(ws, {
      hooks: {
        beforeWrite: () => {
          renameSync(path.join(ws.artifactRoot, 'task.json'), kept);
          mkdirSync(path.join(ws.artifactRoot, 'task.json'), { mode: 0o700 });
          throw new Error('injected write-stage failure');
        },
      },
    }));
    assert.deepEqual(r, { ok: false, code: 'write-failed', cleanup: 'failed' }, 'unlinkat without AT_REMOVEDIR fails against a directory -> truthful indeterminate');
    assert.equal(lstatSync(path.join(ws.artifactRoot, 'task.json')).isDirectory(), true, 'the directory was NEVER deleted');
    assert.equal(existsSync(kept), true, 'the created object (renamed away) survives');
  } finally {
    ws.remove();
  }
});

// ─────────────────────────── RACE-I01 carry (A-type) ───────────────────────────

test('mac3c RACE-I01: a symlink-decoy root planted after anchoring cannot redirect the create (original root authority)', () => {
  const ws = makeFsWorkspace();
  try {
    const moved = `${ws.artifactRoot}-moved`;
    const decoyDir = path.join(ws.workspaceRoot, 'decoy-root');
    mkdirSync(decoyDir, { mode: 0o700 });
    const r = executeDraftFileWrite(evidence(ws, {
      hooks: {
        afterRootOpen: () => {
          renameSync(ws.artifactRoot, moved);
          symlinkSync(decoyDir, ws.artifactRoot); // symlink decoy at the root path
        },
      },
    }));
    assert.deepEqual(r, { ok: true, outcome: 'created', persistedByteCount: PAYLOAD_BYTES });
    assert.equal(existsSync(path.join(moved, 'task.json')), true, 'the create stayed in the originally anchored root');
    assert.deepEqual(readdirSync(decoyDir), [], 'the symlink target received nothing');
    assert.equal(readlinkSync(ws.artifactRoot), decoyDir, 'the symlink decoy is untouched');
    rmSync(moved, { recursive: true, force: true });
  } finally {
    ws.remove();
  }
});

// ─────────────────────────── RACE-I03 carry (B-type) ───────────────────────────

test('mac3c RACE-I03: a dangling symlink at the ancestor component fails closed — never followed, nothing created', () => {
  const ws = makeFsWorkspace();
  try {
    symlinkSync('nowhere', path.join(ws.artifactRoot, 'sub'));
    const r = executeDraftFileWrite(evidence(ws, {
      canonicalExistingDirectoryAncestor: path.join(ws.artifactRoot, 'sub'),
      canonicalAncestorRelativePath: 'sub',
    }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(['parent-not-directory', 'symlink-loop'].includes(r.code), `unexpected code ${r.code}`);
      assert.equal(r.cleanup, 'not-needed');
    }
    assert.equal(readlinkSync(path.join(ws.artifactRoot, 'sub')), 'nowhere', 'dangling symlink untouched');
    assert.deepEqual(readdirSync(ws.artifactRoot), ['sub'], 'nothing was created anywhere in the artifact root');
  } finally {
    ws.remove();
  }
});
