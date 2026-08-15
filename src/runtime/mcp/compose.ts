/**
 * WP-9 Slice 5 / WP-10 Slice 3 / WP-14A — trusted startup composition
 * root for the local stdio MCP runtime.
 *
 * The CLI is an in-package trusted composition root: it uses the exact
 * PRIVATE/TRUSTED repository composition APIs (genuine validated trusted
 * workspace configuration, genuine storage bootstrap action provenance,
 * genuine branded `TrustedStorageBootstrapInput`) to reconstruct existing
 * trusted registrations from the operator-owned startup configuration,
 * then builds the committed host-owned inspection registry, the WP-10
 * host-owned drafting registry, and the two WP-14A host-owned registries
 * (controlled proposal persistence + stateless changed-context
 * inspection). WP-14A lanes (genuine workspace configuration, real
 * resolvers, the committed WP-11 executor, the committed WP-7 services)
 * are built in `lanes.ts` for surfaces with configured workspaces; a
 * surface without workspaces keeps the tools but serves the typed
 * `unsupported` outcome (fail closed).
 *
 * SAME-INSTANCE COMPOSITION (WP-10 Slice 3): for each configured logical
 * surface, exactly ONE `SchemaRegistry` is created and that SAME object is
 * passed to BOTH the inspection registration and the drafting registration.
 * `validate-artifact` and `draft-artifact` therefore self-validate under the
 * identical schema context for the same surface (the accepted
 * DRAFT/VALIDATE SURFACE CONSISTENCY invariant at runtime composition). The
 * startup JSON does not serialize custom schema registries: one fresh
 * registry per surface is created here and shared. The factory dependency is
 * a pure composition seam (defaults to `createSchemaRegistry`); tests use it
 * to prove same-instance sharing without production instrumentation.
 *
 * Trust creators are imported HERE ONLY (localized composition root, per the
 * runtime static guard). They are never re-exported through `./mcp` or any
 * package subpath, and MCP requests never carry roots or locators.
 */
import { markValidatedTrustedWorkspaceConfiguration } from '../../trusted/configuration-brand.js';
import {
  createStorageBootstrapActionProvenance,
  createTrustedStorageBootstrapInput,
} from '../../storage/trusted-input/bootstrap-input.js';
import { createInitializationCapability } from '../../storage/capabilities/authenticity.js';
import { verifyStoreInstance } from '../../storage/read/read-record.js';
import { defaultLimitProfile, type SelectedLimitProfile } from '../../storage/limits/limits.js';
import { createSchemaRegistry } from '../../api/validate.js';
import type { SchemaRegistry } from '../../schema/registry.js';
import {
  createMcpDraftingRegistry,
  createMcpInspectionRegistry,
  createMcpPersistRegistry,
  createMcpChangesRegistry,
  type McpDraftingRegistration,
  type McpDraftingRegistry,
  type McpInspectionRegistry,
  type McpStoreRegistrationInput,
  type McpPersistRegistration,
  type McpPersistRegistry,
  type McpChangesRegistration,
  type McpChangesRegistry,
} from '../../adapters/mcp/index.js';
import { buildWorkspaceLanes } from './lanes.js';
import type { RuntimeConfig } from './config.js';
import { TRUSTED_HOST_LANE } from '../../trusted/index.js';
import type { TrustedHostLane } from '../../trusted/index.js';

const BOOTSTRAP_ACTION_IDENTITY = 'project-gateway-macos-mcp-bootstrap';

/** Default Git binary path for the WP-14A changed-context lane (operator-overridable). */
const DEFAULT_GIT_PATH = '/usr/bin/git';

/**
 * Pure composition dependencies (optional). The schema-registry factory is
 * the ONLY injected seam: it lets composition tests prove that the SAME
 * registry object instance is shared between the inspection and drafting
 * registrations of one surface. No mutable instrumentation, no state.
 */
export interface ComposeDependencies {
  readonly createSchemaRegistry?: () => SchemaRegistry;
}

export type ComposeResult =
  | { readonly ok: true; readonly registry: McpInspectionRegistry; readonly draftingRegistry: McpDraftingRegistry; readonly persistRegistry: McpPersistRegistry; readonly changesRegistry: McpChangesRegistry }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Build the trusted registries (inspection + drafting + WP-14A
 * persist/changes) from the validated operator startup configuration.
 *
 * `hostLane` is the trusted host lane operand (PS-6), derived once at the
 * CLI boundary and shared with the bootstrap path; the default is the
 * Linux lane for existing direct callers/tests. It is never an
 * operator-config-controlled field.
 */
export async function composeTrustedRegistry(config: RuntimeConfig, deps: ComposeDependencies = {}, hostLane: TrustedHostLane = TRUSTED_HOST_LANE): Promise<ComposeResult> {
  const createRegistry = deps.createSchemaRegistry ?? createSchemaRegistry;
  const inspectionRegistrations: McpStoreRegistrationInput[] = [];
  const draftingRegistrations: McpDraftingRegistration[] = [];
  const persistRegistrations: McpPersistRegistration[] = [];
  const changesRegistrations: McpChangesRegistration[] = [];
  for (const surface of config.surfaces) {
    const limitProfile: SelectedLimitProfile = { ...defaultLimitProfile(), ...surface.limitProfile };
    // The trusted configuration object carries the standard repository facts;
    // `identity` is the operator-supplied configuration identity that the
    // store metadata binds (verifyStoreInstance re-checks it at composition
    // and the domain re-checks it on every request).
    const trustedConfiguration = {
      configurationVersion: surface.configurationVersion,
      capabilityVocabularyVersion: '1',
      hostLane: 'pi',
      provenance: { sourceKind: 'control-plane' },
      workspaces: [],
      identity: surface.configurationIdentity,
    };
    markValidatedTrustedWorkspaceConfiguration(trustedConfiguration);
    const provenance = createStorageBootstrapActionProvenance({
      actionIdentity: BOOTSTRAP_ACTION_IDENTITY,
      locator: surface.locator,
      serviceUid: surface.serviceUid,
      forbiddenRoots: surface.forbiddenRoots,
      configurationIdentity: surface.configurationIdentity,
      limitProfile,
    });
    const inputResult = createTrustedStorageBootstrapInput(trustedConfiguration, provenance, {
      locator: surface.locator,
      serviceUid: surface.serviceUid,
      forbiddenRoots: surface.forbiddenRoots,
      limitProfile,
    });
    if (!inputResult.ok) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: `surface ${surface.surfaceId} trusted bootstrap failed: ${inputResult.reason}` };
    }
    // In-process capability-generation seeding: the domain's read/verify
    // capability issuance observes the in-process generation registry, which
    // is normally established by in-process initialization. A fresh gateway
    // process reads stores initialized elsewhere, so the composition root
    // re-establishes the verified store instance and seeds the generation
    // entry by creating an initialization capability that is NEVER used for
    // any mutation operation and is disposed immediately. No initialization
    // or filesystem mutation is performed; the capability cannot outlive
    // composition.
    const storeResult = verifyStoreInstance({
      locator: surface.locator,
      serviceUid: surface.serviceUid,
      forbiddenRoots: surface.forbiddenRoots,
      configurationIdentity: surface.configurationIdentity,
      configurationVersion: surface.configurationVersion,
      limitProfile,
    });
    if (!storeResult.ok || storeResult.storeInstance === undefined) {
      return { ok: false, code: storeResult.code ?? 'ERR-STO-INTEGRITY', message: storeResult.message ?? `surface ${surface.surfaceId} store verification failed` };
    }
    const generationCapability = createInitializationCapability({
      trustedInput: inputResult.input,
      parentIdentity: storeResult.storeInstance.parentIdentity,
    });
    if (generationCapability === undefined) {
      return { ok: false, code: 'ERR-STO-REQ-INVALID', message: `surface ${surface.surfaceId} generation seeding failed` };
    }
    generationCapability.dispose();
    // ONE schema registry per logical surface, shared verbatim by the
    // inspection registration and the drafting registration of the SAME
    // surface (WP-10 Slice 3 same-instance composition).
    const schemaRegistry = createRegistry();
    inspectionRegistrations.push({ surfaceId: surface.surfaceId, trustedConfiguration, trustedInput: inputResult.input, schemaRegistry });
    draftingRegistrations.push({ surfaceId: surface.surfaceId, schemaRegistry });
    // WP-14A lanes: genuine validated workspace configuration + WP-11
    // executor/resolver (persistence) and WP-7 controlled services
    // (changed context). Surfaces without configured workspaces register
    // WITHOUT a lane: the WP-14A tools exist but return the typed
    // `unsupported` outcome for that surface (fail closed, never invented).
    persistRegistrations.push({ surfaceId: surface.surfaceId, schemaRegistry });
    changesRegistrations.push({ surfaceId: surface.surfaceId });
    if (surface.workspaces !== undefined && surface.workspaces.length > 0) {
      // WP-14B integration correction: the controlled Git lane requires
      // EMPTY operator-owned HOME/TMPDIR directories (WP-7 lane contract);
      // the operator's real HOME is never empty and can never be used.
      // Fail closed with a clear typed composition error when omitted.
      if (surface.gitHome === undefined || surface.gitTmpdir === undefined) {
        return { ok: false, code: 'ERR-LANE-COMPOSITION', message: `surface ${surface.surfaceId} workspace lanes require gitHome and gitTmpdir (empty, operator-owned directories outside every workspace root)` };
      }
      const lanesResult = await buildWorkspaceLanes({
        configurationVersion: surface.configurationVersion,
        workspaces: surface.workspaces,
        gitPath: surface.gitPath ?? DEFAULT_GIT_PATH,
        home: surface.gitHome,
        tmpdir: surface.gitTmpdir,
        hostLane,
      });
      if (!lanesResult.ok) {
        return { ok: false, code: 'ERR-LANE-COMPOSITION', message: `surface ${surface.surfaceId} workspace lanes failed: ${lanesResult.message}` };
      }
      persistRegistrations.pop();
      persistRegistrations.push({ surfaceId: surface.surfaceId, schemaRegistry, lane: lanesResult.lanes.persistLane });
      changesRegistrations.pop();
      changesRegistrations.push({ surfaceId: surface.surfaceId, lane: lanesResult.lanes.changesLane });
    }
  }
  const registryResult = createMcpInspectionRegistry({
    registrations: inspectionRegistrations,
  });
  if (!registryResult.ok || registryResult.registry === undefined) {
    return { ok: false, code: registryResult.code ?? 'ERR-STO-REQ-INVALID', message: registryResult.message ?? 'registry composition failed' };
  }
  const draftingResult = createMcpDraftingRegistry({
    registrations: draftingRegistrations,
  });
  if (!draftingResult.ok || draftingResult.registry === undefined) {
    return { ok: false, code: draftingResult.code ?? 'ERR-DRAFT-REQ-INVALID', message: draftingResult.message ?? 'drafting registry composition failed' };
  }
  const persistResult = createMcpPersistRegistry({
    registrations: persistRegistrations,
  });
  if (!persistResult.ok || persistResult.registry === undefined) {
    return { ok: false, code: persistResult.code ?? 'ERR-PERSIST-REQ-INVALID', message: persistResult.message ?? 'persistence registry composition failed' };
  }
  const changesResult = createMcpChangesRegistry({
    registrations: changesRegistrations,
  });
  if (!changesResult.ok || changesResult.registry === undefined) {
    return { ok: false, code: changesResult.code ?? 'ERR-CHANGES-REQ-INVALID', message: changesResult.message ?? 'changed-context registry composition failed' };
  }
  return { ok: true, registry: registryResult.registry, draftingRegistry: draftingResult.registry, persistRegistry: persistResult.registry, changesRegistry: changesResult.registry };
}
