/**
 * MAC-3E — RACE-I14 integrated fd-pressure evidence (real Intel host).
 *
 * The MAC-3B isolated pressure harness proved EMFILE induction/release in
 * a separate child. THIS suite drives the REAL production consumers
 * (completion writer, writing executor, reader descent) under that held
 * pressure inside the isolated child (`tests/mac3e/pressure-consumer.mjs`):
 *
 *   - the PROBE (consumer under EMFILE) must fail closed with a TYPED
 *     outcome inside the accepted vocabulary — never a throw-shaped
 *     success, never a fallback pathname write;
 *   - no partial object may exist after the failed probe (truthful
 *     lifecycle: nothing created, so nothing to clean up);
 *   - the POST (same consumer after release) must SUCCEED with the exact
 *     canonical bytes — recovery after pressure release;
 *   - the parent process fd table is untouched (the child is isolated).
 *
 * The EMFILE phase is deterministic (pad-file opens until the process fd
 * limit, hard-capped); no sleeps, no retry-until-win. MAC-3E does NOT
 * exhaust the parent or the machine.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PRESSURE_SCRIPT = fileURLToPath(new URL('../../../tests/mac3e/pressure-consumer.mjs', import.meta.url));

const OCCURRENCE_ID = 'pgw:o:77777777777777777777777777777777';
const ATTEMPT_ID = 'pgw:a:88888888888888888888888888888888';
const EXACT = Buffer.from('{"exact":"pressure-probe"}');

const bases: string[] = [];
function newBase(): { base: string; root: string } {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac3e-pressure-')));
  bases.push(base);
  const root = path.join(base, 'ws');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(base, 'pad.bin'), 'pad');
  return { base, root };
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

interface PressureResult {
  readonly ok: boolean;
  readonly preopened: number;
  readonly emfile: boolean;
  readonly probe: unknown;
  readonly probeLeft: boolean;
  readonly probeBytes: string | null;
  readonly post: unknown;
  readonly sanity: boolean;
  readonly error: string | null;
}

function runPressureConsumer(fixtureDir: string, consumer: 'completion' | 'executor' | 'reader-open'): Promise<PressureResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [PRESSURE_SCRIPT, fixtureDir, consumer], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, 20000);
    timer.unref();
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 16384) {
        child.kill('SIGKILL');
        stdout = stdout.slice(0, 16384) + '\nERROR output-budget-exceeded\n';
      }
    });
    child.stderr!.resume();
    child.on('close', () => {
      clearTimeout(timer);
      const lines = stdout.split('\n').filter((l) => l.length > 0);
      const resultLine = lines[lines.length - 1] ?? '';
      const m = /^RESULT (.+)$/.exec(resultLine);
      const error = /^ERROR (.+)$/.exec(resultLine);
      if (timedOut) {
        resolvePromise({ ok: false, preopened: 0, emfile: false, probe: null, probeLeft: false, probeBytes: null, post: null, sanity: false, error: 'timeout' });
      } else if (m) {
        try {
          const parsed = JSON.parse(m[1]!) as { preopened: number; emfile: boolean; probe: unknown; probeLeft: boolean; probeBytes: string | null; post: unknown; sanity: boolean };
          resolvePromise({ ok: parsed.emfile && parsed.sanity, ...parsed, error: null });
        } catch {
          resolvePromise({ ok: false, preopened: 0, emfile: false, probe: null, probeLeft: false, probeBytes: null, post: null, sanity: false, error: 'unparseable-result' });
        }
      } else if (error) {
        resolvePromise({ ok: false, preopened: 0, emfile: false, probe: null, probeLeft: false, probeBytes: null, post: null, sanity: false, error: error[1] ?? 'pressure-failed' });
      } else {
        resolvePromise({ ok: false, preopened: 0, emfile: false, probe: null, probeLeft: false, probeBytes: null, post: null, sanity: false, error: `unexpected-exit:${String(child.exitCode)}` });
      }
    });
  });
}

function fdCount(): number {
  return fs.readdirSync('/dev/fd').length;
}

test('mac3e RACE-I14 completion: EMFILE probe fails closed typed, no partial object, exact recovery after release', async () => {
  const { base, root } = newBase();
  fs.mkdirSync(path.join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID), { recursive: true });
  const dest = path.join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json');
  const parentBefore = fdCount();
  const r = await runPressureConsumer(base, 'completion');
  assert.equal(r.ok, true, `pressure cycle must complete: ${r.error}`);
  assert.equal(r.emfile, true);
  assert.equal(r.preopened > 0, true, 'pressure was genuinely induced');
  // Probe: typed fail-closed — the completion writer's root anchor maps
  // EMFILE into the closed io-failure vocabulary; nothing was created.
  const probe = r.probe as { ok?: boolean; code?: string; threw?: boolean };
  assert.equal(probe.threw, undefined, `no untyped throw crosses the consumer boundary: ${JSON.stringify(probe)}`);
  assert.equal(probe.ok, false, 'probe fails closed under pressure');
  assert.equal(probe.code, 'io-failure', `exact typed failure: ${JSON.stringify(probe)}`);
  assert.equal(r.probeLeft, false, `the failed probe left NO object at the destination (child-side observation): ${JSON.stringify(r)}`);
  // Post: recovery — the same consumer succeeds after release.
  const post = r.post as { ok?: boolean; outcome?: string };
  assert.deepEqual(post, { ok: true, outcome: 'created' }, `exact post-release outcome: ${JSON.stringify(post)}`);
  assert.deepEqual(fs.readFileSync(dest), EXACT, 'canonical bytes after recovery');
  const parentAfter = fdCount();
  assert.ok(parentAfter <= parentBefore + 2, `parent fd table untouched: ${parentBefore} -> ${parentAfter}`);
});

test('mac3e RACE-I14 executor: EMFILE probe fails closed typed, no partial object, exact recovery after release', async () => {
  const { base, root } = newBase();
  const dest = path.join(root, 'pressure-target.json');
  const parentBefore = fdCount();
  const r = await runPressureConsumer(base, 'executor');
  assert.equal(r.ok, true, `pressure cycle must complete: ${r.error}`);
  const probe = r.probe as { ok?: boolean; code?: string; cleanup?: string; threw?: boolean };
  assert.equal(probe.threw, undefined, 'no untyped throw crosses the executor boundary');
  assert.equal(probe.ok, false, 'probe fails closed under pressure');
  assert.equal(probe.code, 'io-failure', `exact typed failure: ${JSON.stringify(probe)}`);
  assert.equal(probe.cleanup, 'not-needed', 'no object existed, so cleanup truthfully reports not-needed');
  assert.equal(r.probeLeft, false, `the failed probe left NO object at the destination (child-side observation): ${JSON.stringify(r)}`);
  const post = r.post as { ok?: boolean; outcome?: string; persistedByteCount?: number };
  assert.deepEqual(
    { ok: post.ok, outcome: post.outcome, persistedByteCount: post.persistedByteCount },
    { ok: true, outcome: 'created', persistedByteCount: EXACT.byteLength },
    `exact post-release outcome: ${JSON.stringify(post)}`,
  );
  assert.deepEqual(fs.readFileSync(dest), EXACT, 'canonical bytes after recovery');
  const parentAfter = fdCount();
  assert.ok(parentAfter <= parentBefore + 2, `parent fd table untouched: ${parentBefore} -> ${parentAfter}`);
});

test('mac3e RACE-I14 reader descent: EMFILE probe fails closed typed, original bytes recovered after release', async () => {
  const { base, root } = newBase();
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'file.txt'), 'PRESSURE-ORIGINAL');
  const parentBefore = fdCount();
  const r = await runPressureConsumer(base, 'reader-open');
  assert.equal(r.ok, true, `pressure cycle must complete: ${r.error}`);
  const probe = r.probe as { ok?: boolean; code?: string; threw?: boolean };
  assert.equal(probe.threw, undefined, 'no untyped throw crosses the reader boundary');
  assert.equal(probe.ok, false, 'probe fails closed under pressure');
  assert.equal(probe.code, 'error', `exact typed reader vocabulary failure: ${JSON.stringify(probe)}`);
  assert.equal(fs.readFileSync(path.join(root, 'sub', 'file.txt'), 'utf8'), 'PRESSURE-ORIGINAL', 'no mutation during the failed probe');
  const post = r.post as { ok?: boolean; target?: string; bytes?: string };
  assert.equal(post.ok, true, 'reader descent recovers after release');
  assert.equal(post.target, 'sub/file.txt');
  assert.equal(post.bytes, 'PRESSURE-ORIGINAL', 'exact original bytes after recovery');
  const parentAfter = fdCount();
  assert.ok(parentAfter <= parentBefore + 2, `parent fd table untouched: ${parentBefore} -> ${parentAfter}`);
});
