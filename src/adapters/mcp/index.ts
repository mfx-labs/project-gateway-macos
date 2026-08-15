/**
 * @project-gateway/macos-core/mcp
 *
 * MCP adapter library boundary: WP-9 MCP inspection surface (slice 1-5:
 * transport-free protocol/tool layer, read-only inspection tools backed
 * exclusively by accepted domain APIs), WP-10 drafting adapter (slice 2:
 * transport-free host/surface-aware draft-proposal routing over the accepted
 * drafting core), and the WP-14A controlled-producer adapters (persist.ts:
 * Model-B proposal persistence over the committed WP-11 core; changes.ts:
 * stateless changed-context inspection over the committed WP-7
 * boundaries). All are SDK/transport independent: typed request/response
 * boundaries that a future MCP server transport shim (stdlib/stdio/SSE) can
 * host. No storage authority, capability, provenance, or trusted-input
 * creator is exported; results are plain frozen data and confer zero
 * authority.
 */
export { createMcpInspectionSurface, mapDomainError } from './inspect.js';
export { createInspectionContext } from './context.js';
export { createMcpInspectionRegistry, SURFACE_ID_RE } from './registry.js';
export type { McpStoreRegistrationInput, McpInspectionRegistry, RegistryResult } from './registry.js';
export { MCP_INSPECTION_TOOLS, MCP_ERROR_CODES } from './types.js';
export type { McpInspectionContext, McpInspectionContextInput, McpInspectionSurface, McpInspectionTool, McpErrorCode, McpInspectionRequest, McpInspectionResponse, McpToolDescriptor } from './types.js';
export { decodeContinuation, encodeContinuation, validateInspectionRequest } from './validate.js';
export type { ValidationIssue } from './validate.js';
export { createDraftingContext, createMcpDraftingRegistry, MCP_DRAFT_TOOLS } from './drafting.js';
export type { DraftingContext, DraftingContextResult, McpDraftingRegistration, McpDraftingRegistry, DraftingRegistryResult, DraftingResponse, DraftingSuccessResponse, DraftingRoutingErrorResponse, DraftingRoutingErrorCode, McpDraftTool } from './drafting.js';
export { createMcpPersistRegistry, MCP_PERSIST_TOOLS, persistProposalArtifact, PERSIST_WORKSPACE_ID_MAX_LENGTH } from './persist.js';
export type { McpPersistRegistration, McpPersistRegistry, PersistRegistryResult, PersistLane, PersistResponse, PersistSuccessResponse, PersistFailureResponse, PersistErrorCode, McpPersistTool, PersistArtifactRequest } from './persist.js';
export { createMcpChangesRegistry, MCP_CHANGES_TOOLS, inspectProjectChanges, MAX_CHANGES_REPORTED_FILES, MAX_CHANGES_CONTENT_PATHS, MAX_CHANGES_CONTENT_BYTES, MAX_CHANGES_PATH_LENGTH } from './changes.js';
export type { McpChangesRegistration, McpChangesRegistry, ChangesRegistryResult, ChangesLane, ChangesResponse, ChangesSuccessResponse, ChangesFailureResponse, ChangesErrorCode, McpChangesTool, InspectChangesRequest } from './changes.js';
