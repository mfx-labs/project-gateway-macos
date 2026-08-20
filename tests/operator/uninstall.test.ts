/**
 * S4 — `uninstall` tests (in-process, isolated temp roots).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uninstall } from '../../src/operator/uninstall.js';

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'pgw-uninstall-'));
}

test('uninstall: removes install root and CLI link, preserves registry and state', () => {
  const root = makeRoot();
  const installRoot = join(root, 'install');
  const binLink = join(root, 'bin', 'pgw');
  const registry = join(root, 'registry.json');
  const state = join(root, 'state');

  // simulate an installed runtime + operator link
  mkdirSync(join(installRoot, 'current', 'bin'), { recursive: true });
  writeFileSync(join(installRoot, 'current', 'bin', 'pgw'), '#!/bin/sh\nexit 0\n');
  mkdirSync(join(root, 'bin'), { recursive: true });
  symlinkSync(join(installRoot, 'current', 'bin', 'pgw'), binLink);
  // user state that must survive
  writeFileSync(registry, '{}\n');
  mkdirSync(join(state, 'project'), { recursive: true });

  const result = uninstall({ installRoot, binLink });
  assert.equal(result.ok, true);
  assert.equal(existsSync(installRoot), false);
  assert.equal(existsSync(binLink), false);
  assert.equal(existsSync(registry), true);
  assert.equal(existsSync(join(state, 'project')), true);
  rmSync(root, { recursive: true, force: true });
});

test('uninstall: idempotent second run does not fail or recreate anything', () => {
  const root = makeRoot();
  const installRoot = join(root, 'install');
  const binLink = join(root, 'bin', 'pgw');
  mkdirSync(join(root, 'bin'), { recursive: true });

  const first = uninstall({ installRoot, binLink });
  assert.equal(first.ok, true);
  const second = uninstall({ installRoot, binLink });
  assert.equal(second.ok, true);

  assert.equal(existsSync(installRoot), false);
  assert.equal(existsSync(binLink), false);
  // no new state created under the bin dir
  assert.deepEqual(readdirSync(join(root, 'bin')), []);
  rmSync(root, { recursive: true, force: true });
});

test('uninstall: unrelated regular file at the bin-link path is preserved', () => {
  const root = makeRoot();
  const installRoot = join(root, 'install');
  const binLink = join(root, 'bin', 'pgw');
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(binLink, 'unrelated-content');

  const result = uninstall({ installRoot, binLink });
  assert.equal(result.ok, true);
  assert.equal(result.preservedBinLink, true);
  assert.equal(existsSync(binLink), true);
  assert.equal(readFileSync(binLink, 'utf8'), 'unrelated-content');
  assert.equal(existsSync(installRoot), false);
  rmSync(root, { recursive: true, force: true });
});

test('uninstall: unrelated symlink at the bin-link path is preserved', () => {
  const root = makeRoot();
  const installRoot = join(root, 'install');
  const binLink = join(root, 'bin', 'pgw');
  mkdirSync(join(root, 'bin'), { recursive: true });
  const otherTarget = join(root, 'other-tool');
  writeFileSync(otherTarget, 'x');
  symlinkSync(otherTarget, binLink);

  const result = uninstall({ installRoot, binLink });
  assert.equal(result.ok, true);
  assert.equal(result.preservedBinLink, true);
  assert.equal(lstatSync(binLink).isSymbolicLink(), true);
  assert.equal(readlinkSync(binLink), otherTarget);
  assert.equal(readFileSync(otherTarget, 'utf8'), 'x');
  assert.equal(existsSync(installRoot), false);
  rmSync(root, { recursive: true, force: true });
});
