/**
 * @project-gateway/macos-core/trusted (internal module family)
 *
 * Trusted-local configuration foundation (WP-6 Phase 1).
 *
 * This barrel is INTERNAL to the repository (corrections F-5/F-8): it is not
 * re-exported from the package root, and it exposes only cohesive internal
 * entry points needed by later repository modules and the trusted test
 * suite. Low-level helpers (lexical canonicalization, ancestor predicates,
 * numeric helpers, finding constructors, sort helpers, fail-report builders,
 * capability/extension predicates, regex and digest-domain constants) are
 * intentionally NOT barrel-exported; tests that need them import their
 * module directly.
 *
 * Raw canonical roots are trusted-process internal data (correction F-5):
 * they are never exposed through the package root API, public identity,
 * findings, or any user-facing/MCP/ChatGPT projection.
 *
 * Deterministic, fail-closed, I/O-free validation of TrustedWorkspaceConfiguration
 * runtime inputs: descriptor-derived snapshot hardening (arrays included),
 * explicit configuration versioning, mandatory trusted host-lane operand,
 * mandatory injected root resolver, opaque workspace identifiers,
 * workspace-record validation, workspace-ID and resolved-canonical-root
 * uniqueness, global and workspace ceiling structures, strict recursive
 * unknown-field rejection, trustedExtensionSet declarations, provenance,
 * deterministic locale-independent configuration identity, typed
 * fail-closed findings, and deeply immutable validated outputs.
 *
 * This module family performs no filesystem, network, Git, process, or
 * trusted-state I/O; all external state (e.g. symlink resolution of existing
 * roots) is supplied through explicit interfaces.
 */
export {
  validateTrustedWorkspaceConfiguration,
  lookupValidatedWorkspace,
  lookupValidatedArtifactLocation,
} from './validate.js';
export type { ValidatedArtifactLocationLookup } from './validate.js';
export { snapshotTrustedWorkspaceConfigurationInput, TrustedSnapshotError } from './snapshot.js';
export type { TrustedSnapshotErrorKind } from './snapshot.js';
export { computeTrustedConfigurationIdentity, trustedConfigurationProjection } from './identity.js';
export type { TrustedConfigurationIdentity } from './identity.js';
export {
  TRUSTED_CONFIGURATION_VERSION,
  TRUSTED_CONFIGURATION_VERSION_2,
} from './types.js';
export type {
  TrustedConfigurationVersion,
  TrustedWorkspaceConfigurationInput,
  TrustedConfigurationProvenanceInput,
  TrustedWorkspaceInput,
  TrustedExtensionSetInput,
  TrustedConfigurationValidationOptions,
  ValidatedWorkspaceRecord,
  ValidatedGlobalCapabilityCeiling,
  ValidatedTrustedWorkspaceConfiguration,
} from './types.js';
export {
  CAPABILITY_VOCABULARY_VERSION,
  CAPABILITY_VOCABULARY_V1,
} from './capabilities.js';
export {
  TRUSTED_SOURCE_KIND,
} from './provenance.js';
export type { ValidatedTrustedConfigurationProvenance } from './provenance.js';
export {
  TRUSTED_HOST_LANE,
  DARWIN_ARM64_HOST_LANE,
  DARWIN_X86_64_HOST_LANE,
  ACCEPTED_HOST_LANES,
  trustedHostLaneForPlatformArch,
  isSupportedHostLane,
} from './host-lane.js';
export type {
  TrustedHostLane,
} from './host-lane.js';
export {
  EXTENSION_SCOPES,
} from './extension-set.js';
export type {
  ExtensionScope,
  ValidatedExtensionIdentity,
  ValidatedExpectedToolSource,
  ValidatedTrustedExtensionSet,
} from './extension-set.js';
export type { RootPathResolver, CanonicalRoot, RootResolutionSuccess, RootResolutionFailure } from './roots.js';
export type {
  TrustedConfigurationFinding,
  TrustedConfigurationFindingCode,
  TrustedConfigurationReport,
} from './findings.js';
// ---------------------------------------------------------------------------
// WP-6 Phase 2A: existing-path containment decision core (internal entry
// points). The containment request is untrusted workspace-relative request
// data; the validated configuration and the injected resolver are trusted
// operands. Raw resolved absolute paths remain trusted-process internal and
// are never exposed through the package root, findings, public identity, or
// external projections.
// ---------------------------------------------------------------------------
export { evaluateExistingPathContainment } from './containment-validate.js';
export { parseWorkspaceRelativePath } from './containment-path.js';
export {
  computeContainmentDecisionIdentity,
  containmentDecisionProjection,
} from './containment-identity.js';
export type { ContainmentDecisionIdentity, ContainmentDecisionIdentityInput } from './containment-identity.js';
export {
  CONTAINMENT_PROTOCOL_VERSION,
  CONTAINMENT_OPERATION_CLASS,
  CONTAINMENT_PURPOSES,
} from './containment-types.js';
export type {
  ContainmentPurpose,
  ExistingPathContainmentRequestInput,
  ExistingPathContainmentOptions,
  ExistingPathContainmentDecision,
} from './containment-types.js';
export type {
  ExistingPathResolver,
  ExistingPathResolution,
  ExistingPathResolutionSuccess,
  ExistingPathResolutionFailure,
  ExistingPathResolutionFailureCode,
} from './containment-resolver.js';
export type {
  ExistingPathContainmentFinding,
  ExistingPathContainmentFindingCode,
  ExistingPathContainmentReport,
} from './containment-findings.js';
// ---------------------------------------------------------------------------
// WP-6 Phase 2B-P: trusted artifact-location configuration (version-2
// workspace operand). The artifact-location resolver evidence interface and
// the fixed four-draft scope constant are internal entry points; the
// configured directory grants no write authority and performs no
// destination containment or persistence.
// ---------------------------------------------------------------------------
export { ARTIFACT_DRAFT_LOCATION_KINDS } from './artifact-location.js';
export type {
  ArtifactLocationResolver,
  ArtifactLocationResolution,
  ArtifactLocationResolutionSuccess,
  ArtifactLocationResolutionFailure,
  ArtifactLocationResolutionFailureCode,
} from './artifact-location.js';
// ---------------------------------------------------------------------------
// WP-6 Phase 2B: prospective artifact-draft destination containment (internal
// entry points). The request is untrusted artifact-root-relative request
// data; the runtime-genuine validated configuration and the injected
// prospective-destination resolver are trusted operands. Decisions are
// prospective trusted-process containment data granting no write authority;
// raw canonical paths remain trusted-process internal (F-5) and are never
// exposed through the package root, findings, public identity, or external
// projections.
// ---------------------------------------------------------------------------
export { evaluateProspectiveArtifactDestination } from './destination-validate.js';
export type { ProspectiveArtifactDestinationReport } from './destination-findings.js';
export {
  computeDestinationDecisionIdentity,
  destinationDecisionProjection,
  DESTINATION_DECISION_DIGEST_RE,
} from './destination-identity.js';
export type { DestinationDecisionIdentity, DestinationDecisionIdentityInput } from './destination-identity.js';
export {
  DESTINATION_CONTAINMENT_PROTOCOL_VERSION,
  DESTINATION_CONTAINMENT_OPERATION_CLASS,
  DESTINATION_CONTAINMENT_PURPOSE,
} from './destination-types.js';
export type {
  ArtifactDraftKind,
  ProspectiveArtifactDestinationRequest,
  ProspectiveArtifactDestinationOptions,
  ProspectiveArtifactDestinationDecision,
  ProspectiveDestinationResolutionRequest,
  ProspectiveDestinationResolver,
  ProspectiveDestinationResolution,
  ProspectiveDestinationResolutionSuccess,
  ProspectiveDestinationResolutionFailure,
  ProspectiveDestinationResolutionFailureSubject,
  ProspectiveDestinationResolutionFailureCode,
  ProspectiveDestinationTargetState,
} from './destination-types.js';
export type {
  DestinationContainmentFinding,
  DestinationContainmentFindingCode,
} from './destination-findings.js';
