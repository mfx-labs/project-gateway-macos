/**
 * S2 — operator CLI subprocess tests (built `pgw` binary).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { projectIdFromPath } from '../../src/operator/project-id.js';

const CLI_PATH = join(import.meta.dirname, '..', '..', '..', 'dist', 'operator', 'cli.js');

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

test('cli: --version exits 0 and prints package version + platform/arch', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
  const r = await runCli(['--version']);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, `pgw ${pkg.version} (${process.platform} ${process.arch})\n`);
});

test('cli: add with no operand exits 2', async () => {
  const r = await runCli(['add']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: pgw add/);
});

test('cli: list with an empty isolated registry exits 0 and prints nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pgw-cli-list-'));
  const r = await runCli(['list'], { HOME: home });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  rmSync(home, { recursive: true, force: true });
});

test('cli: add + list + remove end-to-end in an isolated home', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pgw-cli-e2e-'));
  const project = join(home, 'project');
  mkdirSync(project);
  const id = projectIdFromPath(realpathSync(project));

  const add = await runCli(['add', project], { HOME: home });
  assert.equal(add.code, 0);
  assert.match(add.stdout, new RegExp(`^added ${id} `));

  const list = await runCli(['list'], { HOME: home });
  assert.equal(list.code, 0);
  assert.match(list.stdout, new RegExp(`^${id} `));

  const remove = await runCli(['remove', id], { HOME: home });
  assert.equal(remove.code, 0);
  assert.match(remove.stdout, new RegExp(`^removed ${id}\n$`));

  const listAfter = await runCli(['list'], { HOME: home });
  assert.equal(listAfter.code, 0);
  assert.equal(listAfter.stdout, '');

  rmSync(home, { recursive: true, force: true });
});

test('cli: pgw project ... routes to add/list/remove', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pgw-cli-project-'));
  const project = join(home, 'project');
  mkdirSync(project);
  const id = projectIdFromPath(realpathSync(project));

  const add = await runCli(['project', 'add', project], { HOME: home });
  assert.equal(add.code, 0);
  assert.match(add.stdout, new RegExp(`^added ${id} `));

  const list = await runCli(['project', 'list'], { HOME: home });
  assert.equal(list.code, 0);
  assert.match(list.stdout, new RegExp(`^${id} `));

  const remove = await runCli(['project', 'remove', id], { HOME: home });
  assert.equal(remove.code, 0);
  assert.match(remove.stdout, new RegExp(`^removed ${id}\n$`));

  // unknown subcommand rejected
  const bogus = await runCli(['project', 'bogus'], { HOME: home });
  assert.equal(bogus.code, 2);
  assert.match(bogus.stderr, /usage: pgw project/);

  rmSync(home, { recursive: true, force: true });
});

test('cli: malformed invocations exit 2', async () => {
  assert.equal((await runCli([])).code, 2);
  assert.equal((await runCli(['--version', 'extra'])).code, 2);
  assert.equal((await runCli(['remove'])).code, 2);
  assert.equal((await runCli(['bogus'])).code, 2);
});

test('cli: uninstall in an isolated home exits 0 and is idempotent', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pgw-cli-uninstall-'));
  const r = await runCli(['uninstall'], { HOME: home });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /uninstalled/);
  rmSync(home, { recursive: true, force: true });
});

test('cli: pgw is the only operator bin; no project-gateway-macos alias', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    bin: Record<string, string>;
  };
  assert.equal(pkg.bin['pgw'], './dist/operator/cli.js');
  assert.equal('project-gateway-macos' in pkg.bin, false);
  assert.equal('project-gateway-macos-mcp' in pkg.bin, true);
});
