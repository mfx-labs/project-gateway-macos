/**
 * S2 — `list` tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProjects } from '../../src/operator/list.js';
import { saveRegistry } from '../../src/operator/registry.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'pgw-list-'));
}

test('list: empty registry returns no projects', () => {
  const dir = makeDir();
  const result = listProjects(join(dir, 'registry.json'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.projects, []);
  rmSync(dir, { recursive: true, force: true });
});

test('list: returns registered projects', () => {
  const dir = makeDir();
  const path = join(dir, 'registry.json');
  const projects = [
    { id: 'pgw:w:' + 'a'.repeat(32), path: '/a' },
    { id: 'pgw:w:' + 'b'.repeat(32), path: '/b' },
  ];
  assert.equal(saveRegistry({ projects }, path).ok, true);
  const result = listProjects(path);
  assert.equal(result.ok, true);
  assert.deepEqual(result.projects, projects);
  rmSync(dir, { recursive: true, force: true });
});
