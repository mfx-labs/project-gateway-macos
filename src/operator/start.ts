/**
 * S3 — `pgw start`.
 *
 * Launches the existing Gateway MCP stdio server with the S2 project registry
 * as the single persistent source of truth. Derives each runtime surface in
 * memory, derives the configuration identity READ-ONLY through the accepted
 * WP-6 validation + identity primitives, assembles the runtime surface in
 * memory, and hands all surfaces to composeTrustedRegistry, whose existing
 * verifyStoreInstance path performs read-only store verification.
 *
 * `start` NEVER provisions, repairs, migrates, or re-anchors a store:
 * bootstrapStore / initializeTrustedStore are not called here. A missing,
 * uninitialized, or corrupt store fails before the MCP server and no store
 * files/directories are created. No runtime.json, no second persistent config.
 */
import { realpathSync, readFileSync } from 'node:fs';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { diagnostic } from './diagnostic.js';
import { loadRegistry } from './registry.js';
import { deriveRuntimeSurface } from './surface.js';
import {
  CAPABILITY_VOCABULARY_VERSION,
  TRUSTED_SOURCE_KIND,
  computeTrustedConfigurationIdentity,
  validateTrustedWorkspaceConfiguration,
  trustedHostLaneForPlatformArch,
} from '../trusted/index.js';
import { composeTrustedRegistry } from '../runtime/mcp/compose.js';
import { createMcpServer } from '../runtime/mcp/server.js';
import type { SurfaceConfig } from '../runtime/mcp/config.js';

function packageIdentity(): { readonly name: string; readonly version: string } {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { readonly name?: string; readonly version?: string };
    return { name: pkg.name ?? 'pgw-mcp', version: pkg.version ?? '0.0.0' };
  } catch {
    return { name: 'pgw-mcp', version: '0.0.0' };
  }
}

export async function runStart(): Promise<void> {
  const hostLane = trustedHostLaneForPlatformArch(process.platform, process.arch);
  if (hostLane === null) {
    diagnostic(`start: unsupported host platform/architecture: ${process.platform} ${process.arch}`);
    process.exitCode = 2;
    return;
  }

  const loaded = loadRegistry();
  if (!loaded.ok) {
    diagnostic(`start: ${loaded.message}`);
    process.exitCode = 1;
    return;
  }
  if (loaded.registry.projects.length === 0) {
    diagnostic('start: no registered projects; run `pgw add <path>` first');
    process.exitCode = 1;
    return;
  }

  const surfaces: SurfaceConfig[] = [];
  for (const project of loaded.registry.projects) {
    const facts = deriveRuntimeSurface(project);

    const validation = validateTrustedWorkspaceConfiguration(
      {
        configurationVersion: facts.configurationVersion,
        capabilityVocabularyVersion: CAPABILITY_VOCABULARY_VERSION,
        provenance: { sourceKind: TRUSTED_SOURCE_KIND },
        workspaces: [{ workspaceId: facts.workspaceId, root: facts.root }],
      },
      {
        hostLane,
        resolveRootPath: (p) => {
          try {
            return realpathSync(p);
          } catch {
            return null;
          }
        },
      },
    );
    if (!validation.ok || validation.configuration === undefined) {
      diagnostic(`start: project ${project.id} configuration validation failed: ${validation.findings[0]?.code ?? 'unknown'}`);
      process.exitCode = 1;
      return;
    }

    let identity: string;
    try {
      identity = computeTrustedConfigurationIdentity(validation.configuration).digest;
    } catch {
      diagnostic(`start: project ${project.id} configuration identity derivation failed`);
      process.exitCode = 1;
      return;
    }

    surfaces.push({
      surfaceId: facts.surfaceId,
      locator: facts.locator,
      serviceUid: facts.serviceUid,
      forbiddenRoots: [],
      configurationIdentity: identity,
      configurationVersion: facts.configurationVersion,
      limitProfile: {},
      workspaces: validation.configuration.workspaces.map((w) => ({
        workspaceId: w.workspaceId,
        root: w.canonicalRoot,
      })),
      gitPath: facts.gitPath,
      gitHome: facts.gitHome,
      gitTmpdir: facts.gitTmp,
    });
  }

  const composed = await composeTrustedRegistry({ surfaces }, {}, hostLane);
  if (!composed.ok) {
    diagnostic(`start: runtime composition failed: ${composed.code}: ${composed.message}`);
    process.exitCode = 1;
    return;
  }

  const identity = packageIdentity();
  const server = createMcpServer(composed.registry, composed.draftingRegistry, composed.persistRegistry, composed.changesRegistry, identity);
  // stdout carries MCP protocol only from here; diagnostics remain on stderr.
  serveStdio(() => server, { onerror: (error) => diagnostic(`runtime error: ${error.message}`) });
}
