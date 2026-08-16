/**
 * MAC-3B — durable candidate WP-7 accounting negative/positive
 * regression suite (MAC3B-F1 closure).
 *
 * Locks the accounting helpers exported by
 * `scripts/run-wp7-tests.mjs` (`evaluateSuite`, `parseSkippedNames`,
 * `EXPECTED_COUNTS`, `PERMITTED_SKIPS`) as DURABLE regression evidence.
 * Previously the negative behavior was only exercised by gate-time
 * one-off invocations; from MAC-3B focused correction onward it is a
 * durable regression test included in the current MAC-3B candidate
 * delta (runs in the default inventory via
 * `dist-test/tests/unit/*.test.js`); it is NOT yet Git-committed — the
 * local baseline commit is pending MAC-3B closure.
 *
 * Policy preserved: exactness is never weakened to make tests pass; the
 * adversarial TAP cases below document the fail-closed boundaries of the
 * skip allowlist (multiset-exact names, strict ` # SKIP` marker).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// The runner lives at <repo>/scripts/run-wp7-tests.mjs, which is NOT
// mirrored into dist-test. Resolve it at runtime from the compiled
// location (<repo>/dist-test/tests/unit/*.js -> 3 ups = repo root) and
// type it via the source-relative specifier (2 ups from tests/unit)
// against scripts/run-wp7-tests.d.mts.
const runner = (await import(
  new URL('../../../scripts/run-wp7-tests.mjs', import.meta.url).href,
)) as typeof import('../../scripts/run-wp7-tests.mjs');

const evaluateSuite = runner.evaluateSuite;
const parseSkippedNames = runner.parseSkippedNames;
const EXPECTED_COUNTS = runner.EXPECTED_COUNTS;
const PERMITTED_SKIPS = runner.PERMITTED_SKIPS;

const DARWIN_SECURITY_SKIPS = PERMITTED_SKIPS.security.darwin;

/** Minimal complete TAP trailing block (all six summary fields). */
function summary(tests: number, pass: number, fail: number, cancelled: number, skipped: number, todo: number): string {
  return (
    `1..${tests}\n` +
    `# tests ${tests}\n` +
    `# pass ${pass}\n` +
    `# fail ${fail}\n` +
    `# cancelled ${cancelled}\n` +
    `# skipped ${skipped}\n` +
    `# todo ${todo}\n`
  );
}

const DARWIN_SHAPE =
  'ok 1 - a\n' +
  '    ok 1 - WP-7 git children spawned during operations are observed, then reaped # SKIP /proc process-table observation is Linux-only (MAC-2D lane)\n' +
  '    ok 2 - leak-detection control: a deliberately leaked git child is detected, then cleaned up # SKIP /proc process-table observation is Linux-only (MAC-2D lane)\n' +
  '    ok 3 - unrelated host git processes are ignored (ownership-aware) # SKIP /proc process-table observation is Linux-only (MAC-2D lane)\n';

test('accounting: manifest sanity — exact counts and the exact Darwin permit allowlist', () => {
  assert.equal(EXPECTED_COUNTS.reader, 68, 'reader count restored to the authorized actual');
  assert.equal(EXPECTED_COUNTS.git, 41);
  assert.equal(EXPECTED_COUNTS.fff, 26);
  assert.equal(EXPECTED_COUNTS.security, 40, 'security count restored to the executed actual');
  assert.deepEqual(DARWIN_SECURITY_SKIPS, [
    'WP-7 git children spawned during operations are observed, then reaped',
    'leak-detection control: a deliberately leaked git child is detected, then cleaned up',
    'unrelated host git processes are ignored (ownership-aware)',
  ], 'the Darwin security permit list is exactly the three documented /proc tests');
  assert.deepEqual(PERMITTED_SKIPS.security.linux, [], 'Linux remains zero-skip');
  assert.deepEqual(PERMITTED_SKIPS.reader.darwin, [], 'reader remains zero-skip on every platform');
});

test('accounting: exact Darwin permitted-skip shape passes', () => {
  const r = evaluateSuite('security', 40, 0, DARWIN_SHAPE + summary(40, 37, 0, 0, 3, 0), DARWIN_SECURITY_SKIPS);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.summary?.pass, 37);
});

test('accounting: unexpected skip fails', () => {
  const r = evaluateSuite(
    'security', 40, 0,
    'ok 1 - a\n    ok 1 - x # SKIP unexpected\n' + summary(40, 37, 0, 0, 3, 0),
    DARWIN_SECURITY_SKIPS,
  );
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('unexpected or duplicated skipped test: x')), JSON.stringify(r.problems));
});

test('accounting: permitted skip missing fails (drift both ways)', () => {
  const r = evaluateSuite('security', 40, 0, 'ok 1 - a\n' + summary(40, 40, 0, 0, 0, 0), DARWIN_SECURITY_SKIPS);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('permitted skip did not occur')), JSON.stringify(r.problems));
});

test('accounting: skip-count mismatch fails', () => {
  // Summary says 2 skipped, the permit list has 3.
  const r = evaluateSuite(
    'security', 40, 0,
    'ok 1 - a\n    ok 1 - x # SKIP a\n    ok 2 - y # SKIP b\n' + summary(40, 38, 0, 0, 2, 0),
    DARWIN_SECURITY_SKIPS,
  );
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('platform-permitted skipped tests')), JSON.stringify(r.problems));
});

test('accounting: exact executed-count mismatch fails', () => {
  const r = evaluateSuite('reader', 68, 0, 'ok 1 - a\n' + summary(67, 67, 0, 0, 0, 0), []);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('expected 68 executed tests, summary reports 67')), JSON.stringify(r.problems));
});

test('accounting: zero-skip suite passes on the exact executed count', () => {
  const r = evaluateSuite('reader', 68, 0, 'ok 1 - a\n' + summary(68, 68, 0, 0, 0, 0), []);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test('accounting: unexpected skip on a zero-skip suite fails', () => {
  const r = evaluateSuite(
    'reader', 68, 0,
    'ok 1 - a\n    ok 1 - x # SKIP unexpected\n' + summary(68, 67, 0, 0, 1, 0),
    [],
  );
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('unexpected or duplicated skipped test: x')), JSON.stringify(r.problems));
});

test('accounting: nested/indented subtest skips are still detected (indentation never hides a skip)', () => {
  const deep = 'ok 1 - suite\n        ok 1 - deep # SKIP reason\n';
  assert.deepEqual(parseSkippedNames(deep), ['deep']);
  const r = evaluateSuite('reader', 68, 0, 'ok 1 - a\n' + deep + summary(68, 67, 0, 0, 1, 0), []);
  assert.equal(r.ok, false, 'an indented skip on a zero-skip suite must fail');
});

test('accounting: duplicate skipped name fails (multiset — one name cannot be counted twice)', () => {
  const dup = '    ok 1 - x # SKIP first\n    ok 2 - x # SKIP second\n';
  assert.deepEqual(parseSkippedNames(dup), ['x', 'x'], 'duplicates are preserved for multiset reconciliation');
  // Honest summary: 2 skipped, permit allows 1 → must fail.
  const r1 = evaluateSuite('security', 40, 0, 'ok 1 - a\n' + dup + summary(40, 38, 0, 0, 2, 0), ['x']);
  assert.equal(r1.ok, false);
  assert.ok(r1.problems.some((p) => p.includes('duplicated skipped test: x')), JSON.stringify(r1.problems));
  // Cheating summary: 1 skipped but two skip lines → must still fail.
  const r2 = evaluateSuite('security', 40, 0, 'ok 1 - a\n' + dup + summary(40, 39, 0, 0, 1, 0), ['x']);
  assert.equal(r2.ok, false, 'a duplicated skip line must never pass as one permitted skip');
});

test('accounting: a # inside a test name is not a skip marker', () => {
  const line = 'ok 1 - version #3 handling\n';
  assert.deepEqual(parseSkippedNames(line), []);
  // The #-named test is a NORMAL passing test: with a zero-skip permit
  // list the suite passes — the name is never mistaken for a skip.
  const r = evaluateSuite('reader', 68, 0, line + summary(68, 68, 0, 0, 0, 0), []);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test('accounting: skip-without-name never masquerades as a permitted skip', () => {
  const malformed = 'ok 1 - # SKIP reason\n';
  assert.deepEqual(parseSkippedNames(malformed), [], 'a name-less skip is not collected');
  // Summary claims one skip, permit allows one, but no name matches →
  // the permitted skip did not occur → fail closed.
  const r = evaluateSuite('security', 40, 0, 'ok 1 - a\n' + malformed + summary(40, 39, 0, 0, 1, 0), ['x']);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('permitted skip did not occur')), JSON.stringify(r.problems));
});

test('accounting: todo and not-ok lines never masquerade as permitted skips', () => {
  const adversarial =
    'ok 1 - a\n' +
    '    not ok 1 - x # SKIP boom\n' +
    '    ok 2 - y # TODO later\n';
  assert.deepEqual(parseSkippedNames(adversarial), [], 'neither a not-ok line nor a TODO line is a skip');
  const r = evaluateSuite('security', 40, 0, adversarial + summary(3, 1, 1, 0, 0, 0), ['x', 'y']);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('1 failing tests')), JSON.stringify(r.problems));
});
