/**
 * S2 — fixed operator path roots tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultBinLink, defaultInstallRoot, defaultRegistryPath, defaultStateBase } from '../../src/operator/paths.js';

test('paths: registry/state use the fixed per-user layout', () => {
  assert.equal(defaultRegistryPath(), join(homedir(), '.config', 'project-gateway-macos', 'registry.json'));
  assert.equal(defaultStateBase(), join(homedir(), '.local', 'state', 'project-gateway-macos'));
});

test('paths: install root and bin link use the fixed per-user layout', () => {
  assert.equal(defaultInstallRoot(), join(homedir(), '.local', 'share', 'project-gateway-macos'));
  assert.equal(defaultBinLink(), join(homedir(), '.local', 'bin', 'pgw'));
});

test('paths: PGW_HOME has no effect on registry/state resolution', () => {
  const previous = process.env['PGW_HOME'];
  process.env['PGW_HOME'] = '/tmp/pgw-must-not-be-honored';
  try {
    const registry = defaultRegistryPath();
    const state = defaultStateBase();
    assert.equal(registry.includes('/tmp/pgw-must-not-be-honored'), false);
    assert.equal(state.includes('/tmp/pgw-must-not-be-honored'), false);
    assert.equal(registry, join(homedir(), '.config', 'project-gateway-macos', 'registry.json'));
    assert.equal(state, join(homedir(), '.local', 'state', 'project-gateway-macos'));
  } finally {
    if (previous === undefined) delete process.env['PGW_HOME'];
    else process.env['PGW_HOME'] = previous;
  }
});
