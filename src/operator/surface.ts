/**
 * S3 — shared deterministic runtime-surface derivation (start/doctor).
 *
 * Derives the same fixed per-project runtime facts from a registry entry that
 * `add` provisions: store locator, Git lane dirs, surface id, fixed
 * configuration version, artifact location, Git path. In-memory only — never
 * persisted, never added to registry.json, never written to runtime.json.
 *
 * CONFIGURATION VERSION 2 (operator): the operator runtime produces a
 * version-2 trusted workspace configuration with a per-workspace artifact
 * location, matching the accepted controlled-persistence contract
 * (WP-6 Phase 2B-P / WP-11): `evaluateProspectiveArtifactDestination` accepts
 * only `TRUSTED_CONFIGURATION_VERSION_2` (TAD-002) and `persist-artifact`
 * requires a configured `artifactLocation` (TAD-004). The operator surface
 * consequently derives a deterministic workspace-local `artifacts`
 * directory — the same convention the accepted mac2f/mac3e/wp14b acceptance
 * tests use (`artifactRoot = join(workspaceRoot, 'artifacts')`).
 */
import { realpathSync, lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ID_PREFIX } from '../trusted/workspace-id.js';
import type { ArtifactLocationResolution } from '../trusted/index.js';
import { defaultStateBase } from './paths.js';
import type { RegistryProject } from './registry.js';

/** Fixed trusted-configuration version used by the operator bootstrap: version 2 (TAD-002-compatible). */
export const CONFIGURATION_VERSION = '2';
/** Default Git binary path (operator-owned lane fact). */
export const GIT_PATH = '/usr/bin/git';
/** Accepted workspace-local artifact directory name (mac2f/mac3e/wp14b convention). */
export const ARTIFACT_DIR_NAME = 'artifacts';

/** Deterministic artifact location for a registered project root (a strict descendant of the root). */
export function deriveArtifactLocation(root: string): string {
  return join(root, ARTIFACT_DIR_NAME);
}

/** Real artifact-location resolver (operator-owned host observation seam). */
export function createOperatorArtifactLocationResolver(): (absolutePath: string) => ArtifactLocationResolution {
  return (absolutePath: string): ArtifactLocationResolution => {
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(absolutePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ELOOP') return { ok: false, code: 'loop' };
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'inaccessible' };
      return { ok: false, code: 'not-found' };
    }
    if (st.isSymbolicLink()) {
      let resolved: string;
      try {
        resolved = realpathSync(absolutePath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ELOOP') return { ok: false, code: 'loop' };
        return { ok: false, code: 'not-found' };
      }
      let target: ReturnType<typeof statSync>;
      try {
        target = statSync(resolved);
      } catch {
        return { ok: false, code: 'not-found' };
      }
      if (!target.isDirectory()) return { ok: false, code: 'unsupported-entry-kind' };
      return { ok: true, canonicalPath: resolved, entryKind: 'directory' };
    }
    if (!st.isDirectory()) return { ok: false, code: 'unsupported-entry-kind' };
    try {
      return { ok: true, canonicalPath: realpathSync(absolutePath), entryKind: 'directory' };
    } catch {
      return { ok: false, code: 'error' };
    }
  };
}

export interface RuntimeSurfaceFacts {
  readonly surfaceId: string;
  readonly workspaceId: string;
  readonly root: string;
  /** Deterministic version-2 artifact location (workspace-local `artifacts` directory). */
  readonly artifactLocation: string;
  readonly locator: string;
  readonly gitHome: string;
  readonly gitTmp: string;
  readonly gitPath: string;
  readonly configurationVersion: string;
  readonly serviceUid: number;
}

export function deriveRuntimeSurface(project: RegistryProject, stateBase: string = defaultStateBase()): RuntimeSurfaceFacts {
  return {
    surfaceId: project.id.slice(WORKSPACE_ID_PREFIX.length),
    workspaceId: project.id,
    root: project.path,
    artifactLocation: deriveArtifactLocation(project.path),
    locator: join(stateBase, project.id, 'store'),
    gitHome: join(stateBase, project.id, 'git-home'),
    gitTmp: join(stateBase, project.id, 'git-tmp'),
    gitPath: GIT_PATH,
    configurationVersion: CONFIGURATION_VERSION,
    serviceUid: process.getuid?.() ?? 0,
  };
}
