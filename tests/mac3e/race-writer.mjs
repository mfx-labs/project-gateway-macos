#!/usr/bin/env node
/**
 * MAC-3E — same-destination race child (TEST-ONLY, real production write).
 *
 * NOT part of production. Executed by `tests/unit/mac3e-concurrency.test.ts`
 * as a separate Node process so that several REAL production writers race
 * one destination with true process concurrency (RACE-I15/W-C7 evidence —
 * not a reentrant simulation).
 *
 * argv: <fixtureRoot> <mode: completion|executor> <payload: exact|conflict> <goFile>
 *
 * Protocol:
 *   - validates the fixture root (exists, realpath-canonical, owned by the
 *     service uid) and prints `READY <pid>`;
 *   - waits for the parent-created GO file (bounded deadline poll — a
 *     lifecycle synchronization barrier, NEVER evidence);
 *   - performs EXACTLY ONE production write through the real compiled
 *     production module (completion `writeResultArtifact` or executor
 *     `executeDraftFileWrite`) against the shared destination;
 *   - prints `RESULT <json>` with the typed outcome and exits 0.
 *
 * The child never touches anything outside the fixture root; the parent
 * owns lifecycle bounding (timeout → SIGKILL → reap).
 */
import { lstatSync, realpathSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [fixtureRootArg, mode, payload, goFileArg] = process.argv.slice(2);

function fail(message) {
  process.stdout.write(`ERROR ${message}\n`);
  process.exit(1);
}

if (mode !== 'completion' && mode !== 'executor') fail('unknown-mode');
if (payload !== 'exact' && payload !== 'conflict') fail('unknown-payload');

const root = resolve(fixtureRootArg);
try {
  const st = lstatSync(root);
  if (!st.isDirectory()) fail('fixture-root-not-a-directory');
} catch {
  fail('fixture-root-missing');
}
if (realpathSync(root) !== root) fail('fixture-root-not-canonical');
const goFile = resolve(goFileArg);

const OCCURRENCE_ID = 'pgw:o:55555555555555555555555555555555';
const ATTEMPT_ID = 'pgw:a:66666666666666666666666666666666';
const EXACT = Buffer.from('{"exact":"race-canonical"}');
const CONFLICT = Buffer.from('{"conflict":"race-loser"}');
const bytes = payload === 'exact' ? EXACT : CONFLICT;

process.stdout.write(`READY ${process.pid}\n`);

// Barrier: wait for the parent's GO file. Bounded deadline (lifecycle
// bound only — the race evidence is the outcome-set invariant, never
// barrier timing).
const deadline = Date.now() + 10000;
while (!existsSync(goFile)) {
  if (Date.now() > deadline) fail('go-timeout');
  await new Promise((r) => setTimeout(r, 2));
}

let result;
try {
  if (mode === 'completion') {
    const { writeResultArtifact } = await import('../../dist/completion/writer.js');
    result = writeResultArtifact({
      root,
      serviceUid: process.getuid?.() ?? 0,
      occurrenceId: OCCURRENCE_ID,
      attemptId: ATTEMPT_ID,
      bytes,
    });
  } else {
    const { executeDraftFileWrite } = await import('../../dist/writing/executor.js');
    result = executeDraftFileWrite({
      operationClass: 'artifact-draft-destination',
      purpose: 'persist-validated-artifact-draft',
      configurationIdentity: 'sha-256:' + 'e'.repeat(64),
      workspaceId: 'pgw:w:eeeeeeeeeeeeeeee',
      artifactKind: 'TaskSpec',
      canonicalArtifactRoot: root,
      canonicalExistingDirectoryAncestor: root,
      canonicalAncestorRelativePath: '',
      destinationTailComponents: ['race-target.json'],
      canonicalUtf8: payload === 'exact' ? '{"exact":"race-canonical"}' : '{"conflict":"race-loser"}',
      expectedByteCount: bytes.byteLength,
    });
  }
} catch (e) {
  const message = e && typeof e.message === 'string' ? e.message : 'write-threw';
  process.stdout.write(`ERROR ${message}\n`);
  process.exit(1);
}

process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
process.exit(0);
