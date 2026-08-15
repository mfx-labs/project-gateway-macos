/**
 * PS-1 — control-plane storage bootstrap action producer (operator-only).
 *
 * The WP-8-C contract names this module as the sole intended production
 * consumer of `createStorageBootstrapActionProvenance` (see
 * `src/storage/trusted-input/bootstrap-input.ts` and the storage static
 * guard's creator-consumer edges). PS-1 implements that consumer: the
 * trusted local operator composition boundary that makes store
 * initialization reachable through supported production code.
 *
 * AUTHORITY BOUNDARY (binding):
 * - This module is the PS-1 operator-bootstrap production composition path
 *   that mints the genuine bootstrap action provenance. Together with the
 *   pre-existing runtime composition root (`compose.ts` in the local stdio
 *   runtime), these are the sole two guard-pinned production consumers of
 *   the provenance creator (storage static-guard creator-consumer edges). The
 *   runtime root composes trusted registrations and re-verifies existing
 *   stores; it does not expose bootstrap authority to MCP callers. The
 *   provenance is constructed here from correlated host-owned operands
 *   (operator startup configuration + validator-derived configuration
 *   identity + effective limit profile); no request, artifact, model input,
 *   or runtime tool operand can reach the provenance fields.
 * - The module exposes NO provenance, capability, brand, or trusted-input
 *   creator. The result carries only resolved configuration facts
 *   (identity, canonical workspace records, store digests) — never an
 *   authority-bearing object.
 * - It is not exported through the package root, ./mcp, or any package
 *   subpath; the only reachable surface is the operator CLI verb
 *   `project-gateway-macos-mcp bootstrap`.
 *
 * The module is I/O-free (no filesystem, network, process, or timers): all
 * host observation (path canonicalization, artifact-location resolution) is
 * injected through the WP-6 resolver seam, exactly as the committed WP-14A
 * lanes do. Storage mutation happens exclusively inside the accepted
 * initialization orchestrator (`initializeTrustedStore`), which revalidates
 * its one-shot capability at every mutation boundary; no second storage
 * initialization engine exists or is introduced here.
 *
 * Fail-closed contract: partial, foreign, unsupported-version, malformed,
 * drifted, wrong-identity, wrong-ownership, wrong-mode, and forbidden-root
 * states are never repaired; they surface as typed failures with the
 * storage codes unchanged. A caller-supplied configuration identity is
 * never trusted: it must equal the validator-derived canonical identity or
 * the action fails before any storage mutation.
 */
import { validateTrustedWorkspaceConfiguration } from '../trusted/validate.js';
import { computeTrustedConfigurationIdentity } from '../trusted/identity.js';
import { CAPABILITY_VOCABULARY_VERSION, TRUSTED_SOURCE_KIND } from '../trusted/index.js';
import type { TrustedHostLane } from '../trusted/index.js';
import type { ArtifactLocationResolver, RootPathResolver, ValidatedWorkspaceRecord } from '../trusted/index.js';
import { createStorageBootstrapActionProvenance } from '../storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../storage/initialization/initialize.js';
import type { InitializationResult } from '../storage/types.js';
import { verifyStoreInstance } from '../storage/read/read-record.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../storage/limits/limits.js';

/** Action identity bound into every store initialized through this boundary. */
export const CONTROL_PLANE_BOOTSTRAP_ACTION_IDENTITY = 'project-gateway-operator-bootstrap';

/** Injected host-observation seam (same contract as the WP-14A lanes). */
export interface BootstrapResolvers {
  readonly resolveRootPath: RootPathResolver;
  readonly resolveArtifactLocation?: ArtifactLocationResolver;
}

/** One operator workspace entry (closed fields; the startup-config shape). */
export interface BootstrapWorkspaceInput {
  readonly workspaceId: string;
  readonly root: string;
  readonly artifactLocation?: string;
}

/** Operator-owned bootstrap action request for one logical surface. */
export interface StorageBootstrapActionInput {
  readonly surfaceId: string;
  /** Trusted store parent locator (the directory that will contain store-v1/ and config-v1/). */
  readonly locator: string;
  /** Trusted service UID (defaulted to the current process UID by the config loader). */
  readonly serviceUid: number;
  /** Canonical absolute paths of governed repository/workspace roots. */
  readonly forbiddenRoots: readonly string[];
  /** Trusted configuration version (pinned by the operator/manifest). */
  readonly configurationVersion: string;
  /**
   * Optional operator-supplied identity. NEVER trusted: when present it must
   * equal the identity derived from the validated canonical configuration,
   * otherwise the action fails closed before any storage mutation.
   */
  readonly configurationIdentity?: string;
  /** Optional limit-profile overrides merged onto the repository defaults. */
  readonly limitProfile: Readonly<Record<string, number>>;
  /** Workspace entries (validated through the WP-6 Phase-1 pipeline). */
  readonly workspaces: readonly BootstrapWorkspaceInput[];
  /**
   * Trusted host lane operand (PS-6): the lane derived once at the operator
   * CLI boundary from the actual host observation. Never an
   * operator-config-controlled field; the lane participates in configuration
   * identity, so stores are lane-bound (cross-lane replay fails closed).
   */
  readonly hostLane: TrustedHostLane;
  /** Host observation seam (real resolvers supplied by the operator CLI). */
  readonly resolvers: BootstrapResolvers;
  /** Optional operator-owned Git lane facts, passed through to the runtime config unchanged. */
  readonly gitPath?: string;
  readonly gitHome?: string;
  readonly gitTmpdir?: string;
}

/** One resolved workspace record for the runtime configuration. */
export interface ResolvedWorkspaceRecord {
  readonly workspaceId: string;
  /** Canonical root exactly as validated (symlink-resolved). */
  readonly root: string;
  /** Canonical artifact location, present only when configured. */
  readonly artifactLocation?: string;
}

/** The resolved runtime surface: exactly the facts normal startup requires. */
export interface ResolvedBootstrapSurface {
  readonly surfaceId: string;
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly configurationIdentity: string;
  readonly configurationVersion: string;
  readonly limitProfile: Readonly<Record<string, number>>;
  readonly workspaces: readonly ResolvedWorkspaceRecord[];
  readonly gitPath?: string;
  readonly gitHome?: string;
  readonly gitTmpdir?: string;
}

export type StorageBootstrapActionResult =
  | {
      readonly ok: true;
      readonly state: 'INITIALIZED';
      readonly configurationIdentity: string;
      readonly parentIdentity: InitializationResult['parentIdentity'];
      readonly namespaceIdentities: InitializationResult['namespaceIdentities'];
      readonly metadataDigests: InitializationResult['metadataDigests'];
      readonly resolved: ResolvedBootstrapSurface;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Map one validated workspace record to the runtime-config workspace shape. */
function resolvedWorkspace(record: ValidatedWorkspaceRecord): ResolvedWorkspaceRecord {
  return {
    workspaceId: record.workspaceId,
    root: record.canonicalRoot,
    ...(record.artifactLocation !== undefined ? { artifactLocation: record.artifactLocation } : {}),
  };
}

/**
 * Run the operator bootstrap action for one surface: validate the trusted
 * configuration through the committed WP-6 Phase-1 pipeline with injected
 * host resolvers, derive the canonical configuration identity, mint the
 * genuine bootstrap action provenance from correlated host-owned fields,
 * invoke the accepted initialization orchestrator (provision or exact
 * idempotent replay), and independently re-verify the resulting store.
 *
 * Every failure path is typed and closed; nothing partial is returned and
 * no state is repaired.
 */
export function bootstrapStore(input: StorageBootstrapActionInput): StorageBootstrapActionResult {
  const limitProfile: SelectedLimitProfile = { ...defaultLimitProfile(), ...input.limitProfile };
  const configurationReport = validateTrustedWorkspaceConfiguration(
    {
      configurationVersion: input.configurationVersion,
      capabilityVocabularyVersion: CAPABILITY_VOCABULARY_VERSION,
      provenance: { sourceKind: TRUSTED_SOURCE_KIND },
      workspaces: input.workspaces.map((w) => ({
        workspaceId: w.workspaceId,
        root: w.root,
        ...(w.artifactLocation !== undefined ? { artifactLocation: w.artifactLocation } : {}),
      })),
    },
    {
      hostLane: input.hostLane,
      resolveRootPath: input.resolvers.resolveRootPath,
      ...(input.resolvers.resolveArtifactLocation !== undefined ? { resolveArtifactLocation: input.resolvers.resolveArtifactLocation } : {}),
    },
  );
  if (!configurationReport.ok || configurationReport.configuration === undefined) {
    const first = configurationReport.findings[0];
    return {
      ok: false,
      code: 'ERR-BOOT-CONFIG-INVALID',
      message: `bootstrap configuration invalid: ${first?.code ?? 'unknown'}`,
    };
  }
  const configuration = configurationReport.configuration;

  // The identity is DERIVED from the validated canonical configuration
  // through the accepted WP-6 computation; a caller-supplied identity is
  // only ever compared, never adopted.
  let derivedIdentity: string;
  try {
    derivedIdentity = computeTrustedConfigurationIdentity(configuration).digest;
  } catch {
    return { ok: false, code: 'ERR-BOOT-IDENTITY-FAILED', message: 'configuration identity computation failed' };
  }
  if (derivedIdentity !== configuration.identity) {
    return { ok: false, code: 'ERR-BOOT-INTERNAL-INVARIANT', message: 'validator-derived identity did not match the canonical computation' };
  }
  if (input.configurationIdentity !== undefined && input.configurationIdentity !== derivedIdentity) {
    return {
      ok: false,
      code: 'ERR-BOOT-IDENTITY-CONFLICT',
      message: 'supplied configurationIdentity does not match the identity derived from the validated configuration',
    };
  }

  // Genuine branded provenance from correlated host-owned fields ONLY.
  // No operand of this module (or of any caller) can inject provenance
  // fields; the brand is process-local and minted exactly here.
  const provenance = createStorageBootstrapActionProvenance({
    actionIdentity: CONTROL_PLANE_BOOTSTRAP_ACTION_IDENTITY,
    locator: input.locator,
    serviceUid: input.serviceUid,
    forbiddenRoots: input.forbiddenRoots,
    configurationIdentity: derivedIdentity,
    limitProfile,
  });

  // The accepted orchestrator: provisions an absent store or replay-
  // verifies an initialized one; every other aggregate state fails closed.
  const init = initializeTrustedStore({
    trustedConfiguration: configuration,
    actionProvenance: provenance,
    locator: input.locator,
    serviceUid: input.serviceUid,
    forbiddenRoots: input.forbiddenRoots,
    limitProfile,
  });
  if (!init.ok || init.state !== 'INITIALIZED') {
    const first = init.findings?.[0];
    return {
      ok: false,
      code: first?.code ?? 'ERR-STO-INTEGRITY',
      message: first?.message ?? 'trusted store initialization failed closed',
    };
  }

  // Independent post-initialization verification through the accepted
  // store-instance pipeline (the same verification the runtime composition
  // root performs on every startup).
  const verified = verifyStoreInstance({
    locator: input.locator,
    serviceUid: input.serviceUid,
    forbiddenRoots: input.forbiddenRoots,
    configurationIdentity: derivedIdentity,
    configurationVersion: input.configurationVersion,
    limitProfile,
  });
  if (!verified.ok || verified.storeInstance === undefined) {
    return {
      ok: false,
      code: verified.code ?? 'ERR-BOOT-VERIFY-FAILED',
      message: verified.message ?? 'store verification after initialization failed',
    };
  }

  const resolved: ResolvedBootstrapSurface = {
    surfaceId: input.surfaceId,
    locator: input.locator,
    serviceUid: input.serviceUid,
    forbiddenRoots: [...input.forbiddenRoots],
    configurationIdentity: derivedIdentity,
    configurationVersion: input.configurationVersion,
    // Operator overrides only: normal startup merges the repository defaults
    // itself (compose.ts), so serializing the effective profile would be
    // rejected by the closed startup-config selection gate.
    limitProfile: { ...input.limitProfile },
    workspaces: configuration.workspaces.map(resolvedWorkspace),
    ...(input.gitPath !== undefined ? { gitPath: input.gitPath } : {}),
    ...(input.gitHome !== undefined ? { gitHome: input.gitHome } : {}),
    ...(input.gitTmpdir !== undefined ? { gitTmpdir: input.gitTmpdir } : {}),
  };

  return {
    ok: true,
    state: 'INITIALIZED',
    configurationIdentity: derivedIdentity,
    parentIdentity: init.parentIdentity,
    namespaceIdentities: init.namespaceIdentities,
    metadataDigests: init.metadataDigests,
    resolved,
  };
}
