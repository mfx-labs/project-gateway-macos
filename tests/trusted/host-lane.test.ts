/**
 * WP-6 Phase 1 correction F-7 / PS-6 closed accepted-lane set:
 * explicit trusted host-lane operand.
 *
 * Validation requires an explicit trusted host-lane compatibility operand;
 * the core never ambiently probes the host (no process, environment, path,
 * or runtime global reads); only an accepted lane identifier can produce a
 * validated configuration, and the accepted lane is bound into the
 * configuration identity. PS-6 closes the accepted set to exactly
 * `linux-x86_64-posix-utf8-node22` and `darwin-arm64-posix-utf8-node22`;
 * PS-6I adds `darwin-x86_64-posix-utf8-node22` (macOS Intel) as the
 * third accepted member. Any `macos-*` spelling, Windows, and unknown
 * lanes fail closed (ADR-042, ADR-043).
 *
 * MAC-2E (Darwin-only product scope): the three-member set above remains
 * the PROTOCOL-recognized lane vocabulary (validation, digest identity,
 * cross-lane replay) unchanged; the macOS PRODUCT additionally accepts
 * ONLY the two Darwin lanes as current-host lanes —
 * `trustedHostLaneForPlatformArch` never maps a Linux/Windows/unknown
 * host to a lane, so the CLI boundary fails closed with exit 2.
 * Protocol can represent a lane value; the product decides which current
 * hosts it runs on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTrustedWorkspaceConfiguration,
  computeTrustedConfigurationIdentity,
  TRUSTED_HOST_LANE,
  DARWIN_ARM64_HOST_LANE,
  DARWIN_X86_64_HOST_LANE,
  ACCEPTED_HOST_LANES,
  isSupportedHostLane,
  trustedHostLaneForPlatformArch,
} from '../../src/trusted/index.js';
import { validConfig, fakeResolver, validOptions } from './helpers.js';

test('PS6I: the closed accepted-lane set is exactly linux x86_64 + darwin arm64 + darwin Intel', () => {
  assert.deepEqual([...ACCEPTED_HOST_LANES], [TRUSTED_HOST_LANE, DARWIN_ARM64_HOST_LANE, DARWIN_X86_64_HOST_LANE]);
  assert.equal(isSupportedHostLane(TRUSTED_HOST_LANE), true);
  assert.equal(isSupportedHostLane(DARWIN_ARM64_HOST_LANE), true);
  assert.equal(isSupportedHostLane(DARWIN_X86_64_HOST_LANE), true);
});

test('PS6I: all three accepted lanes validate and the validated configuration retains the ACTUAL lane operand', () => {
  for (const lane of ACCEPTED_HOST_LANES) {
    const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: lane }));
    assert.equal(report.ok, true, lane);
    // The validated configuration must carry the validated operand — never
    // a hardcoded Linux value (PS-6 corrected the constant stamp).
    assert.equal(report.configuration!.hostLane, lane, lane);
  }
});

test('PS6/F7: missing host lane fails closed with a dedicated finding (TCF-027)', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig(),
    // @ts-expect-error — lane omission must be a type error; runtime check still fails closed
    { resolveRootPath: fakeResolver() },
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-027');
  assert.equal(report.findings[0]!.messageKey, 'trusted-config.host-lane-missing');
  assert.equal(report.configuration, undefined);
});

test('F7: non-string host lane fails closed (TCF-027)', () => {
  const report = validateTrustedWorkspaceConfiguration(
    validConfig(),
    // @ts-expect-error — lane must be a string; runtime check still fails closed
    { hostLane: 42, resolveRootPath: fakeResolver() },
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-027');
});

test('F7: empty host lane fails closed (TCF-027)', () => {
  const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: '' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-027');
});

test('PS6I/F7: unsupported host lanes fail closed before identity (TCF-028)', () => {
  // The rejected `macos-*` spelling, Windows, wrong arch / node /
  // non-POSIX, future, and malformed lanes. (darwin-x86_64-posix-utf8-node22
  // is an accepted PS-6I lane and is NOT rejected.)
  for (const lane of [
    'macos-arm64-posix-utf8-node22',
    'macos-x86_64-posix-utf8-node22',
    'darwin-arm64-posix-utf8-node20',
    'darwin-arm64-nonposix-utf8-node22',
    'linux-arm64-posix-utf8-node22',
    'linux-x86_64-posix-utf8-node20',
    'windows-x64-win32-utf16-node22',
    'linux-x86_64-nonposix-utf8-node22',
    'linux-x86_64-posix-utf8-node22-beta',
    'trusted-lane-v2',
    'linux-x86_64-posix-utf8-node22 ',
    ' LINUX-X86_64-POSIX-UTF8-NODE22',
    'DARWIN-ARM64-POSIX-UTF8-NODE22',
  ]) {
    const report = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: lane }));
    assert.equal(report.ok, false, lane);
    assert.equal(report.findings[0]!.code, 'TCF-028', lane);
    assert.equal(report.findings[0]!.messageKey, 'trusted-config.host-lane-unsupported', lane);
    assert.equal(report.configuration, undefined, lane);
  }
});

test('F7: no host-lane inference from input fields', () => {
  // A hostLane field inside the input object is an unknown field, never an
  // inferred operand (the lane comes from options only).
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ hostLane: TRUSTED_HOST_LANE }),
    validOptions(),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-025');
});

test('PS6I/F7: the accepted lane is bound into identity bytes (all three lanes)', () => {
  for (const lane of ACCEPTED_HOST_LANES) {
    const cfg = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: lane })).configuration!;
    const utf8 = computeTrustedConfigurationIdentity(cfg).canonicalUtf8;
    assert.ok(utf8.includes(`"hostLane":"${lane}"`), lane);
    // The lane constant is part of the canonical projection.
    const proj = computeTrustedConfigurationIdentity(cfg).projection as Record<string, unknown>;
    assert.equal(proj['hostLane'], lane);
  }
});

test('PS6I: identity differs across all three lanes for otherwise identical inputs', () => {
  const linux = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: TRUSTED_HOST_LANE })).configuration!;
  const darwin = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: DARWIN_ARM64_HOST_LANE })).configuration!;
  const intel = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: DARWIN_X86_64_HOST_LANE })).configuration!;
  const linuxIdentity = computeTrustedConfigurationIdentity(linux);
  const darwinIdentity = computeTrustedConfigurationIdentity(darwin);
  const intelIdentity = computeTrustedConfigurationIdentity(intel);
  assert.notEqual(linuxIdentity.digest, darwinIdentity.digest);
  assert.notEqual(linuxIdentity.digest, intelIdentity.digest);
  assert.notEqual(darwinIdentity.digest, intelIdentity.digest, 'darwin-arm64 and darwin-Intel must never share an identity');
  assert.equal(linux.identity, linuxIdentity.digest);
  assert.equal(darwin.identity, darwinIdentity.digest);
  assert.equal(intel.identity, intelIdentity.digest);
});

test('PS6I: Intel-lane identity is deterministic (identical inputs, identical digest)', () => {
  const a = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: DARWIN_X86_64_HOST_LANE })).configuration!;
  const b = validateTrustedWorkspaceConfiguration(validConfig(), validOptions({ hostLane: DARWIN_X86_64_HOST_LANE })).configuration!;
  assert.equal(computeTrustedConfigurationIdentity(a).digest, computeTrustedConfigurationIdentity(b).digest);
});

test('MAC-2E: the shared platform/arch → lane mapping accepts ONLY the two Darwin product lanes', () => {
  // The mapping is pure and shared; the CLI boundary supplies the observed
  // platform/arch exactly once. Product-supported current-host mappings only.
  assert.equal(trustedHostLaneForPlatformArch('darwin', 'arm64'), DARWIN_ARM64_HOST_LANE);
  assert.equal(trustedHostLaneForPlatformArch('darwin', 'x64'), DARWIN_X86_64_HOST_LANE);
  // Linux — even x86_64 — is no longer a current-host lane for this macOS
  // product: the lane value remains protocol-recognized (config
  // validation/digest/replay), but no current host maps to it, so
  // Linux-bound state is foreign and fails closed at the CLI (exit 2).
  assert.equal(trustedHostLaneForPlatformArch('linux', 'x64'), null);
  assert.equal(trustedHostLaneForPlatformArch('linux', 'arm64'), null);
  assert.equal(trustedHostLaneForPlatformArch('linux', 'ia32'), null);
  // Windows fails closed on every architecture.
  assert.equal(trustedHostLaneForPlatformArch('win32', 'x64'), null);
  assert.equal(trustedHostLaneForPlatformArch('win32', 'arm64'), null);
  // Unknown platforms and unsupported Darwin architectures fail closed.
  assert.equal(trustedHostLaneForPlatformArch('freebsd', 'x64'), null);
  assert.equal(trustedHostLaneForPlatformArch('openbsd', 'arm64'), null);
  assert.equal(trustedHostLaneForPlatformArch('plan9', 'x64'), null);
  assert.equal(trustedHostLaneForPlatformArch('darwin', ''), null);
  assert.equal(trustedHostLaneForPlatformArch('darwin', 'ia32'), null);
  assert.equal(trustedHostLaneForPlatformArch('darwin', 'arm'), null);
  assert.equal(trustedHostLaneForPlatformArch('', ''), null);
  assert.equal(trustedHostLaneForPlatformArch('DARWIN', 'X64'), null);
});

test('MAC-2E: the real current host classifies as a supported Darwin product lane', () => {
  // The current real Intel host must classify as
  // darwin-x86_64-posix-utf8-node22; an Apple Silicon host would classify
  // as darwin-arm64-posix-utf8-node22 (MAC-5 owns physical Apple Silicon
  // acceptance; MAC-2E requires no real arm64 hardware).
  const lane = trustedHostLaneForPlatformArch(process.platform, process.arch);
  if (process.platform === 'darwin' && process.arch === 'x64') {
    assert.equal(lane, DARWIN_X86_64_HOST_LANE);
  } else if (process.platform === 'darwin' && process.arch === 'arm64') {
    assert.equal(lane, DARWIN_ARM64_HOST_LANE);
  } else {
    // Non-Darwin hosts cannot run this product; the classification must be null.
    assert.equal(lane, null);
  }
});

test('F7: unsupported lanes fail before any input handling', () => {
  // Even hostile input cannot change the outcome: the lane is checked first.
  const hostile = validConfig();
  (hostile as Record<string, unknown>)['self'] = hostile; // cyclic input
  const report = validateTrustedWorkspaceConfiguration(hostile, validOptions({ hostLane: 'windows-x64-win32-utf16-node22' }));
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-028');
});

test('F7: resolver contract is interpreted under the accepted lane', () => {
  // Under the accepted lane the resolver is the host-boundary operand; a
  // resolver failure still fails closed (TCF-008).
  const resolver = fakeResolver({}, new Set(['/srv/gateway/broken']));
  const report = validateTrustedWorkspaceConfiguration(
    validConfig({ workspaces: [{ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: '/srv/gateway/broken' }] }),
    validOptions({ resolveRootPath: resolver }),
  );
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.code, 'TCF-008');
});
