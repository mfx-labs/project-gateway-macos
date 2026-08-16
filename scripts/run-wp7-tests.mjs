#!/usr/bin/env node
/**
 * WP-7-C — validated WP-7 test runner (Z-01 final correction).
 *
 * Executes the real compiled WP-7 tests per suite and enforces the ACTUAL
 * executed-test summary against the accepted count manifest. File presence
 * and source<->compiled correspondence are validated separately by
 * scripts/wp7-discovery-guard.mjs; this runner proves that the tests are
 * really discovered AND executed, with the exact accepted counts.
 *
 * Per suite (reader, git, fff, security), sequentially:
 *   - resolve the exact compiled *.test.js files;
 *   - launch the supported Node test runner (process.execPath, Node 22.23.2)
 *     with a machine-parseable TAP reporter and serialized file execution;
 *   - parse the final authoritative TAP summary (plan line + summary block);
 *   - require: tests == expected, pass == tests, fail == cancelled ==
 *     skipped == todo == 0, and process exit 0;
 *   - fail nonzero on: zero tests, all-skipped, missing/added tests,
 *     absent or ambiguous summary, exit/summary inconsistency.
 *
 * No informal console-sentence parsing is used. On failure the original
 * suite output is preserved to a temporary file and a bounded deterministic
 * diagnostic is printed.
 *
 * The accepted count manifest (must be updated consistently if authorized
 * test-count changes are ever merged):
 *   reader 68, git 41, fff 26, security 40 (total 175 executed).
 * Reader rose from 62 to 68 in MAC-2D (anchors ×5 + fd-stability ×1)
 * without a manifest update (MAC-2G FINDING-3) — restored here by MAC-3B.
 * Security rose from 32 to 39 in the final focused-rereview correction:
 * seven direct fingerprint fail-closed tests (Z-05) were authorized, and
 * one later addition brought the suite to 40 executed tests (the previous
 * manifest value 39 was stale by one; MAC-2G FINDING-3).
 * Git rose from 38 to 41 with the PS-6R version-policy tests (minimum
 * 2.30.0 acceptance, same-version fingerprint mutation, unsafe-binary
 * rejection) — authorized by the PS-6R runtime compatibility gate.
 *
 * Platform-skip accounting (MAC-3B): the security suite contains exactly
 * three /proc process-table observation tests that are documented
 * Linux-only (MAC-2D lane) and skip on Darwin. PERMITTED_SKIPS lists the
 * EXACT test names permitted to skip per suite per platform; the runner
 * enforces that the observed skipped-test set equals the permitted set
 * for the current platform (no unexpected skips, no missing permitted
 * skips) and that the summary skip count matches. All other suites and
 * platforms remain zero-skip; exact executed-test counts remain enforced
 * everywhere. A platform absent from PERMITTED_SKIPS defaults to
 * zero-permitted skips (fail-closed).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const EXPECTED_COUNTS = Object.freeze({ reader: 68, git: 41, fff: 26, security: 40 });

/**
 * Exact per-platform permitted-skip allowlist (MAC-3B). A skipped test is
 * accepted ONLY if its exact TAP name is listed for the current platform;
 * any other skip fails. Permitted skips that do NOT occur also fail
 * (accounting must stay exact both directions). A suite/platform absent
 * from this table is zero-skip (fail-closed).
 */
export const PERMITTED_SKIPS = Object.freeze({
  reader: Object.freeze({ darwin: Object.freeze([]), linux: Object.freeze([]) }),
  git: Object.freeze({ darwin: Object.freeze([]), linux: Object.freeze([]) }),
  fff: Object.freeze({ darwin: Object.freeze([]), linux: Object.freeze([]) }),
  security: Object.freeze({
    darwin: Object.freeze([
      'WP-7 git children spawned during operations are observed, then reaped',
      'leak-detection control: a deliberately leaked git child is detected, then cleaned up',
      'unrelated host git processes are ignored (ownership-aware)',
    ]),
    linux: Object.freeze([]),
  }),
});

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_DIAGNOSTIC_LINES = 15;

/**
 * Parse the final authoritative TAP summary from a node --test TAP stream.
 * The plan line (`1..N`) and the six summary fields must each appear
 * exactly once in the trailing block; nested (indented) subtests are
 * ignored. Returns { ok, summary | error }.
 */
export function parseTapSummary(stdout) {
  const lines = stdout.split('\n');
  let planIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^1\.\.\d+$/.test(lines[i])) {
      planIdx = i;
      break;
    }
  }
  if (planIdx === -1) return { ok: false, error: 'missing TAP plan line (1..N)' };
  const block = lines.slice(planIdx + 1);
  const readField = (name) => {
    const re = new RegExp(`^# ${name} (\\d+)$`);
    const matches = block.filter((l) => re.test(l));
    if (matches.length !== 1) {
      return { bad: `summary field '# ${name}' must appear exactly once in the trailing summary (found ${matches.length})` };
    }
    return Number(re.exec(matches[0])[1]);
  };
  const fields = {};
  for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const v = readField(name);
    if (v.bad) return { ok: false, error: v.bad };
    fields[name] = v;
  }
  return { ok: true, summary: fields };
}

/**
 * Collect the exact names of every test the TAP stream reports as skipped
 * (`ok <n> - <name> # SKIP …` at any nesting depth). The marker must be
 * the exact ` # SKIP` token with a non-empty name: a bare `#` inside a
 * name, a name-less skip, `not ok` lines, and `# TODO` lines never match.
 * Duplicates are preserved (the caller reconciles the multiset exactly).
 */
export function parseSkippedNames(stdout) {
  const skipped = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*ok \d+ - (.+?) # SKIP(?: .*)?$/.exec(line);
    if (m) skipped.push(m[1]);
  }
  return skipped;
}

/**
 * Evaluate a suite result: reconcile the parsed summary with the accepted
 * expected count, the per-platform permitted-skip allowlist, and the
 * child exit status. Returns { ok, problems, summary }.
 */
export function evaluateSuite(name, expected, status, stdout, permittedSkips = []) {
  const problems = [];
  const parsed = parseTapSummary(stdout);
  if (!parsed.ok) {
    problems.push(`no valid test summary (${parsed.error}); process exit ${status}`);
    return { ok: false, problems, summary: null };
  }
  const s = parsed.summary;
  const observedSkips = parseSkippedNames(stdout);
  // Multiset reconciliation: every observed skip name must occur exactly
  // as often as the permit list allows (0 or 1 for a unique allowlist), so
  // a duplicated skipped name can never masquerade as one permitted skip.
  const observedCounts = new Map();
  for (const name of observedSkips) observedCounts.set(name, (observedCounts.get(name) ?? 0) + 1);
  const permittedCounts = new Map();
  for (const name of permittedSkips) permittedCounts.set(name, (permittedCounts.get(name) ?? 0) + 1);
  if (s.tests !== expected) problems.push(`expected ${expected} executed tests, summary reports ${s.tests}`);
  if (s.fail !== 0) problems.push(`${s.fail} failing tests`);
  if (s.cancelled !== 0) problems.push(`${s.cancelled} cancelled tests`);
  if (s.todo !== 0) problems.push(`${s.todo} todo tests`);
  if (s.skipped !== permittedSkips.length) {
    problems.push(`expected ${permittedSkips.length} platform-permitted skipped tests, summary reports ${s.skipped}`);
  }
  for (const [name, count] of observedCounts) {
    const allowed = permittedCounts.get(name) ?? 0;
    if (allowed !== count) {
      problems.push(`unexpected or duplicated skipped test: ${name} (observed ${count}, permitted ${allowed})`);
    }
  }
  for (const [name, count] of permittedCounts) {
    const observed = observedCounts.get(name) ?? 0;
    if (observed !== count) {
      problems.push(`permitted skip did not occur (accounting drift): ${name}`);
    }
  }
  if (s.pass !== s.tests - s.skipped) problems.push(`pass count ${s.pass} != executed minus skipped ${s.tests - s.skipped}`);
  if (status !== 0) problems.push(`test process exited ${status} (inconsistent with an accepted summary)`);
  return { ok: problems.length === 0, problems, summary: s };
}

function runSuite(files) {
  const child = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-reporter=tap', ...files],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES },
  );
  return {
    status: child.status === null ? -1 : child.status,
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    spawnError: child.error ? String(child.error) : null,
  };
}

function main() {
  const problems = [];
  const preserved = [];
  let totalTests = 0;
  let totalSkips = 0;
  const platform = process.platform;
  for (const suite of Object.keys(EXPECTED_COUNTS)) {
    const expected = EXPECTED_COUNTS[suite];
    const permittedSkips = (PERMITTED_SKIPS[suite] && PERMITTED_SKIPS[suite][platform]) || Object.freeze([]);
    const dir = join(REPO_ROOT, 'dist-test', 'tests', 'wp7', suite);
    if (!existsSync(dir)) {
      problems.push(`[${suite}] compiled suite directory missing: dist-test/tests/wp7/${suite}`);
      continue;
    }
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.test.js'))
      .sort()
      .map((f) => join(dir, f));
    if (files.length === 0) {
      problems.push(`[${suite}] zero compiled test files in dist-test/tests/wp7/${suite}`);
      continue;
    }

    const { status, stdout, stderr, spawnError } = runSuite(files);
    const evaluation = evaluateSuite(suite, expected, status, stdout, permittedSkips);
    totalTests += evaluation.summary ? evaluation.summary.tests : 0;
    totalSkips += evaluation.summary ? evaluation.summary.skipped : 0;

    if (spawnError) {
      problems.push(`[${suite}] runner spawn failed: ${spawnError}`);
    }
    if (!evaluation.ok) {
      for (const p of evaluation.problems) problems.push(`[${suite}] ${p}`);
      const artifact = join(mkdtempSync(join(tmpdir(), 'wp7-runner-')), `${suite}.out.txt`);
      writeFileSync(artifact, `-- stdout --\n${stdout}\n-- stderr --\n${stderr}`);
      preserved.push(artifact);
      const tail = stdout.split('\n').slice(-MAX_DIAGNOSTIC_LINES).join('\n');
      console.error(`[wp7-runner] FAIL ${suite}: last ${MAX_DIAGNOSTIC_LINES} output lines:\n${tail}`);
    } else {
      const skipNote = evaluation.summary.skipped > 0 ? ` (${evaluation.summary.skipped} platform-permitted skips)` : '';
      console.log(`[wp7-runner] ${suite}: ${evaluation.summary.tests - evaluation.summary.skipped}/${evaluation.summary.tests} pass (exit ${status})${skipNote}`);
    }
  }

  if (problems.length > 0) {
    for (const p of problems.slice(0, 40)) console.error(`[wp7-runner] FAIL: ${p}`);
    if (problems.length > 40) console.error(`[wp7-runner] FAIL: ${problems.length - 40} further problems omitted`);
    for (const a of preserved) console.error(`[wp7-runner] full suite output preserved at: ${a}`);
    console.error('[wp7-runner] WP-7 validated execution FAILED; refusing to report success.');
    process.exit(1);
  }
  console.log(`[wp7-runner] WP-7 validated execution OK: ${totalTests} tests across ${Object.keys(EXPECTED_COUNTS).length} suites, 0 failed/cancelled/todo, ${totalSkips} platform-permitted skips.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
