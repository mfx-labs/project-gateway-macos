/**
 * @project-gateway/macos-core
 *
 * Consumer-neutral Artifact Core library: deterministic validation and protocol
 * evaluation for the Project Gateway artifact protocol (WP-0..WP-3).
 *
 * The core performs no filesystem, network, Git, process, or trusted-state I/O.
 * All external state is supplied through explicit interfaces.
 */
export {
  parseRawJsonInput,
  createSchemaRegistry,
  validateArtifactRevision,
  validateArtifactSelf,
  validateArtifactForUse,
  validateArtifactInput,
  validateRegistrySnapshot,
  validateLifecycleRecord,
  computeArtifactDigest,
  verifyArtifactDigestValue,
  computeRegistryDigest,
  verifyRegistryDigestValue,
  resolveExactArtifactReference,
  resolveExactArtifactReferenceForUse,
  validateLifecycleGraph,
  evaluatePointOfUseEligibility,
  VALIDATION_PHASES,
  isLevelAtLeast,
} from './api/validate.js';
export { SchemaRegistry, SchemaRegistryError } from './schema/registry.js';
export { classifyRetrospectiveEligibility } from './lifecycle/retrospective-eligibility.js';
export type { RetrospectiveEligibility } from './lifecycle/retrospective-eligibility.js';
export { ConformanceRunner, manifestStats } from './conformance/runner.js';
export type { ConformanceSummary, ConformanceMismatch, ConformanceManifestEntry } from './conformance/runner.js';
export { MemoryIdentityState } from './api/types.js';
export type {
  AcceptedModel,
  ValidatedArtifact,
  ValidatedRegistrySnapshot,
  ValidatedLifecycleRecord,
  ExactArtifactReferenceModel,
  Finding,
  ValidationReport,
  RegisteredRevision,
  RegisteredInstance,
  IdentityStateView,
  ExactSubjectResolver,
  AcceptedRegistryContext,
  ConsumerSupportDeclaration,
  LifecycleStateView,
  RevocationView,
  PointOfUseInputs,
  EligibilityReport,
  ImmutableModel,
  RequestedUse,
  ValidationLevel,
  ArtifactKindId,
  LifecycleRecordType,
  ValidationPhase,
  FailureCategory,
} from './api/types.js';
export { ARTIFACT_DIGEST_DOMAIN, REGISTRY_DIGEST_DOMAIN } from './digest/index.js';
export { isNfc } from './canonical/input.js';
export { jcsSerialize } from './canonical/jcs.js';
export { ruleIds, ruleDef, enforcementKind, evaluatorFor, evaluatorRulesForArtifact } from './semantic/rules.js';
export type { RuleDef, EnforcementKind } from './semantic/rules.js';
export { RawJsonError } from './json/scanner.js';
export { validateReferenceModel, validateReferenceModelForUse } from './references/validate.js';
export { isBrandedArtifact, isBrandedRegistry, isBrandedRecord, snapshotJson } from './internal/snapshot.js';
export { snapshotModel } from './api/types.js';
// Narrow adapter-facing protocol-equality helper: exact artifact reference
// equality used by the Pi adapter to correlate exact bundle members.
export { exactReferencesEqual, workspaceBindingsEqual } from './internal/protocol-equality.js';
