/**
 * Security and boundary tests: duplicate keys, Unicode, bounds, prototype
 * pollution, no caller-input mutation, deterministic reports, and the
 * no-I/O core policy (production modules must not import filesystem/network/
 * process modules).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseRawJsonInput,
  createSchemaRegistry,
  validateArtifactRevision,
  computeArtifactDigest,
  ConformanceRunner,
} from '../../src/index.js';

const reg = createSchemaRegistry();
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, '..', '..', '..', 'dist');

/**
 * WP-8-C exact compiled-module delegation (focused security-test integration
 * correction). The WP-8 storage boundary owns a stricter dedicated security
 * suite (`tests/unit/storage/static-guard.test.ts`) that enforces per-module
 * `node:fs` API allowlists, exact-name import discipline, brand-path scoping,
 * creator-consumer edges, and export/package/dependency/contract invariants.
 *
 * ONLY the exact compiled modules listed here — the filesystem-bearing
 * WP-8-C sources, the WP-8-D sources, and the WP-8-E read-only scan source
 * mapped to their deterministic compiled outputs — are delegated to that
 * boundary. A blanket `/storage/` or `dist/storage/**` exclusion is
 * deliberately NOT used: every other compiled storage module (barrels, the
 * orchestrator, state classifier, metadata profile, capability and
 * trusted-input modules, pure registry/recovery derivation, and any future
 * or sibling module) remains subject to this global blanket no-I/O
 * assertion. The predicate matches exact normalized compiled paths only and
 * fails closed on anything else.
 */
const STORAGE_FS_DELEGATED_MODULES: ReadonlySet<string> = new Set([
  'storage/root/resolve.js',
  'storage/initialization/provision.js',
  'storage/probe/probe.js',
  'storage/probe/scratch.js',
  'storage/metadata/bootstrap-persist.js',
  // WP-8-D exact fs-bearing modules (ADR-029 implementation constraints):
  'storage/publication/publish-record.js',
  'storage/locks/lock.js',
  'storage/read/read-record.js',
  'storage/read/enumerate.js',
  // WP-8-K: read-only audit-history inspection (13.4/HST-001…010; ADR-034).
  'storage/read/history.js',
  // WP-8-E: the read-only store scan (sole new scan owner; read-only
  // allowlist; every other registry/recovery module is fs-free and remains
  // subject to this blanket assertion).
  'storage/recovery/scan.js',
  // WP-8-F: the two exact recovery-mutation fs owners (descriptor-bound
  // re-verification and the exact-own-temporary unlink). The pure evidence,
  // execution, assessment, and plan modules remain under this blanket
  // no-I/O assertion.
  'storage/recovery/reverify.js',
  'storage/recovery/cleanup.js',
  'storage/recovery/quarantine.js',
  // WP-8-I: the exact external-disposition mutation owner (unlink + fsync;
  // ADR-032 §12).
  'storage/recovery/disposition.js',
  // WP-8-H: the exact registry-index store access (read-only probe and
  // reads); the pure index model and the index-rebuild builder remain under
  // this blanket no-I/O assertion.
  'storage/registry/index-store.js',
  // WP-8-L: the exact retention-deletion mutation owner (unlink + fsync;
  // §15.4/ADR-035). The retention evidence and execution modules remain
  // under this blanket no-I/O assertion.
  'storage/retention/delete.js',
]);

/**
 * Exact-path delegation predicate. Normalizes platform separators to
 * forward slashes and returns true ONLY for the exact delegated compiled
 * module paths. Path-traversal spellings, near-match filenames, nested
 * descendants, sibling files, and hypothetical future modules all fail
 * closed (they are not members of the exact set).
 */
export function isStorageFsDelegatedModule(compiledPath: string): boolean {
  const normalized = compiledPath.split(sep).join('/');
  // Accept both absolute compiled paths (.../dist/storage/...) and
  // dist-relative spellings; anything else fails closed.
  const marker = '/dist/';
  const idx = normalized.lastIndexOf(marker);
  const rel = idx === -1 ? (normalized.startsWith('dist/') ? normalized.slice('dist/'.length) : normalized) : normalized.slice(idx + marker.length);
  return STORAGE_FS_DELEGATED_MODULES.has(rel);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('security: production modules perform no hidden filesystem/network/process I/O', () => {
  const forbidden = [
    'node:fs',
    'node:net',
    'node:http',
    'node:https',
    'node:child_process',
    "require('fs')",
    'fetch(',
    'process.env',
    'Date.now(',
  ];
  // The Pi adapter is a separate module boundary with its own security suite
  // (tests/pi-adapter/security), which verifies that its only I/O is the
  // environment-gated host harness; it is excluded here by boundary.
  // WP-7 internal modules (reader/git/fff) are likewise a separate module
  // boundary with their own security suite (tests/wp7/security) verifying
  // that the only process I/O is the constrained trusted Git executable and
  // descriptor-bound reads; they are excluded here by boundary.
  // WP-8 storage: ONLY the exact compiled filesystem-bearing modules listed
  // in STORAGE_FS_DELEGATED_MODULES are delegated to the stricter dedicated
  // storage static guard (tests/unit/storage/static-guard.test.ts); every
  // other compiled storage module remains subject to this assertion.
  // WP-9 Slice 5 runtime (src/runtime/mcp): the stdio CLI is a dedicated
  // composition-root boundary with its own security guard
  // (tests/runtime/static-guard.test.ts) that allows only bounded startup
  // config reads and forbids network, mutation, stdout, and subprocess I/O.
  // WP-11 Slice 1 controlled writing (src/writing): a dedicated module
  // boundary with its own stricter guard
  // (tests/writing/static-guard.test.ts) proving that node:fs appears ONLY
  // in the injected host write executor (exact create-only API discipline)
  // and that the pure core is I/O-free; excluded here by boundary.
  // The MAC-2B Darwin integration adapter (src/internal/darwin-fs) is part
  // of that same writing boundary: it is the executor's only bridge to the
  // accepted five-primitive native seam (closeSync for intermediate
  // descent fds only; no path opens, no mutation, no /proc), covered by
  // tests/writing/static-guard.test.ts and the adapter suite; excluded
  // here by boundary.
  // WP-13B completion/result (src/completion): a dedicated module boundary
  // with its own stricter guard
  // (tests/unit/wp13b-static-guard.test.ts) proving that node:fs appears
  // ONLY in the narrow result-write executor (writer.ts; exclusive-create
  // discipline) and that every other completion module is I/O-free;
  // excluded here by boundary.
  // PS-1 operator bootstrap (src/bootstrap): a dedicated operator-CLI
  // boundary with its own stricter guard
  // (tests/unit/bootstrap-static-guard.test.ts) proving that node:fs is
  // restricted to the exact output-write discipline (atomic 0600
  // no-clobber config publish), that config reads flow through the accepted
  // loader, and that the boundary composes the trusted control-plane
  // bootstrap action without minting provenance; excluded here by boundary.
  // S2+ operator CLI (src/operator): a dedicated host/composition boundary
  // (registry reads/writes, project canonicalization, store bootstrap during
  // `pgw add`, read-only inspection during `pgw doctor`, runtime composition
  // during `pgw start`, install-layout handling, and `pgw uninstall`) that
  // inherently requires node:fs / node:path / node:os; excluded here by
  // boundary exactly as the runtime, writing, completion, and bootstrap
  // composition roots above are.
  const prodFiles = walk(DIST)
    .filter((p) => !p.includes('conformance') && !p.includes('/adapters/') && !p.includes('/reader/') && !p.includes('/git/') && !p.includes('/fff/') && !p.includes('/runtime/') && !p.includes('/writing/') && !p.includes('/internal/darwin-fs/') && !p.includes('/completion/') && !p.includes('/bootstrap/') && !p.includes('/operator/'))
    .filter((p) => !isStorageFsDelegatedModule(p));
  for (const p of prodFiles) {
    if (p.includes('runner.js') || p.includes('corpus-bundle')) continue;
    const src = readFileSync(p, 'utf8');
    for (const needle of forbidden) {
      assert.ok(!src.includes(needle), `forbidden ${needle} in ${p}`);
    }
  }
});

test('security: time-dependent decisions never call Date.now in protocol code', () => {
  const files = walk(DIST).filter((p) => p.includes('pointofuse') || p.includes('lifecycle') || p.includes('engine'));
  for (const p of files) {
    const src = readFileSync(p, 'utf8');
    assert.ok(!src.includes('Date.now'), `Date.now in ${p}`);
  }
});

test('security: duplicate keys rejected at every depth', () => {
  const inputs = [
    '{"a":1,"a":2}',
    '{"a":{"b":1,"b":2}}',
    '[[{"x":1,"x":2}]]',
    '{"a":1,"b":2,"a":3}',
  ];
  for (const input of inputs) {
    const r = parseRawJsonInput(input, { subjectClass: 'artifact' });
    assert.equal(r.ok, false, input);
    if (!r.ok) assert.equal(r.report.findings[0]?.category, 'DUPLICATE-MEMBER', input);
  }
});

test('security: no silent repair of malformed input', () => {
  const inputs = ['{"a":}', '[1,]', '{"a" 1}', '01', '{"a":1} extra'];
  for (const input of inputs) {
    const r = parseRawJsonInput(input, { subjectClass: 'artifact' });
    assert.equal(r.ok, false, input);
  }
});

test('security: unpaired surrogates rejected', () => {
  const r = parseRawJsonInput('{"s":"\\udc00"}', { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
});

test('security: prototype pollution is inert', () => {
  const r = parseRawJsonInput('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}', { subjectClass: 'artifact' });
  assert.equal(r.ok, true);
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
});

test('security: caller input is never mutated', () => {
  const model = {
    protocol: { id: 'project-gateway.artifact', version: '1.0', canonicalization: 'jcs-rfc8785-v1' },
    kind: { id: 'TaskSpec', version: '1.0' },
    instance_id: 'pgw:i:' + 'a'.repeat(32),
    revision: { id: 'pgw:r:' + 'b'.repeat(32), generation: 0, predecessor: null, digest: '' },
    workspace_binding: { mode: 'portable' },
    requirements: { protocol_features: [], consumer_capabilities: [] },
    extensions: [],
    body: {
      objective: 'x',
      instructions: [{ instruction_id: 'i', text: 't' }],
      expected_deliverables: [{ deliverable_id: 'd', description: 'x', kind: 'document' }],
      outcome_constraints: [],
      project_data_citations: [],
    },
  };
  model.revision['digest'] = computeArtifactDigest(model).digest;
  const before = JSON.stringify(model);
  const report = validateArtifactRevision(model, reg, 'semantic-self-validation');
  assert.equal(report.ok, true);
  assert.equal(JSON.stringify(model), before);
});

test('security: bounded traversal resists deep nesting', () => {
  const deep = '['.repeat(33) + ']'.repeat(33);
  const r = parseRawJsonInput(deep, { subjectClass: 'artifact' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.report.findings[0]?.category, 'RESOURCE-LIMIT');
});

test('security: storage fs-module delegation is exact and fail-closed', () => {
  // Accepted: the exact compiled paths of the filesystem-bearing WP-8-C/D
  // sources plus the WP-8-E read-only scan module.
  const accepted = [
    'dist/storage/root/resolve.js',
    'dist/storage/initialization/provision.js',
    'dist/storage/probe/probe.js',
    'dist/storage/probe/scratch.js',
    'dist/storage/metadata/bootstrap-persist.js',
    'dist/storage/recovery/scan.js',
    'dist/storage/recovery/reverify.js',
    'dist/storage/recovery/cleanup.js',
    'dist/storage/recovery/quarantine.js',
    'dist/storage/recovery/disposition.js',
    'dist/storage/registry/index-store.js',
  ];
  for (const path of accepted) {
    assert.equal(isStorageFsDelegatedModule(path), true, `expected delegation for ${path}`);
  }
  // Native platform-separator construction of an exact path is accepted.
  assert.equal(isStorageFsDelegatedModule(['storage', 'root', 'resolve.js'].join(sep)), true, 'native separator normalization');
  // Rejected: barrels, orchestrator, state, metadata profile, capability and
  // trusted-input modules, siblings, near-matches, tricks, and futures.
  const rejected = [
    'dist/storage/index.js',
    'storage/index.js',
    'storage/root/index.js',
    'storage/initialization/index.js',
    'storage/probe/index.js',
    'storage/metadata/index.js',
    'storage/capabilities/index.js',
    'storage/trusted-input/index.js',
    'storage/initialization/initialize.js',
    'storage/initialization/state.js',
    'storage/metadata/store-metadata.js',
    'storage/capabilities/authenticity.js',
    'storage/trusted-input/bootstrap-input.js',
    'storage/root/identity.js',
    'storage/root/overlap.js',
    'storage/root/resolve2.js',
    'storage/root/resolvex.js',
    'storage/root/xresolve.js',
    'storage/root/resolve.jsx',
    'storage/root/resolve.js.bak',
    'storage/root/not-resolve.js',
    'storage/root/resolve-helper.js',
    'storage/root/sub/resolve.js',
    'storage/root/sub/provision.js',
    'storage/../storage/root/resolve.js',
    'storage/root/../root/resolve.js',
    'storage/root/future.js',
    'storage/future/whatever.js',
    'storage\\root\\resolve.js',
    'storage/root/resolve',
    'resolve.js',
    'dist/storage/root/resolve.ts',
    'dist/storage/root/resolve.js/extra',
  ];
  for (const path of rejected) {
    assert.equal(isStorageFsDelegatedModule(path), false, `must reject ${path}`);
  }
  // The delegated set among the real compiled tree is exactly the delegated set.
  const delegatedInTree = walk(DIST).filter((p) => isStorageFsDelegatedModule(p)).map((p) => p.slice(DIST.length + 1).split(sep).join('/')).sort();
  assert.deepEqual(delegatedInTree, [...STORAGE_FS_DELEGATED_MODULES].sort());
});

test('security: deterministic finding order', () => {
  const model = {
    protocol: { id: 'project-gateway.artifact', version: '1.0', canonicalization: 'jcs-rfc8785-v1' },
    kind: { id: 'TaskSpec', version: '1.0' },
    instance_id: 'pgw:i:' + 'a'.repeat(32),
    revision: { id: 'pgw:r:' + 'b'.repeat(32), generation: 0, predecessor: null, digest: 'x' },
    workspace_binding: { mode: 'portable' },
    requirements: { protocol_features: [], consumer_capabilities: [] },
    extensions: [],
    body: {},
    unexpected: true,
  };
  const a = validateArtifactRevision(model, reg, 'structural-schema-validation');
  const b = validateArtifactRevision(JSON.parse(JSON.stringify(model)), reg, 'structural-schema-validation');
  assert.deepEqual(a, b);
});

test('security: conformance runner exposes no mutable global state', () => {
  const r1 = new ConformanceRunner();
  const r2 = new ConformanceRunner();
  assert.equal(r1.run().passed, r2.run().passed);
});

test('security: snapshot traversal state is per-call (no module-global WeakMap/WeakSet)', () => {
  const src = readFileSync(join(DIST, 'internal', 'snapshot.js'), 'utf8');
  // no module-scope WeakMap construction; the only WeakSets are the three
  // module-private membership sets
  assert.ok(!src.includes('new WeakMap'), 'module-global WeakMap in snapshot module');
  const weakSets = src.match(/new WeakSet/g) ?? [];
  assert.equal(weakSets.length, 3, 'unexpected WeakSet in snapshot module');
});

test('security: wrappers expose no brand symbol or brand property in compiled output', () => {
  const src = readFileSync(join(DIST, 'api', 'types.js'), 'utf8');
  assert.ok(!src.includes('getOwnPropertySymbols'), 'wrapper creation copies brand symbols');
  const snapSrc = readFileSync(join(DIST, 'internal', 'snapshot.js'), 'utf8');
  assert.ok(!snapSrc.includes('Symbol('), 'brand symbols exist in snapshot module');
  assert.ok(!snapSrc.includes('Symbol.for('), 'global symbol membership exists');
});

test('security: expected manifest metadata is never execution input (compiled scan)', () => {
  const src = readFileSync(join(DIST, 'conformance', 'runner.js'), 'utf8');
  const lines = src.split('\n');
  const classStart = lines.findIndex((l) => l.includes('class ConformanceRunner'));
  const comparisonStart = lines.findIndex((l) => l.includes('// ----') && l.includes('comparison'));
  assert.ok(classStart > 0 && comparisonStart > classStart);
  for (let i = classStart; i < comparisonStart; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    assert.ok(
      !line.includes('expected_schema_id') &&
        !line.includes('expected_semantic_rule_ids') &&
        !line.includes('expected_failure_category') &&
        !line.includes('expected_result'),
      `expected metadata read in execution code at compiled line ${i + 1}`,
    );
  }
});

test('security: point-of-use and identity modules keep no hidden mutable protocol state', () => {
  for (const rel of ['pointofuse/evaluate.js', 'engine/pipeline.js', 'engine/identity.js', 'references/validate.js']) {
    const src = readFileSync(join(DIST, rel), 'utf8');
    assert.ok(!src.includes('Date.now'), `Date.now in ${rel}`);
    assert.ok(!src.includes('process.env'), `process.env in ${rel}`);
  }
});
