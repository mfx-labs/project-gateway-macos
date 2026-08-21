/**
 * WP-14A / S2 — operator v2 + artifact-location + persist-path tests.
 *
 * Proves the operator runtime now produces a version-2 trusted workspace
 * configuration with a workspace-local `artifacts` artifact location, and
 * that the real operator composition path (`pgw add` → `deriveRuntimeSurface`
 * → `composeTrustedRegistry`) reaches `persist-artifact` WITHOUT the
 * TAD-002 configuration-version rejection, while version-1 configurations
 * remain rejected by the unweakened destination-containment gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addProject } from '../../src/operator/add.js';
import { loadRegistry } from '../../src/operator/registry.js';
import { deriveRuntimeSurface, CONFIGURATION_VERSION, ARTIFACT_DIR_NAME, deriveArtifactLocation } from '../../src/operator/surface.js';
import { createMcpPersistRegistry, type PersistLane } from '../../src/adapters/mcp/index.js';
import { createProspectiveDestinationResolver } from '../../src/runtime/mcp/lanes.js';
import { executeDraftFileWrite } from '../../src/writing/executor.js';
import {
  CAPABILITY_VOCABULARY_VERSION,
  TRUSTED_SOURCE_KIND,
  computeTrustedConfigurationIdentity,
  validateTrustedWorkspaceConfiguration,
  trustedHostLaneForPlatformArch,
  TRUSTED_CONFIGURATION_VERSION_2,
  evaluateProspectiveArtifactDestination,
} from '../../src/trusted/index.js';
import type { SurfaceConfig } from '../../src/runtime/mcp/config.js';
import { createOperatorArtifactLocationResolver } from '../../src/operator/surface.js';
import { parseRawJsonInput, computeArtifactDigest, createSchemaRegistry } from '../../src/api/validate.js';

const HOST_LANE = trustedHostLaneForPlatformArch(process.platform, process.arch);
const runnable = HOST_LANE !== null;

/** Strip `revision.digest` from a committed valid TaskSpec fixture (producer-derived digest rule). */
function taskSpecContent(): string {
  const model = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'artifacts', 'valid', 'task-minimal-genesis.json'), 'utf8')) as Record<string, unknown>;
  const revision = { ...(model['revision'] as Record<string, unknown>) };
  delete revision['digest'];
  return JSON.stringify({ ...model, revision });
}

test('operator: fresh project produces version-2 surface with artifact location', { skip: !runnable }, () => {
  const root = mkdtempSync(join(tmpdir(), 'pgw-opv2-'));
  try {
    const project = join(root, 'project');
    mkdirSync(project);
    const canonical = realpathSync(project);
    const registryPath = join(root, 'registry.json');
    const stateBase = join(root, 'state');

    const added = addProject({ path: project, registryPath, stateBase });
    assert.equal(added.ok, true);

    const loaded = loadRegistry(registryPath);
    assert.equal(loaded.ok, true);
    const regProject = loaded.registry.projects[0]!;
    assert.equal(regProject.id, added.id);
    assert.equal(regProject.path, canonical);

    const facts = deriveRuntimeSurface(regProject, stateBase);
    // Version-2 configuration with deterministic workspace-local artifact location.
    assert.equal(facts.configurationVersion, CONFIGURATION_VERSION);
    assert.equal(CONFIGURATION_VERSION, '2');
    assert.equal(facts.configurationVersion, TRUSTED_CONFIGURATION_VERSION_2);
    assert.equal(facts.artifactLocation, deriveArtifactLocation(canonical));
    assert.equal(facts.artifactLocation, join(canonical, ARTIFACT_DIR_NAME));
    // workspaceId/root unchanged (identity preservation).
    assert.equal(facts.workspaceId, added.id);
    assert.equal(facts.root, canonical);
    // artifact location provisioned as a real directory beneath the root.
    assert.equal(existsSync(facts.artifactLocation), true);
    // registry schema unchanged (id + path only).
    assert.deepEqual(Object.keys(regProject).sort(), ['id', 'path']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('operator: derived version-2 config validates and persists through the persist lane (no TAD-002)', { skip: !runnable }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pgw-opv2i-'));
  try {
    const project = join(root, 'project');
    mkdirSync(project);
    const canonical = realpathSync(project);
    const registryPath = join(root, 'registry.json');
    const stateBase = join(root, 'state');

    // Same operator path as `pgw add` (real store bootstrap, v2 config).
    const added = addProject({ path: project, registryPath, stateBase });
    assert.equal(added.ok, true, JSON.stringify(added));
    const loaded = loadRegistry(registryPath);
    assert.equal(loaded.ok, true);
    const facts = deriveRuntimeSurface(loaded.registry.projects[0]!, stateBase);

    // Same surface derivation as `pgw start` (start.ts): operator resolvers + v2 config.
    const hostLane = HOST_LANE!;
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
          try { return realpathSync(p); } catch { return null; }
        },
        resolveArtifactLocation: createOperatorArtifactLocationResolver(),
      },
    );
    assert.equal(validation.ok && validation.configuration !== undefined, true, 'operator v2 config validates');
    const config = validation.configuration!;
    assert.equal(config.configurationVersion, TRUSTED_CONFIGURATION_VERSION_2);
    const ws = config.workspaces.find((w) => w.workspaceId === facts.workspaceId);
    assert.ok(ws, 'workspace present');
    assert.ok(ws.artifactLocation, 'version-2 workspace carries artifactLocation');
    assert.equal(ws.artifactLocation, realpathSync(facts.artifactLocation));
    computeTrustedConfigurationIdentity(config).digest;

    // The exact WP-14A persist-lane composition (lanes.ts): genuine config +
    // real prospective-destination resolver + committed WP-11 executor.
    const lane: PersistLane = {
      configuration: config,
      resolveProspectiveDestination: createProspectiveDestinationResolver(),
      writeDraftFile: executeDraftFileWrite,
    };
    const registryResult = createMcpPersistRegistry({ registrations: [{ surfaceId: facts.surfaceId, schemaRegistry: createSchemaRegistry(), lane }] });
    assert.equal(registryResult.ok && registryResult.registry !== undefined, true, JSON.stringify(registryResult));
    const registry = registryResult.registry!;

    const content = taskSpecContent();
    const persist = registry.persist(facts.surfaceId, { workspaceId: facts.workspaceId, kind: 'TaskSpec', content });
    assert.equal(persist.ok, true, `persist must succeed (no TAD-002): ${JSON.stringify(persist)}`);
    assert.equal(persist.result.persisted.transition, 'missing-to-file');
    // Destination is under the configured artifact location (workspace-local artifacts/).
    const dest = join(facts.artifactLocation, persist.result.persisted.relativeDestination);
    assert.equal(existsSync(dest), true, 'persisted proposal file exists under artifact location');
    // Evidence digest equals the trusted digest over the producer content.
    const parsed = parseRawJsonInput(content, { subjectClass: 'artifact' });
    assert.equal(parsed.ok, true);
    assert.equal(persist.result.persisted.digest, computeArtifactDigest(parsed.model as Readonly<Record<string, unknown>>).digest);
    // Exactly one proposal file in artifacts/ (no leaks).
    assert.deepEqual(readdirSync(facts.artifactLocation).sort(), [persist.result.persisted.relativeDestination]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('operator: version-1 configuration presented directly to destination containment remains rejected (TAD-002 unchanged)', { skip: !runnable }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pgw-opv1-'));
  try {
    const project = join(root, 'project');
    mkdirSync(project);
    const canonical = realpathSync(project);
    const hostLane = HOST_LANE!;
    // Build a genuine version-1 configuration the way the pre-correction operator did.
    const v1 = validateTrustedWorkspaceConfiguration(
      {
        configurationVersion: '1',
        capabilityVocabularyVersion: CAPABILITY_VOCABULARY_VERSION,
        provenance: { sourceKind: TRUSTED_SOURCE_KIND },
        workspaces: [{ workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', root: canonical }],
      },
      { hostLane, resolveRootPath: (p) => { try { return realpathSync(p); } catch { return null; } } },
    );
    assert.equal(v1.ok && v1.configuration !== undefined, true);
    const config = v1.configuration!;
    assert.equal(config.configurationVersion, '1');

    // The unweakened destination-containment gate must still reject version 1.
    const report = evaluateProspectiveArtifactDestination(
      {
        expectedConfigurationIdentity: config.identity,
        workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa',
        artifactKind: 'TaskSpec',
        destination: 'TaskSpec.pgw:i:0000.pgw:r:0000.json',
      },
      {
        configuration: config,
        resolveProspectiveDestination: () => ({ ok: false, subject: 'resolution', code: 'error' }),
      },
    );
    assert.equal(report.ok, false);
    assert.ok(report.findings.some((f) => f.code === 'TAD-002'), 'TAD-002 explicitly emitted for version-1 config');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
