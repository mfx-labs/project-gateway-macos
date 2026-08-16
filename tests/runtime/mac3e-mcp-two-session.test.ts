/**
 * MAC-3E — real MCP integration evidence (Intel host; the real nine-tool
 * surface, real operator bootstrap, real stdio server processes).
 *
 * MAC-3A §17 layer-3 items, exactly the four planned pieces:
 *   1. concurrent same-destination `persist-artifact` from TWO independent
 *      MCP sessions (two server processes) racing one destination — at
 *      most one `created`, the loser fails with the accepted closed code
 *      `write-denied`, no overwrite;
 *   2. conflict/no-overwrite observed through the public schema while a
 *      bounded churn actor mutates the workspace concurrently;
 *   3. unknown-workspace authority rejection (`write-denied`) remains
 *      denied under concurrent churn;
 *   4. server continuity after race/conflict denial: subsequent valid
 *      requests succeed, zero stderr, clean EOF on both sessions.
 *
 * No test-only MCP tools are added; the surface is exactly the accepted
 * nine tools. Deterministic outcome-SET invariants over true concurrent
 * sessions — no sleeps as evidence (timeouts are lifecycle bounds only).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, chmodSync, rmSync, writeFileSync, readFileSync, readdirSync,
  lstatSync, mkdirSync, realpathSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { withChildActor, type RunningChildActor } from '../mac3b/child-actor.js';

const WS = 'pgw:w:aaaaaaaaaaaaaaaa';
const UNKNOWN_WS = 'pgw:w:ffffffffffffffff';
const CLI_PATH = join(import.meta.dirname, '..', '..', '..', 'dist', 'runtime', 'mcp', 'cli.js');
const REPO = join(import.meta.dirname, '..', '..', '..');
const GIT = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'].find((p) => existsSync(p)) ?? 'git';

const NINE_TOOLS = ['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class', 'draft-artifact', 'persist-artifact', 'inspect-changes'].sort();

const TASKSPEC_FIXTURE = JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'valid', 'task-minimal-genesis.json'), 'utf8')) as Record<string, unknown>;

function draftContent(model: Readonly<Record<string, unknown>>): string {
  const revision = { ...(model['revision'] as Readonly<Record<string, unknown>>) };
  delete revision['digest'];
  return JSON.stringify({ ...model, revision });
}

const DRAFT_TASKSPEC = draftContent(TASKSPEC_FIXTURE);

const bases: string[] = [];

after(() => {
  for (const base of bases) {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort fixture cleanup
    }
  }
});

function git(args: string[], root: string): void {
  execFileSync(GIT, ['-C', root, ...args], { stdio: 'ignore' });
}

async function runCli(args: readonly string[]): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => (stdout += c));
    child.stderr.on('data', (c: string) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

interface Fixture {
  readonly base: string;
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly resolvedPath: string;
}

/** Full production fixture: realpath-canonical base, real git workspace,
 * operator bootstrap provisioning (derived configuration identity). */
function makeFixture(): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'mac3e-mcp-')));
  bases.push(base);
  chmodSync(base, 0o700);
  const storeDir = join(base, 'store');
  const workspaceRoot = join(base, 'workspace');
  const artifactRoot = join(workspaceRoot, 'artifacts');
  const home = join(base, 'home');
  const tmpdirDir = join(base, 'tmpdir');
  for (const dir of [storeDir, workspaceRoot, artifactRoot, home, tmpdirDir]) {
    mkdirSync(dir, { mode: 0o700 });
  }
  git(['init', '-q'], workspaceRoot);
  git(['config', 'user.email', 't@t'], workspaceRoot);
  git(['config', 'user.name', 't'], workspaceRoot);
  writeFileSync(join(workspaceRoot, 'README.md'), '# project\n');
  git(['add', '.'], workspaceRoot);
  git(['commit', '-q', '-m', 'init'], workspaceRoot);

  const bootPath = join(base, 'bootstrap-config.json');
  writeFileSync(bootPath, JSON.stringify({
    surfaces: [{
      surfaceId: 'alpha',
      locator: storeDir,
      configurationVersion: '2',
      workspaces: [{ workspaceId: WS, root: workspaceRoot, artifactLocation: artifactRoot }],
      gitPath: GIT,
      gitHome: home,
      gitTmpdir: tmpdirDir,
    }],
  }), { mode: 0o600 });
  const resolvedPath = join(base, 'resolved.json');
  execFileSync(process.execPath, [CLI_PATH, 'bootstrap', '--config', bootPath, '--output', resolvedPath], { stdio: 'ignore' });
  return { base, workspaceRoot, artifactRoot, resolvedPath };
}

interface Session {
  readonly client: Client;
  readonly stderrText: () => string;
  readonly close: () => Promise<void>;
}

async function openSession(configPath: string): Promise<Session> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_PATH, '--config', configPath], stderr: 'pipe' });
  const client = new Client({ name: 'mac3e-client', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  let stderrText = '';
  const stderr = transport.stderr as NodeJS.ReadableStream | null;
  if (stderr !== null) {
    stderr.setEncoding('utf8');
    stderr.on('data', (chunk: string) => (stderrText += chunk));
  }
  await client.connect(transport);
  return {
    client,
    stderrText: () => stderrText,
    close: async () => {
      await client.close();
      // The server must exit cleanly (EOF) — the transport's close
      // already awaited process exit; assert no lingering diagnostics.
      assert.equal(stderrText.length, 0, 'zero stderr across the whole session');
    },
  };
}

interface PersistResponse {
  readonly ok: boolean;
  readonly result?: { readonly persisted?: { readonly transition: string; readonly relativeDestination: string } };
  readonly error?: { readonly code: string };
}

async function persist(client: Client, workspaceId: string): Promise<PersistResponse> {
  const call = await client.callTool({
    name: 'persist-artifact',
    arguments: { surfaceId: 'alpha', workspaceId, kind: 'TaskSpec', content: DRAFT_TASKSPEC },
  });
  return call.structuredContent as PersistResponse;
}

test('mac3e MCP: two sessions racing one destination — at most one created, loser write-denied, server continuity', async () => {
  const fx = makeFixture();
  const sessionA = await openSession(fx.resolvedPath);
  const sessionB = await openSession(fx.resolvedPath);
  try {
    // Both sessions: the exact nine-tool surface.
    const toolsA = await sessionA.client.listTools();
    assert.equal(toolsA.tools.length, 9, 'exactly nine tools (session A)');
    assert.deepEqual(toolsA.tools.map((t) => t.name).sort(), NINE_TOOLS, 'the exact nine-tool surface (session A)');
    const toolsB = await sessionB.client.listTools();
    assert.equal(toolsB.tools.length, 9, 'exactly nine tools (session B)');

    // TRUE CONCURRENCY: both sessions fire the same-destination persist
    // simultaneously (two independent server processes, one destination).
    const [ra, rb] = await Promise.all([
      persist(sessionA.client, WS),
      persist(sessionB.client, WS),
    ]);

    // Deterministic outcome-set invariant: exactly ONE created; the loser
    // follows the accepted closed vocabulary; no overwrite.
    const created = [ra, rb].filter((r) => r.ok === true);
    const denied = [ra, rb].filter((r) => r.ok === false);
    assert.equal(created.length, 1, `exactly one created across the pair: ${JSON.stringify([ra, rb])}`);
    assert.equal(denied.length, 1, `exactly one loser: ${JSON.stringify([ra, rb])}`);
    // The loser's code is inside the accepted closed persistence vocabulary:
    // `write-conflict` (the MAC-3A §16 canonical public code for a RACED
    // target — appears between the loser's prospective evaluation and the
    // executor's O_EXCL) or `write-denied` (pre-existing target at the
    // loser's decision time). Both are fail-closed; never a success.
    assert.ok(
      denied[0]!.error?.code === 'write-conflict' || denied[0]!.error?.code === 'write-denied',
      `loser fails with the accepted closed code: ${JSON.stringify(denied[0])}`,
    );
    assert.equal(created[0]!.result!.persisted!.transition, 'missing-to-file', 'the winner created the destination');

    // Independent on-disk verification: canonical bytes, 0600, exactly one
    // proposal file, never overwritten/truncated by the loser.
    const dest = created[0]!.result!.persisted!.relativeDestination;
    const filePath = join(fx.artifactRoot, dest);
    assert.equal(lstatSync(filePath).isFile(), true, 'persisted object is a regular file');
    assert.equal(lstatSync(filePath).mode & 0o777, 0o600, 'mode exactly 0600');
    assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')), JSON.parse(DRAFT_TASKSPEC), 'canonical content, never overwritten');

    // Server continuity after the race: both sessions answer valid
    // requests, protocol-valid.
    for (const s of [sessionA, sessionB]) {
      const registry = await s.client.callTool({ name: 'inspect-registry', arguments: { surfaceId: 'alpha' } });
      assert.equal((registry.structuredContent as { ok: boolean }).ok, true, 'server remains usable after the race');
      const enumerate = await s.client.callTool({ name: 'enumerate-class', arguments: { surfaceId: 'alpha', recordClass: 'approval-record' } });
      assert.equal((enumerate.structuredContent as { ok: boolean }).ok, true, 'subsequent valid request succeeds');
    }
  } finally {
    await sessionA.close();
    await sessionB.close();
  }
});

test('mac3e MCP: conflict/no-overwrite and unknown-workspace denial both hold under concurrent churn; server continuity after denial', async () => {
  const fx = makeFixture();
  const session = await openSession(fx.resolvedPath);
  try {
    // First persist succeeds (baseline object).
    const first = await persist(session.client, WS);
    assert.equal(first.ok, true, `baseline persist: ${JSON.stringify(first)}`);
    const dest = first.result!.persisted!.relativeDestination;
    const filePath = join(fx.artifactRoot, dest);
    const firstBytes = readFileSync(filePath, 'utf8');

    // Bounded churn actor mutates the workspace (sibling names) in a
    // separate process WHILE the conflict persist and the unknown-
    // workspace persist run.
    await withChildActor(
      { fixtureRoot: fx.workspaceRoot, script: 'mixed-churn', budget: 300 },
      async (actor: RunningChildActor) => {
        const conflict = await persist(session.client, WS);
        assert.equal(conflict.ok, false, 'conflict persist fails closed under churn');
        assert.equal(conflict.error?.code, 'write-denied', 'create-only collision is the accepted closed failure');
        assert.equal(readFileSync(filePath, 'utf8'), firstBytes, 'pre-existing object never overwritten/truncated under churn');

        const unknown = await persist(session.client, UNKNOWN_WS);
        assert.equal(unknown.ok, false, 'unknown workspace denied under churn');
        assert.equal(unknown.error?.code, 'write-denied', 'out-of-authority destination fails closed under churn');
        void actor;
      },
    );

    // No fallback object anywhere: the artifact root contains exactly the
    // winner's proposal; nothing appeared for the unknown workspace.
    const artifacts = readdirSync(fx.artifactRoot).sort();
    assert.deepEqual(artifacts, [dest], 'no fallback/external file was created');

    // Server continuity after denial.
    const registry = await session.client.callTool({ name: 'inspect-registry', arguments: { surfaceId: 'alpha' } });
    assert.equal((registry.structuredContent as { ok: boolean }).ok, true, 'server remains usable after churn + denial');
    assert.equal(session.stderrText().length, 0, 'no stderr diagnostics');
  } finally {
    await session.close();
  }
});
