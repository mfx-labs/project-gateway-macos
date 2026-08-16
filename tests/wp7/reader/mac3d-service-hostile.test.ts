/**
 * MAC-3D — reader hostile verification, SERVICE layer (real Intel
 * filesystem; deterministic structural sequencing only).
 *
 * Evidence class: B — structural descriptor-first sequencing. Churn is
 * installed either between two service operations (root-cache divergence)
 * or as a single-shot side effect inside the host-owned existing-path
 * resolver that runs during containment (decision evidence obtained
 * FIRST, then the lexical state is replaced, then the descriptor-relative
 * open). No reader seam exists (accepted design) and none is added; no
 * sleeps, no retries, no scheduler dependence.
 *
 * Rows covered (MAC-3A §20):
 *   - W-R9 (RACE-I01, I09): the cached root descriptor keeps authority
 *     over the ORIGINAL tree, while the containment decision re-resolves
 *     the pathname into the decoy root — the S-07 bind detects the
 *     dev/ino divergence and the service fails closed with the exact
 *     `ERR-CON-DENIED` mapping (reads AND directory listing).
 *   - W-R4 (RACE-I09): the identical bindDescriptor path and the exact
 *     service-level `ERR-CON-DENIED` mapping required by the accepted
 *     contract (post-open mismatch is the fail-closed boundary).
 *   - W-R3 (RACE-I03): a final-component symlink substitution between the
 *     containment decision and the descriptor open fails closed at the
 *     service surface with the exact `ERR-NOT-FOUND` code.
 *   - W-R1 (RACE-I09): accepted bind-time semantics at the service
 *     surface — a different regular file bound at decision time reads the
 *     bind-time object (the pre-open residual race is NOT claimed
 *     atomic); a directory at the target fails with the exact
 *     `ERR-FTYPE-UNSUPPORTED` code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createWp7Fixture, WORKSPACE_ALPHA, type Wp7Fixture } from '../helpers.js';
import { WorkspaceInspectionService } from '../../../src/reader/service.js';
import type { OperationResult } from '../../../src/reader/types.js';
import type { ExistingPathResolver } from '../../../src/trusted/index.js';

const NO_CTRL = {};

const fixtures: Wp7Fixture[] = [];
function newFixture(): Wp7Fixture {
  const fixture = createWp7Fixture();
  fixtures.push(fixture);
  return fixture;
}

test.after(() => {
  for (const fixture of fixtures) {
    try {
      fixture.cleanup();
    } catch {
      // best-effort fixture cleanup
    }
  }
});

function serviceFor(fixture: Wp7Fixture): WorkspaceInspectionService {
  return new WorkspaceInspectionService({
    configuration: fixture.configuration,
    resolveExistingPath: fixture.resolveExistingPath,
  });
}

function failCode(result: OperationResult): string {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('unreachable');
  return result.failure.code;
}

/**
 * Single-shot churn inside the host-owned resolver: the containment
 * decision evidence is obtained from the ORIGINAL state FIRST, then the
 * churn runs exactly once, then the descriptor-relative open observes the
 * replaced state. Deterministic B-type sequencing, no timing.
 */
function churningResolver(fixture: Wp7Fixture, churn: () => void): ExistingPathResolver {
  let done = false;
  return (p: string) => {
    const r = fixture.resolveExistingPath(p);
    if (!done) {
      done = true;
      churn();
    }
    return r;
  };
}

// ─────────────── W-R9 — root-cache divergence: service-level ERR-CON-DENIED ───────────────

test('mac3d W-R9 service: cached root fd keeps the original tree; the re-resolved decision sees the decoy root — exact ERR-CON-DENIED (read)', async () => {
  const fixture = newFixture();
  const service = serviceFor(fixture);
  try {
    // Warm the root cache with a successful read.
    const warm = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      NO_CTRL,
    );
    assert.equal(warm.ok, true, 'root cache warmed by the first read');

    // Root churn: the original tree is renamed away; a decoy tree with the
    // SAME layout (different bytes) takes the root pathname.
    const moved = `${fixture.root}-moved`;
    fs.renameSync(fixture.root, moved);
    fs.mkdirSync(fixture.root, { recursive: true });
    fs.mkdirSync(path.join(fixture.root, 'docs'));
    fs.writeFileSync(path.join(fixture.root, 'docs', 'notes.md'), 'DECOY-ROOT-CONTENT\n');

    // The containment decision re-resolves the pathname into the DECOY
    // root; the descent runs through the RETAINED original root fd; S-07
    // detects the dev/ino divergence and fails closed.
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      NO_CTRL,
    );
    assert.equal(failCode(r), 'ERR-CON-DENIED', 'post-open identity divergence maps to the exact service code');
    assert.equal(fs.readFileSync(path.join(moved, 'docs', 'notes.md'), 'utf8'), 'hello world\n', 'original object byte-identical');
    assert.equal(fs.readFileSync(path.join(fixture.root, 'docs', 'notes.md'), 'utf8'), 'DECOY-ROOT-CONTENT\n', 'decoy byte-identical — never adopted');
  } finally {
    await service.dispose().catch(() => {});
    fixture.cleanup();
  }
});

test('mac3d W-R9 service: root-cache divergence fails closed for directory listing — exact ERR-CON-DENIED', async () => {
  const fixture = newFixture();
  const service = serviceFor(fixture);
  try {
    const warm = await service.listDirectory(
      { operation: 'list-directory', workspaceId: WORKSPACE_ALPHA, path: 'docs' },
      NO_CTRL,
    );
    assert.equal(warm.ok, true, 'root cache warmed by the first listing');

    const moved = `${fixture.root}-moved`;
    fs.renameSync(fixture.root, moved);
    fs.mkdirSync(fixture.root, { recursive: true });
    fs.mkdirSync(path.join(fixture.root, 'docs'));
    fs.writeFileSync(path.join(fixture.root, 'docs', 'decoy-notes.md'), 'x');

    const r = await service.listDirectory(
      { operation: 'list-directory', workspaceId: WORKSPACE_ALPHA, path: 'docs' },
      NO_CTRL,
    );
    assert.equal(failCode(r), 'ERR-CON-DENIED', 'listing identity divergence maps to the exact service code');
    const originalEntries = fs.readdirSync(path.join(moved, 'docs')).sort();
    assert.ok(originalEntries.includes('notes.md'), 'original directory intact');
    assert.deepEqual(fs.readdirSync(path.join(fixture.root, 'docs')), ['decoy-notes.md'], 'decoy directory untouched — never enumerated');
  } finally {
    await service.dispose().catch(() => {});
    fixture.cleanup();
  }
});

// ─────────────── W-R3 — final symlink substitution between decision and open ───────────────

test('mac3d W-R3 service: a symlink planted between the containment decision and the open fails closed — exact ERR-NOT-FOUND', async () => {
  const fixture = newFixture();
  const decoyFile = path.join(fixture.root, 'decoy-target.txt');
  fs.writeFileSync(decoyFile, 'DECOY-BYTES');
  const target = path.join(fixture.root, 'docs', 'notes.md');
  const service = new WorkspaceInspectionService({
    configuration: fixture.configuration,
    resolveExistingPath: churningResolver(fixture, () => {
      // The decision evidence was already taken on the ORIGINAL file;
      // the final component is now substituted by a symlink.
      fs.rmSync(target);
      fs.symlinkSync(decoyFile, target);
    }),
  });
  try {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      NO_CTRL,
    );
    assert.equal(failCode(r), 'ERR-NOT-FOUND', 'final-component symlink substitution fails closed in the accepted vocabulary');
    assert.equal(fs.readlinkSync(target), decoyFile, 'symlink untouched');
    assert.equal(fs.readFileSync(decoyFile, 'utf8'), 'DECOY-BYTES', 'decoy never read');
  } finally {
    await service.dispose().catch(() => {});
    fixture.cleanup();
  }
});

// ─────────── W-R1 — accepted bind-time semantics at the service surface ───────────

test('mac3d W-R1 service: a different regular file bound at decision time reads the bind-time object (accepted semantics LOCK)', async () => {
  const fixture = newFixture();
  const target = path.join(fixture.root, 'docs', 'notes.md');
  const service = new WorkspaceInspectionService({
    configuration: fixture.configuration,
    resolveExistingPath: churningResolver(fixture, () => {
      // Decision evidence taken on the ORIGINAL file; the same pathname
      // now holds a DIFFERENT regular file. The accepted contract does not
      // claim the pre-open window atomic: the descent binds the bind-time
      // object at the accepted pathname (Linux-identical semantics).
      fs.rmSync(target);
      fs.writeFileSync(target, 'BIND-TIME-CONTENT\n');
    }),
  });
  try {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      NO_CTRL,
    );
    assert.equal(r.ok, true, 'the bind-time regular file is read (decision-time pathname semantics)');
    if (r.ok) {
      const v = r.value as { text: string };
      assert.equal(v.text, 'BIND-TIME-CONTENT\n', 'exactly the bind-time object content is returned');
    }
  } finally {
    await service.dispose().catch(() => {});
    fixture.cleanup();
  }
});

test('mac3d W-R1 service: a directory at the target between decision and open fails closed — exact ERR-FTYPE-UNSUPPORTED', async () => {
  const fixture = newFixture();
  const target = path.join(fixture.root, 'docs', 'notes.md');
  const service = new WorkspaceInspectionService({
    configuration: fixture.configuration,
    resolveExistingPath: churningResolver(fixture, () => {
      fs.rmSync(target);
      fs.mkdirSync(target);
    }),
  });
  try {
    const r = await service.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'docs/notes.md' },
      NO_CTRL,
    );
    assert.equal(failCode(r), 'ERR-FTYPE-UNSUPPORTED', 'directory target fails the inherited type gate at the service surface');
    assert.equal(fs.lstatSync(target).isDirectory(), true, 'directory untouched');
  } finally {
    await service.dispose().catch(() => {});
    fixture.cleanup();
  }
});
