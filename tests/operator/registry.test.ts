/**
 * S2 — project registry persistence/validation tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, saveRegistry } from '../../src/operator/registry.js';

const ID = 'pgw:w:' + 'a'.repeat(32);

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'pgw-registry-'));
}

test('registry: missing file behaves as empty', () => {
  const dir = makeDir();
  const r = loadRegistry(join(dir, 'registry.json'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.registry.projects, []);
  rmSync(dir, { recursive: true, force: true });
});

test('registry: round-trip write/read', () => {
  const dir = makeDir();
  const path = join(dir, 'registry.json');
  const saved = saveRegistry({ projects: [{ id: ID, path: '/canonical/a' }] }, path);
  assert.equal(saved.ok, true);
  const loaded = loadRegistry(path);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.registry.projects, [{ id: ID, path: '/canonical/a' }]);
  // persisted document contains only {id, path}
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { projects: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(doc.projects[0]!).sort(), ['id', 'path']);
  rmSync(dir, { recursive: true, force: true });
});

test('registry: malformed JSON fails clearly', () => {
  const dir = makeDir();
  const path = join(dir, 'registry.json');
  writeFileSync(path, '{not json');
  const r = loadRegistry(path);
  assert.equal(r.ok, false);
  assert.match(r.message, /not valid JSON/);
  rmSync(dir, { recursive: true, force: true });
});

test('registry: malformed entries fail clearly', () => {
  const dir = makeDir();
  const path = join(dir, 'registry.json');
  // invalid id
  writeFileSync(path, JSON.stringify({ projects: [{ id: 'nope', path: '/x' }] }));
  const badId = loadRegistry(path);
  assert.equal(badId.ok, false);
  assert.match(badId.message, /valid workspace identifier/);
  // relative path
  writeFileSync(path, JSON.stringify({ projects: [{ id: ID, path: 'relative' }] }));
  const badPath = loadRegistry(path);
  assert.equal(badPath.ok, false);
  assert.match(badPath.message, /absolute path/);
  // non-object entry
  writeFileSync(path, JSON.stringify({ projects: ['x'] }));
  const badEntry = loadRegistry(path);
  assert.equal(badEntry.ok, false);
  assert.match(badEntry.message, /must be an object/);
  rmSync(dir, { recursive: true, force: true });
});

test('registry: atomic persistence leaves no temp file behind', () => {
  const dir = makeDir();
  const path = join(dir, 'sub', 'registry.json');
  const saved = saveRegistry({ projects: [] }, path);
  assert.equal(saved.ok, true);
  assert.equal(existsSync(path), true);
  assert.deepEqual(readdirSync(join(dir, 'sub')), ['registry.json']);
  rmSync(dir, { recursive: true, force: true });
});
