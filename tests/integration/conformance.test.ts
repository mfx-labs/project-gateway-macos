/**
 * Integration tests: full conformance execution, vector coverage, raw-input
 * phases, workflow subject integrity, and the WP-6 Phase 3C1 PointOfUse v2
 * conformance context (POUV2-* fixtures and CAN-POUV2* digest vectors).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConformanceRunner, manifestStats } from '../../src/index.js';
import { CONFORMANCE_MANIFEST, CORPUS_INPUTS } from '../../src/generated/corpus-bundle.js';
import { ruleIds } from '../../src/semantic/rules.js';
import { jcsSerialize } from '../../src/canonical/jcs.js';
import { validateTrustedWorkspaceConfiguration, TRUSTED_HOST_LANE, DARWIN_ARM64_HOST_LANE, DARWIN_X86_64_HOST_LANE } from '../../src/trusted/index.js';
import type { TrustedHostLane } from '../../src/trusted/index.js';
import { brandRecordWrapper } from '../../src/internal/snapshot.js';
import { runRegistrySnapshotPipeline } from '../../src/engine/pipeline.js';
import { SchemaRegistry } from '../../src/schema/registry.js';
import { evaluatePointOfUseEligibilityForConfiguration } from '../../src/pointofuse/index.js';
import {
  semanticGlobalCapabilityCeilingDenial,
  semanticWorkspaceCapabilityCeilingDenial,
  semanticGrantRecordTypeDenial,
} from '../../src/pointofuse/index.js';

const corpus = CORPUS_INPUTS as Record<string, string>;
const manifest = CONFORMANCE_MANIFEST as { fixtures: { fixture_id: string; paths: string[]; expected_semantic_rule_ids: string[]; expected_result: string }[] };

test('integration: manifest stats match the committed package', () => {
  const stats = manifestStats();
  assert.equal(stats.entries, 648);
  assert.equal(stats.schemas, 52);
  assert.ok(stats.inputs >= 300);
});

test('integration: every physical corpus input is listed in the manifest', () => {
  const listed = new Set<string>();
  for (const f of manifest.fixtures) for (const p of f.paths) listed.add(p);
  for (const rel of Object.keys(corpus)) assert.ok(listed.has(rel), `unlisted input ${rel}`);
});

test('integration: all 236 artifact RULE matrix entries point at existing inputs', () => {
  const ruleEntries = manifest.fixtures.filter((f) => f.fixture_id.startsWith('RULE-'));
  assert.equal(ruleEntries.length, 236); // artifact RULE matrix entries (118 rules x PASS/FAIL); NOT complete catalog coverage
  for (const f of ruleEntries) {
    for (const p of f.paths) assert.ok(corpus[p] !== undefined, `missing ${p} for ${f.fixture_id}`);
  }
});

test('integration: all 36 digest vectors recompute', () => {
  const manifestVectors = manifest.fixtures.filter((f) => f.fixture_id.startsWith('CAN-'));
  assert.equal(manifestVectors.length, 36);
  const vectors = [...new Set(manifestVectors.flatMap((f) => f.paths))];
  for (const rel of vectors) {
    const v = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[rel]!, 'base64'))) as Record<string, unknown>;
    const expected = v['expected_sha256'];
    if (expected === null || expected === undefined) continue;
    const texts = Array.isArray(v['canonical_utf8']) ? (v['canonical_utf8'] as string[]) : [String(v['canonical_utf8'])];
    const hashes = Array.isArray(expected) ? (expected as string[]) : [String(expected)];
    for (let i = 0; i < texts.length; i++) {
      const got = createHash('sha256').update(String(v['digest_domain']) + texts[i]!, 'utf8').digest('hex');
      assert.equal(got, hashes[i], `vector ${rel}[${i}]`);
    }
  }
});

test('integration: full conformance manifest executes 648/648 including the PointOfUse v2 context', () => {
  const summary = new ConformanceRunner().run();
  assert.equal(summary.total, 648);
  assert.equal(summary.executed, 648);
  assert.equal(summary.passed, 648);
  assert.equal(summary.failed, 0);
  assert.deepEqual(summary.mismatches, []);
});

test('PS6: the darwin-arm64 lane PASSES the authoritative conformance corpus 648/648 (lane-keyed identity oracles)', () => {
  // SIR-PS6-001 correction: the darwin lane must pass every authoritative
  // vector via the lane-keyed expected static identities (ADR-016 addendum,
  // ADR-042) — never a blessed expected-failure allowance.
  const darwinSummary = new ConformanceRunner({ hostLane: DARWIN_ARM64_HOST_LANE }).run();
  assert.equal(darwinSummary.total, 648);
  assert.equal(darwinSummary.executed, 648);
  assert.equal(darwinSummary.passed, 648);
  assert.equal(darwinSummary.failed, 0);
  assert.deepEqual(darwinSummary.mismatches, []);
  // The linux lane remains the authoritative green baseline.
  const linuxSummary = new ConformanceRunner().run();
  assert.equal(linuxSummary.passed, 648);
  assert.deepEqual(linuxSummary.mismatches, []);
});

test('PS6I: the darwin-intel lane PASSES the authoritative conformance corpus 648/648 (lane-keyed identity oracles)', () => {
  // ADR-043: the intel lane must pass every authoritative vector via its
  // lane-keyed expected static identities — never a blessed
  // expected-failure allowance.
  const intelSummary = new ConformanceRunner({ hostLane: DARWIN_X86_64_HOST_LANE }).run();
  assert.equal(intelSummary.total, 648);
  assert.equal(intelSummary.executed, 648);
  assert.equal(intelSummary.passed, 648);
  assert.equal(intelSummary.failed, 0);
  assert.deepEqual(intelSummary.mismatches, []);
  // The linux and darwin-arm64 lanes remain the authoritative green baselines.
  const linuxSummary = new ConformanceRunner().run();
  assert.equal(linuxSummary.passed, 648);
  assert.deepEqual(linuxSummary.mismatches, []);
  const darwinSummary = new ConformanceRunner({ hostLane: DARWIN_ARM64_HOST_LANE }).run();
  assert.equal(darwinSummary.passed, 648);
  assert.deepEqual(darwinSummary.mismatches, []);
});

test('integration: runner is deterministic across instances', () => {
  const a = new ConformanceRunner().run();
  const b = new ConformanceRunner().run();
  assert.equal(a.passed, b.passed);
  assert.deepEqual(a.mismatches, b.mismatches);
});

// ---------------------------------------------------------------------------
// WP-6 Phase 3C1: PointOfUse v2 conformance context and rule registration
// ---------------------------------------------------------------------------

const POUV2_ENTRIES = manifest.fixtures.filter((f) => f.fixture_id.startsWith('POUV2-'));
const POUV2_VECTOR_ENTRIES = manifest.fixtures.filter((f) => f.fixture_id.startsWith('CAN-POUV2'));
const RULE_ENTRIES = manifest.fixtures.filter((f) => f.fixture_id.startsWith('RULE-'));
const POUV2_ONLY_RULES = ['AUT-000', 'LFC-012'];

test('integration: POUV2 conformance fixtures and vectors are present and complete', () => {
  assert.equal(POUV2_ENTRIES.length, 39);
  assert.equal(POUV2_VECTOR_ENTRIES.length, 17);
  for (const f of [...POUV2_ENTRIES, ...POUV2_VECTOR_ENTRIES]) {
    for (const p of f.paths) assert.ok(corpus[p] !== undefined, `missing ${p} for ${f.fixture_id}`);
  }
});

test('integration: every Phase-3 emitted rule ID is registered in the catalog (Model B)', () => {
  const emitted = new Set<string>();
  for (const f of [
    semanticGlobalCapabilityCeilingDenial('sub'),
    semanticWorkspaceCapabilityCeilingDenial('sub'),
    semanticGrantRecordTypeDenial('sub'),
  ]) {
    for (const r of f.ruleIds) emitted.add(r);
  }
  const catalog = new Set(ruleIds());
  for (const id of emitted) {
    assert.match(id, /^[A-Z]+-\d{3}$/, `rule ID syntax ${id}`);
    assert.ok(catalog.has(id), `unregistered emitted rule ID ${id}`);
    assert.ok(!id.startsWith('000-'), `placeholder rule ID ${id}`);
    assert.ok(!id.startsWith('POU2-'), `finding code used as rule ID ${id}`);
  }
  assert.ok(emitted.has('AUT-000'));
  assert.ok(emitted.has('LFC-012'));
});

test('integration: artifact RULE matrix — 118 rules x exactly one PASS + one FAIL entry = 236', () => {
  // The artifact RULE matrix is a DISJOINT coverage mode from the POUV2-only
  // rules: every artifact rule has exactly two RULE-* entries (one PASS, one
  // FAIL) and the POUV2-only rules have ZERO RULE-* entries.
  const byRule = new Map<string, { pass: number; fail: number; entries: string[] }>();
  for (const f of RULE_ENTRIES) {
    const ids = f.expected_semantic_rule_ids;
    assert.equal(ids.length, 1, `RULE entry ${f.fixture_id} must carry exactly one rule`);
    const rule = ids[0]!;
    const entry = byRule.get(rule) ?? { pass: 0, fail: 0, entries: [] };
    if (f.expected_result === 'pass') entry.pass += 1;
    else if (f.expected_result === 'fail') entry.fail += 1;
    else assert.fail(`RULE entry ${f.fixture_id} has no polarity`);
    entry.entries.push(f.fixture_id);
    byRule.set(rule, entry);
    // fixture ID encodes the polarity: RULE-<ID>-PASS / RULE-<ID>-FAIL
    assert.ok(
      f.fixture_id === `RULE-${rule}-PASS` || f.fixture_id === `RULE-${rule}-FAIL`,
      `RULE entry ${f.fixture_id} does not encode RULE-<ID>-<POLARITY>`,
    );
    assert.equal(f.expected_result, f.fixture_id.endsWith('-PASS') ? 'pass' : 'fail');
  }
  assert.equal(RULE_ENTRIES.length, 236, 'artifact RULE matrix entries');
  assert.equal(byRule.size, 118, 'artifact matrix rules');
  for (const [rule, entry] of byRule) {
    assert.equal(entry.pass, 1, `rule ${rule} PASS side`);
    assert.equal(entry.fail, 1, `rule ${rule} FAIL side`);
    assert.equal(entry.entries.length, 2, `rule ${rule} entry count`);
    assert.equal(new Set(entry.entries).size, 2, `rule ${rule} duplicate entry`);
  }
});

test('integration: coverage partition — catalog = artifact matrix ∪ POUV2-only, disjoint', () => {
  const artifactRules = new Set(RULE_ENTRIES.flatMap((f) => f.expected_semantic_rule_ids));
  const catalog = new Set(ruleIds());
  const pouv2Only = new Set(POUV2_ONLY_RULES);
  // union == catalog
  const union = new Set([...artifactRules, ...pouv2Only]);
  assert.equal(union.size, catalog.size);
  for (const id of catalog) assert.ok(union.has(id), `catalog rule ${id} lacks both coverage modes`);
  for (const id of union) assert.ok(catalog.has(id), `coverage rule ${id} not in catalog`);
  // disjoint
  for (const id of artifactRules) assert.ok(!pouv2Only.has(id), `artifact matrix must not contain ${id}`);
  // exact counts
  assert.equal(artifactRules.size, 118);
  assert.equal(RULE_ENTRIES.length, 236);
  assert.equal(pouv2Only.size, 2);
  assert.equal(catalog.size, 120);
});

test('integration: POUV2-only branch coverage — AUT-000 global, AUT-000 workspace, LFC-012 (MODERATE-3)', () => {
  // Factory-to-branch mapping: finding codes POU2-020/021/022 are nominal
  // factory identities; the branch distinction is the exact message key and
  // the final registered rule IDs.
  const globalFactory = semanticGlobalCapabilityCeilingDenial('x');
  const workspaceFactory = semanticWorkspaceCapabilityCeilingDenial('x');
  const grantFactory = semanticGrantRecordTypeDenial('x');
  assert.equal(globalFactory.messageKey, 'pou2.global-capability-ceiling-denial');
  assert.ok(globalFactory.ruleIds.includes('AUT-000'));
  assert.equal(workspaceFactory.messageKey, 'pou2.workspace-capability-ceiling-denial');
  assert.ok(workspaceFactory.ruleIds.includes('AUT-000'));
  assert.equal(grantFactory.messageKey, 'pou2.grant-record-type');
  assert.ok(grantFactory.ruleIds.includes('LFC-012'));
  assert.ok(grantFactory.ruleIds.includes('LFC-008'));

  const globalFixtures: string[] = [];
  const workspaceFixtures: string[] = [];
  const grantFixtures: string[] = [];
  for (const f of POUV2_ENTRIES) {
    const descriptor = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[f.paths[0]!]!, 'base64'))) as Record<string, unknown>;
    const expect = (descriptor['expect'] as Record<string, unknown>) ?? {};
    const keys = (expect['message_keys'] as string[]) ?? [];
    const rules = (expect['rule_ids'] as string[]) ?? [];
    if (keys.includes('pou2.global-capability-ceiling-denial') && rules.includes('AUT-000')) globalFixtures.push(f.fixture_id);
    if (keys.includes('pou2.workspace-capability-ceiling-denial') && rules.includes('AUT-000')) workspaceFixtures.push(f.fixture_id);
    if (keys.includes('pou2.grant-record-type') && rules.includes('LFC-012') && rules.includes('LFC-008')) grantFixtures.push(f.fixture_id);
  }
  assert.ok(globalFixtures.length >= 1, 'AUT-000 global branch needs at least one fixture');
  assert.ok(workspaceFixtures.length >= 1, 'AUT-000 workspace branch needs at least one fixture');
  assert.ok(grantFixtures.length >= 1, 'LFC-012 needs at least one fixture');
  // The global branch may not be satisfied by the same fixture as the workspace branch.
  assert.ok(
    globalFixtures.every((id) => !workspaceFixtures.includes(id)),
    `global and workspace branch fixtures must be disjoint: ${globalFixtures} vs ${workspaceFixtures}`,
  );
  // No unknown POUV2-only rule: every fixture-emitted rule outside the artifact
  // matrix must be one of the two POUV2-only rules.
  const artifactRules = new Set(RULE_ENTRIES.flatMap((f) => f.expected_semantic_rule_ids));
  for (const f of POUV2_ENTRIES) {
    const descriptor = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[f.paths[0]!]!, 'base64'))) as Record<string, unknown>;
    const expect = (descriptor['expect'] as Record<string, unknown>) ?? {};
    for (const r of (expect['rule_ids'] as string[]) ?? []) {
      if (artifactRules.has(r)) continue;
      assert.ok(POUV2_ONLY_RULES.includes(r), `unknown POUV2-only rule ${r} in ${f.fixture_id}`);
    }
  }
});

test('integration: fixture static identities are independently derivable from literal oracle projections (MODERATE-2)', () => {
  const DOMAIN = 'PGAP-POINT-OF-USE-INPUT-v2\u0000';
  let oracleFixtures = 0;
  const laneKeys: TrustedHostLane[] = [TRUSTED_HOST_LANE, DARWIN_ARM64_HOST_LANE, DARWIN_X86_64_HOST_LANE];
  for (const f of POUV2_ENTRIES) {
    const descriptor = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[f.paths[0]!]!, 'base64'))) as Record<string, unknown>;
    const oracle = descriptor['oracle'] as Record<string, unknown> | undefined;
    const expect = (descriptor['expect'] as Record<string, unknown>) ?? {};
    if (oracle === undefined) {
      // Boundary and v1 fixtures never assert a static identity.
      assert.equal(expect['static_identity'], undefined, `${f.fixture_id} asserts a static identity without an oracle`);
      assert.equal(expect['staticIdentityByLane'], undefined, `${f.fixture_id} carries a lane-keyed identity map without an oracle`);
      continue;
    }
    oracleFixtures += 1;
    const projection = oracle['static_projection'];
    assert.ok(projection && typeof projection === 'object', `${f.fixture_id} oracle projection missing`);
    // 1. serialize with the committed canonical JCS primitive
    const canonical = jcsSerialize(projection);
    // 2. prepend the exact domain; 3. hash independently; 4. format exactly
    const digest = 'sha-256:' + createHash('sha256').update(DOMAIN + canonical, 'utf8').digest('hex');
    // 5. assert equality with the fixture's expected static identity
    assert.equal(digest, expect['static_identity'], `${f.fixture_id} oracle digest mismatch`);
    assert.match(digest, /^sha-256:[0-9a-f]{64}$/);
    // SIR-PS6-001 lane-keyed oracle (ADR-016 addendum, ADR-042): the
    // static-identity expectation is keyed by the accepted trusted host
    // lane. The shared projection + the lane's configuration-identity
    // literal must independently derive each lane's expected value, and
    // the Linux entry must equal the preserved committed single-lane
    // value.
    const byLane = expect['staticIdentityByLane'] as Record<string, unknown> | undefined;
    assert.ok(byLane !== undefined, `${f.fixture_id} oracle fixture lacks staticIdentityByLane`);
    assert.deepEqual(Object.keys(byLane).sort(), [...laneKeys].sort(), `${f.fixture_id} lane map keys`);
    assert.equal(byLane[TRUSTED_HOST_LANE], expect['static_identity'], `${f.fixture_id} linux lane entry must preserve the committed oracle`);
    const darwinConfigurationIdentity = oracle['darwinConfigurationIdentity'];
    assert.equal(typeof darwinConfigurationIdentity, 'string', `${f.fixture_id} darwinConfigurationIdentity missing`);
    const darwinProjection = { ...(projection as Record<string, unknown>), configurationIdentity: darwinConfigurationIdentity };
    const darwinCanonical = jcsSerialize(darwinProjection);
    const darwinDigest = 'sha-256:' + createHash('sha256').update(DOMAIN + darwinCanonical, 'utf8').digest('hex');
    assert.equal(darwinDigest, byLane[DARWIN_ARM64_HOST_LANE], `${f.fixture_id} darwin lane oracle digest mismatch`);
    // PS-6I (ADR-043): the intel entry is independently derivable the same
    // way from the fixture's intel configuration-identity literal, and the
    // intel digest must differ from the darwin digest (lanes never share
    // an identity vector).
    const intelConfigurationIdentity = oracle['intelConfigurationIdentity'];
    assert.equal(typeof intelConfigurationIdentity, 'string', `${f.fixture_id} intelConfigurationIdentity missing`);
    const intelProjection = { ...(projection as Record<string, unknown>), configurationIdentity: intelConfigurationIdentity };
    const intelCanonical = jcsSerialize(intelProjection);
    const intelDigest = 'sha-256:' + createHash('sha256').update(DOMAIN + intelCanonical, 'utf8').digest('hex');
    assert.equal(intelDigest, byLane[DARWIN_X86_64_HOST_LANE], `${f.fixture_id} intel lane oracle digest mismatch`);
    assert.notEqual(intelDigest, darwinDigest, `${f.fixture_id} intel and darwin lane identity vectors must differ`);
  }
  assert.ok(oracleFixtures >= 9, `expected at least 9 oracle fixtures, got ${oracleFixtures}`);
  // 7. production equality: the runner compares production identities against
  // the same literals; assert every oracle fixture executed without mismatch
  // under BOTH accepted lanes.
  for (const lane of laneKeys) {
    const summary = new ConformanceRunner({ hostLane: lane }).run();
    const oracleIds = new Set(
      POUV2_ENTRIES
        .filter((f) => {
          const d = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[f.paths[0]!]!, 'base64'))) as Record<string, unknown>;
          return d['oracle'] !== undefined;
        })
        .map((f) => f.fixture_id),
    );
    for (const m of summary.mismatches) {
      assert.ok(!oracleIds.has(m.fixtureId), `oracle fixture ${m.fixtureId} mismatch under ${lane}: ${m.reason} ${m.detail}`);
    }
    assert.equal(summary.passed, 648, `lane ${lane} full corpus must be green`);
  }
});

test('integration: CAN-POUV2-008A/008B prove object-key-order independence (MODERATE-1)', () => {
  const rawA = new TextDecoder().decode(Buffer.from(corpus['fixtures/canonicalization/pointofuse/CAN-POUV2-008A.json']!, 'base64'));
  const rawB = new TextDecoder().decode(Buffer.from(corpus['fixtures/canonicalization/pointofuse/CAN-POUV2-008B.json']!, 'base64'));
  const rawOne = new TextDecoder().decode(Buffer.from(corpus['fixtures/canonicalization/pointofuse/CAN-POUV2-001.json']!, 'base64'));
  const a = JSON.parse(rawA) as Record<string, unknown>;
  const b = JSON.parse(rawB) as Record<string, unknown>;
  // raw fixture bytes must differ (literal key insertion order differs)
  assert.notEqual(rawA, rawB);
  assert.notEqual(rawA, rawOne);
  assert.notEqual(rawB, rawOne);
  // parsed projections must be deeply equal (same semantic content and values)
  const projA = (a['canonical_projections'] as Record<string, unknown>[])[0]!;
  const projB = (b['canonical_projections'] as Record<string, unknown>[])[0]!;
  assert.deepEqual(projA, projB);
  // key-order signatures must differ at more than one object depth
  const keySig = (v: Record<string, unknown>): string => Object.keys(v).join(',');
  assert.notEqual(keySig(projA), keySig(projB), 'top-level key order must differ');
  assert.notEqual(keySig(projA['requestedUse'] as Record<string, unknown>), keySig(projB['requestedUse'] as Record<string, unknown>), 'nested key order must differ');
  assert.notEqual(keySig(projA['consumerSupport'] as Record<string, unknown>), keySig(projB['consumerSupport'] as Record<string, unknown>), 'consumer key order must differ');
  // canonical UTF-8 and digest must be identical
  assert.equal(a['canonical_utf8'], b['canonical_utf8']);
  assert.equal(jcsSerialize(projA), String(a['canonical_utf8']));
  assert.equal(a['expected_sha256'], b['expected_sha256']);
});

test('integration: v2 conformance context dispatches through the internal authoritative router (functional, MINOR-2)', () => {
  // Functional proof through the authoritative path: a POUV2 fixture whose
  // result the direct public v1 entry CANNOT produce (v2 request, genuine
  // configuration capability ceiling, eligibility-v2, both identities, the
  // global capability-ceiling denial with AUT-000).
  const descriptor = JSON.parse(new TextDecoder().decode(Buffer.from(corpus['fixtures/pointofuse-v2/POUV2-009.json']!, 'base64'))) as Record<string, unknown>;
  const configInput = descriptor['config'] as Record<string, unknown>;
  const report = validateTrustedWorkspaceConfiguration(configInput, { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p: string) => p });
  assert.equal(report.ok, true);
  // translate the descriptor request (mirror of the runner's decoder)
  const request = descriptor['request'] as Record<string, unknown>;
  const inputs = request['inputs'] as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (key === 'bundle_path') out['bundle'] = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[String(value)]!, 'base64')));
    else if (key === 'policy_path') out['policy'] = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[String(value)]!, 'base64')));
    else if (key === 'grant') {
      if ((value as Record<string, unknown>)['present'] === true) out['grant'] = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[String((value as Record<string, unknown>)['path'])]!, 'base64')));
    } else if (key === 'registry') {
      const model = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[String((value as Record<string, unknown>)['snapshot_path'])]!, 'base64'))) as Record<string, unknown>;
      out['registry'] = {
        registryProtocolId: String((value as Record<string, unknown>)['registryProtocolId'] ?? 'project-gateway.registry'),
        registrySnapshotFormatVersion: String((value as Record<string, unknown>)['registrySnapshotFormatVersion'] ?? '1.0'),
        registrySnapshotId: String(model['snapshot_id'] ?? ''),
        registrySnapshotDigest: String(model['snapshot_digest'] ?? ''),
        snapshot: runRegistrySnapshotPipeline(model, { schemaRegistry: new SchemaRegistry() }).value,
      };
    } else if (key === 'lifecycle') {
      const records = ((value as Record<string, unknown>)['record_paths'] as string[]).map((rel) => {
        const model = JSON.parse(new TextDecoder().decode(Buffer.from(corpus[rel]!, 'base64'))) as Record<string, unknown>;
        const wrapper = Object.freeze({ recordType: String(model['record_type'] ?? ''), recordId: String(model['record_id'] ?? ''), level: 'structural-valid', model: Object.freeze(model) });
        brandRecordWrapper(wrapper);
        return wrapper;
      });
      out['lifecycle'] = { records, findRecord: (id: string) => records.find((r) => r.recordId === id) };
    } else if (key === 'identity') {
      out['identity'] = { findInstance: () => undefined, findRevision: () => undefined, findPredecessor: () => undefined, verifyRegistration: () => false };
    } else if (key === 'resolver') {
      out['resolver'] = { resolve: () => undefined };
    } else if (key === 'revocations') {
      out['revocations'] = { revocationsByTarget: () => [] };
    } else {
      out[key] = value;
    }
  }
  const result = evaluatePointOfUseEligibilityForConfiguration(report.configuration as never, { routeProtocolVersion: '2', inputs: out });
  assert.equal(result.kind, 'eligibility-v2');
  if (result.kind !== 'eligibility-v2') return;
  assert.equal(result.eligibility.eligible, false);
  assert.match(result.eligibility.staticInputCorrelationIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.match(result.eligibility.pointOfUseResultIdentity, /^sha-256:[0-9a-f]{64}$/);
  assert.ok(result.eligibility.findings.some((f) => f.messageKey === 'pou2.global-capability-ceiling-denial'));
  assert.ok(result.eligibility.ruleIds.includes('AUT-000'));
  // Source-level invariant retained: the runner's POUV2 branch references the
  // internal router and never calls or imports the public direct v1 entry.
  const src = readFileSync(fileURLToPath(new URL('../../../src/conformance/runner.ts', import.meta.url)), 'utf8');
  assert.ok(src.includes("evaluatePointOfUseEligibilityForConfiguration"));
  assert.ok(src.includes("fixture_id.startsWith('POUV2-')"));
  assert.ok(!src.includes('evaluatePointOfUseEligibility('));
});

test('integration: default test workflow includes the PointOfUse-v2 focused suites exactly once', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'));
  const testScript = String(pkg['scripts']['test']);
  assert.equal(testScript.split('node scripts/run-test-inventory.mjs').length - 1, 1, 'npm test must invoke the authoritative inventory exactly once');
  const inventory = readFileSync(fileURLToPath(new URL('../../../scripts/run-test-inventory.mjs', import.meta.url)), 'utf8');
  const occurrences = inventory.split('dist-test/tests/pointofuse-v2/*.test.js').length - 1;
  assert.equal(occurrences, 1, 'npm test must run the PointOfUse-v2 suites exactly once');
  assert.ok(String(pkg['scripts']['test:pointofuse-v2']).includes('dist-test/tests/pointofuse-v2/*.test.js'));
});

test('integration: generated corpus is byte-reproducible from the committed fixtures', () => {
  // Recomputed corpus (manifest paths + canonicalization vector sources) must
  // match the committed generated bundle exactly — the same procedure the
  // committed generator performs.
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  };
  const inputs = new Set<string>();
  for (const f of manifest.fixtures) for (const p of f.paths) inputs.add(p);
  for (const p of walk(join(root, 'fixtures/canonicalization'))) {
    const doc = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    for (const k of ['source_fixture', 'source_fixtures']) {
      const v = doc[k];
      if (typeof v === 'string') inputs.add(v);
      else if (Array.isArray(v)) for (const x of v) inputs.add(String(x));
    }
  }
  const recomputed = new Map<string, string>();
  for (const rel of [...inputs].sort()) {
    recomputed.set(rel, readFileSync(join(root, rel)).toString('base64'));
  }
  assert.equal(recomputed.size, Object.keys(corpus).length);
  for (const [rel, b64] of recomputed) {
    assert.equal(corpus[rel], b64, `corpus mismatch for ${rel}`);
  }
});
