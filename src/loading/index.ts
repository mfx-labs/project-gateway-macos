/**
 * @project-gateway/macos-core/loading
 *
 * WP-14C — Pi zero-transfer artifact loading (proposal-context loads).
 *
 * One short Pi-facing action (`gateway-load`) resolves → controlled-reads →
 * validates → correlates → renders → injects the intended RESOLVED
 * PROPOSAL SET into Pi context through the committed WP-5A host-bridge
 * injection seam. Loading prepares Pi context; it does NOT authorize Pi
 * execution. No ExecutionBundle construction or persistence, no lifecycle
 * authority, no registry evidence, no durable selection state.
 *
 * Transport-free and I/O-free: all filesystem observation happens through
 * the injected WP-7 controlled reader lane; all Pi host interaction happens
 * through the injected host surface. Results are plain frozen data.
 */
export { resolveProposalLoad, validateLoadOptions, validateCandidate, parseCandidateFilename } from './core.js';
export type { ProposalLoadResult } from './types.js';
export {
  createProposalLoadBridge,
  createProposalLoadSessionRegistry,
  performGatewayLoad,
  buildLoadFeedback,
  GATEWAY_LOAD_COMMAND,
} from './bridge.js';
export type { ProposalLoadBridge, ProposalLoadBridgeResult, ProposalLoadSessionRegistry, GatewayLoadInput, GatewayLoadOutcome } from './bridge.js';
export { renderProposalLoadPlan, computeProposalLoadId, PROPOSAL_LOAD_PREAMBLE } from './plan.js';
export type {
  ProposalLoadPlan,
  ProposalLoadOptions,
  ProposalLoadPin,
  ProposalLoadLane,
  ProposalLoadedArtifact,
  ProposalLoadFailure,
  ProposalLoadErrorCode,
  ProposalLoadKindId,
} from './types.js';
export {
  PROPOSAL_LOAD_KINDS,
  PROPOSAL_INSTANCE_ID_RE,
  PROPOSAL_REVISION_ID_RE,
  PROPOSAL_CANDIDATE_FILE_RE,
  MAX_LOAD_PINS,
  MAX_CANDIDATES_PER_KIND,
  MAX_CANDIDATE_BYTES,
  MAX_LOAD_BLOCK_BYTES,
} from './types.js';
