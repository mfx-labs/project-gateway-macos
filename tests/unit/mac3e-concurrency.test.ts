/**
 * MAC-3E — RACE-I15 / W-C7 TRUE CONCURRENCY evidence (real Intel host).
 *
 * N real production writers run in SEPARATE Node processes and race ONE
 * shared destination simultaneously (barrier-released, then a single
 * production write each). This is true concurrent-process evidence —
 * not the MAC-3C reentrant ordering simulation.
 *
 * Evidence policy (MAC-3A §10/§12): the barrier is a lifecycle
 * synchronization bound, never evidence; the GO-file poll deadline in the
 * child is a bounded lifecycle limit. The EVIDENCE is the deterministic
 * outcome-set invariant that must hold under ANY scheduling:
 *
 *   - exactly ONE outcome is `created` (at most one creation);
 *   - every loser outcome is inside the accepted vocabulary:
 *     `already-exact` (exact-bytes recovery adoption) or
 *     `exclusive-create-conflict` (typed conflict — the executor lane) /
 *     `exclusive-create-conflict` (completion recovery);
 *   - the on-disk object contains exactly ONE of the racer payloads and
 *     is consistent with the outcome set (no overwrite, no interleaved
 *     bytes, no adoption of a decoy);
 *   - nothing outside the fixture root is created or mutated.
 *
 * No sleeps, no retry-until-win, no statistical acceptance: every
 * assertion is an invariant over the complete outcome set.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACE_SCRIPT = fileURLToPath(new URL('../../../tests/mac3e/race-writer.mjs', import.meta.url));

const COMPLETION_DEST = 'execution-result.json';
const EXECUTOR_DEST = 'race-target.json';
const EXACT_BYTES = Buffer.from('{"exact":"race-canonical"}');
const CONFLICT_BYTES = Buffer.from('{"conflict":"race-loser"}');

const bases: string[] = [];
function newBase(): string {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac3e-race-')));
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

interface RacerOutcome {
  readonly ok: boolean;
  readonly error: string | null;
  readonly result: unknown;
}

/** Barrier: spawn all racers, wait for every READY, then release via GO. */
async function raceWriters(
  fixtureRoot: string,
  mode: 'completion' | 'executor',
  payloads: readonly ('exact' | 'conflict')[],
): Promise<unknown[]> {
  const goFile = path.join(fixtureRoot, 'GO');
  const racers = payloads.map((payload) => {
    const racer = spawn(process.execPath, [RACE_SCRIPT, fixtureRoot, mode, payload, goFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    racer.stdout!.setEncoding('utf8');
    racer.stdout!.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 8192) {
        racer.kill('SIGKILL');
        stdout = stdout.slice(0, 8192) + '\nERROR output-budget-exceeded\n';
      }
    });
    racer.stderr!.resume();
    const ready = new Promise<void>((resolvePromise) => {
      racer.stdout!.on('data', () => {
        if (stdout.split('\n').some((l) => /^READY \d+$/.test(l))) resolvePromise();
      });
    });
    const done = new Promise<RacerOutcome>((resolvePromise) => {
      const timer = setTimeout(() => {
        try {
          racer.kill('SIGKILL');
        } catch {
          // already gone
        }
        resolvePromise({ ok: false, error: 'timeout', result: null });
      }, 15000);
      timer.unref();
      racer.on('close', () => {
        clearTimeout(timer);
        const lines = stdout.split('\n').filter((l) => l.length > 0);
        const resultLine = lines[lines.length - 1] ?? '';
        const m = /^RESULT (.+)$/.exec(resultLine);
        if (m) {
          try {
            resolvePromise({ ok: true, error: null, result: JSON.parse(m[1]!) });
          } catch {
            resolvePromise({ ok: false, error: `unparseable-result:${m[1]!.slice(0, 80)}`, result: null });
          }
        } else {
          const error = /^ERROR (.+)$/.exec(resultLine);
          resolvePromise({ ok: false, error: error?.[1] ?? `no-result-line:${resultLine.slice(0, 80)}`, result: null });
        }
      });
    });
    return { ready, done };
  });

  // Every racer must print READY before the GO release (bounded deadline —
  // lifecycle synchronization, not evidence).
  const readyDeadline = new Promise<void>((_, rejectPromise) => {
    const t = setTimeout(() => rejectPromise(new Error('racers did not become READY')), 10000);
    t.unref();
  });
  await Promise.race([Promise.all(racers.map((r) => r.ready)), readyDeadline]);
  fs.writeFileSync(goFile, 'go');

  const outcomes = await Promise.all(racers.map((r) => r.done));
  assert.ok(
    outcomes.every((o) => o.ok && o.error === null),
    `every racer must complete a typed production write: ${JSON.stringify(outcomes.map((o) => o.error))}`,
  );
  return outcomes.map((o) => o.result);
}

test('mac3e RACE-I15 completion: N concurrent processes racing one destination — exactly one created, losers recover/adopt, no overwrite', async () => {
  const base = newBase();
  const root = path.join(base, 'ws');
  fs.mkdirSync(path.join(root, 'results', 'pgw:o:55555555555555555555555555555555', 'pgw:a:66666666666666666666666666666666'), { recursive: true });
  const dest = path.join(root, 'results', 'pgw:o:55555555555555555555555555555555', 'pgw:a:66666666666666666666666666666666', COMPLETION_DEST);

  const outcomes = await raceWriters(root, 'completion', ['exact', 'exact', 'exact', 'exact']);
  assert.equal(outcomes.length, 4);
  const created = outcomes.filter((o) => (o as { ok?: boolean }).ok === true && (o as { outcome?: string }).outcome === 'created');
  const adopted = outcomes.filter((o) => (o as { ok?: boolean }).ok === true && (o as { outcome?: string }).outcome === 'already-exact');
  assert.equal(created.length, 1, `exactly one created outcome: ${JSON.stringify(outcomes)}`);
  assert.equal(adopted.length, 3, `every loser recovered the winner's exact bytes: ${JSON.stringify(outcomes)}`);
  assert.deepEqual(fs.readFileSync(dest), EXACT_BYTES, 'on-disk object is the single canonical payload — no interleaving, no overwrite');
  // Nothing outside the fixture: the sibling directory of the racer tree
  // is untouched (cross-root confinement).
  assert.deepEqual(fs.readdirSync(base).sort(), ['ws'], 'no cross-root object was created');
});

test('mac3e RACE-I15 completion: mixed payloads — the winner payload on disk, loser outcomes consistent, at most one created', async () => {
  const base = newBase();
  const root = path.join(base, 'ws');
  fs.mkdirSync(path.join(root, 'results', 'pgw:o:55555555555555555555555555555555', 'pgw:a:66666666666666666666666666666666'), { recursive: true });
  const dest = path.join(root, 'results', 'pgw:o:55555555555555555555555555555555', 'pgw:a:66666666666666666666666666666666', COMPLETION_DEST);

  const payloads: readonly ('exact' | 'conflict')[] = ['exact', 'exact', 'conflict', 'conflict'];
  const outcomes = await raceWriters(root, 'completion', payloads);
  const created = outcomes.filter((o) => (o as { ok?: boolean }).ok === true && (o as { outcome?: string }).outcome === 'created');
  const disk = fs.readFileSync(dest);
  assert.equal(created.length, 1, `exactly one created outcome: ${JSON.stringify(outcomes)}`);
  assert.ok(disk.equals(EXACT_BYTES) || disk.equals(CONFLICT_BYTES), 'on-disk bytes are exactly one racer payload');
  const bytesOf = (p: 'exact' | 'conflict'): Buffer => (p === 'exact' ? EXACT_BYTES : CONFLICT_BYTES);
  for (let i = 0; i < outcomes.length; i++) {
    const r = outcomes[i] as { ok: boolean; outcome?: string; code?: string };
    const payload = payloads[i]!;
    if (r.ok) {
      assert.ok(r.outcome === 'created' || r.outcome === 'already-exact', `typed ok outcome: ${JSON.stringify(r)}`);
      // already-exact adoption requires the disk to hold THIS racer's payload.
      if (r.outcome === 'already-exact') {
        assert.deepEqual(disk, bytesOf(payload), 'adoption only of the racer payload matching the on-disk winner');
      }
    } else {
      assert.equal(r.code, 'exclusive-create-conflict', `loser uses the accepted conflict vocabulary: ${JSON.stringify(r)}`);
    }
  }
  assert.deepEqual(fs.readdirSync(base).sort(), ['ws'], 'no cross-root object was created');
});

test('mac3e RACE-I15 executor: N concurrent processes racing one destination — exactly one created, typed conflicts, no overwrite', async () => {
  const base = newBase();
  const root = path.join(base, 'ws');
  fs.mkdirSync(root, { recursive: true });
  const dest = path.join(root, EXECUTOR_DEST);

  const outcomes = await raceWriters(root, 'executor', ['exact', 'exact', 'exact', 'exact']);
  const winners = outcomes.filter((o) => (o as { ok?: boolean }).ok === true);
  const losers = outcomes.filter((o) => (o as { ok?: boolean }).ok === false);
  assert.equal(winners.length, 1, `exactly one created outcome: ${JSON.stringify(outcomes)}`);
  assert.equal(losers.length, 3, `exactly three losing racers: ${JSON.stringify(outcomes)}`);

  // E1-F1: per-racer exact assertions (regression-locked, not merely
  // observed): the winner's full created shape with the exact persisted
  // byte count; every loser's exact fail-closed shape including the
  // truthful not-needed cleanup disposition.
  const winner = winners[0] as { ok: boolean; outcome?: string; persistedByteCount?: number };
  assert.equal(winner.ok, true, `winner.ok exactly true: ${JSON.stringify(winner)}`);
  assert.equal(winner.outcome, 'created', `winner outcome exactly created: ${JSON.stringify(winner)}`);
  assert.equal(winner.persistedByteCount, EXACT_BYTES.length, `winner persisted exactly the canonical byte count: ${JSON.stringify(winner)}`);
  for (const o of losers) {
    const r = o as { ok: boolean; code?: string; cleanup?: string };
    assert.equal(r.ok, false, `loser ok exactly false: ${JSON.stringify(r)}`);
    assert.equal(r.code, 'exclusive-create-conflict', `loser code exactly exclusive-create-conflict: ${JSON.stringify(r)}`);
    assert.equal(r.cleanup, 'not-needed', `loser cleanup exactly not-needed (nothing created to clean): ${JSON.stringify(r)}`);
  }

  assert.deepEqual(fs.readFileSync(dest), EXACT_BYTES, 'on-disk object is the single canonical payload');
  assert.deepEqual(fs.readdirSync(root).sort(), ['GO', EXECUTOR_DEST], 'no sibling/partial file leaked (GO is the test barrier, not a write)');
  assert.deepEqual(fs.readdirSync(base).sort(), ['ws'], 'no cross-root object was created');
});
