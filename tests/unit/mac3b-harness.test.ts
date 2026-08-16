/**
 * MAC-3B — harness self-tests (TEST-ONLY infrastructure proof).
 *
 * Proves the MAC-3B infrastructure itself: the bounded child-pathname
 * actor (ready protocol, budget bounding, timeout kill/reap, orphan-free
 * cleanup, fixture containment), the deterministic interleave helper
 * (exact ordering, single-shot actions, no sleep/retry), and the isolated
 * fd-pressure harness (EMFILE induction confined to the child, release,
 * post-release usability, parent untouched).
 *
 * These are HARNESS tests, not RACE-Ixx closure evidence: infrastructure
 * availability != security evidence (MAC-3B §14). Sleeps appear ONLY as
 * lifecycle pacing in the timeout/orphan tests; they are never used as
 * synchronization evidence (MAC-3B §11).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChildActor, startChildActor, withChildActor } from '../mac3b/child-actor.js';
import { preparePressureFixture, runFdPressure } from '../mac3b/fd-pressure.js';
import { makeInterleaveClock, once } from '../mac3b/interleave.js';

function makeFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac3b-actor-')));
  return {
    root,
    remove() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function fdCount(): number {
  return fs.readdirSync('/dev/fd').length;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('child actor: ready handshake and DONE protocol with the exact iteration count', async () => {
  const fx = makeFixture();
  try {
    const actor = startChildActor({ fixtureRoot: fx.root, script: 'dir-rename-cycle', budget: 5 });
    await actor.ready;
    assert.ok(actor.pid > 0, 'child pid exposed');
    const outcome = await actor.wait();
    assert.equal(outcome.ok, true);
    assert.equal(outcome.iterations, 5, 'exactly budget iterations');
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.timedOut, false);
  } finally {
    fx.remove();
  }
});

test('child actor: bounded mutation scripts leave the expected deterministic final state', async () => {
  const fx = makeFixture();
  try {
    // dir-rename-cycle: after 4 iterations from empty, the churn state is
    // alpha (fresh replacement) AND alpha-moved (the renamed original);
    // the cycle deterministically occupies both names after iteration 1.
    fs.mkdirSync(path.join(fx.root, 'alpha'));
    const r1 = await runChildActor({ fixtureRoot: fx.root, script: 'dir-rename-cycle', budget: 4 });
    assert.equal(r1.ok, true);
    assert.equal(fs.statSync(path.join(fx.root, 'alpha')).isDirectory(), true);
    assert.equal(fs.statSync(path.join(fx.root, 'alpha-moved')).isDirectory(), true);

    // symlink-cycle: after 2 iterations the link is absent again, target dir exists.
    const r2 = await runChildActor({ fixtureRoot: fx.root, script: 'symlink-cycle', budget: 2 });
    assert.equal(r2.ok, true);
    assert.equal(fs.existsSync(path.join(fx.root, 'link')), false);
    assert.equal(fs.statSync(path.join(fx.root, 'target')).isDirectory(), true);
  } finally {
    fx.remove();
  }
});

test('child actor: budget exhaustion terminates cleanly', async () => {
  const fx = makeFixture();
  try {
    const outcome = await runChildActor({ fixtureRoot: fx.root, script: 'mixed-churn', budget: 500 });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.iterations, 500, 'budget exhausted exactly');
  } finally {
    fx.remove();
  }
});

test('child actor: timeout path kills and reaps (lifecycle bounding, not evidence)', async () => {
  const fx = makeFixture();
  try {
    const actor = startChildActor({
      fixtureRoot: fx.root,
      script: 'pause',
      budget: 100,
      pauseDelayMs: 300,
      timeoutMs: 150,
    });
    await actor.ready;
    const outcome = await actor.wait();
    assert.equal(outcome.timedOut, true, 'timeout detected');
    assert.equal(outcome.signal, 'SIGKILL');
    assert.equal(outcome.exitCode, null);
    assert.equal(alive(actor.pid), false, 'killed child is reaped, no orphan');
  } finally {
    fx.remove();
  }
});

test('child actor: forced parent assertion failure leaves no orphan (finally kill+reap)', async () => {
  const fx = makeFixture();
  let pid = -1;
  try {
    await assert.rejects(
      withChildActor(
        { fixtureRoot: fx.root, script: 'pause', budget: 100, pauseDelayMs: 500 },
        async (actor) => {
          pid = actor.pid;
          await sleep(50);
          throw new Error('injected parent failure');
        },
      ),
      /injected parent failure/,
    );
    assert.equal(alive(pid), false, 'child killed and reaped despite the assertion failure');
  } finally {
    fx.remove();
  }
});

test('child actor: fixture containment blocks escape (no outside write)', async () => {
  const fx = makeFixture();
  let pid = -1;
  try {
    const actor = startChildActor({ fixtureRoot: fx.root, script: 'escape-attempt', budget: 3 });
    await actor.ready;
    pid = actor.pid;
    const outcome = await actor.wait();
    assert.equal(outcome.ok, true, 'escape attempts are blocked per-operation, not fatal');
    const escapeTarget = path.join(os.tmpdir(), `mac3b-escape-${pid}`);
    assert.equal(fs.existsSync(escapeTarget), false, 'no file was ever written outside the fixture root');
    assert.equal(alive(pid), false, 'child reaped');
  } finally {
    fx.remove();
  }
});

test('child actor: unknown script and invalid budget fail closed without a child', async () => {
  const fx = makeFixture();
  try {
    const outcome = await runChildActor({ fixtureRoot: fx.root, script: 'nope' as never, budget: 2 });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, 'unknown-script');
    assert.throws(
      () => startChildActor({ fixtureRoot: fx.root, script: 'dir-rename-cycle', budget: 0 }),
      /budget/,
    );
    assert.throws(
      () => startChildActor({ fixtureRoot: fx.root, script: 'dir-rename-cycle', budget: 100_001 }),
      /budget/,
    );
  } finally {
    fx.remove();
  }
});

test('interleave clock: exact deterministic ordering, no timing, no retry', () => {
  const clock = makeInterleaveClock();
  clock.record('anchor');
  clock.record('mutate');
  clock.record('resume');
  clock.assertExact(['anchor', 'mutate', 'resume']);
  assert.throws(() => clock.assertExact(['anchor', 'resume', 'mutate']), /order mismatch/);
  assert.deepEqual(clock.order(), ['anchor', 'mutate', 'resume']);
  assert.equal(Object.isFrozen(clock.order()), true);
});

test('interleave once: single-shot action with predictable error propagation', () => {
  let calls = 0;
  const action = once(() => {
    calls++;
    return 'first';
  });
  assert.equal(action(), 'first');
  assert.equal(action(), undefined, 'later calls are no-ops');
  assert.equal(action(), undefined);
  assert.equal(calls, 1, 'exactly one invocation');

  let failedCalls = 0;
  const failing = once(() => {
    failedCalls++;
    throw new Error('boundary-boom');
  });
  assert.throws(() => failing(), /boundary-boom/, 'first-call error propagates predictably');
  failing();
  failing();
  assert.equal(failedCalls, 1, 'a failed action is not retried (no retry-until-win)');
});

test('fd pressure: EMFILE induced in the child, released, child usable, parent untouched', async () => {
  const fx = makeFixture();
  try {
    const markerDir = preparePressureFixture(fx.root);
    const parentBefore = fdCount();
    const r = await runFdPressure({ markerDir });
    assert.equal(r.ok, true, 'pressure cycle completed (emfile reached + sanity ok)');
    assert.equal(r.emfile, true, 'controlled EMFILE was deterministically reached');
    assert.equal(r.probe, 'emfile', 'probe under held pressure fails with EMFILE');
    assert.equal(r.sanity, 'ok', 'child remains usable after release');
    assert.ok(r.preopened >= 1, `descriptors were actually held (${r.preopened})`);
    assert.equal(r.exitCode, 0);
    assert.equal(fs.existsSync(path.join(markerDir, 'sanity.marker')), true, 'post-release sanity marker written');
    const parentAfter = fdCount();
    assert.ok(parentAfter <= parentBefore + 2, `parent fd table unaffected: ${parentBefore} -> ${parentAfter}`);
  } finally {
    fx.remove();
  }
});

test('fd pressure: bounded and reproducible across repeated isolated cycles', async () => {
  const fx = makeFixture();
  try {
    const markerDir = preparePressureFixture(fx.root);
    const parentBefore = fdCount();
    for (let i = 0; i < 2; i++) {
      const r = await runFdPressure({ markerDir });
      assert.equal(r.ok, true, `cycle ${i} reproducible`);
      assert.equal(r.emfile, true);
    }
    const parentAfter = fdCount();
    assert.ok(parentAfter <= parentBefore + 2, 'repeated cycles leave the parent untouched');
  } finally {
    fx.remove();
  }
});
