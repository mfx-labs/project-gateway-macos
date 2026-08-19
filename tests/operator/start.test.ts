/**
 * S3 — `pgw start` subprocess tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { runStart } from '../../src/operator/start.js';

const CLI_PATH = join(import.meta.dirname, '..', '..', '..', 'dist', 'operator', 'cli.js');

const NINE_TOOLS = [
  'validate-artifact',
  'inspect-stored-record',
  'inspect-registry',
  'inspect-audit-history',
  'verify-record',
  'enumerate-class',
  'draft-artifact',
  'persist-artifact',
  'inspect-changes',
].sort();

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
  // realpath so the temp home contains no symlink components (macOS `/var`
  // is a symlink to `/private/var`), which the WP-7 git-lane HOME validation
  // rejects at composition time.
  return realpathSync(mkdtempSync(join(tmpdir(), 'pgw-start-')));
}

/** Register a project via `pgw add` and return its id. */
async function registerProject(home: string, project: string): Promise<string> {
  mkdirSync(project);
  const r = await runCli(['add', project], { HOME: home });
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.trim().split(' ')[1]!;
}

function findFiles(root: string, name: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (entry === name) found.push(p);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(root);
  return found;
}

test('start: one project serves the nine-tool MCP surface and closes cleanly', async () => {
  const home = makeHome();
  await registerProject(home, join(home, 'proj'));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, 'start'],
    env: { ...process.env, HOME: home },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'pgw-start-test', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), NINE_TOOLS);
  await client.close();
  rmSync(home, { recursive: true, force: true });
});

test('start: multiple projects compose without a persistent runtime.json', async () => {
  const home = makeHome();
  await registerProject(home, join(home, 'a'));
  await registerProject(home, join(home, 'b'));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, 'start'],
    env: { ...process.env, HOME: home },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'pgw-start-multi', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 9);
  await client.close();

  assert.deepEqual(findFiles(home, 'runtime.json'), []);
  rmSync(home, { recursive: true, force: true });
});

test('start: empty registry fails with no MCP output', async () => {
  const home = makeHome();
  const r = await runCli(['start'], { HOME: home });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /no registered projects/);
  rmSync(home, { recursive: true, force: true });
});

test('start: broken store fails before the MCP service', async () => {
  const home = makeHome();
  const project = join(home, 'proj');
  const id = await registerProject(home, project);
  const storeLocator = join(home, '.local', 'state', 'project-gateway-macos', id, 'store');
  rmSync(storeLocator, { recursive: true, force: true });

  const r = await runCli(['start'], { HOME: home });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /runtime composition failed/);
  rmSync(home, { recursive: true, force: true });
});

test('start: missing store namespaces are not recreated (no provisioning)', async () => {
  const home = makeHome();
  const project = join(home, 'proj');
  const id = await registerProject(home, project);
  const storeLocator = join(home, '.local', 'state', 'project-gateway-macos', id, 'store');
  // Leave the locator directory present but remove both initialized namespaces,
  // reproducing the previously-escaped provisioning branch.
  rmSync(join(storeLocator, 'config-v1'), { recursive: true, force: true });
  rmSync(join(storeLocator, 'store-v1'), { recursive: true, force: true });
  const snapshot = readdirSync(storeLocator);

  const r = await runCli(['start'], { HOME: home });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /runtime composition failed/);

  // start must not provision/repair: no namespace recreated, state unchanged.
  assert.deepEqual(readdirSync(storeLocator), snapshot);
  assert.equal(existsSync(join(storeLocator, 'config-v1')), false);
  assert.equal(existsSync(join(storeLocator, 'store-v1')), false);
  rmSync(home, { recursive: true, force: true });
});

test('start: unsupported host platform/architecture exits 2', async () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  process.exitCode = 0;
  try {
    await runStart();
    assert.equal(process.exitCode, 2);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
    process.exitCode = 0;
  }
});
