/**
 * MAC-3C — completion-writer hostile-race verification (deterministic only).
 *
 * Evidence classes (MAC-3A §10): A = deterministic boundary pause through the
 * accepted MAC-3B completion seams (`afterCreateConflict`, `beforeWrite`,
 * carried `afterRootOpen`); B = structural sequencing. NO sleeps, no
 * retry-until-win, no scheduler races.
 *
 * Rows covered (MAC-3A §20):
 *   - W-C2: EEXIST observed, then the target is swapped before the recovery
 *     open — recovery inspects ONLY the descriptor-relative current object,
 *     gated by fstat(regular,uid,size) + exact bytes (decoy conflict / exact
 *     adoption / directory / FIFO variants).
 *   - W-C3: target swapped to a symlink before the recovery open — never
 *     `already-exact`, even for a symlink pointing at the exact expected
 *     bytes.
 *   - RACE-I08 carry: recovery adoption is observational-only (mtime/ctime
 *     unchanged across an `already-exact` recovery).
 *   - W-C7: deterministic reentrant same-destination interleave via the
 *     EXISTING `afterRootOpen` hook — ORDERING EVIDENCE ONLY. This does NOT
 *     close RACE-I15 final concurrency (MAC-3E owns that closure).
 *   - W-C8: created-path failure cleanup through `beforeWrite` — name-bound
 *     swap, parent churn, and dir-at-name (never deletes a directory).
 *   - RACE-I13 carry: completion-writer fd-lifetime stability across created,
 *     recovery-conflict, beforeWrite-cleanup, and afterCreateConflict-throw
 *     cycles (the completion writer previously had no fd-count evidence).
 *   - RACE-I01 carry: symlink-decoy root replacement after anchoring.
 *   - RACE-I03 carry: dangling symlink at a descent component fails closed.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeResultArtifact } from '../../src/completion/writer.js';
import { makeInterleaveClock } from '../mac3b/interleave.js';

const OCCURRENCE_ID = 'pgw:o:33333333333333333333333333333333';
const ATTEMPT_ID = 'pgw:a:44444444444444444444444444444444';

const EXACT = Buffer.from('{"exact":"canonical"}');
const CONFLICT = Buffer.from('{"conflict":"different"}');
const DECOY = Buffer.from('{"decoy":"planted"}');

const roots: string[] = [];
function newRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac3c-completion-')));
  roots.push(root);
  return root;
}

function freshDestination(root: string, attemptId: string = ATTEMPT_ID): string {
  const dir = path.join(root, 'results', OCCURRENCE_ID, attemptId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'execution-result.json');
}

function uid(): number {
  return process.getuid?.() ?? 0;
}

function input(root: string, bytes: Uint8Array, hooks?: NonNullable<Parameters<typeof writeResultArtifact>[0]['hooks']>, attemptId: string = ATTEMPT_ID): Parameters<typeof writeResultArtifact>[0] {
  return {
    root,
    serviceUid: uid(),
    occurrenceId: OCCURRENCE_ID,
    attemptId,
    bytes,
    ...(hooks === undefined ? {} : { hooks }),
  };
}

function fdCount(): number {
  return fs.readdirSync('/dev/fd').length;
}

after(() => {
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort fixture cleanup
    }
  }
});

// ─────────────────────────── W-C2 / W-C3 (A-type afterCreateConflict) ───────────────────────────

test('mac3c W-C2: EEXIST target swapped to a decoy before recovery — conflict, decoy byte-identical', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, CONFLICT); // pre-created target (EEXIST at create time)
  const r = writeResultArtifact(input(root, EXACT, {
    afterCreateConflict: () => {
      // Mid-window swap: the EEXIST target is replaced by a different decoy
      // BEFORE the recovery open.
      fs.rmSync(dest);
      fs.writeFileSync(dest, DECOY);
    },
  }));
  assert.deepEqual(r, { ok: false, code: 'exclusive-create-conflict' }, 'recovery inspects the CURRENT name object and rejects the decoy bytes');
  assert.deepEqual(fs.readFileSync(dest), DECOY, 'decoy byte-identical — recovery never mutated it');
});

test('mac3c W-C2: EEXIST target swapped to a directory before recovery — conflict, directory intact', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, CONFLICT);
  const r = writeResultArtifact(input(root, EXACT, {
    afterCreateConflict: () => {
      fs.rmSync(dest);
      fs.mkdirSync(dest, { mode: 0o700 });
    },
  }));
  assert.deepEqual(r, { ok: false, code: 'exclusive-create-conflict' });
  assert.equal(fs.lstatSync(dest).isDirectory(), true, 'directory never deleted or adopted');
});

test('mac3c W-C2: EEXIST target swapped to a FIFO before recovery — conflict, never blocks', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, CONFLICT);
  const r = writeResultArtifact(input(root, EXACT, {
    afterCreateConflict: () => {
      fs.rmSync(dest);
      execFileSync('mkfifo', [dest]);
    },
  }));
  // The test completing at all is the determinism evidence: O_NONBLOCK|O_RDONLY
  // open of the FIFO cannot block; fstat rejects it as non-regular.
  assert.deepEqual(r, { ok: false, code: 'exclusive-create-conflict' });
  assert.equal(fs.lstatSync(dest).isFIFO(), true, 'FIFO untouched');
});

test('mac3c W-C3: target swapped to a dangling symlink before recovery — conflict, never already-exact', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, CONFLICT);
  const r = writeResultArtifact(input(root, EXACT, {
    afterCreateConflict: () => {
      fs.rmSync(dest);
      fs.symlinkSync('nowhere', dest);
    },
  }));
  assert.deepEqual(r, { ok: false, code: 'exclusive-create-conflict' }, 'symlink-refused routes to the closed conflict code');
  assert.equal(fs.readlinkSync(dest), 'nowhere', 'symlink untouched');
});

test('mac3c W-C3: target swapped to a symlink pointing at EXACT bytes — conflict, symlink never adopted', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, CONFLICT);
  const outside = path.join(root, 'outside-exact.json');
  fs.writeFileSync(outside, EXACT);
  const r = writeResultArtifact(input(root, EXACT, {
    afterCreateConflict: () => {
      fs.rmSync(dest);
      fs.symlinkSync(outside, dest);
    },
  }));
  assert.deepEqual(r, { ok: false, code: 'exclusive-create-conflict' }, 'a symlink to the exact expected bytes NEVER yields already-exact');
  assert.deepEqual(fs.readFileSync(outside), EXACT, 'symlink target untouched');
  assert.equal(fs.lstatSync(dest).isSymbolicLink(), true, 'symlink still at the name');
});

test('mac3c W-C2 + RACE-I08: target swapped to an exact-bytes file — observational adoption, mtime/ctime unchanged', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, CONFLICT);
  let plantedMtimeMs = -1;
  let plantedCtimeMs = -1;
  const r = writeResultArtifact(input(root, EXACT, {
    afterCreateConflict: () => {
      fs.rmSync(dest);
      fs.writeFileSync(dest, EXACT);
      const st = fs.statSync(dest);
      plantedMtimeMs = st.mtimeMs;
      plantedCtimeMs = st.ctimeMs;
    },
  }));
  assert.deepEqual(r, { ok: true, outcome: 'already-exact' }, 'exact-bytes current object is adopted observationally');
  const afterStat = fs.statSync(dest);
  assert.equal(afterStat.mtimeMs, plantedMtimeMs, 'recovery never rewrote the target (mtime unchanged)');
  assert.equal(afterStat.ctimeMs, plantedCtimeMs, 'recovery never mutated the target (ctime unchanged)');
  assert.deepEqual(fs.readFileSync(dest), EXACT);
});

// ─────────────── W-C7 — deterministic reentrant same-destination ordering (A-type) ───────────────

test('mac3c W-C7: reentrant same-destination interleave — exact-bytes loser adopts, exactly one created (ORDERING evidence only)', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  const clock = makeInterleaveClock();
  // Writer A is paused at its OWN afterRootOpen boundary; its hook
  // synchronously runs writer B to completion; A then resumes and loses the
  // exclusive create to B's object. Deterministic ordering, no scheduler.
  const a = writeResultArtifact(input(root, EXACT, {
    afterRootOpen: () => {
      clock.record('A-root-anchor');
      const b = writeResultArtifact(input(root, EXACT, {
        beforeWrite: () => clock.record('B-beforeWrite'),
      }));
      assert.deepEqual(b, { ok: true, outcome: 'created' }, 'B created the destination inside the A pause');
      clock.record('A-resumes');
    },
    afterCreateConflict: () => clock.record('A-conflict-boundary'),
  }));
  clock.assertExact(['A-root-anchor', 'B-beforeWrite', 'A-resumes', 'A-conflict-boundary']);
  assert.deepEqual(a, { ok: true, outcome: 'already-exact' }, 'A lost the create and recovered the B exact bytes');
  assert.deepEqual(fs.readFileSync(dest), EXACT);
  // Exactly one created outcome across the pair; the loser's outcome is the
  // recovery adoption. ORDERING evidence only: RACE-I15 final concurrent
  // closure remains UNPROVEN and is owned by MAC-3E.
});

test('mac3c W-C7: reentrant same-destination interleave — conflicting loser fails closed, at most one created', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  const clock = makeInterleaveClock();
  const a = writeResultArtifact(input(root, EXACT, {
    afterRootOpen: () => {
      clock.record('A-root-anchor');
      const b = writeResultArtifact(input(root, CONFLICT, {
        beforeWrite: () => clock.record('B-beforeWrite'),
      }));
      assert.deepEqual(b, { ok: true, outcome: 'created' }, 'B created the destination with conflicting bytes');
      clock.record('A-resumes');
    },
    afterCreateConflict: () => clock.record('A-conflict-boundary'),
  }));
  clock.assertExact(['A-root-anchor', 'B-beforeWrite', 'A-resumes', 'A-conflict-boundary']);
  assert.deepEqual(a, { ok: false, code: 'exclusive-create-conflict' }, 'the conflicting loser fails closed');
  assert.deepEqual(fs.readFileSync(dest), CONFLICT, 'B object is the single created object; no overwrite, no adoption');
});

// ─────────────────────────── W-C8 (A-type beforeWrite) ───────────────────────────

test('mac3c W-C8: final-name swap before failure — name-bound cleanup unlinks the decoy, keeps the created object', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  const kept = path.join(path.dirname(dest), 'kept.json');
  const r = writeResultArtifact(input(root, EXACT, {
    beforeWrite: () => {
      // The operation-created file is renamed away; a decoy takes its name;
      // then the created path fails.
      fs.renameSync(dest, kept);
      fs.writeFileSync(dest, DECOY);
      throw new Error('injected write failure');
    },
  }));
  assert.deepEqual(r, { ok: false, code: 'io-failure' });
  // Accepted I06 boundary: cleanup is name-bound within the retained verified
  // parent — the attacker-placed decoy at the created component is unlinked.
  assert.equal(fs.existsSync(dest), false, 'decoy at the created component was unlinked');
  assert.equal(fs.existsSync(kept), true, 'the created object (renamed away) survives');
  assert.equal(fs.readFileSync(kept, 'utf8'), '', 'no bytes reached the created object');
  assert.equal(fs.statSync(path.dirname(dest)).isDirectory(), true, 'verified parent survives');
});

test('mac3c W-C8: parent churn before failure — cleanup unlinks through the retained parent fd; decoy parent untouched', () => {
  const root = newRoot();
  const attemptDir = path.join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID);
  const dest = freshDestination(root);
  const moved = `${attemptDir}-moved`;
  const r = writeResultArtifact(input(root, EXACT, {
    beforeWrite: () => {
      fs.renameSync(attemptDir, moved);
      fs.mkdirSync(attemptDir, { mode: 0o700 }); // decoy parent at the old lexical path
      throw new Error('injected write failure');
    },
  }));
  assert.deepEqual(r, { ok: false, code: 'io-failure' });
  assert.equal(fs.existsSync(path.join(moved, 'execution-result.json')), false, 'cleanup removed the created object through the RETAINED parent fd');
  assert.deepEqual(fs.readdirSync(attemptDir), [], 'decoy parent received no mutation');
  assert.equal(fs.statSync(moved).isDirectory(), true, 'the moved original parent survives');
});

test('mac3c W-C8: directory planted at the created name — cleanup never deletes a directory, truthful failure', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  const kept = path.join(path.dirname(dest), 'kept.json');
  const r = writeResultArtifact(input(root, EXACT, {
    beforeWrite: () => {
      fs.renameSync(dest, kept);
      fs.mkdirSync(dest, { mode: 0o700 });
      throw new Error('injected write failure');
    },
  }));
  assert.deepEqual(r, { ok: false, code: 'io-failure' });
  assert.equal(fs.lstatSync(dest).isDirectory(), true, 'unlinkat without AT_REMOVEDIR never deletes a directory');
  assert.equal(fs.existsSync(kept), true, 'the created object (renamed away) survives');
});

// ─────────────── RACE-I13 — completion fd-lifetime stability (B-type repetition) ───────────────

test('mac3c RACE-I13: completion fd counts stay stable across created / recovery / cleanup / conflict-throw cycles', () => {
  const root = newRoot();
  fs.mkdirSync(path.join(root, 'results'), { recursive: true });
  const before = fdCount();

  // 1. Created-path success cycles (fresh attempt dirs).
  for (let i = 0; i < 20; i++) {
    const attempt = 'pgw:a:' + i.toString(16).padStart(32, '0');
    fs.mkdirSync(path.join(root, 'results', OCCURRENCE_ID, attempt), { recursive: true });
    const r = writeResultArtifact(input(root, EXACT, undefined, attempt));
    assert.deepEqual(r, { ok: true, outcome: 'created' });
  }

  // 2. Recovery-conflict cycles (same pre-planted conflicting target).
  {
    const attempt = 'pgw:a:deadbeefdeadbeefdeadbeefdeadbeef';
    const dest = freshDestination(root, attempt);
    fs.writeFileSync(dest, CONFLICT);
    for (let i = 0; i < 20; i++) {
      const r = writeResultArtifact(input(root, EXACT, undefined, attempt));
      assert.deepEqual(r, { ok: false, code: 'exclusive-create-conflict' });
    }
    assert.deepEqual(fs.readFileSync(dest), CONFLICT, 'conflicting target never mutated by any cycle');
  }

  // 3. beforeWrite-throw cleanup cycles (created object removed each time).
  for (let i = 20; i < 40; i++) {
    const attempt = 'pgw:a:' + i.toString(16).padStart(32, '0');
    freshDestination(root, attempt);
    const r = writeResultArtifact(input(root, EXACT, {
      beforeWrite: () => {
        throw new Error('injected');
      },
    }, attempt));
    assert.deepEqual(r, { ok: false, code: 'io-failure' });
    assert.equal(fs.existsSync(path.join(root, 'results', OCCURRENCE_ID, attempt, 'execution-result.json')), false, 'created object cleaned up');
  }

  // 4. afterCreateConflict-throw cycles (pre-existing target untouched).
  for (let i = 40; i < 60; i++) {
    const attempt = 'pgw:a:' + i.toString(16).padStart(32, '0');
    const dest = freshDestination(root, attempt);
    fs.writeFileSync(dest, CONFLICT);
    const r = writeResultArtifact(input(root, EXACT, {
      afterCreateConflict: () => {
        throw new Error('injected');
      },
    }, attempt));
    assert.deepEqual(r, { ok: false, code: 'io-failure' });
    assert.deepEqual(fs.readFileSync(dest), CONFLICT, 'pre-existing target untouched');
  }

  const afterCount = fdCount();
  assert.ok(afterCount <= before + 2, `completion fd count stable: ${before} -> ${afterCount}`);
});

// ─────────────────────────── RACE-I01 / RACE-I03 carry ───────────────────────────

test('mac3c RACE-I01: symlink-decoy root planted after anchoring — completion fails closed at the descent identity gate, decoy never entered', () => {
  const root = newRoot();
  freshDestination(root);
  const moved = `${root}-moved`;
  const decoyDir = `${root}-decoy`;
  fs.mkdirSync(decoyDir, { mode: 0o700 });
  const r = writeResultArtifact(input(root, EXACT, {
    afterRootOpen: () => {
      fs.renameSync(root, moved);
      fs.symlinkSync(decoyDir, root);
    },
  }));
  // Completion-writer rename divergence: the descent is descriptor-relative
  // (never re-resolves the lexical root), but the per-component F_GETPATH
  // identity check compares against the accepted canonical path — after a
  // root rename the first component diverges and the writer FAILS CLOSED
  // before any create (D6). The symlink decoy at the root path is never even
  // consulted: no file appears in either the moved original or the decoy.
  assert.deepEqual(r, { ok: false, code: 'parent-not-verified' });
  assert.equal(fs.existsSync(path.join(moved, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json')), false, 'nothing created in the moved original (fail closed before create)');
  assert.deepEqual(fs.readdirSync(decoyDir), [], 'the symlink decoy root received nothing');
  assert.equal(fs.readlinkSync(root), decoyDir, 'the symlink decoy is untouched');
  fs.rmSync(moved, { recursive: true, force: true });
});

test('mac3c RACE-I03: a dangling symlink at a descent component fails closed — never followed, nothing created', () => {
  const root = newRoot();
  fs.mkdirSync(path.join(root, 'results'), { recursive: true });
  // Replace the occurrence component with a dangling symlink. On Darwin,
  // O_DIRECTORY|O_NOFOLLOW on a dangling symlink yields ENOTDIR — mapped to
  // the closed `parent-not-verified` code (a symlink-to-file yields ELOOP ->
  // containment-denied; both fail closed, never followed).
  fs.symlinkSync('nowhere', path.join(root, 'results', OCCURRENCE_ID), 'file');
  const r = writeResultArtifact(input(root, EXACT));
  assert.deepEqual(r, { ok: false, code: 'parent-not-verified' }, 'dangling symlink at descent fails closed (never followed)');
  assert.equal(fs.readlinkSync(path.join(root, 'results', OCCURRENCE_ID)), 'nowhere', 'symlink untouched');
  // And at the results component itself.
  const root2 = newRoot();
  fs.symlinkSync('nowhere', path.join(root2, 'results'), 'file');
  const r2 = writeResultArtifact(input(root2, EXACT));
  assert.deepEqual(r2, { ok: false, code: 'parent-not-verified' });
});
