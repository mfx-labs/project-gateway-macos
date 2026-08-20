/**
 * S4 — standalone installer + installed `pgw uninstall` tests.
 *
 * All cases run against an isolated temporary HOME so no real user install,
 * registry, store, or configuration is ever touched.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const INSTALLER = join(ROOT, 'scripts', 'install.mjs');
const BUILDER = join(ROOT, 'scripts', 'build-distributable.mjs');
const TAR = '/usr/bin/tar';

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

let x64Tarball = '';
let x64Sidecar = '';
let buildDir = '';

before(() => {
  buildDir = mkdtempSync(join(tmpdir(), 'pgw-install-build-'));
  const r = spawnSync(process.execPath, [BUILDER, 'x64', buildDir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `build failed:\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  x64Tarball = join(buildDir, `project-gateway-macos-${version.version}-darwin-x64.tar.gz`);
  x64Sidecar = `${x64Tarball}.sha256`;
});

after(() => {
  rmSync(buildDir, { recursive: true, force: true });
});

function makeHome(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'pgw-install-')));
}

function runInstaller(home: string, args: readonly string[]) {
  return spawnSync(process.execPath, [INSTALLER, ...args], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' });
}

/** Build a tiny synthetic tarball (named for `arch`) from a set of rel-path -> content entries. */
function makeTinyTarball(home: string, arch: string, entries: Readonly<Record<string, string>>) {
  const dir = mkdtempSync(join(home, `tiny-${arch}-`));
  for (const [rel, content] of Object.entries(entries)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, { mode: rel.startsWith('bin/') ? 0o755 : 0o644 });
  }
  const name = `project-gateway-macos-0.0.0-darwin-${arch}.tar.gz`;
  const tarball = join(home, name);
  const t = spawnSync(TAR, ['-czf', tarball, '-C', dir, '.'], { stdio: 'pipe' });
  assert.equal(t.status, 0, t.stderr?.toString());
  rmSync(dir, { recursive: true, force: true });
  const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');
  const sidecar = join(home, `${name}.sha256`);
  writeFileSync(sidecar, `${digest}  ${name}\n`);
  return { tarball, sidecar };
}

test('install: successful install from a valid artifact', () => {
  const home = makeHome();
  const r = runInstaller(home, [x64Tarball, x64Sidecar]);
  assert.equal(r.status, 0, r.stderr);

  const installRoot = join(home, '.local', 'share', 'project-gateway-macos');
  const link = join(home, '.local', 'bin', 'pgw');
  assert.equal(existsSync(join(installRoot, 'current', 'package.json')), true);
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(readlinkSync(link), join(installRoot, 'current', 'bin', 'pgw'));

  const v = spawnSync(link, ['--version'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /^pgw /);
  rmSync(home, { recursive: true, force: true });
});

test('install: digest mismatch fails and leaves the previous install untouched', () => {
  const home = makeHome();
  let r = runInstaller(home, [x64Tarball, x64Sidecar]);
  assert.equal(r.status, 0, r.stderr);

  const installRoot = join(home, '.local', 'share', 'project-gateway-macos');
  const link = join(home, '.local', 'bin', 'pgw');
  const before = readlinkSync(link);

  const badSidecar = join(home, 'bad.sha256');
  writeFileSync(badSidecar, `${'0'.repeat(64)}  whatever.tar.gz\n`);
  r = runInstaller(home, [x64Tarball, badSidecar]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /digest mismatch/);
  assert.equal(existsSync(join(installRoot, 'current', 'package.json')), true);
  assert.equal(readlinkSync(link), before);
  rmSync(home, { recursive: true, force: true });
});

test('install: staging smoke failure leaves the previous install untouched and cleans staging', () => {
  const home = makeHome();
  let r = runInstaller(home, [x64Tarball, x64Sidecar]);
  assert.equal(r.status, 0, r.stderr);

  const installRoot = join(home, '.local', 'share', 'project-gateway-macos');

  // Passes the required-entry check, but bin/pgw exits non-zero → smoke fails.
  const bad = makeTinyTarball(home, 'x64', {
    'package.json': '{"version":"0.0.0","imports":{}}\n',
    'bin/pgw': '#!/bin/sh\nexit 3\n',
    'bin/project-gateway-macos-mcp': '#!/bin/sh\nexit 0\n',
    'dist/operator/cli.js': '// placeholder\n',
    'native/darwin-x64/gateway_fs.node': 'placeholder',
  });

  r = runInstaller(home, [bad.tarball, bad.sidecar]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /smoke test failed/);

  // previous install intact; staging removed
  assert.equal(existsSync(join(installRoot, 'current', 'package.json')), true);
  assert.deepEqual(readdirSync(installRoot), ['current']);
  rmSync(home, { recursive: true, force: true });
});

test('install: reinstall replaces current without a multi-version tree', () => {
  const home = makeHome();
  let r = runInstaller(home, [x64Tarball, x64Sidecar]);
  assert.equal(r.status, 0, r.stderr);
  r = runInstaller(home, [x64Tarball, x64Sidecar]);
  assert.equal(r.status, 0, r.stderr);

  const installRoot = join(home, '.local', 'share', 'project-gateway-macos');
  assert.deepEqual(readdirSync(installRoot).sort(), ['current']);
  assert.equal(existsSync(join(installRoot, 'current', 'package.json')), true);
  assert.equal(readlinkSync(join(home, '.local', 'bin', 'pgw')), join(installRoot, 'current', 'bin', 'pgw'));
  const v = spawnSync(join(home, '.local', 'bin', 'pgw'), ['--version'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(v.status, 0, v.stderr);
  rmSync(home, { recursive: true, force: true });
});

test('install: unrelated regular file at pgw fails closed and preserves it + current', () => {
  const home = makeHome();
  let r = runInstaller(home, [x64Tarball, x64Sidecar]);
  assert.equal(r.status, 0, r.stderr);

  const installRoot = join(home, '.local', 'share', 'project-gateway-macos');
  const link = join(home, '.local', 'bin', 'pgw');
  const currentBefore = readFileSync(join(installRoot, 'current', 'package.json'), 'utf8');

  // replace the Gateway-owned symlink with an unrelated regular file
  unlinkSync(link);
  writeFileSync(link, 'unrelated-content');

  r = runInstaller(home, [x64Tarball, x64Sidecar]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not the Gateway-owned symlink/);
  assert.equal(readFileSync(link, 'utf8'), 'unrelated-content');
  assert.equal(readFileSync(join(installRoot, 'current', 'package.json'), 'utf8'), currentBefore);
  rmSync(home, { recursive: true, force: true });
});

test('install: unrelated symlink at pgw fails closed and preserves it + current', () => {
  const home = makeHome();
  let r = runInstaller(home, [x64Tarball, x64Sidecar]);
  assert.equal(r.status, 0, r.stderr);

  const installRoot = join(home, '.local', 'share', 'project-gateway-macos');
  const link = join(home, '.local', 'bin', 'pgw');
  const unrelatedTarget = join(home, 'some-other-tool');
  writeFileSync(unrelatedTarget, 'x');
  const currentBefore = readFileSync(join(installRoot, 'current', 'package.json'), 'utf8');

  unlinkSync(link);
  symlinkSync(unrelatedTarget, link);

  r = runInstaller(home, [x64Tarball, x64Sidecar]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not the Gateway-owned symlink/);
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(readlinkSync(link), unrelatedTarget);
  assert.equal(readFileSync(unrelatedTarget, 'utf8'), 'x');
  assert.equal(readFileSync(join(installRoot, 'current', 'package.json'), 'utf8'), currentBefore);
  rmSync(home, { recursive: true, force: true });
});

test('install: wrong-architecture artifact fails closed before activation', () => {
  const home = makeHome();
  const bad = makeTinyTarball(home, 'arm64', { 'package.json': '{}\n' });
  const r = runInstaller(home, [bad.tarball, bad.sidecar]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not match this host architecture/);
  assert.equal(existsSync(join(home, '.local', 'share', 'project-gateway-macos')), false);
  assert.equal(existsSync(join(home, '.local', 'bin', 'pgw')), false);
  rmSync(home, { recursive: true, force: true });
});

test('uninstall (installed): removes runtime and link, preserves registry and state', () => {
  const home = makeHome();
  let r = runInstaller(home, [x64Tarball, x64Sidecar]);
  assert.equal(r.status, 0, r.stderr);

  const link = join(home, '.local', 'bin', 'pgw');
  // simulate a real user: registry + gateway state that must survive
  mkdirSync(join(home, '.config', 'project-gateway-macos'), { recursive: true });
  writeFileSync(join(home, '.config', 'project-gateway-macos', 'registry.json'), '{}\n');
  mkdirSync(join(home, '.local', 'state', 'project-gateway-macos', 'somestore'), { recursive: true });

  r = spawnSync(link, ['uninstall'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /uninstalled/);

  assert.equal(existsSync(join(home, '.local', 'share', 'project-gateway-macos')), false);
  assert.equal(existsSync(link), false);
  assert.equal(existsSync(join(home, '.config', 'project-gateway-macos', 'registry.json')), true);
  assert.equal(existsSync(join(home, '.local', 'state', 'project-gateway-macos', 'somestore')), true);
  rmSync(home, { recursive: true, force: true });
});
