/**
 * MAC-2E — Darwin-only scope + product identity static/behavioral guards.
 *
 * Proves the macOS product branding is unambiguous and the trusted
 * protocol identities are untouched:
 *   - package identity  `@project-gateway/macos-core` (package.json +
 *     mechanically mirrored lockfile fields);
 *   - bin identity      `project-gateway-macos-mcp` (single bin entry;
 *     usage text; diagnostics prefix; bootstrap usage);
 *   - MCP server identity is package-derived (no second hard-coded
 *     name/version source in server.ts);
 *   - bootstrap provenance label `project-gateway-macos-mcp-bootstrap`
 *     (compose.ts) and the control-plane constant
 *     `project-gateway-operator-bootstrap` UNCHANGED;
 *   - Darwin lane strings byte-exact and unchanged; the Linux lane value
 *     remains a protocol-recognized operand;
 *   - trusted-config digest: no product-branding string enters the
 *     canonical projection — the only identity distinction between
 *     configurations remains the existing host-lane operand.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateTrustedWorkspaceConfiguration,
  computeTrustedConfigurationIdentity,
  TRUSTED_HOST_LANE,
  DARWIN_ARM64_HOST_LANE,
  DARWIN_X86_64_HOST_LANE,
} from '../../src/trusted/index.js';
import { validConfig, fakeResolver, validOptions } from '../trusted/helpers.js';
import { TRUSTED_CONFIG_DIGEST_DOMAIN } from '../../src/trusted/identity.js';

const REPO = join(import.meta.dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

test('MAC-2E: package identity is @project-gateway/macos-core with the accepted operator and runtime bins', () => {
  const pkg = JSON.parse(read('package.json')) as { name: string; version: string; bin: Record<string, string> };
  assert.equal(pkg.name, '@project-gateway/macos-core');
  // Version semantics remain unchanged in this slice.
  assert.equal(pkg.version, '0.1.0');
  const bin = pkg.bin ?? {};
  assert.equal(bin['pgw'], './dist/operator/cli.js', 'operator CLI `pgw` maps to the operator entry');
  assert.equal(bin['project-gateway-macos-mcp'], './dist/runtime/mcp/cli.js', 'MCP runtime maps to the runtime CLI entry');
  assert.deepEqual(Object.keys(bin).sort(), ['pgw', 'project-gateway-macos-mcp'], 'exactly the two approved bin entries, no retained alias');
  // Lockfile mirrors only the mechanically required identity fields.
  const lock = JSON.parse(read('package-lock.json')) as { name: string; packages: Record<string, { name?: string; bin?: Record<string, string> }> };
  assert.equal(lock.name, '@project-gateway/macos-core');
  assert.equal(lock.packages['']?.name, '@project-gateway/macos-core');
  assert.deepEqual(lock.packages['']?.bin, { pgw: 'dist/operator/cli.js', 'project-gateway-macos-mcp': 'dist/runtime/mcp/cli.js' });
});

test('MAC-2E: CLI usage, diagnostics prefix, and bootstrap usage identify the macOS binary', () => {
  const cli = read('src/runtime/mcp/cli.ts');
  assert.ok(cli.includes('usage: project-gateway-macos-mcp --config <file>'), 'runtime usage line');
  assert.ok(cli.includes('project-gateway-macos-mcp bootstrap --config <file>'), 'bootstrap usage line');
  assert.ok(cli.includes("'project-gateway-macos-mcp'"), 'packageIdentity fallback is the macOS identity');
  // The old bin identity must not appear anywhere in the runtime CLI/boundary
  // (the new string always carries the `-macos-` segment, so any bare
  // `project-gateway-mcp` occurrence would be stale branding).
  for (const rel of ['src/runtime/mcp/cli.ts', 'src/runtime/mcp/diagnostics.ts', 'src/runtime/mcp/compose.ts', 'src/bootstrap/run.ts']) {
    assert.equal(read(rel).includes('project-gateway-mcp'), false, `${rel} must not contain the old bin identity`);
  }
  assert.ok(read('src/runtime/mcp/diagnostics.ts').includes('project-gateway-macos-mcp:'), 'diagnostic prefix is the macOS identity');
  assert.ok(read('src/bootstrap/run.ts').includes('usage: project-gateway-macos-mcp bootstrap --config <file>'), 'bootstrap usage is the macOS identity');
});

test('MAC-2E: unsupported current hosts fail closed at the CLI before any server startup', () => {
  const cli = read('src/runtime/mcp/cli.ts');
  const mainStart = cli.indexOf('async function main');
  const hostCheck = cli.indexOf('trustedHostLaneForPlatformArch(process.platform, process.arch)');
  const configLoad = cli.indexOf('loadRuntimeConfig(parsed.args.configPath)');
  const compose = cli.indexOf('composeTrustedRegistry(loaded.config');
  const serve = cli.indexOf('serveStdio(');
  assert.ok(mainStart >= 0 && hostCheck > mainStart, 'host check lives in main()');
  assert.ok(configLoad > hostCheck && compose > configLoad && serve > compose, 'host acceptance precedes config load, composition, and server startup');
  // The unsupported-host branch exits 2 before any config/store activity.
  const branch = cli.slice(hostCheck, configLoad);
  assert.ok(branch.includes('process.exit(2)'), 'unsupported host exits 2');
  assert.ok(branch.includes('unsupported host lane'), 'unsupported-host diagnostic is explicit');
  assert.ok(branch.includes('supported: darwin-arm64, darwin-x86_64'), 'the supported set lists exactly the two Darwin lanes');
  assert.equal(branch.includes('linux'), false, 'no Linux lane is advertised as supported');
  // Behavioral classification of the shared pure mapping is covered by
  // tests/trusted/host-lane.test.ts (synthetic platform/arch pairs).
});

test('MAC-2E: bootstrap provenance label renamed; operator-bootstrap label unchanged', () => {
  const compose = read('src/runtime/mcp/compose.ts');
  assert.ok(compose.includes("BOOTSTRAP_ACTION_IDENTITY = 'project-gateway-macos-mcp-bootstrap'"), 'recorded storage-bootstrap provenance label is the macOS identity');
  assert.equal(compose.includes('project-gateway-mcp-bootstrap'), false, 'old bootstrap label fully replaced');
  const control = read('src/control-plane/storage-bootstrap-action.ts');
  assert.ok(control.includes("CONTROL_PLANE_BOOTSTRAP_ACTION_IDENTITY = 'project-gateway-operator-bootstrap'"), 'operator-bootstrap protocol-adjacent identity is byte-unchanged');
});

test('MAC-2E: Darwin lane strings are byte-exact and the Linux lane value remains protocol-recognized', () => {
  assert.equal(DARWIN_X86_64_HOST_LANE, 'darwin-x86_64-posix-utf8-node22');
  assert.equal(DARWIN_ARM64_HOST_LANE, 'darwin-arm64-posix-utf8-node22');
  assert.equal(TRUSTED_HOST_LANE, 'linux-x86_64-posix-utf8-node22');
  assert.equal(TRUSTED_CONFIG_DIGEST_DOMAIN, 'PGAP-TRUSTED-CONFIG-v1\u0000', 'digest domain separator unchanged');
  const hostLaneSrc = read('src/trusted/host-lane.ts');
  for (const lane of ['darwin-x86_64-posix-utf8-node22', 'darwin-arm64-posix-utf8-node22', 'linux-x86_64-posix-utf8-node22']) {
    assert.ok(hostLaneSrc.includes(lane), `lane literal ${lane} present unchanged`);
  }
});

test('MAC-2E: MCP server identity is package-derived — no second hard-coded identity source', () => {
  const server = read('src/runtime/mcp/server.ts');
  assert.equal(server.includes('project-gateway'), false, 'server.ts contains no hard-coded product name');
  assert.equal(server.includes("'0.1.0'"), false, 'server.ts contains no hard-coded version');
  assert.ok(server.includes('name: identity.name, version: identity.version'), 'server identity comes from the caller-supplied package-derived identity');
});

test('MAC-2E digest regression: no product-branding string enters the trusted-config digest projection', () => {
  // Identical trusted configuration inputs under each Darwin lane: the ONLY
  // identity distinction must be the host-lane operand; package/bin/server
  // branding and the bootstrap provenance label must never appear.
  const inputs = validConfig();
  for (const lane of [DARWIN_X86_64_HOST_LANE, DARWIN_ARM64_HOST_LANE]) {
    const report = validateTrustedWorkspaceConfiguration(inputs, validOptions({ hostLane: lane, resolveRootPath: fakeResolver() }));
    assert.equal(report.ok, true, lane);
    const identity = computeTrustedConfigurationIdentity(report.configuration!);
    assert.equal((identity.projection as Record<string, unknown>)['hostLane'], lane, 'the lane operand is the identity carrier');
    assert.ok(identity.canonicalUtf8.includes(lane), 'the exact lane string is in the canonical projection');
    for (const branding of ['project-gateway', 'macos-core', 'artifact-core', 'mcp-bootstrap', 'bootstrap', 'project-gateway-macos-mcp']) {
      assert.equal(identity.canonicalUtf8.includes(branding), false, `branding string "${branding}" must not enter the digest projection`);
    }
    assert.match(identity.digest, /^sha-256:[0-9a-f]{64}$/, 'digest format unchanged');
  }
  // Identical inputs, identical digest (deterministic); different lanes,
  // different digest (the pre-existing cross-lane identity distinction).
  const a = computeTrustedConfigurationIdentity(validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: DARWIN_X86_64_HOST_LANE, resolveRootPath: fakeResolver() })).configuration!);
  const b = computeTrustedConfigurationIdentity(validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: DARWIN_X86_64_HOST_LANE, resolveRootPath: fakeResolver() })).configuration!);
  const c = computeTrustedConfigurationIdentity(validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: DARWIN_ARM64_HOST_LANE, resolveRootPath: fakeResolver() })).configuration!);
  assert.equal(a.digest, b.digest);
  assert.notEqual(a.digest, c.digest);
});
