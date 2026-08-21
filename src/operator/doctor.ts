/**
 * S3 — `pgw doctor`.
 *
 * Read-only: answers only whether the current registered configuration can
 * reasonably start. Never bootstraps, initializes, repairs, migrates, or
 * mutates anything. Store readiness is verified read-only via
 * `verifyStoreInstance` after deriving the configuration identity through the
 * same pure validation/identity primitives the bootstrap action uses
 * (`bootstrapStore` itself is never invoked).
 */
import { realpathSync, statSync } from 'node:fs';
import { loadRegistry } from './registry.js';
import { deriveRuntimeSurface, GIT_PATH, createOperatorArtifactLocationResolver } from './surface.js';
import {
  CAPABILITY_VOCABULARY_VERSION,
  TRUSTED_SOURCE_KIND,
  computeTrustedConfigurationIdentity,
  validateTrustedWorkspaceConfiguration,
  trustedHostLaneForPlatformArch,
} from '../trusted/index.js';
import { verifyStoreInstance } from '../storage/read/read-record.js';
import { initializeGitHostLane } from '../git/host-lane.js';

/** Minimal semver-style triple comparison for `>=22.0.0`. */
export function versionAtLeast(version: string, minimum: readonly [number, number, number]): boolean {
  const parts = version.split('.').map((p) => Number(p));
  for (let i = 0; i < 3; i++) {
    const a = parts[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

const NODE_MINIMUM = [22, 0, 0] as const;

function report(status: 'PASS' | 'FAIL', message: string): void {
  process.stdout.write(`[${status}] ${message}\n`);
}

export async function runDoctor(): Promise<number> {
  let failed = false;
  const fail = (message: string): void => {
    failed = true;
    report('FAIL', message);
  };

  // A. host lane
  const hostLane = trustedHostLaneForPlatformArch(process.platform, process.arch);
  if (hostLane === null) {
    fail(`host: unsupported platform/architecture ${process.platform} ${process.arch}`);
  } else {
    report('PASS', `host lane ${hostLane}`);
  }

  // B. node
  if (versionAtLeast(process.versions.node, NODE_MINIMUM)) {
    report('PASS', `node v${process.versions.node} (>=22.0.0)`);
  } else {
    fail(`node v${process.versions.node} is below the required >=22.0.0`);
  }

  // C. git binary + minimum version (existing host-lane primitive)
  const git = await initializeGitHostLane(GIT_PATH);
  if (git.ok) {
    report('PASS', `git ${GIT_PATH} ${git.descriptor.version} (>=2.30.0)`);
  } else {
    fail(`git ${GIT_PATH}: ${git.error.code}`);
  }

  // D. registry
  const loaded = loadRegistry();
  if (!loaded.ok) {
    fail(`registry: ${loaded.message}`);
    return 1;
  }
  if (loaded.registry.projects.length === 0) {
    fail('registry: no registered projects (pgw start requires at least one)');
    return 1;
  }
  report('PASS', `registry ${loaded.registry.projects.length} project(s)`);

  // E/F. per project
  for (const project of loaded.registry.projects) {
    const facts = deriveRuntimeSurface(project);

    // E. registered root still exists and is a directory
    let rootOk = false;
    try {
      rootOk = statSync(project.path).isDirectory();
    } catch {
      rootOk = false;
    }
    if (!rootOk) {
      fail(`project ${project.id}: root is missing or not a directory: ${project.path}`);
      continue;
    }

    // F. read-only store verification (identity derived without bootstrapStore)
    if (hostLane === null) continue;
    const validation = validateTrustedWorkspaceConfiguration(
      {
        configurationVersion: facts.configurationVersion,
        capabilityVocabularyVersion: CAPABILITY_VOCABULARY_VERSION,
        provenance: { sourceKind: TRUSTED_SOURCE_KIND },
        workspaces: [{ workspaceId: facts.workspaceId, root: facts.root, artifactLocation: facts.artifactLocation }],
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
        resolveArtifactLocation: createOperatorArtifactLocationResolver(),
      },
    );
    if (!validation.ok || validation.configuration === undefined) {
      fail(`project ${project.id}: configuration validation failed: ${validation.findings[0]?.code ?? 'unknown'}`);
      continue;
    }
    let identity: string;
    try {
      identity = computeTrustedConfigurationIdentity(validation.configuration).digest;
    } catch {
      fail(`project ${project.id}: configuration identity derivation failed`);
      continue;
    }
    const verified = verifyStoreInstance({
      locator: facts.locator,
      serviceUid: facts.serviceUid,
      forbiddenRoots: [],
      configurationIdentity: identity,
      configurationVersion: facts.configurationVersion,
      limitProfile: {},
    });
    if (verified.ok) {
      report('PASS', `project ${project.id} store verified`);
    } else {
      fail(`project ${project.id}: store verification failed: ${verified.code ?? 'ERR-STO-INTEGRITY'}`);
    }
  }

  return failed ? 1 : 0;
}
