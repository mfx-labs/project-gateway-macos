#!/usr/bin/env node
/**
 * MAC-3E — integrated fd-pressure consumer child (TEST-ONLY).
 *
 * NOT part of production. Executed by `tests/unit/mac3e-fd-pressure.test.ts`
 * as a separate Node process: descriptor pressure is confined to the child
 * (the parent's fd table is untouched; nothing machine-wide is exhausted —
 * RACE-I14).
 *
 * argv: <fixtureDir> <consumer: completion|executor|reader-open>
 *
 * Deterministic phases:
 *   0. (reader-open only) bind the workspace root BEFORE pressure (the
 *      production composition already holds this descriptor);
 *   1. open the pad file repeatedly until EMFILE (bounded by the process
 *      fd limit and a hard cap — always terminates);
 *   2. PROBE under held pressure: run the REAL production consumer
 *      (compiled dist modules) and report its exact typed outcome — it
 *      must fail closed inside the accepted vocabulary with NO partial
 *      object and NO fallback pathname authority;
 *   3. RELEASE every held descriptor;
 *   4. POST: run the SAME consumer again and report its exact outcome —
 *      it must now succeed (recovery after pressure release), proving no
 *      permanent corruption and no descriptor leak.
 *
 * Protocol: `READY <pid>` then `RESULT <json>`; the parent owns the
 * timeout/kill.
 */
import { closeSync, openSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// Production modules are imported STATICALLY (before pressure is induced):
// a dynamic import under EMFILE could fail while loading the module file,
// which is NOT the property under test — the property is the consumer's
// descriptor operation failing closed under pressure.
import { writeResultArtifact } from '../../dist/completion/writer.js';
import { executeDraftFileWrite } from '../../dist/writing/executor.js';
import { bindWorkspaceRoot, openForRead, readFileBytes } from '../../dist/reader/fs.js';
import { loadGatewayFs } from '#gateway-native';

const PRESSURE_CAP = 100000;

const [fixtureDirArg, consumer] = process.argv.slice(2);

function fail(message) {
  process.stdout.write(`ERROR ${message}\n`);
  process.exit(1);
}

if (consumer !== 'completion' && consumer !== 'executor' && consumer !== 'reader-open') fail('unknown-consumer');

const fixtureDir = resolve(fixtureDirArg);
const PAD = join(fixtureDir, 'pad.bin');
const ROOT = join(fixtureDir, 'ws');
const OCCURRENCE_ID = 'pgw:o:77777777777777777777777777777777';
const ATTEMPT_ID = 'pgw:a:88888888888888888888888888888888';
const EXACT = Buffer.from('{"exact":"pressure-probe"}');

let bound = null;

async function prepare() {
  // Warm the native addon BEFORE pressure: the production composition
  // holds the addon from prior operations; the property under test is the
  // descriptor operation failing closed under EMFILE, not the loader.
  loadGatewayFs();
  if (consumer === 'reader-open') {
    bound = await bindWorkspaceRoot(ROOT);
  }
}

async function runConsumer() {
  if (consumer === 'completion') {
    return writeResultArtifact({
      root: ROOT,
      serviceUid: process.getuid?.() ?? 0,
      occurrenceId: OCCURRENCE_ID,
      attemptId: ATTEMPT_ID,
      bytes: EXACT,
    });
  }
  if (consumer === 'executor') {
    return executeDraftFileWrite({
      operationClass: 'artifact-draft-destination',
      purpose: 'persist-validated-artifact-draft',
      configurationIdentity: 'sha-256:' + 'f'.repeat(64),
      workspaceId: 'pgw:w:ffffffffffffffff',
      artifactKind: 'TaskSpec',
      canonicalArtifactRoot: ROOT,
      canonicalExistingDirectoryAncestor: ROOT,
      canonicalAncestorRelativePath: '',
      destinationTailComponents: ['pressure-target.json'],
      canonicalUtf8: '{"exact":"pressure-probe"}',
      expectedByteCount: EXACT.byteLength,
    });
  }
  // reader-open: the root was bound BEFORE pressure (phase 0); the probe
  // runs the real descriptor descent under the held pressure.
  const opened = await openForRead(bound, 'sub/file.txt', 'sub/file.txt');
  if (!opened.ok) return opened;
  const { bytes } = await readFileBytes(opened.target, 64);
  opened.target.close();
  return { ok: true, target: 'sub/file.txt', bytes: bytes.toString() };
}

process.stdout.write(`READY ${process.pid}\n`);

const held = [];
let preopened = 0;
let emfile = false;
try {
  await prepare();

  // Phase 1: induce EMFILE.
  for (let i = 0; i < PRESSURE_CAP; i++) {
    try {
      held.push(openSync(PAD, 'r'));
      preopened++;
    } catch (e) {
      if (e && e.code === 'EMFILE') {
        emfile = true;
        break;
      }
      throw e;
    }
  }
  if (!emfile) fail('emfile-not-reached');

  // Phase 2: probe the production consumer under held pressure.
  let probe;
  try {
    probe = await runConsumer();
  } catch (e) {
    const code = e && typeof e.code === 'string' ? e.code : 'consumer-threw';
    probe = { threw: true, code };
  }
  // Child-side probe disposition: the probe failure must have created NO
  // object at the destination (observed BEFORE the post phase runs).
  const probeDest =
    consumer === 'completion' ? join(ROOT, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json')
    : consumer === 'executor' ? join(ROOT, 'pressure-target.json')
    : join(ROOT, 'sub', 'file.txt');
  const probeLeft = existsSync(probeDest);
  const probeBytes = probeLeft ? (() => { try { return readFileSync(probeDest, 'utf8'); } catch { return '<unreadable>'; } })() : null;

  // Phase 3: release every descriptor.
  for (const fd of held) {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
  }
  held.length = 0;

  // Phase 4: post-release recovery — the SAME consumer must now succeed.
  let post;
  try {
    post = await runConsumer();
  } catch (e) {
    const code = e && typeof e.code === 'string' ? e.code : 'consumer-threw';
    post = { threw: true, code };
  }
  if (bound !== null) await bound.close().catch(() => undefined);

  const sanityOk = existsSync(PAD);
  process.stdout.write(
    `RESULT ${JSON.stringify({ preopened, emfile, probe, probeLeft, probeBytes, post, sanity: sanityOk })}\n`,
  );
  process.exit(sanityOk ? 0 : 1);
} catch (e) {
  for (const fd of held) {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
  }
  const code = e && typeof e.code === 'string' ? e.code : 'pressure-failed';
  process.stdout.write(`ERROR ${code}\n`);
  process.exit(1);
}
