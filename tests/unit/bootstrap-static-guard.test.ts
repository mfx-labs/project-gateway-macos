/**
 * PS-1 — operator bootstrap boundary static guard.
 *
 * Proves the dedicated `src/bootstrap` module boundary (the operator-only
 * `project-gateway-macos-mcp bootstrap` verb):
 *   - no network, subprocess, tunnel, MCP SDK, or environment access;
 *   - no stdout writes other than the resolved-configuration document
 *     (bootstrap mode is NOT the MCP runtime; the runtime stdout invariant
 *     lives in tests/runtime/static-guard.test.ts for src/runtime/mcp);
 *   - filesystem access is restricted to the exact output-write discipline
 *     (bounded config reads flow through the accepted loader; the output
 *     write uses exact fd-bound APIs only) — no mkdir, no rm, no rename,
 *     no chmod, no generic writes;
 *   - the boundary composes the trusted control-plane bootstrap action and
 *     never mints provenance itself (creator localization stays in the
 *     control-plane producer, enforced by the storage static guard).
 *
 * This is the dedicated guard that justifies the `dist/bootstrap` boundary
 * exclusion in tests/security/security.test.ts (same pattern as the
 * runtime, writing, and completion boundaries).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const BOOTSTRAP_SRC = join(REPO, 'src', 'bootstrap');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...collectTsFiles(full));
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function rel(file: string): string {
  return file.slice(REPO.length + 1);
}

const bootstrapFiles = collectTsFiles(BOOTSTRAP_SRC);
assert.ok(bootstrapFiles.length >= 1, 'the bootstrap source tree must exist');

/** Exact node:fs named-import vocabulary permitted in the boundary. */
const FS_ALLOWLIST = new Set([
  'closeSync', 'fchmodSync', 'fsyncSync', 'linkSync', 'openSync', 'readFileSync', 'unlinkSync', 'writeSync',
]);

test('bootstrap static guard: no network, subprocess, tunnel, MCP SDK, environment, or time access', () => {
  for (const file of bootstrapFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of [
      'node:net', 'node:http', 'node:https', 'node:tls', 'node:dgram', 'node:child_process',
      'child_process', 'spawn(', 'exec(', 'fetch(', 'WebSocket', '@modelcontextprotocol',
      'tunnel', 'oauth', 'OAuth', 'process.env', 'Date.now(', 'Math.random', 'setTimeout', 'setInterval',
      'console.log', 'console.info', 'console.warn',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});

test('bootstrap static guard: filesystem access is the exact output-write discipline only', () => {
  for (const file of bootstrapFiles) {
    const content = readFileSync(file, 'utf8');
    assert.equal(content.includes('node:fs'), true, `${rel(file)} must import node:fs with exact named imports`);
    // Exact-name imports only, restricted to the allowlist.
    for (const m of content.matchAll(/import\s*\{([^}]+)\}\s*from\s*'node:fs'/g)) {
      for (const name of m[1]!.split(',').map((s) => s.trim()).filter((s) => s.length > 0)) {
        assert.ok(FS_ALLOWLIST.has(name), `${rel(file)} imports ${name} outside the output-write allowlist`);
      }
    }
    for (const forbidden of ['mkdirSync', 'rmSync', 'rmdirSync', 'renameSync', 'chmodSync', 'chownSync', 'writeFileSync', 'cpSync', 'symlinkSync', 'statSync', 'lstatSync', 'realpathSync', 'opendirSync', 'readdirSync']) {
      assert.equal(new RegExp(`\\b${forbidden}\\b`).test(content), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});

test('bootstrap static guard: composes the control-plane action and never mints provenance', () => {
  for (const file of bootstrapFiles) {
    const content = readFileSync(file, 'utf8');
    // The boundary is the operator CLI face of the trusted control-plane
    // bootstrap action; it must not mint branded material itself.
    for (const forbidden of [
      'createStorageBootstrapActionProvenance', 'createTrustedStorageBootstrapInput',
      'createInitializationCapability', 'markValidatedTrustedWorkspaceConfiguration', 'initializeTrustedStore',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
    // The runner must be present and must route through the action module.
    assert.equal(content.includes('bootstrapStore'), true, `${rel(file)} must compose the control-plane bootstrap action`);
    assert.equal(content.includes('loadBootstrapConfig'), true, `${rel(file)} must use the operator bootstrap config loader`);
    assert.equal(content.includes('runBootstrapCommand'), true, `${rel(file)} must export the operator command runner`);
  }
});
