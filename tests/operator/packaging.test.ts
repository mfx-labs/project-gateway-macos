/**
 * S4 — distributable packaging tests.
 *
 * Verifies per-architecture tarball contents and SHA-256 sidecar. Does not
 * require physical arm64 execution: only artifact assembly/selection evidence.
 * Builds into an isolated temp output dir so concurrent test files never
 * contend over the same artifact paths.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const BUILDER = join(ROOT, 'scripts', 'build-distributable.mjs');

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

let outDir = '';

before(() => {
  outDir = mkdtempSync(join(tmpdir(), 'pgw-pack-'));
});

after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function build(arch: string): void {
  const r = spawnSync(process.execPath, [BUILDER, arch, outDir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `build-distributable ${arch} failed:\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
}

function entriesOf(arch: string): { readonly name: string; readonly entries: string[] } {
  const name = `project-gateway-macos-${version.version}-darwin-${arch}.tar.gz`;
  const list = spawnSync('/usr/bin/tar', ['-tzf', join(outDir, name)], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  const entries = list.stdout
    .split('\n')
    .map((e) => e.replace(/^\.\//, ''))
    .filter((e) => e !== '' && e !== '.');
  return { name, entries };
}

function has(entries: readonly string[], suffix: string): boolean {
  return entries.includes(suffix);
}

test('packaging: x64 artifact contains the x64 addon and required entries, not arm64', () => {
  build('x64');
  const { name, entries } = entriesOf('x64');
  for (const required of [
    'package.json',
    'bin/pgw',
    'bin/project-gateway-macos-mcp',
    'native/index.mjs',
    'native/darwin-x64/gateway_fs.node',
    'dist/operator/cli.js',
  ]) {
    assert.ok(has(entries, required), `missing ${required}`);
  }
  assert.ok(!has(entries, 'native/darwin-arm64/gateway_fs.node'), 'x64 artifact must not bundle the arm64 addon');

  const sidecar = readFileSync(join(outDir, `${name}.sha256`), 'utf8');
  const hex = sidecar.match(/[0-9a-f]{64}/)?.[0];
  assert.ok(hex, 'sidecar missing digest');
  const actual = createHash('sha256').update(readFileSync(join(outDir, name))).digest('hex');
  assert.equal(hex, actual);
});

test('packaging: arm64 artifact contains the arm64 addon, not x64', () => {
  build('arm64');
  const { entries } = entriesOf('arm64');
  assert.ok(has(entries, 'native/darwin-arm64/gateway_fs.node'), 'arm64 artifact missing the arm64 addon');
  assert.ok(!has(entries, 'native/darwin-x64/gateway_fs.node'), 'arm64 artifact must not bundle the x64 addon');
});
