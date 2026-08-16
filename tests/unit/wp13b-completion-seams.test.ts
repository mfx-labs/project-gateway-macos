/**
 * MAC-3B — completion-writer seam contract tests (TEST-ONLY).
 *
 * Proves the EXACT contract of the two approved MAC-3B hooks in
 * `src/completion/writer.ts`:
 *
 *   - `afterCreateConflict`: invoked only at the EEXIST→recovery boundary;
 *     absent hook = accepted behavior unchanged; throwing hook = typed
 *     fail-closed `io-failure` with NO recovery read, NO cleanup, NO
 *     unlink of the pre-existing target; fd lifecycle clean.
 *   - `beforeWrite`: invoked exactly once after a successful exclusive
 *     create, before the bounded write; absent hook = accepted behavior
 *     unchanged; throwing hook = typed `io-failure` routed through the
 *     EXISTING created-path cleanup (single best-effort
 *     cleanupCreated(parentFd, finalComponent), truthful disposition,
 *     no second cleanup); fd lifecycle clean.
 *
 * Hostile name-swap/recovery MATRICES are NOT exercised here — they belong
 * to MAC-3C. This file proves the seams themselves, plus the fail-closed
 * behavior against hostile non-function hook values (JSON cannot carry
 * callbacks; the writer must never invoke a non-callable).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeResultArtifact } from '../../src/completion/writer.js';

const OCCURRENCE_ID = 'pgw:o:11111111111111111111111111111111';
const ATTEMPT_ID = 'pgw:a:22222222222222222222222222222222';

const EXACT = Buffer.from('{"exact":"canonical"}');
const CONFLICT = Buffer.from('{"conflict":"different"}');

const roots: string[] = [];
function newRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac3b-seam-')));
  roots.push(root);
  return root;
}

function freshDestination(root: string): string {
  const dir = path.join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'execution-result.json');
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

// ─────────────────────────── afterCreateConflict ───────────────────────────

test('seam afterCreateConflict: invoked exactly once at the EEXIST boundary, before recovery', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, EXACT);
  let calls = 0;
  const r = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: {
      afterCreateConflict: () => {
        calls++;
      },
    },
  });
  assert.deepEqual(r, { ok: true, outcome: 'already-exact' }, 'recovery still adopts the exact target');
  assert.equal(calls, 1, 'hook invoked exactly once at the EEXIST boundary');
  assert.deepEqual(fs.readFileSync(dest), EXACT, 'pre-existing target byte-identical');
});

test('seam afterCreateConflict: absent hook leaves accepted recovery behavior unchanged', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, EXACT);
  const r = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
  });
  assert.deepEqual(r, { ok: true, outcome: 'already-exact' });
  assert.deepEqual(fs.readFileSync(dest), EXACT);
});

test('seam afterCreateConflict: throwing hook fails closed — no recovery, no cleanup, no unlink', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, EXACT);
  const r = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: {
      afterCreateConflict: () => {
        throw new Error('injected');
      },
    },
  });
  assert.deepEqual(r, { ok: false, code: 'io-failure' }, 'typed fail-closed writer code');
  assert.equal(fs.existsSync(dest), true, 'pre-existing target never unlinked/cleaned');
  assert.deepEqual(fs.readFileSync(dest), EXACT, 'pre-existing target byte-identical');
});

test('seam afterCreateConflict: throwing hook also fails closed for a conflicting target', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, CONFLICT);
  const r = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: {
      afterCreateConflict: () => {
        throw new Error('injected');
      },
    },
  });
  assert.deepEqual(r, { ok: false, code: 'io-failure' });
  assert.deepEqual(fs.readFileSync(dest), CONFLICT, 'conflicting target untouched');
});

test('seam afterCreateConflict: fd lifecycle stays clean across hook and non-hook calls', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, EXACT);
  const before = fdCount();
  const r1 = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: { afterCreateConflict: () => undefined },
  });
  assert.equal(r1.ok, true);
  const r2 = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: {
      afterCreateConflict: () => {
        throw new Error('injected');
      },
    },
  });
  assert.deepEqual(r2, { ok: false, code: 'io-failure' });
  const after = fdCount();
  assert.ok(after <= before + 2, `fd count stable: ${before} -> ${after}`);
});

// ──────────────────────────────── beforeWrite ──────────────────────────────

test('seam beforeWrite: invoked exactly once after a successful exclusive create', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  let calls = 0;
  const r = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: {
      beforeWrite: () => {
        calls++;
      },
    },
  });
  assert.deepEqual(r, { ok: true, outcome: 'created' });
  assert.equal(calls, 1, 'hook invoked exactly once');
  assert.deepEqual(fs.readFileSync(dest), EXACT, 'exact canonical bytes written');
});

test('seam beforeWrite: absent hook leaves created-path behavior unchanged', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  const r = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
  });
  assert.deepEqual(r, { ok: true, outcome: 'created' });
  assert.deepEqual(fs.readFileSync(dest), EXACT);
});

test('seam beforeWrite: throwing hook routes through the existing cleanup path with a truthful disposition', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  const r = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: {
      beforeWrite: () => {
        throw new Error('injected');
      },
    },
  });
  assert.deepEqual(r, { ok: false, code: 'io-failure' }, 'typed fail-closed writer code');
  assert.equal(fs.existsSync(dest), false, 'created target removed by the single cleanup attempt');
  assert.equal(
    fs.statSync(path.join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID)).isDirectory(),
    true,
    'only the created file was removed; the verified parent survives',
  );
});

test('seam beforeWrite: fd lifecycle stays clean across hook and non-hook calls', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  const before = fdCount();
  const r1 = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: { beforeWrite: () => undefined },
  });
  assert.equal(r1.ok, true);
  assert.deepEqual(fs.readFileSync(dest), EXACT);
  // Fresh final component so r2 exercises the created path (not recovery).
  fs.rmSync(dest);
  const r2 = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: {
      beforeWrite: () => {
        throw new Error('injected');
      },
    },
  });
  assert.deepEqual(r2, { ok: false, code: 'io-failure' });
  const after = fdCount();
  assert.ok(after <= before + 2, `fd count stable: ${before} -> ${after}`);
});

// ─────────────────── hostile non-function hook values (JSON) ───────────────

test('seam: hostile non-function hook values fail closed (JSON cannot carry callbacks)', () => {
  const root = newRoot();
  const dest = freshDestination(root);
  fs.writeFileSync(dest, EXACT);

  // afterCreateConflict as a non-callable string (the only shape JSON can
  // produce): the optional call must fail closed, target untouched.
  const r1 = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: { afterCreateConflict: 'x' as unknown as () => void },
  });
  assert.deepEqual(r1, { ok: false, code: 'io-failure' });
  assert.deepEqual(fs.readFileSync(dest), EXACT, 'pre-existing target untouched');

  // beforeWrite as a non-callable number: fresh destination so the create
  // path (not recovery) is the one that fails closed; the created object
  // is removed through the existing cleanup.
  fs.rmSync(dest);
  const r2 = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes: EXACT,
    hooks: { beforeWrite: 42 as unknown as () => void },
  });
  assert.deepEqual(r2, { ok: false, code: 'io-failure' });
  assert.equal(fs.existsSync(dest), false, 'created object cleaned up');
});
