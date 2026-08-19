/**
 * S2 — `remove` tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeProject } from '../../src/operator/remove.js';
import { loadRegistry, saveRegistry } from '../../src/operator/registry.js';

const ID_A = 'pgw:w:' + 'a'.repeat(32);
const ID_B = 'pgw:w:' + 'b'.repeat(32);

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'pgw-remove-'));
}

test('remove: by id removes exactly one entry', () => {
  const dir = makeDir();
  const path = join(dir, 'registry.json');
  saveRegistry({ projects: [{ id: ID_A, path: '/a' }, { id: ID_B, path: '/b' }] }, path);
  const result = removeProject({ selector: ID_A, registryPath: path });
  assert.equal(result.ok, true);
  assert.equal(result.removedId, ID_A);
  const loaded = loadRegistry(path);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.registry.projects, [{ id: ID_B, path: '/b' }]);
  rmSync(dir, { recursive: true, force: true });
});

test('remove: by canonical path removes the matching entry', () => {
  const dir = makeDir();
  const real = join(dir, 'project');
  mkdirSync(real);
  const canonical = realpathSync(real);
  const path = join(dir, 'registry.json');
  saveRegistry({ projects: [{ id: ID_A, path: canonical }] }, path);
  // Pass the non-canonical spelling; removeProject canonicalizes and matches.
  const result = removeProject({ selector: real, registryPath: path });
  assert.equal(result.ok, true);
  assert.equal(result.removedId, ID_A);
  const loaded = loadRegistry(path);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.registry.projects, []);
  rmSync(dir, { recursive: true, force: true });
});

test('remove: unknown project returns a clear not-found result', () => {
  const dir = makeDir();
  const path = join(dir, 'registry.json');
  saveRegistry({ projects: [] }, path);
  const result = removeProject({ selector: ID_A, registryPath: path });
  assert.equal(result.ok, false);
  assert.match(result.message, /not found/);
  rmSync(dir, { recursive: true, force: true });
});

test('remove: deregistration only — store/state remains present', () => {
  const dir = makeDir();
  const path = join(dir, 'registry.json');
  const store = join(dir, 'store');
  const gitHome = join(dir, 'git-home');
  mkdirSync(store, { recursive: true });
  mkdirSync(gitHome, { recursive: true });
  saveRegistry({ projects: [{ id: ID_A, path: '/a' }] }, path);

  const result = removeProject({ selector: ID_A, registryPath: path });
  assert.equal(result.ok, true);
  // registry empty
  const loaded = loadRegistry(path);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.registry.projects, []);
  // store/state untouched
  assert.equal(existsSync(store), true);
  assert.equal(existsSync(gitHome), true);
  rmSync(dir, { recursive: true, force: true });
});

test('remove: stale registration can be removed by its recorded path', () => {
  const dir = makeDir();
  const project = join(dir, 'project');
  mkdirSync(project);
  const canonical = realpathSync(project);
  const path = join(dir, 'registry.json');
  const store = join(dir, 'state', 'store');
  mkdirSync(store, { recursive: true });
  saveRegistry({ projects: [{ id: ID_A, path: canonical }] }, path);

  // Delete the project directory so realpathSync(selector) fails; the
  // recorded canonical path string must still match (S2-REV-002).
  rmSync(project, { recursive: true, force: true });
  const result = removeProject({ selector: canonical, registryPath: path });
  assert.equal(result.ok, true);
  assert.equal(result.removedId, ID_A);

  const loaded = loadRegistry(path);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.registry.projects, []);
  // preserved Gateway state/store remains untouched
  assert.equal(existsSync(store), true);
  rmSync(dir, { recursive: true, force: true });
});
