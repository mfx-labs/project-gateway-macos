/**
 * S2 — `pgw add <path>`.
 *
 * Validates/canonicalizes the path, derives the deterministic project id,
 * provisions the per-project state directories, reuses the existing Gateway
 * bootstrap action (provision or exact idempotent replay), then — only on
 * success — appends the registration. No new lifecycle model, no migration,
 * no store deletion/recreation.
 */
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { projectIdFromPath } from './project-id.js';
import { loadRegistry, saveRegistry } from './registry.js';
import { defaultRegistryPath, defaultStateBase } from './paths.js';
import { CONFIGURATION_VERSION, deriveArtifactLocation, createOperatorArtifactLocationResolver, GIT_PATH } from './surface.js';
import { bootstrapStore } from '../control-plane/storage-bootstrap-action.js';
import { trustedHostLaneForPlatformArch } from '../trusted/host-lane.js';
import { WORKSPACE_ID_PREFIX } from '../trusted/workspace-id.js';

export interface AddInput {
  readonly path: string;
  /** Registry path override (tests). */
  readonly registryPath?: string;
  /** State base override (tests). */
  readonly stateBase?: string;
}

export type AddResult =
  | { readonly ok: true; readonly id: string; readonly path: string; readonly alreadyRegistered: boolean }
  | { readonly ok: false; readonly message: string };

export function addProject(input: AddInput): AddResult {
  let stat;
  try {
    stat = statSync(input.path);
  } catch {
    return { ok: false, message: `path does not exist: ${input.path}` };
  }
  if (!stat.isDirectory()) return { ok: false, message: `path is not a directory: ${input.path}` };

  let canonical: string;
  try {
    canonical = realpathSync(input.path);
  } catch {
    return { ok: false, message: `path could not be canonicalized: ${input.path}` };
  }

  const id = projectIdFromPath(canonical);
  const stateBase = input.stateBase ?? defaultStateBase();
  const locator = join(stateBase, id, 'store');
  const gitHome = join(stateBase, id, 'git-home');
  const gitTmp = join(stateBase, id, 'git-tmp');
  const artifactLocation = deriveArtifactLocation(canonical);

  try {
    // The storage engine requires the trusted parent (locator) to pre-exist
    // as an operator-owned 0700 directory; git-home/git-tmp must be empty
    // operator-owned dirs outside the workspace root (WP-7 lane contract).
    // The version-2 artifact location must exist as a directory (a strict
    // descendant of the workspace root) before controlled persistence uses
    // it; the workspace root itself is never recreated/replaced.
    mkdirSync(locator, { recursive: true, mode: 0o700 });
    mkdirSync(gitHome, { recursive: true });
    mkdirSync(gitTmp, { recursive: true });
    mkdirSync(artifactLocation, { recursive: true });
  } catch (err) {
    return { ok: false, message: `project state directories could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown'})` };
  }

  const hostLane = trustedHostLaneForPlatformArch(process.platform, process.arch);
  if (hostLane === null) {
    return { ok: false, message: `unsupported host platform/architecture: ${process.platform} ${process.arch}` };
  }

  const result = bootstrapStore({
    surfaceId: id.slice(WORKSPACE_ID_PREFIX.length),
    locator,
    serviceUid: process.getuid?.() ?? 0,
    forbiddenRoots: [],
    configurationVersion: CONFIGURATION_VERSION,
    limitProfile: {},
    workspaces: [{ workspaceId: id, root: canonical, artifactLocation }],
    hostLane,
    resolvers: {
      // Same host-observation seam as the WP-14A lane resolver (realpathSync);
      // inlined to avoid pulling the full lanes stack into the operator CLI.
      resolveRootPath: (p) => {
        try {
          return realpathSync(p);
        } catch {
          return null;
        }
      },
      resolveArtifactLocation: createOperatorArtifactLocationResolver(),
    },
    gitPath: GIT_PATH,
    gitHome,
    gitTmpdir: gitTmp,
  });
  if (!result.ok) {
    return { ok: false, message: `bootstrap failed: ${result.code}: ${result.message}` };
  }

  const registryPath = input.registryPath ?? defaultRegistryPath();
  const loaded = loadRegistry(registryPath);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  if (loaded.registry.projects.some((p) => p.id === id)) {
    return { ok: true, id, path: canonical, alreadyRegistered: true };
  }
  const saved = saveRegistry({ projects: [...loaded.registry.projects, { id, path: canonical }] }, registryPath);
  if (!saved.ok) return { ok: false, message: saved.message };
  return { ok: true, id, path: canonical, alreadyRegistered: false };
}
