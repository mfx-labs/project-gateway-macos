/**
 * PS-1 — operator bootstrap CLI tests (subprocess, built CLI).
 *
 * Proves `project-gateway-macos-mcp bootstrap`:
 *   - exact CLI surface (success, replay, malformed operands fail closed);
 *   - bootstrap mode never starts the stdio MCP server and emits no MCP
 *     protocol data;
 *   - runtime mode is unchanged (strict `--config` only) and accepts the
 *     bootstrap-produced runtime configuration;
 *   - `--output` semantics: deterministic bytes, exact 0600, atomic
 *     no-clobber (identical content is an idempotent no-op; different
 *     content is a typed conflict), no provenance/authority serialization;
 *   - stdout JSON composition behavior when `--output` is omitted;
 *   - fail-closed operator configuration (both load profiles);
 *   - store fail-closed states surfaced as typed diagnostics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, readFileSync, statSync, existsSync, readdirSync, mkdirSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadRuntimeConfig, loadBootstrapConfig } from '../../src/runtime/mcp/config.js';
import { writeOutputFile } from '../../src/bootstrap/run.js';

const CLI_PATH = join(import.meta.dirname, '..', '..', '..', 'dist', 'runtime', 'mcp', 'cli.js');
const SERVER_SRC = join(import.meta.dirname, '..', '..', '..', 'src', 'runtime', 'mcp', 'server.ts');
const SHA256_RE = /^sha-256:[0-9a-f]{64}$/;

function makeEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps1-bootstrap-cli-'));
  chmodSync(dir, 0o700);
  return dir;
}

/**
 * The trusted parent (locator) must ALREADY exist as an operator-owned 0700
 * directory (the storage engine never creates parents; pi-shuttle `project
 * add` provisions it). The bootstrap CLI fails closed on an absent parent.
 */
function makeLocator(env: string): string {
  const locator = join(env, 'store');
  mkdirSync(locator, { mode: 0o700 });
  chmodSync(locator, 0o700);
  return locator;
}

function runCli(args: readonly string[], input?: string): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

function bootstrapConfig(locator: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    surfaces: [
      {
        surfaceId: 'main',
        locator,
        configurationVersion: '2',
        ...overrides,
      },
    ],
  };
}

function writeConfig(env: string, doc: unknown): string {
  const path = join(env, 'bootstrap-config.json');
  writeFileSync(path, JSON.stringify(doc), { mode: 0o600 });
  return path;
}

test('bootstrap CLI: successful bootstrap writes the resolved runtime config atomically with exact 0600', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const output = join(env, 'runtime.json');
  const configPath = writeConfig(env, bootstrapConfig(locator));
  const run = await runCli(['bootstrap', '--config', configPath, '--output', output]);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, '', 'with --output, stdout must stay empty (no MCP protocol data, no stray output)');
  assert.ok(run.stderr.includes('INITIALIZED'), run.stderr);
  const mode = statSync(output).mode & 0o777;
  assert.equal(mode, 0o600, 'resolved runtime config must be 0600');
  const doc = JSON.parse(readFileSync(output, 'utf8')) as { surfaces: Array<Record<string, unknown>> };
  assert.equal(doc.surfaces.length, 1);
  const surface = doc.surfaces[0]!;
  assert.equal(surface.surfaceId, 'main');
  assert.equal(surface.locator, locator);
  assert.equal(typeof surface.configurationIdentity, 'string');
  assert.equal(SHA256_RE.test(surface.configurationIdentity as string), true);
  // The output is a complete runtime config document: strict startup
  // validation accepts it unchanged.
  const loaded = loadRuntimeConfig(output);
  assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.message);
  // The store exists with exactly the fixed bootstrap entries.
  assert.deepEqual(readdirSync(join(locator, 'store-v1')).sort(), ['metadata', 'tmp']);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: output is deterministic (byte-identical across runs)', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const configPath = writeConfig(env, bootstrapConfig(locator));
  const out1 = join(env, 'runtime-1.json');
  const out2 = join(env, 'runtime-2.json');
  const run1 = await runCli(['bootstrap', '--config', configPath, '--output', out1]);
  const run2 = await runCli(['bootstrap', '--config', configPath, '--output', out2]);
  assert.equal(run1.code, 0, run1.stderr);
  assert.equal(run2.code, 0, run2.stderr);
  assert.deepEqual(readFileSync(out1), readFileSync(out2), 'resolved documents must be byte-deterministic');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: exact replay is an idempotent no-op on an identical output file', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const output = join(env, 'runtime.json');
  const configPath = writeConfig(env, bootstrapConfig(locator));
  const run1 = await runCli(['bootstrap', '--config', configPath, '--output', output]);
  assert.equal(run1.code, 0, run1.stderr);
  const before = statSync(output).mtimeMs;
  const run2 = await runCli(['bootstrap', '--config', configPath, '--output', output]);
  assert.equal(run2.code, 0, run2.stderr);
  const after = statSync(output).mtimeMs;
  assert.equal(after, before, 'identical output must be a no-op (not rewritten)');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: conflicting existing output fails closed (ERR-BOOT-OUTPUT-CONFLICT)', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const output = join(env, 'runtime.json');
  const configPath = writeConfig(env, bootstrapConfig(locator));
  writeFileSync(output, '{"surfaces":[]}', { mode: 0o600 });
  const run = await runCli(['bootstrap', '--config', configPath, '--output', output]);
  assert.equal(run.code, 1);
  assert.ok(run.stderr.includes('ERR-BOOT-OUTPUT-CONFLICT'), run.stderr);
  assert.equal(readFileSync(output, 'utf8'), '{"surfaces":[]}', 'conflicting output must never be overwritten');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: without --output, stdout carries the resolved JSON document (composition behavior)', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const configPath = writeConfig(env, bootstrapConfig(locator));
  const run = await runCli(['bootstrap', '--config', configPath]);
  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.stderr.includes('INITIALIZED'), run.stderr);
  assert.equal(run.stdout.includes('jsonrpc'), false, 'no MCP protocol data may be emitted');
  const doc = JSON.parse(run.stdout) as { surfaces: Array<Record<string, unknown>> };
  assert.equal(doc.surfaces[0]?.surfaceId, 'main');
  // The stdout document is a complete runtime config too.
  const stdoutPath = join(env, 'runtime-stdout.json');
  writeFileSync(stdoutPath, run.stdout, { mode: 0o600 });
  const loaded = loadRuntimeConfig(stdoutPath);
  assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.message);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: no provenance or authority-bearing values are serialized', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const output = join(env, 'runtime.json');
  const configPath = writeConfig(env, bootstrapConfig(locator));
  const run = await runCli(['bootstrap', '--config', configPath, '--output', output]);
  assert.equal(run.code, 0, run.stderr);
  const content = readFileSync(output, 'utf8');
  assert.equal(content.includes('actionIdentity'), false);
  assert.equal(content.includes('"provenance"'), false);
  assert.equal(content.includes('WeakSet'), false);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: identity conflict fails closed and creates no store', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const configPath = writeConfig(env, bootstrapConfig(locator, { configurationIdentity: 'sha-256:' + 'c'.repeat(64) }));
  const run = await runCli(['bootstrap', '--config', configPath]);
  assert.equal(run.code, 1);
  assert.ok(run.stderr.includes('ERR-BOOT-IDENTITY-CONFLICT'), run.stderr);
  assert.equal(existsSync(join(locator, 'store-v1')), false, 'no store may be created on identity conflict');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: re-bootstrap with the resolved identity replays successfully (pi-shuttle flow)', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const output = join(env, 'runtime.json');
  const configPath = writeConfig(env, bootstrapConfig(locator));
  const run1 = await runCli(['bootstrap', '--config', configPath, '--output', output]);
  assert.equal(run1.code, 0, run1.stderr);
  // Feed the resolved document back as the bootstrap config (identity now present).
  const run2 = await runCli(['bootstrap', '--config', output]);
  assert.equal(run2.code, 0, run2.stderr);
  const doc = JSON.parse(run2.stdout) as { surfaces: Array<{ configurationIdentity: string }> };
  assert.equal(SHA256_RE.test(doc.surfaces[0]!.configurationIdentity), true);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: partial store fails closed with the typed storage code', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const configPath = writeConfig(env, bootstrapConfig(locator));
  assert.equal((await runCli(['bootstrap', '--config', configPath])).code, 0);
  rmSync(join(locator, 'config-v1'), { recursive: true, force: true });
  const run = await runCli(['bootstrap', '--config', configPath]);
  assert.equal(run.code, 1);
  assert.ok(run.stderr.includes('ERR-STO-RECOVERY-REQUIRED'), run.stderr);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: wrong namespace mode fails closed with a typed storage code', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const configPath = writeConfig(env, bootstrapConfig(locator));
  assert.equal((await runCli(['bootstrap', '--config', configPath])).code, 0);
  chmodSync(join(locator, 'store-v1'), 0o755);
  const run = await runCli(['bootstrap', '--config', configPath]);
  assert.equal(run.code, 1);
  assert.ok(run.stderr.includes('ERR-STO-'), run.stderr);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: malformed and unknown operands fail closed (exit 2)', async () => {
  const env = makeEnv();
  const configPath = writeConfig(env, bootstrapConfig(join(env, 'store')));
  for (const args of [
    ['bootstrap'],
    ['bootstrap', '--config'],
    ['bootstrap', '--config', ''],
    ['bootstrap', '--config', configPath, 'extra'],
    ['bootstrap', '--output', join(env, 'o.json'), '--config', configPath],
    ['bootstrap', '--config', configPath, '--output'],
    ['--config'],
  ]) {
    const run = await runCli(args);
    assert.equal(run.code, 2, `args ${JSON.stringify(args)} must fail closed with exit 2`);
  }
  const help = await runCli(['bootstrap', '--help']);
  assert.equal(help.code, 0, 'bootstrap --help prints usage and exits 0');
  assert.ok(help.stderr.includes('usage:'), help.stderr);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: invalid operator configuration documents fail closed (exit 1)', async () => {
  const env = makeEnv();
  const locator = join(env, 'store');
  const cases: Array<{ readonly name: string; readonly doc: unknown }> = [
    { name: 'not-json', doc: '{invalid' },
    { name: 'unknown-top-level', doc: { surfaces: [], extra: true } },
    { name: 'missing-surfaces', doc: {} },
    { name: 'duplicate-surface', doc: { surfaces: [{ surfaceId: 'main', locator, configurationVersion: '2' }, { surfaceId: 'main', locator, configurationVersion: '2' }] } },
    { name: 'unknown-surface-field', doc: { surfaces: [{ surfaceId: 'main', locator, configurationVersion: '2', authority: 'x' }] } },
    { name: 'malformed-identity', doc: { surfaces: [{ surfaceId: 'main', locator, configurationVersion: '2', configurationIdentity: 'not-a-digest' }] } },
    { name: 'bad-locator', doc: { surfaces: [{ surfaceId: 'main', locator: 'relative', configurationVersion: '2' }] } },
  ];
  for (const c of cases) {
    const configPath = writeConfig(env, c.doc);
    const run = await runCli(['bootstrap', '--config', configPath]);
    assert.equal(run.code, 1, `${c.name}: bootstrap must fail closed`);
    assert.ok(run.stderr.length > 0, `${c.name}: typed diagnostic required`);
  }
  assert.equal(existsSync(join(locator, 'store-v1')), false, 'no store may be created from invalid configs');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: normal startup validation still REQUIRES configurationIdentity', async () => {
  const env = makeEnv();
  const locator = join(env, 'store');
  // Bootstrap profile accepts the absent identity.
  const bootstrapPath = writeConfig(env, bootstrapConfig(locator));
  const bootstrapLoaded = loadBootstrapConfig(bootstrapPath);
  assert.equal(bootstrapLoaded.ok, true, bootstrapLoaded.ok ? '' : bootstrapLoaded.message);
  // Runtime profile rejects the exact same document.
  const runtimeLoaded = loadRuntimeConfig(bootstrapPath);
  assert.equal(runtimeLoaded.ok, false);
  if (!runtimeLoaded.ok) assert.ok(runtimeLoaded.message.includes('configurationIdentity'), runtimeLoaded.message);
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: runtime mode is unchanged and serves the bootstrap-produced config', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const output = join(env, 'runtime.json');
  const configPath = writeConfig(env, bootstrapConfig(locator));
  const boot = await runCli(['bootstrap', '--config', configPath, '--output', output]);
  assert.equal(boot.code, 0, boot.stderr);
  // Runtime mode with a missing config still fails exactly as before.
  const missing = await runCli(['--config', join(env, 'nope.json')]);
  assert.equal(missing.code, 1);
  assert.ok(missing.stderr.includes('could not be read'), missing.stderr);
  // Runtime mode over the bootstrap-produced config starts the MCP server
  // and shuts down cleanly on stdin EOF (never bootstrap behavior).
  const runtime = await runCli(['--config', output]);
  assert.equal(runtime.code, 0, runtime.stderr);
  assert.equal(runtime.stdout.includes('jsonrpc'), false, 'stdout carries no protocol bytes without a client');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap output: short writes are looped until the complete buffer is written before publish (SIR-PS1-002)', () => {
  const env = makeEnv();
  const target = join(env, 'runtime.json');
  const content = JSON.stringify(bootstrapConfig(join(env, 'store')));
  // Pathological short-write primitive: really writes at most one byte per
  // call while reporting the actual short count (a genuine partial write).
  const shortWriter: (fd: number, buffer: Buffer, offset: number, length: number) => number = (fd, buffer, offset, length) =>
    writeSync(fd, buffer, offset, Math.min(1, length));
  const result = writeOutputFile(target, content, shortWriter);
  assert.equal(result.ok, true, result.ok ? '' : result.message);
  assert.equal(readFileSync(target, 'utf8'), content, 'the complete byte sequence must be published after short writes');
  assert.equal(statSync(target).mode & 0o777, 0o600, 'permissions must stay exact 0600');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap output: zero-progress write fails closed; nothing is published and the temp is cleaned (SIR-PS1-002)', () => {
  const env = makeEnv();
  const target = join(env, 'runtime.json');
  const content = JSON.stringify(bootstrapConfig(join(env, 'store')));
  let calls = 0;
  // One real partial write, then zero progress: an I/O failure mid-write.
  const failingWriter: (fd: number, buffer: Buffer, offset: number, length: number) => number = (fd, buffer, offset, length) => {
    calls += 1;
    if (calls >= 2) return 0;
    return writeSync(fd, buffer, offset, Math.min(1, length));
  };
  const result = writeOutputFile(target, content, failingWriter);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-BOOT-OUTPUT-IO');
  assert.equal(existsSync(target), false, 'the final output path must never be published on an incomplete write');
  const leftovers = readdirSync(env).filter((e) => e.includes('.tmp-'));
  assert.deepEqual(leftovers, [], 'the temporary file must be cleaned up on failure');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: output I/O failure fails the command closed with ERR-BOOT-OUTPUT-IO', async () => {
  const env = makeEnv();
  const locator = makeLocator(env);
  const configPath = writeConfig(env, bootstrapConfig(locator));
  const run = await runCli(['bootstrap', '--config', configPath, '--output', join(env, 'missing-dir', 'runtime.json')]);
  assert.equal(run.code, 1);
  assert.ok(run.stderr.includes('ERR-BOOT-OUTPUT-IO'), run.stderr);
  assert.equal(run.stdout, '', 'no partial output document may be emitted on failure');
  rmSync(env, { recursive: true, force: true });
});

test('bootstrap CLI: the MCP server surface cannot reach the bootstrap path', () => {
  const serverSrc = readFileSync(SERVER_SRC, 'utf8');
  assert.equal(serverSrc.includes('bootstrapStore'), false, 'server.ts must not call the bootstrap action');
  assert.equal(serverSrc.includes('runBootstrapCommand'), false, 'server.ts must not call the bootstrap runner');
  assert.equal(serverSrc.includes('../../bootstrap/'), false, 'server.ts must not import the bootstrap module');
});
