/**
 * S3 — shared deterministic runtime-surface derivation (start/doctor).
 *
 * Derives the same fixed per-project runtime facts from a registry entry that
 * `add` provisions: store locator, Git lane dirs, surface id, fixed
 * configuration version, Git path. In-memory only — never persisted, never
 * added to registry.json, never written to runtime.json.
 */
import { join } from 'node:path';
import { WORKSPACE_ID_PREFIX } from '../trusted/workspace-id.js';
import { defaultStateBase } from './paths.js';
import type { RegistryProject } from './registry.js';

/** Fixed trusted-configuration version used by the operator bootstrap. */
export const CONFIGURATION_VERSION = '1';
/** Default Git binary path (operator-owned lane fact). */
export const GIT_PATH = '/usr/bin/git';

export interface RuntimeSurfaceFacts {
  readonly surfaceId: string;
  readonly workspaceId: string;
  readonly root: string;
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
    locator: join(stateBase, project.id, 'store'),
    gitHome: join(stateBase, project.id, 'git-home'),
    gitTmp: join(stateBase, project.id, 'git-tmp'),
    gitPath: GIT_PATH,
    configurationVersion: CONFIGURATION_VERSION,
    serviceUid: process.getuid?.() ?? 0,
  };
}
