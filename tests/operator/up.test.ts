/**
 * macOS — `pgw up` DI + subprocess tests (built `pgw` binary).
 *
 * Proves:
 *   - routing/usage/help behavior at the CLI level (unchanged accepted UX);
 *   - FAIL-CLOSED gates (platform, TTY, missing tunnel-client/profile/keychain);
 *   - correct foreground launch: `tunnel-client run --profile project-gateway`
 *     with CONTROL_PLANE_API_KEY delivered ONLY via the child environment;
 *   - exit/signal propagation and no `up`/`start` recursion;
 *   - the PRODUCTION dependency resolution is env-independent — the former
 *     PGW_UP_TUNNEL_CLIENT / PGW_UP_SECURITY / PGW_UP_PROFILE_DIR / PGW_UP_TTY
 *     overrides cannot influence production behavior or route the real
 *     credential to an arbitrary executable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const CLI_PATH = join(import.meta.dirname, '..', '..', '..', 'dist', 'operator', 'cli.js');
const UP_MOD_URL = pathToFileURL(join(import.meta.dirname, '..', '..', '..', 'dist', 'operator', 'up.js')).href;
const UP_SRC = join(import.meta.dirname, '..', '..', '..', 'src', 'operator', 'up.ts');
const COMMON_SCRIPT = join(import.meta.dirname, '..', '..', '..', 'scripts', 'tunnel-client-common.sh');

const upMod = await import(UP_MOD_URL);

const SECRET = 'sk-testsecret';

interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[], env?: Readonly<Record<string, string>>): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
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

function makeHome(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'pgw-up-')));
}

/** Temp home with (optional) installed tunnel-client + profile present. */
function buildHome(withTc: boolean, withProfile: boolean): string {
  const home = makeHome();
  if (withTc) mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  if (withProfile) mkdirSync(join(home, '.config', 'tunnel-client'), { recursive: true });
  if (withTc) writeFileSync(join(home, '.local', 'bin', 'tunnel-client'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  if (withProfile) writeFileSync(join(home, '.config', 'tunnel-client', 'project-gateway.yaml'), 'config_version: 1\n');
  return home;
}

type Rec = { cmd: string; args: string[]; env: NodeJS.ProcessEnv };

/** Build a fully-satisfied UpDependencies; spawn captures the child invocation. */
function readyDeps(overrides: Record<string, unknown> = {}): { rec: Rec; deps: Record<string, unknown> } {
  const rec: Rec = { cmd: '', args: [], env: {} };
  const base: Record<string, unknown> = {
    platform: 'darwin',
    isTTY: true,
    homeDir: '/home/user',
    tunnelClientPath: '/home/user/.local/bin/tunnel-client',
    securityPath: '/usr/bin/security',
    profilePath: '/home/user/.config/tunnel-client/project-gateway.yaml',
    readKeychain: () => SECRET,
    spawn: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => { rec.cmd = cmd; rec.args = args; rec.env = env; return { status: 0, signal: null }; },
  };
  return { rec, deps: { ...base, ...overrides } };
}

// ---- routing / help --------------------------------------------------------

test('up: pgw help exits 0 and distinguishes tunnel / up / start', async () => {
  const r = await runCli(['help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /start\s+start the low-level Gateway stdio MCP runtime/);
  assert.match(r.stdout, /up\s+start the configured tunnel \+ Gateway stack in the foreground/);
  assert.match(r.stdout, /tunnel\s+install\/configure the macOS tunnel workflow/);
  assert.match(r.stdout, /pgw tunnel/);
  assert.match(r.stdout, /pgw up/);
});

test('up: unexpected args exit 2', async () => {
  assert.equal((await runCli(['up', 'extra'])).code, 2);
  assert.equal((await runCli(['help', 'extra'])).code, 2);
  assert.equal((await runCli(['bogus'])).code, 2);
  assert.equal((await runCli([])).code, 2);
});

// ---- fail-closed gates (DI) ------------------------------------------------

test('up: rejects a non-interactive session (isTTY false)', async () => {
  const home = buildHome(true, true);
  const { deps } = readyDeps({ isTTY: false, homeDir: home, tunnelClientPath: join(home, '.local', 'bin', 'tunnel-client'), profilePath: join(home, '.config', 'tunnel-client', 'project-gateway.yaml') });
  const code = await upMod.runUp(deps);
  assert.equal(code, 2);
  rmSync(home, { recursive: true, force: true });
});

test('up: rejects a non-macOS platform', async () => {
  const code = await upMod.runUp({ platform: 'linux', isTTY: true, homeDir: '/x', tunnelClientPath: '/x/tc', securityPath: '/usr/bin/security', profilePath: '/x/p', readKeychain: () => SECRET, spawn: () => ({ status: 0, signal: null }) });
  assert.equal(code, 2);
});

test('up: missing tunnel-client fails with actionable setup guidance', async () => {
  const home = buildHome(false, true);
  const { deps } = readyDeps({ homeDir: home, tunnelClientPath: join(home, '.local', 'bin', 'tunnel-client'), profilePath: join(home, '.config', 'tunnel-client', 'project-gateway.yaml') });
  const code = await upMod.runUp(deps);
  assert.equal(code, 1);
  rmSync(home, { recursive: true, force: true });
});

test('up: missing profile fails with actionable setup guidance', async () => {
  const home = buildHome(true, false);
  const { deps } = readyDeps({ homeDir: home, tunnelClientPath: join(home, '.local', 'bin', 'tunnel-client'), profilePath: join(home, '.config', 'tunnel-client', 'project-gateway.yaml') });
  const code = await upMod.runUp(deps);
  assert.equal(code, 1);
  rmSync(home, { recursive: true, force: true });
});

test('up: missing Keychain credential fails', async () => {
  const code = await upMod.runUp({ platform: 'darwin', isTTY: true, homeDir: '/x', tunnelClientPath: '/x/tc', securityPath: '/usr/bin/security', profilePath: '/x/p', readKeychain: () => null, spawn: () => ({ status: 0, signal: null }) });
  assert.equal(code, 1);
});

test('up: empty Keychain credential fails', async () => {
  const code = await upMod.runUp({ platform: 'darwin', isTTY: true, homeDir: '/x', tunnelClientPath: '/x/tc', securityPath: '/usr/bin/security', profilePath: '/x/p', readKeychain: () => '', spawn: () => ({ status: 0, signal: null }) });
  assert.equal(code, 1);
});

// ---- launch / secret / exit semantics (DI) ---------------------------------

test('up: launches tunnel-client run --profile project-gateway; secret only in child env', async () => {
  const home = buildHome(true, true);
  const { rec, deps } = readyDeps({
    homeDir: home,
    tunnelClientPath: join(home, '.local', 'bin', 'tunnel-client'),
    profilePath: join(home, '.config', 'tunnel-client', 'project-gateway.yaml'),
  });
  const code = await upMod.runUp(deps);
  assert.equal(code, 0);
  assert.deepEqual(rec.args, ['run', '--profile', 'project-gateway']);
  assert.equal(rec.cmd, join(home, '.local', 'bin', 'tunnel-client'));
  assert.equal(rec.env.CONTROL_PLANE_API_KEY, SECRET);
  // the secret must never appear in diagnostics (none written on success) nor
  // be placed anywhere except the child environment object we captured.
  assert.equal(Object.values(rec.env).some((v) => typeof v === 'string' && v.includes(SECRET)), true, 'secret present in env');
  assert.equal(rec.args.some((a) => a.includes(SECRET)), false, 'secret never in argv');
  rmSync(home, { recursive: true, force: true });
});

test('up: propagates the tunnel-client exit code', async () => {
  const home = buildHome(true, true);
  const { deps } = readyDeps({ homeDir: home, tunnelClientPath: join(home, '.local', 'bin', 'tunnel-client'), profilePath: join(home, '.config', 'tunnel-client', 'project-gateway.yaml'), spawn: () => ({ status: 7, signal: null }) });
  const code = await upMod.runUp(deps);
  assert.equal(code, 7);
  rmSync(home, { recursive: true, force: true });
});

test('up: signal termination returns non-zero truthfully', async () => {
  const home = buildHome(true, true);
  const { deps } = readyDeps({ homeDir: home, tunnelClientPath: join(home, '.local', 'bin', 'tunnel-client'), profilePath: join(home, '.config', 'tunnel-client', 'project-gateway.yaml'), spawn: () => ({ status: null, signal: 'SIGTERM' }) });
  const code = await upMod.runUp(deps);
  assert.equal(code, 1);
  rmSync(home, { recursive: true, force: true });
});

test('up: never invokes pgw up / pgw start itself (recursion-free)', async () => {
  const home = buildHome(true, true);
  const { rec, deps } = readyDeps({ homeDir: home, tunnelClientPath: join(home, '.local', 'bin', 'tunnel-client'), profilePath: join(home, '.config', 'tunnel-client', 'project-gateway.yaml') });
  await upMod.runUp(deps);
  assert.equal(rec.args[0], 'run');
  assert.notEqual(rec.args[0], 'up');
  assert.notEqual(rec.args[0], 'start');
  rmSync(home, { recursive: true, force: true });
});

// ---- production entry ignores former PGW_UP_* overrides --------------------

test('up: production deps are env-independent (PGW_UP_* ignored)', async () => {
  const realHome = homedir();
  const home = makeHome();
  process.env.PGW_UP_TUNNEL_CLIENT = '/tmp/fake/tc';
  process.env.PGW_UP_SECURITY = '/tmp/fake/sec';
  process.env.PGW_UP_PROFILE_DIR = '/tmp/fake/profiles';
  process.env.XDG_CONFIG_HOME = join(home, 'xdg');
  try {
    const deps = upMod.productionUpDeps();
    // Executable path derives from the real homedir, not PGW_UP_TUNNEL_CLIENT.
    assert.equal(deps.tunnelClientPath, join(realHome, '.local', 'bin', 'tunnel-client'));
    // Trusted system executable, not PGW_UP_SECURITY.
    assert.equal(deps.securityPath, '/usr/bin/security');
    // Profile honors the legitimate XDG_CONFIG_HOME but ignores PGW_UP_PROFILE_DIR.
    assert.equal(deps.profilePath, join(home, 'xdg', 'tunnel-client', 'project-gateway.yaml'));
    assert.equal(deps.isTTY === true || deps.isTTY === false, true);
  } finally {
    delete process.env.PGW_UP_TUNNEL_CLIENT;
    delete process.env.PGW_UP_SECURITY;
    delete process.env.PGW_UP_PROFILE_DIR;
    delete process.env.XDG_CONFIG_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('up: production entry ignores PGW_UP_TTY + executable overrides (no fake runs)', async () => {
  const home = makeHome();
  const marker = join(home, 'ran-marker');
  // Place a marker script at the fake override path; it must never execute.
  writeFileSync(join(home, 'fake-tc'), `#!/usr/bin/env bash\necho EVIL > "${marker}"\n`, { mode: 0o755 });
  // Production `pgw up` in a non-TTY pipe must return the TTY gate (2) and
  // prove PGW_UP_TTY=1 no longer bypasses it, so the override executable never
  // runs and can never receive CONTROL_PLANE_API_KEY.
  const r = await runCli(['up'], {
    PGW_UP_TTY: '1',
    PGW_UP_TUNNEL_CLIENT: join(home, 'fake-tc'),
    PGW_UP_SECURITY: join(home, 'fake-tc'),
    PGW_UP_PROFILE_DIR: join(home, 'profiles'),
    HOME: home,
  });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /interactive Terminal/);
  assert.equal(existsSync(marker), false, 'override fake executable must never run');
  rmSync(home, { recursive: true, force: true });
});

test('up: source contains no dev path, no workspace, no autostart, no PGW_UP_*/PGW_TUNNEL_PKG_ROOT', () => {
  const src = readFileSync(UP_SRC, 'utf8');
  assert.equal(src.includes('/Users/serene'), false);
  assert.equal(src.includes('/serene'), false);
  assert.equal(src.includes('pgw:w:'), false);
  for (const tok of ['PGW_UP_', 'PGW_TUNNEL_PKG_ROOT', 'launchctl', 'nohup', 'disown', 'daemon', 'LaunchAgent']) {
    assert.equal(src.includes(tok), false, `up.ts must not contain '${tok}'`);
  }
});

test('up: pgw start remains the low-level stdio runtime (does not start the tunnel)', async () => {
  const home = makeHome();
  const r = await runCli(['start'], { HOME: home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no registered projects/);
  assert.equal(r.stderr.includes('tunnel'), false);
  rmSync(home, { recursive: true, force: true });
});

test('up: common helper does not expose SECURITY_BIN env override', () => {
  const common = readFileSync(COMMON_SCRIPT, 'utf8');
  assert.equal(common.includes('${SECURITY_BIN'), false);
  assert.equal(common.includes('SECURITY_BIN="/usr/bin/security"'), true);
});
