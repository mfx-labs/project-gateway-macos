/**
 * S2 — `add` tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addProject } from '../../src/operator/add.js';
import { loadRegistry } from '../../src/operator/registry.js';
import { projectIdFromPath } from '../../src/operator/project-id.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'pgw-add-'));
}

test('add: valid directory bootstraps a store and registers the project', () => {
  const root = makeDir();
  const project = join(root, 'project');
  mkdirSync(project);
  const canonical = realpathSync(project);
  const id = projectIdFromPath(canonical);
  const registryPath = join(root, 'registry.json');
  const stateBase = join(root, 'state');

  const result = addProject({ path: project, registryPath, stateBase });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyRegistered, false);
  assert.equal(result.id, id);

  const loaded = loadRegistry(registryPath);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.registry.projects, [{ id, path: canonical }]);

  assert.equal(existsSync(join(stateBase, id, 'store', 'config-v1')), true);
  assert.equal(existsSync(join(stateBase, id, 'store', 'store-v1')), true);
  assert.equal(existsSync(join(stateBase, id, 'git-home')), true);
  assert.equal(existsSync(join(stateBase, id, 'git-tmp')), true);
  rmSync(root, { recursive: true, force: true });
});

test('add: second add of the same project is idempotent (no duplicate)', () => {
  const root = makeDir();
  const project = join(root, 'project');
  mkdirSync(project);
  const registryPath = join(root, 'registry.json');
  const stateBase = join(root, 'state');

  const first = addProject({ path: project, registryPath, stateBase });
  assert.equal(first.ok, true);
  assert.equal(first.alreadyRegistered, false);
  const second = addProject({ path: project, registryPath, stateBase });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyRegistered, true);

  const loaded = loadRegistry(registryPath);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.registry.projects.length, 1);
  rmSync(root, { recursive: true, force: true });
});

test('add: missing path fails and does not append registration', () => {
  const root = makeDir();
  const registryPath = join(root, 'registry.json');
  const result = addProject({ path: join(root, 'missing'), registryPath, stateBase: join(root, 'state') });
  assert.equal(result.ok, false);
  assert.match(result.message, /does not exist/);
  const loaded = loadRegistry(registryPath);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.registry.projects, []);
  rmSync(root, { recursive: true, force: true });
});

test('add: non-directory path fails and does not append registration', () => {
  const root = makeDir();
  const file = join(root, 'file');
  writeFileSync(file, 'x');
  const registryPath = join(root, 'registry.json');
  const result = addProject({ path: file, registryPath, stateBase: join(root, 'state') });
  assert.equal(result.ok, false);
  assert.match(result.message, /not a directory/);
  const loaded = loadRegistry(registryPath);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.registry.projects, []);
  rmSync(root, { recursive: true, force: true });
});

test('add: failed bootstrap does not append registration', () => {
  const root = makeDir();
  const project = join(root, 'project');
  mkdirSync(project);
  const canonical = realpathSync(project);
  const id = projectIdFromPath(canonical);
  const registryPath = join(root, 'registry.json');
  const stateBase = join(root, 'state');

  // Pre-create the store locator as a symlink: mkdirSync (recursive) treats
  // it as present, then the storage engine rejects the symlink trusted parent
  // (ERR-STO-ROOT-INVALID), so bootstrap fails before any registration.
  const realStore = join(stateBase, id, 'real-store');
  mkdirSync(realStore, { recursive: true, mode: 0o700 });
  symlinkSync(realStore, join(stateBase, id, 'store'));

  const result = addProject({ path: project, registryPath, stateBase });
  assert.equal(result.ok, false);
  assert.match(result.message, /bootstrap failed/);

  const loaded = loadRegistry(registryPath);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.registry.projects, []);
  rmSync(root, { recursive: true, force: true });
});
