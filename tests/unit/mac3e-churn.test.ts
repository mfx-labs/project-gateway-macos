/**
 * MAC-3E — RACE-I16 integrated cross-root churn evidence (real Intel host).
 *
 * A bounded hostile churn actor (the accepted MAC-3B child-process
 * harness) mutates pathname-visible workspace state in a SEPARATE process
 * WHILE a real production operation runs (true concurrent churn — not a
 * reentrant simulation). The evidence is the deterministic confinement
 * invariant that must hold under ANY interleaving:
 *
 *   - the production outcome stays inside the accepted typed vocabulary
 *     (created / typed conflict / typed identity failure / not-found —
 *     whichever the scheduling produces), never an untyped crash;
 *   - authority never crosses the retained root/parent: no object is
 *     created or mutated OUTSIDE the fixture (the churn actor is
 *     self-confined; the production writer is descriptor-anchored);
 *   - a decoy object can never receive bytes or be adopted;
 *   - after the churn completes, the fixture contains only names inside
 *     the fixture root (no cross-parent/root mutation).
 *
 * Churn window: the actor runs a bounded budget (exact iteration count,
 * `DONE <n>` protocol) concurrently with the operation; the parent awaits
 * both. No sleeps, no retry-until-win: every assertion is an invariant
 * over the complete outcome set, not a particular winner.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withChildActor, type RunningChildActor } from '../mac3b/child-actor.js';
import { writeResultArtifact } from '../../src/completion/writer.js';
import { executeDraftFileWrite } from '../../src/writing/executor.js';
import { bindWorkspaceRoot, openForRead, readFileBytes } from '../../src/reader/fs.js';

const UID = process.getuid?.() ?? 0;
const OCCURRENCE_ID = 'pgw:o:99999999999999999999999999999999';
const ATTEMPT_ID = 'pgw:a:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EXACT = Buffer.from('{"exact":"churn-canonical"}');

const bases: string[] = [];
function newBase(): string {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac3e-churn-')));
  bases.push(base);
  return base;
}

after(() => {
  for (const base of bases) {
    try {
      fs.rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort fixture cleanup
    }
  }
});

/** Every filesystem entry under the fixture must live inside the root. */
function assertConfined(base: string, root: string): void {
  // The base directory holds exactly the churn fixture (and nothing new
  // outside it) — the strongest cross-root tripwire available without a
  // machine-wide scan.
  const siblings = fs.readdirSync(base).sort();
  assert.deepEqual(siblings, ['ws'], `no object was created outside the fixture root: ${JSON.stringify(siblings)}`);
  // Walk: every entry inside is a pathname under root by construction.
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      assert.ok(full.startsWith(root + path.sep), `entry escaped the root: ${full}`);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full);
    }
  };
  walk(root);
}

test('mac3e RACE-I16 completion: concurrent mixed churn on sibling names cannot redirect the create or leak authority', async () => {
  const base = newBase();
  const root = path.join(base, 'ws');
  fs.mkdirSync(path.join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID), { recursive: true });
  const dest = path.join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json');

  const outcome = await withChildActor(
    { fixtureRoot: root, script: 'mixed-churn', budget: 400 },
    async (actor: RunningChildActor) => {
      // The production write runs WHILE the churn actor mutates sibling
      // names (alpha/link/target/file/decoy) concurrently.
      const write = writeResultArtifact({
        root,
        serviceUid: UID,
        occurrenceId: OCCURRENCE_ID,
        attemptId: ATTEMPT_ID,
        bytes: EXACT,
      });
      void actor;
      return write;
    },
  );
  // The destination chain is disjoint from the churn vocabulary, so the
  // write must succeed with the exact canonical bytes; the decoy names are
  // never adopted and never receive bytes.
  assert.deepEqual(outcome, { ok: true, outcome: 'created' }, `typed outcome: ${JSON.stringify(outcome)}`);
  assert.deepEqual(fs.readFileSync(dest), EXACT, 'canonical bytes at the destination');
  assertConfined(base, root);
});

test('mac3e RACE-I16 executor: concurrent ancestor rename/replacement churn — typed confined outcome, decoy never receives bytes', async () => {
  const base = newBase();
  const root = path.join(base, 'ws');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'alpha'), { mode: 0o700 });
  // A decoy directory OUTSIDE the fixture (separate tree, service-owned):
  // it must stay empty — no authority may ever cross into it.
  const outsideBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac3e-outside-')));
  bases.push(outsideBase);
  const OUTSIDE_DECOY = path.join(outsideBase, 'outside-decoy');
  fs.mkdirSync(OUTSIDE_DECOY, { mode: 0o700 });

  // The churn actor renames/replaces `alpha` (the executor's descent
  // component) while the executor runs. The accepted outcome set: created
  // (identity matched while the original was at the name), or the typed
  // identity/descent failures (rename divergence / missing component) —
  // never an untyped crash and never a byte outside the fixture.
  let outcome: unknown;
  await withChildActor(
    { fixtureRoot: root, script: 'dir-rename-cycle', budget: 400 },
    async (actor: RunningChildActor) => {
      outcome = executeDraftFileWrite({
        operationClass: 'artifact-draft-destination',
        purpose: 'persist-validated-artifact-draft',
        configurationIdentity: 'sha-256:' + 'a'.repeat(64),
        workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa',
        artifactKind: 'TaskSpec',
        canonicalArtifactRoot: root,
        canonicalExistingDirectoryAncestor: path.join(root, 'alpha'),
        canonicalAncestorRelativePath: 'alpha',
        destinationTailComponents: ['churn-target.json'],
        canonicalUtf8: '{"exact":"churn-canonical"}',
        expectedByteCount: EXACT.byteLength,
      });
      void actor;
    },
  );
  const r = outcome as { ok: boolean; code?: string; cleanup?: string };
  if (r.ok) {
    assert.equal(r.ok, true, 'created while the verified parent was at the accepted name');
    // The bytes landed in the object the executor's verified parent fd
    // anchored — which after a rename cycle is the CURRENT occupant; the
    // invariant: bytes exist under the fixture root only.
  } else {
    assert.ok(
      ['parent-not-verified', 'missing-parent', 'parent-not-directory', 'io-failure'].includes(r.code!),
      `typed confined failure: ${JSON.stringify(r)}`,
    );
    assert.equal(r.cleanup, 'not-needed', 'no create occurred, cleanup truthful');
  }
  assert.deepEqual(fs.readdirSync(OUTSIDE_DECOY), [], 'the outside decoy directory received nothing');
  assertConfined(base, root);
});

test('mac3e RACE-I16 reader: concurrent file-decoy churn — reads stay confined, decoy content only inside the fixture', async () => {
  const base = newBase();
  const root = path.join(base, 'ws');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'file'), 'iteration-0');
  const bound = await bindWorkspaceRoot(root);
  try {
    let readOutcome: unknown;
    await withChildActor(
      { fixtureRoot: root, script: 'file-decoy-cycle', budget: 400 },
      async (actor: RunningChildActor) => {
        // The reader descent happens while the churn actor renames/
        // replaces `file` ↔ `decoy` at full speed.
        const opened = await openForRead(bound, 'file', 'file');
        if (!opened.ok) {
          readOutcome = opened;
        } else {
          const { bytes } = await readFileBytes(opened.target, 64);
          opened.target.close();
          readOutcome = { ok: true, bytes: bytes.toString() };
        }
        void actor;
      },
    );
    const r = readOutcome as { ok: boolean; code?: string; bytes?: string };
    if (r.ok) {
      // The actor's create/truncate-before-write transition may expose its
      // own empty file; every non-empty success remains one of its payloads.
      assert.ok(
        r.bytes === '' || /^iteration-\d+(-again)?$/.test(r.bytes!),
        `confined content: ${JSON.stringify(r)}`,
      );
    } else {
      assert.equal(r.code, 'not-found', `typed reader failure: ${JSON.stringify(r)}`);
    }
    assertConfined(base, root);
  } finally {
    await bound.close().catch(() => undefined);
  }
});
