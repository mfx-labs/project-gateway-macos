/**
 * macOS — `pgw tunnel` subprocess + direct-module tests (built `pgw` binary).
 *
 * Proves:
 *   - `pgw tunnel` routes to the packaged setup helper and propagates its exit
 *     code (via the injected dependency seam and the production CLI);
 *   - the PRODUCTION package root is derived from the installed package and
 *     ignores the former PGW_TUNNEL_PKG_ROOT environment override;
 *   - missing packaged helpers fail clearly;
 *   - `pgw tunnel` never launches `pgw up`/`pgw start` itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const CLI_PATH = join(import.meta.dirname, '..', '..', '..', 'dist', 'operator', 'cli.js');
const TUNNEL_MOD_URL = pathToFileURL(join(import.meta.dirname, '..', '..', '..', 'dist', 'operator', 'tunnel.js')).href;
const TUNNEL_SRC = join(import.meta.dirname, '..', '..', '..', 'src', 'operator', 'tunnel.ts');
const COMMON_SCRIPT = join(import.meta.dirname, '..', '..', '..', 'scripts', 'tunnel-client-common.sh');

const tunnelMod = await import(TUNNEL_MOD_URL);

interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[], env: Readonly<Record<string, string>> = {}, cwd?: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function makeDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'pgw-tunnel-')));
}

/** Fabricate a package root containing a setup helper stub. */
function fakePackage(root: string, setupBody: string, withCommon = true): void {
  const scripts = join(root, 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'setup-tunnel-client-macos.sh'), setupBody, { mode: 0o755 });
  if (withCommon) writeFileSync(join(scripts, 'tunnel-client-common.sh'), '#!/usr/bin/env bash\n', { mode: 0o644 });
}

// ---- dependency-injection behavior (deep-module seam) ---------------------

test('tunnel: routes to the injected setup helper (exit 0)', async () => {
  const pkg = makeDir();
  const log = join(pkg, 'log');
  fakePackage(join(pkg, 'pkg'), `#!/usr/bin/env bash\necho RAN > "${log}"\nexit 0\n`);
  const code = await tunnelMod.runTunnel({
    packageRoot: join(pkg, 'pkg'),
    spawnSetup: (bin: string) => spawnSync('bash', [bin], { stdio: 'inherit' }),
  });
  assert.equal(code, 0);
  assert.equal(readFileSync(log, 'utf8').trim(), 'RAN');
  rmSync(pkg, { recursive: true, force: true });
});

test('tunnel: propagates the setup helper exit code', async () => {
  const pkg = makeDir();
  fakePackage(join(pkg, 'pkg'), '#!/usr/bin/env bash\nexit 9\n');
  const code = await tunnelMod.runTunnel({
    packageRoot: join(pkg, 'pkg'),
    spawnSetup: (bin: string) => spawnSync('bash', [bin], { stdio: 'ignore' }),
  });
  assert.equal(code, 9);
  rmSync(pkg, { recursive: true, force: true });
});

test('tunnel: missing packaged helper fails clearly (exit 1)', async () => {
  const pkg = makeDir();
  mkdirSync(join(pkg, 'pkg', 'scripts'), { recursive: true }); // no setup script
  const code = await tunnelMod.runTunnel({
    packageRoot: join(pkg, 'pkg'),
    spawnSetup: () => ({ status: 0, signal: null }),
  });
  assert.equal(code, 1);
  rmSync(pkg, { recursive: true, force: true });
});

test('tunnel: extra operand exits 2 (usage)', async () => {
  const r = await runCli(['tunnel', 'x']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: pgw tunnel/);
});

test('tunnel: never launches pgw up / pgw start (static: only the setup helper is spawned)', () => {
  const src = readFileSync(TUNNEL_SRC, 'utf8');
  // The only spawnSync target is the packaged setup helper (`bash`).
  const spawns = [...src.matchAll(/spawnSync\('([^']+)'/g)].map((m) => m[1]!);
  assert.deepEqual(spawns, ['bash']);
  assert.equal(src.includes('run --profile'), false);
});

// ---- production entry ignores the former override -------------------------

test('tunnel: production package root ignores PGW_TUNNEL_PKG_ROOT', async () => {
  const realRoot = join(import.meta.dirname, '..', '..', '..');
  process.env.PGW_TUNNEL_PKG_ROOT = '/tmp/evil/pkg';
  try {
    const deps = tunnelMod.productionTunnelDeps();
    assert.equal(deps.packageRoot.includes('/tmp/evil'), false);
    // Production root must be the real derived package root (repo root here).
    assert.equal(realpathSync(deps.packageRoot), realpathSync(realRoot));
  } finally {
    delete process.env.PGW_TUNNEL_PKG_ROOT;
  }
});

test('tunnel: production entry ignores PGW_TUNNEL_PKG_ROOT (marker never runs)', async () => {
  const pkg = makeDir();
  const marker = join(pkg, 'marker');
  // Fake package the override would otherwise point at.
  fakePackage(join(pkg, 'evil'), `#!/usr/bin/env bash\necho EVIL > "${marker}"\nexit 0\n`);
  const home = makeDir(); // no pgw in this HOME → real setup fails fast at the pgw gate
  const r = await runCli(['tunnel'], {
    PGW_TUNNEL_PKG_ROOT: join(pkg, 'evil'),
    HOME: home,
  });
  assert.equal(existsSync(marker), false, 'evil package helper must never run');
  assert.notEqual(r.code, 0);
  // Real installed helper ran and failed because pgw is not installed there.
  assert.match(r.stderr, /pgw not found/);
  rmSync(pkg, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('tunnel: common helper no longer exposes env origin/checksum overrides', () => {
  const common = readFileSync(COMMON_SCRIPT, 'utf8');
  assert.equal(common.includes('TUNNEL_CLIENT_URL_BASE'), false);
  assert.equal(common.includes('TC_SHA_DARWIN'), false);
  assert.equal(common.includes('${SECURITY_BIN:-'), false);
});
