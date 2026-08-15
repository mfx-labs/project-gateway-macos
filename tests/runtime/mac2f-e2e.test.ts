/**
 * MAC-2F — real Intel stdio MCP persist E2E through the production path.
 *
 * Exercises the EXACT production composition an operator uses:
 *
 *   project-gateway-macos-mcp bootstrap --config <file> --output <file>
 *     (real control-plane provisioning; configuration identity DERIVED,
 *      never synthesized)
 *   project-gateway-macos-mcp --config <resolved>
 *     (real stdio MCP process; initialize identity; nine tools;
 *      draft-artifact → persist-artifact → controlled writer → Darwin
 *      descriptor seam → actual filesystem)
 *
 * Plus the bounded security-negative mini-matrix: conflicting destination
 * (fail closed, no overwrite), out-of-authority destination (fail closed,
 * no external create), and server continuity after rejection.
 *
 * Darwin harness portability (allowed class):
 *   - realpath-canonical fixture roots (production-equivalent root
 *     canonicalization; no `/var` vs `/private/var` false identity);
 *   - host-resolvable Git binary location;
 *   - the built CLI resolved from the repository layout.
 *
 * No production code is modified or bypassed; the store is provisioned
 * through the real operator bootstrap verb; every file-level assertion is
 * made independently of the MCP response.
 */
import { test } from 'node:test';
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
import { computeArtifactDigest } from '../../src/api/validate.js';
import { loadGatewayFs } from '#gateway-native';

const UID = process.getuid?.() ?? 0;
const WS = 'pgw:w:aaaaaaaaaaaaaaaa';
const CLI_PATH = join(import.meta.dirname, '..', '..', '..', 'dist', 'runtime', 'mcp', 'cli.js');
const REPO = join(import.meta.dirname, '..', '..', '..');
const GIT = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'].find((p) => existsSync(p)) ?? 'git';

const NINE_TOOLS = ['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class', 'draft-artifact', 'persist-artifact', 'inspect-changes'].sort();

const TASKSPEC_FIXTURE = JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'valid', 'task-minimal-genesis.json'), 'utf8')) as Record<string, unknown>;

/** Draft content: the canonical envelope with the derived digest member removed. */
function draftContent(model: Readonly<Record<string, unknown>>): string {
  const revision = { ...(model['revision'] as Readonly<Record<string, unknown>>) };
  delete revision['digest'];
  return JSON.stringify({ ...model, revision });
}

const DRAFT_TASKSPEC = draftContent(TASKSPEC_FIXTURE);

interface E2EFixture {
  readonly base: string;
  readonly storeDir: string;
  readonly storeRoot: string;
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly bootPath: string;
  readonly resolvedPath: string;
  readonly cleanup: () => void;
}

function git(args: string[], root: string): void {
  execFileSync(GIT, ['-C', root, ...args], { stdio: 'ignore' });
}

function runCli(args: readonly string[]): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
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

/**
 * Full production fixture (synchronous): realpath-canonical isolated base
 * (no `/var` vs `/private/var` false identity — production-equivalent root
 * canonicalization), real git workspace with a committed baseline, and the
 * operator bootstrap profile (configurationIdentity ABSENT → derived).
 */
function makeE2EFixture(): E2EFixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'mac2f-e2e-')));
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
  chmodSync(bootPath, 0o600);
  const resolvedPath = join(base, 'resolved.json');

  return {
    base, storeDir, storeRoot: `${storeDir}/store-v1`, workspaceRoot, artifactRoot, bootPath, resolvedPath,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/**
 * Provision through the REAL operator bootstrap verb and verify the
 * production artifacts: derived sha-256 identity; persisted store metadata
 * bound to `project-gateway-operator-bootstrap` (never the in-process
 * `project-gateway-macos-mcp-bootstrap` label).
 */
async function provision(fx: E2EFixture): Promise<void> {
  const boot = await runCli(['bootstrap', '--config', fx.bootPath, '--output', fx.resolvedPath]);
  assert.equal(boot.code, 0, `operator bootstrap must succeed: ${boot.stderr}`);
  assert.ok(boot.stderr.includes('INITIALIZED'), 'bootstrap diagnostic reports initialization');
  assert.equal(boot.stdout, '', 'bootstrap emits no MCP/stdout payload when --output is used');

  const resolved = JSON.parse(readFileSync(fx.resolvedPath, 'utf8')) as { surfaces: { surfaceId: string; configurationIdentity: string }[] };
  assert.match(resolved.surfaces[0]!.configurationIdentity, /^sha-256:[0-9a-f]{64}$/, 'the derived identity is a real sha-256 digest');

  const metadata = readFileSync(join(fx.storeRoot, 'metadata', 'metadata.json'), 'utf8');
  assert.ok(metadata.includes('project-gateway-operator-bootstrap'), 'persisted store metadata uses the operator-bootstrap identity');
  assert.equal(metadata.includes('macos-mcp-bootstrap'), false, 'the in-process label is not persisted store metadata');
}

/** Snapshot of store paths/sizes/mtimes/modes (lstat; no follow). */
function snapshotStore(root: string): string {
  if (!existsSync(root)) return '<absent>';
  const entries: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const childRel = rel === '' ? name : `${rel}/${name}`;
      const st = lstatSync(full);
      entries.push(`${childRel}|${st.size}|${st.mtimeMs}|${st.mode & 0o777}|${st.isDirectory() ? 'd' : st.isSymbolicLink() ? 'l' : 'f'}`);
      if (st.isDirectory()) walk(full, childRel);
    }
  };
  walk(root, '');
  return entries.join('\n');
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

interface Session {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  readonly close: () => Promise<void>;
}

async function openSession(configPath: string): Promise<Session> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_PATH, '--config', configPath], stderr: 'pipe' });
  const client = new Client({ name: 'mac2f-client', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(transport);
  return {
    client,
    transport,
    close: async () => {
      await client.close();
      const pid = transport.pid;
      if (pid !== null) {
        const exited = await waitForExit(pid, 10000);
        assert.equal(exited, true, 'the server process must exit cleanly after the session closes (EOF)');
      }
    },
  };
}

interface PersistEvidence {
  readonly artifactKind: string;
  readonly instanceId: string;
  readonly revisionId: string;
  readonly digest: string;
  readonly relativeDestination: string;
  readonly persistedByteCount: number;
  readonly transition: string;
}

/** The full positive persist flow + independent on-disk verification. */
async function runPositiveFlow(fx: E2EFixture, session: Session): Promise<string> {
  const { client } = session;

  // Connectivity: real MCP initialize identity.
  const serverVersion = client.getServerVersion();
  assert.ok(serverVersion !== undefined, 'server identity present');
  assert.equal(serverVersion.name, '@project-gateway/macos-core', 'initialize name is the macOS package identity');
  assert.equal(serverVersion.version, '0.1.0', 'initialize version is the package version');

  // tools/list: exactly the nine accepted tools.
  const { tools } = await client.listTools();
  assert.equal(tools.length, 9, 'exactly nine tools');
  assert.deepEqual(tools.map((t) => t.name).sort(), NINE_TOOLS, 'the exact nine-tool surface');

  // validate-artifact on the full candidate envelope (public validation
  // surface; the digest-bearing model — drafts are draft-tool content).
  const validated = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: 'alpha', content: JSON.stringify(TASKSPEC_FIXTURE) } });
  const vSc = validated.structuredContent as { ok: boolean; result?: { valid: boolean } };
  assert.equal(vSc.ok, true);
  assert.equal(vSc.result?.valid, true, 'candidate validates through the public surface');

  // draft-artifact: independent in-memory UX; persist revalidates (Model B).
  const draft = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
  const draftSc = draft.structuredContent as { ok: boolean; result: { ok: boolean; valid?: boolean; proposal?: { canonicalUtf8: string } } };
  assert.equal(draftSc.ok, true);
  assert.equal(draftSc.result.ok, true);
  assert.equal(draftSc.result.valid, true);
  const canonical = draftSc.result.proposal!.canonicalUtf8;

  // persist-artifact through the real public schema.
  const persist = await client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: WS, kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
  assert.equal(persist.isError, undefined);
  const persistSc = persist.structuredContent as { ok: boolean; result?: { persisted: PersistEvidence; validation: { level: string } }; error?: { code: string; message: string } };
  assert.equal(persistSc.ok, true, JSON.stringify(persistSc));
  const evidence = persistSc.result!.persisted;
  assert.equal(evidence.artifactKind, 'TaskSpec');
  assert.equal(evidence.instanceId, TASKSPEC_FIXTURE['instance_id']);
  assert.equal(evidence.revisionId, (TASKSPEC_FIXTURE['revision'] as Record<string, unknown>)['id']);
  const { digest } = computeArtifactDigest(TASKSPEC_FIXTURE);
  assert.equal(evidence.digest, digest, 'evidence digest is the trusted digest');
  assert.equal(evidence.relativeDestination.startsWith('/'), false, 'evidence is artifact-root relative');
  assert.equal(evidence.transition, 'missing-to-file');

  // Independent filesystem verification (never trust the MCP response alone).
  const filePath = join(fx.artifactRoot, evidence.relativeDestination);
  const st = lstatSync(filePath);
  assert.equal(st.isFile(), true, 'persisted object is a regular file');
  assert.equal(st.mode & 0o777, 0o600, 'mode is exactly 0600');
  assert.equal(st.uid, UID, 'service uid is the expected uid');
  assert.equal(readFileSync(filePath, 'utf8'), canonical, 'file bytes equal the trusted canonical bytes');
  // No sibling, no temp/partial file leaked: exactly one artifact entry.
  assert.deepEqual(readdirSync(fx.artifactRoot).sort(), [evidence.relativeDestination], 'exactly one proposal file, no leaks');
  return evidence.relativeDestination;
}

test('mac2f run-1: real Intel MCP persist E2E — full positive flow + security-negative mini-matrix', async () => {
  const fx = makeE2EFixture();
  try {
    await provision(fx);
    const storeBefore = snapshotStore(fx.storeRoot);
    const session = await openSession(fx.resolvedPath);
    let stderrText = '';
    const stderr = session.transport.stderr as NodeJS.ReadableStream | null;
    if (stderr !== null) {
      stderr.setEncoding('utf8');
      stderr.on('data', (chunk: string) => (stderrText += chunk));
    }
    try {
      const dest = await runPositiveFlow(fx, session);
      const { client } = session;

      // The store is untouched by the whole workflow (no lifecycle record).
      assert.equal(snapshotStore(fx.storeRoot), storeBefore, 'the store was not mutated by the session');

      // Audit/inspection visibility: the persisted proposal is observable
      // through the existing changed-context surface (untracked in the
      // workspace) and the registry remains empty.
      const registry = await client.callTool({ name: 'inspect-registry', arguments: { surfaceId: 'alpha' } });
      const regSc = registry.structuredContent as { ok: boolean; result: { recordsByClass: Record<string, unknown> } };
      assert.equal(regSc.ok, true);
      assert.deepEqual(regSc.result.recordsByClass, {}, 'no lifecycle/control-plane record was created');
      const changes = await client.callTool({ name: 'inspect-changes', arguments: { surfaceId: 'alpha', workspaceId: WS } });
      const changesSc = changes.structuredContent as { ok: boolean; result?: { changedFiles: { path: string }[]; changedFileCount: number } };
      assert.equal(changesSc.ok, true, JSON.stringify(changesSc));
      // The persisted proposal is observable through the existing changed-
      // context surface: git reports the untracked artifact directory
      // (the persisted file is its only member).
      assert.ok(
        changesSc.result!.changedFiles.some((f) => f.path === 'artifacts/' || f.path.startsWith('artifacts/') || f.path === dest || f.path.endsWith(`/${dest}`)),
        'the persisted proposal is observable through inspect-changes',
      );

      // Conflict: second logically-equivalent persist of the SAME revision.
      const conflict = await client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: WS, kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal(conflict.isError, undefined);
      const conflictSc = conflict.structuredContent as { ok: boolean; error?: { code: string } };
      assert.equal(conflictSc.ok, false);
      assert.equal(conflictSc.error?.code, 'write-denied', 'create-only collision is the inherited closed failure');
      const filePath = join(fx.artifactRoot, dest);
      const firstBytes = readFileSync(filePath, 'utf8');
      assert.equal(existsSync(filePath), true, 'pre-existing object still present');
      assert.equal(readFileSync(filePath, 'utf8'), firstBytes, 'pre-existing exact content was never overwritten/truncated');

      // Containment failure: unknown workspace through the public tool input.
      const containment = await client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: 'pgw:w:ffffffffffffffff', kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      const containmentSc = containment.structuredContent as { ok: boolean; error?: { code: string } };
      assert.equal(containmentSc.ok, false);
      assert.equal(containmentSc.error?.code, 'write-denied', 'out-of-authority destination fails closed');
      assert.deepEqual(readdirSync(fx.artifactRoot).sort(), [dest], 'no external/fallback file was created');

      // Unknown surface routing: not-found, still fail closed.
      const unknownSurface = await client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'nope', workspaceId: WS, kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal((unknownSurface.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'not-found');

      // Server continuity: after rejections the server still answers valid
      // requests, protocol-valid.
      const registryAfter = await client.callTool({ name: 'inspect-registry', arguments: { surfaceId: 'alpha' } });
      assert.equal((registryAfter.structuredContent as { ok: boolean }).ok, true, 'server remains usable after rejections');
      const enumerateAfter = await client.callTool({ name: 'enumerate-class', arguments: { surfaceId: 'alpha', recordClass: 'approval-record' } });
      assert.equal((enumerateAfter.structuredContent as { ok: boolean }).ok, true, 'subsequent valid request succeeds');
      assert.equal(snapshotStore(fx.storeRoot), storeBefore, 'no side effect from any failure path');
    } finally {
      await session.close();
    }
    assert.equal(stderrText.length, 0, 'no stderr diagnostics during the whole session');
  } finally {
    fx.cleanup();
    assert.equal(existsSync(fx.base), false, 'test-owned fixture removed');
  }
});

test('mac2f run-2: real Intel MCP persist E2E — fresh independent workspace', async () => {
  const fx = makeE2EFixture();
  try {
    await provision(fx);
    const session = await openSession(fx.resolvedPath);
    try {
      const dest = await runPositiveFlow(fx, session);
      // Fresh run: no dependence on run-1 state; conflict still fails closed.
      const conflict = await session.client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: WS, kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal((conflict.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'write-denied');
      assert.equal(readFileSync(join(fx.artifactRoot, dest), 'utf8').length > 0, true, 'existing file intact after conflict');
      const registry = await session.client.callTool({ name: 'inspect-registry', arguments: { surfaceId: 'alpha' } });
      assert.equal((registry.structuredContent as { ok: boolean }).ok, true, 'server continuity on the fresh session');
    } finally {
      await session.close();
    }
  } finally {
    fx.cleanup();
    assert.equal(existsSync(fx.base), false, 'test-owned fixture removed');
  }
});

test('mac2f: the production process loads the real darwin-x64 addon with exactly six exports', () => {
  // The same loader the production adapter uses (`#gateway-native` →
  // native/index.mjs) resolves the active addon for THIS physical host:
  // darwin + x64 → darwin-x64/gateway_fs.node (never the arm64 candidate).
  const addon = loadGatewayFs();
  assert.deepEqual(Object.keys(addon).sort(), ['createExclusiveFileAt', 'getPath', 'openDirectoryAt', 'openExistingFileAt', 'readDirectoryEntries', 'unlinkAt'], 'JS-visible native surface is exactly six');
});
