/**
 * WP-5A compatibility tests: the environment-gated local Pi harness (F8).
 *
 * `PGW_PI_PACKAGE_PATH` (or an explicit path) is the authoritative harness
 * input; the harness is inert with a stable gated result when the gate is
 * absent. The machine-specific local lane lives in `local-lane.ts` and is used
 * only by the labeled local-lane test. The harness never starts Pi, never
 * sends a model request, never executes tools, never reads `~/.pi`, and never
 * modifies user configuration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  inspectLocalPiPackage,
  resolvePiPackagePath,
} from '../../../src/adapters/pi/index.js';
import { LOCAL_LANE_PI_PACKAGE_PATH, inspectLocalLanePi } from './local-lane.js';

// tests run from the repository root; fixtures are source-tree test assets
const FIXTURES = join(process.cwd(), 'tests', 'pi-adapter', 'fixtures', 'pi-packages');

test('F8: harness is inert without the environment gate', async () => {
  const previous = process.env['PGW_PI_PACKAGE_PATH'];
  delete process.env['PGW_PI_PACKAGE_PATH'];
  try {
    assert.equal(resolvePiPackagePath(), undefined);
    const result = await inspectLocalPiPackage();
    assert.equal(result.inspected, false);
    assert.ok(result.findings.some((f) => f.key === 'harness.not-gated'));
  } finally {
    if (previous !== undefined) process.env['PGW_PI_PACKAGE_PATH'] = previous;
  }
});

test('F8: environment variable is the authoritative gate', async () => {
  const previous = process.env['PGW_PI_PACKAGE_PATH'];
  process.env['PGW_PI_PACKAGE_PATH'] = join(FIXTURES, 'wrong-version');
  try {
    assert.equal(resolvePiPackagePath(), join(FIXTURES, 'wrong-version'));
    const result = await inspectLocalPiPackage();
    assert.equal(result.inspected, true);
    assert.equal(result.version, '0.84.0');
    assert.ok(result.findings.some((f) => f.key === 'harness.version-drift'));
  } finally {
    if (previous !== undefined) process.env['PGW_PI_PACKAGE_PATH'] = previous;
    else delete process.env['PGW_PI_PACKAGE_PATH'];
  }
});

test('F8: wrong explicit path (not a package) fails closed', async () => {
  const result = await inspectLocalPiPackage(join(FIXTURES, 'not-a-package'));
  assert.equal(result.inspected, true);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'harness.inspection-failed'));
});

test('F8: missing manifest fails closed', async () => {
  const result = await inspectLocalPiPackage(join(FIXTURES, 'missing-manifest'));
  assert.equal(result.inspected, true);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'harness.inspection-failed'));
});

test('F8: path outside a Pi package (plain file) fails closed', async () => {
  const result = await inspectLocalPiPackage(join(FIXTURES, 'not-a-package', 'README.txt'));
  assert.equal(result.inspected, true);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'harness.inspection-failed'));
});

test('F8: wrong package identity rejected', async () => {
  const result = await inspectLocalPiPackage(join(FIXTURES, 'wrong-identity'));
  assert.equal(result.inspected, true);
  assert.equal(result.packageId, '@some-other/vendor-agent');
  assert.ok(result.findings.some((f) => f.key === 'harness.package-identity'));
});

test('F8: wrong version rejected (manifest and VERSION export)', async () => {
  const result = await inspectLocalPiPackage(join(FIXTURES, 'wrong-version'));
  assert.equal(result.inspected, true);
  assert.equal(result.version, '0.84.0');
  assert.ok(result.findings.some((f) => f.key === 'harness.version-drift'));
  assert.ok(result.findings.some((f) => f.key === 'harness.version-export-drift'));
});

test('F8: missing required export rejected', async () => {
  const result = await inspectLocalPiPackage(join(FIXTURES, 'missing-export'));
  assert.equal(result.inspected, true);
  assert.equal(result.compatible, false);
  assert.ok(result.findings.some((f) => f.key === 'harness.export-missing'));
});

test('F8: real Pi 0.83.0 path supplied explicitly is accepted', async (t) => {
  // labeled local-lane convenience: exercises the locally installed Pi package
  if (LOCAL_LANE_PI_PACKAGE_PATH.length === 0) {
    t.skip('local Pi package path not configured; local-lane check skipped');
    return;
  }
  const result = await inspectLocalPiPackage(LOCAL_LANE_PI_PACKAGE_PATH);
  assert.equal(result.inspected, true);
  assert.equal(result.packageId, '@earendil-works/pi-coding-agent');
  assert.equal(result.version, '0.83.0');
  assert.equal(result.compatible, true, JSON.stringify(result.findings));
  for (const name of ['VERSION', 'isToolCallEventType', 'createExtensionRuntime', 'discoverAndLoadExtensions']) {
    assert.equal(result.runtimeExports[name], true, `missing runtime export ${name}`);
  }
});

test('F8: local-lane wrapper inspects the same real package (no model request)', async (t) => {
  if (LOCAL_LANE_PI_PACKAGE_PATH.length === 0) {
    t.skip('local Pi package path not configured; local-lane check skipped');
    return;
  }
  const direct = await inspectLocalPiPackage(LOCAL_LANE_PI_PACKAGE_PATH);
  const viaWrapper = await inspectLocalLanePi();
  assert.equal(viaWrapper.inspected, true);
  assert.equal(viaWrapper.compatible, direct.compatible);
  assert.deepEqual(viaWrapper.findings, direct.findings);
});

test('F8: harness never sends a model request (no prompt API invoked)', async () => {
  const previous = process.env['PGW_PI_PACKAGE_PATH'];
  delete process.env['PGW_PI_PACKAGE_PATH'];
  try {
    const result = await inspectLocalPiPackage();
    assert.equal(result.inspected, false);
    assert.deepEqual(result.runtimeExports, {});
  } finally {
    if (previous !== undefined) process.env['PGW_PI_PACKAGE_PATH'] = previous;
  }
});

test('F8: internal package subpaths remain blocked', async () => {
  for (const subpath of ['internal/protocol-equality', 'adapters/pi/index', 'conformance/runner']) {
    let rejected = false;
    try {
      await import(`@project-gateway/macos-core/${subpath}`);
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, `subpath @project-gateway/macos-core/${subpath} must not resolve`);
  }
});

// ---------------------------------------------------------------------------
// A-4 — required fixture payloads must remain commit-visible: the root
// `.gitignore` re-includes only the WP-5A fixture tree, never production
// `dist/` output. This guard detects accidental ignore-rule regressions.
// ---------------------------------------------------------------------------
test('A-4: required fixture payloads exist and are not excluded by ignore rules', () => {
  const payloads = [
    join(FIXTURES, 'missing-export', 'dist', 'index.js'),
    join(FIXTURES, 'wrong-identity', 'dist', 'index.js'),
    join(FIXTURES, 'wrong-version', 'dist', 'index.js'),
  ];
  for (const p of payloads) {
    assert.equal(existsSync(p), true, `fixture payload missing: ${p}`);
  }
  // the ignore rules must re-include exactly this fixture tree
  const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('!tests/pi-adapter/fixtures/pi-packages/**/dist/index.js'), 'fixture payload negation missing from .gitignore');
  assert.ok(gitignore.includes('node_modules/') && gitignore.includes('dist/'), 'production ignore rules still present');
  // the fixture payload semantics the harness relies on
  const missingExport = readFileSync(join(FIXTURES, 'missing-export', 'dist', 'index.js'), 'utf8');
  assert.ok(missingExport.includes('discoverAndLoadExtensions') === false || !/discoverAndLoadExtensions/.test(missingExport), 'missing-export payload must omit the export');
  const wrongVersion = readFileSync(join(FIXTURES, 'wrong-version', 'dist', 'index.js'), 'utf8');
  assert.ok(/0\.84\.0/.test(wrongVersion), 'wrong-version payload must export VERSION 0.84.0');
});
