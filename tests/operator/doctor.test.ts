/**
 * S3 — `pgw doctor` subprocess + unit tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { versionAtLeast } from '../../src/operator/doctor.js';

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

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'pgw-doctor-'));
}

async function registerProject(home: string, project: string): Promise<string> {
  mkdirSync(project);
  const r = await runCli(['add', project], { HOME: home });
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.trim().split(' ')[1]!;
}

/** Recursive lstat snapshot (size/mtime/mode/kind) for read-only proof. */
function snapshot(root: string): string {
  const lines: string[] = [];
  const walk = (dir: string, rel: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = lstatSync(p);
      const childRel = rel === '' ? name : `${rel}/${name}`;
      lines.push(`${childRel}|${st.size}|${st.mtimeMs}|${st.mode & 0o777}|${st.isDirectory() ? 'd' : st.isSymbolicLink() ? 'l' : 'f'}`);
      if (st.isDirectory()) walk(p, childRel);
    }
  };
  walk(root, '');
  return lines.join('\n');
}

test('doctor: healthy configuration exits 0 with PASS lines', async () => {
  const home = makeHome();
  await registerProject(home, join(home, 'proj'));
  const r = await runCli(['doctor'], { HOME: home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\[PASS\] host lane/);
  assert.match(r.stdout, /\[PASS\] node/);
  assert.match(r.stdout, /\[PASS\] git/);
  assert.match(r.stdout, /\[PASS\] registry 1 project/);
  assert.match(r.stdout, /store verified/);
  rmSync(home, { recursive: true, force: true });
});

test('doctor: empty registry fails', async () => {
  const home = makeHome();
  const r = await runCli(['doctor'], { HOME: home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\[FAIL\] registry: no registered projects/);
  rmSync(home, { recursive: true, force: true });
});

test('doctor: missing project root fails', async () => {
  const home = makeHome();
  const project = join(home, 'proj');
  await registerProject(home, project);
  rmSync(project, { recursive: true, force: true });
  const r = await runCli(['doctor'], { HOME: home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\[FAIL\] project .*root is missing/);
  rmSync(home, { recursive: true, force: true });
});

test('doctor: invalid store fails and is not recreated (bootstrap prohibition)', async () => {
  const home = makeHome();
  const project = join(home, 'proj');
  const id = await registerProject(home, project);
  const storeLocator = join(home, '.local', 'state', 'project-gateway-macos', id, 'store');
  rmSync(storeLocator, { recursive: true, force: true });

  const r = await runCli(['doctor'], { HOME: home });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\[FAIL\] project .*store verification failed/);
  assert.equal(existsSync(storeLocator), false, 'doctor must not recreate the store');
  rmSync(home, { recursive: true, force: true });
});

test('doctor: read-only — filesystem snapshot unchanged after run', async () => {
  const home = makeHome();
  await registerProject(home, join(home, 'proj'));
  const before = snapshot(home);
  const r = await runCli(['doctor'], { HOME: home });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(snapshot(home), before);
  rmSync(home, { recursive: true, force: true });
});

test('doctor: versionAtLeast primitive', () => {
  assert.equal(versionAtLeast('22.0.0', [22, 0, 0]), true);
  assert.equal(versionAtLeast('22.23.1', [22, 0, 0]), true);
  assert.equal(versionAtLeast('23.0.0', [22, 0, 0]), true);
  assert.equal(versionAtLeast('21.9.9', [22, 0, 0]), false);
});
