/**
 * WP-14B — end-to-end integration validation through the real stdio
 * runtime (the exact path an external Secure MCP Tunnel / ChatGPT connector
 * launches: `project-gateway-macos-mcp --config <file>`).
 *
 * Proves the ChatGPT-side zero-transfer workflow end-to-end:
 *
 *   connectivity → inspect → draft → trusted revalidation → persist
 *   proposal artifact → retrieve changed project context
 *
 * plus integration-level fail-closed evidence and authority-isolation
 * negative evidence (no lifecycle/control-plane record, no execution
 * path, no store mutation, no half-written proposal state).
 *
 * No live OpenAI/tunnel dependency: fully local and deterministic — the
 * stdio MCP path exercised here IS the tunnel's transport boundary (the
 * tunnel launches this CLI and bridges MCP over stdio).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, readFileSync, readdirSync, lstatSync, mkdirSync, renameSync, unlinkSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { markValidatedTrustedWorkspaceConfiguration } from '../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createStorageWriteActionProvenance, createTrustedStorageBootstrapInput } from '../../src/storage/trusted-input/bootstrap-input.js';
import { initializeTrustedStore } from '../../src/storage/initialization/initialize.js';
import { publishRecord } from '../../src/storage/publication/index.js';
import { computePayloadDigest } from '../../src/storage/format/envelope.js';
import { defaultLimitProfile } from '../../src/storage/limits/limits.js';
import { computeArtifactDigest } from '../../src/api/validate.js';

const UID = process.getuid?.() ?? 0;
const CID = 'sha-256:' + 'a'.repeat(64);
const WS = 'pgw:w:aaaaaaaaaaaaaaaa';
// Host-resolvable Git binary (MAC-2F portability port: the previous
// Linux-only absolute path cannot exist on Darwin).
const GIT_BIN = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'].find((p) => existsSync(p)) ?? 'git';
const CLI_PATH = join(import.meta.dirname, '..', '..', '..', 'dist', 'runtime', 'mcp', 'cli.js');
const REPO = join(import.meta.dirname, '..', '..', '..');

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
  readonly configPath: string;
  readonly cleanup: () => void;
}

function git(args: string[], root: string): void {
  execFileSync(GIT_BIN, ['-C', root, ...args], { stdio: 'ignore' });
}

/** Full WP-14B fixture: v2 store + git workspace + artifact location + operator config. */
function makeE2EFixture(): E2EFixture {
  // Realpath-canonical base (MAC-2F Darwin portability): on macOS the
  // tmpdir prefix `/var/folders/...` contains the `/var` symlink, which the
  // WP-7 lane HOME/TMPDIR contract rejects; the canonical form
  // `/private/var/folders/...` is production-equivalent.
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'wp14b-e2e-')));
  chmodSync(base, 0o700);
  const storeDir = join(base, 'store');
  mkdirSync(storeDir, { mode: 0o700 });
  const workspaceRoot = join(base, 'workspace');
  const artifactRoot = join(workspaceRoot, 'artifacts');
  const home = join(base, 'home');
  const tmpdirDir = join(base, 'tmpdir');
  for (const dir of [workspaceRoot, artifactRoot, home, tmpdirDir]) {
    mkdirSync(dir, { mode: 0o700 });
  }
  chmodSync(artifactRoot, 0o700);

  // Store initialized under a version-2 configuration (matches the surface).
  const config = { configurationVersion: '2', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CID };
  markValidatedTrustedWorkspaceConfiguration(config);
  const bp = createStorageBootstrapActionProvenance({ actionIdentity: 'wp14b-b', locator: storeDir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CID, limitProfile: defaultLimitProfile() });
  const ir = createTrustedStorageBootstrapInput(config, bp, { locator: storeDir, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
  assert.equal(ir.ok, true);
  const init = initializeTrustedStore({ trustedConfiguration: config, actionProvenance: bp, locator: storeDir, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
  assert.equal(init.ok, true, JSON.stringify(init.findings));

  // Git workspace with a committed baseline.
  git(['init', '-q'], workspaceRoot);
  git(['config', 'user.email', 't@t'], workspaceRoot);
  git(['config', 'user.name', 't'], workspaceRoot);
  writeFileSync(join(workspaceRoot, 'README.md'), '# project\n');
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
  writeFileSync(join(workspaceRoot, 'src', 'main.ts'), 'export const x = 1;\n');
  git(['add', '.'], workspaceRoot);
  git(['commit', '-q', '-m', 'init'], workspaceRoot);

  // Operator startup config: credential-free, lane-bearing.
  const configPath = join(base, 'gateway-config.json');
  writeFileSync(configPath, JSON.stringify({
    surfaces: [{
      surfaceId: 'alpha',
      locator: storeDir,
      configurationIdentity: CID,
      configurationVersion: '2',
      workspaces: [{ workspaceId: WS, root: workspaceRoot, artifactLocation: artifactRoot }],
      gitPath: GIT_BIN,
      gitHome: home,
      gitTmpdir: tmpdirDir,
    }],
  }), { mode: 0o600 });
  chmodSync(configPath, 0o600);

  return {
    base,
    storeDir,
    storeRoot: `${storeDir}/store-v1`,
    workspaceRoot,
    artifactRoot,
    configPath,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
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

function snapshotArtifacts(root: string): string {
  return readdirSync(root).sort().join('\n');
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
  const client = new Client({ name: 'wp14b-client', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
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

test('wp14b: end-to-end zero-transfer persist workflow through the real stdio runtime', async () => {
  const fx = makeE2EFixture();
  try {
    const storeBefore = snapshotStore(fx.storeRoot);
    const artifactsBefore = snapshotArtifacts(fx.artifactRoot);
    const session = await openSession(fx.configPath);
    try {
      // Connectivity: the real CLI answers the modern MCP opening with the
      // exact nine-tool surface.
      const { tools } = await session.client.listTools();
      assert.equal(tools.length, 9);
      const names = tools.map((t) => t.name).sort();
      for (const expected of ['validate-artifact', 'inspect-registry', 'draft-artifact', 'persist-artifact', 'inspect-changes']) {
        assert.ok(names.includes(expected), `${expected} discoverable`);
      }

      // Inspect: project/registry state through the surface.
      const registry = await session.client.callTool({ name: 'inspect-registry', arguments: { surfaceId: 'alpha' } });
      assert.equal((registry.structuredContent as { ok: boolean }).ok, true);

      // Construct + validate candidate (draft-artifact is an independent
      // in-memory UX; persist revalidates under Model B regardless).
      const draft = await session.client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      const draftSc = draft.structuredContent as { ok: boolean; result: { ok: boolean; valid?: boolean; proposal?: { canonicalUtf8: string; digest: string; instanceId: string; revisionId: string } } };
      assert.equal(draftSc.ok, true);
      assert.equal(draftSc.result.ok, true);
      assert.equal(draftSc.result.valid, true);
      const canonical = draftSc.result.proposal!.canonicalUtf8;

      // Persist through controlled write (Model B revalidation inside).
      const persist = await session.client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: WS, kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal(persist.isError, undefined);
      const persistSc = persist.structuredContent as { ok: boolean; result?: { persisted: { artifactKind: string; instanceId: string; revisionId: string; digest: string; relativeDestination: string; persistedByteCount: number; transition: string }; validation: { level: string } }; error?: { code: string; message: string } };
      assert.equal(persistSc.ok, true, JSON.stringify(persistSc));
      const evidence = persistSc.result!.persisted;
      assert.equal(evidence.artifactKind, 'TaskSpec');
      assert.equal(evidence.instanceId, TASKSPEC_FIXTURE['instance_id']);
      assert.equal(evidence.revisionId, (TASKSPEC_FIXTURE['revision'] as Record<string, unknown>)['id']);
      const { digest } = computeArtifactDigest(TASKSPEC_FIXTURE);
      assert.equal(evidence.digest, digest, 'evidence digest is the trusted digest');
      assert.equal(evidence.relativeDestination.startsWith('/'), false, 'evidence is artifact-root relative');
      assert.equal(evidence.transition, 'missing-to-file');

      // The project-visible proposal file exists and its bytes are EXACTLY
      // the trusted canonical bytes (the bytes the surface itself produced).
      const filePath = join(fx.artifactRoot, evidence.relativeDestination);
      assert.equal(existsSync(filePath), true, 'project-visible proposal file exists');
      const persistedBytes = readFileSync(filePath, 'utf8');
      assert.equal(persistedBytes, canonical, 'file bytes equal trusted canonical bytes');

      // Proposal remains unapproved/unissued: the registry is empty and the
      // store is byte-for-byte untouched by the entire workflow.
      const registryAfter = await session.client.callTool({ name: 'inspect-registry', arguments: { surfaceId: 'alpha' } });
      const regSc = registryAfter.structuredContent as { ok: boolean; result: { recordsByClass: Record<string, unknown> } };
      assert.equal(regSc.ok, true);
      assert.deepEqual(regSc.result.recordsByClass, {}, 'no lifecycle/control-plane record was created');
      const enumerate = await session.client.callTool({ name: 'enumerate-class', arguments: { surfaceId: 'alpha', recordClass: 'approval-record' } });
      assert.equal((enumerate.structuredContent as { ok: boolean }).ok, true);
      assert.equal(snapshotStore(fx.storeRoot), storeBefore, 'the store was not mutated by connectivity/persistence');
      assert.equal(snapshotArtifacts(fx.artifactRoot), artifactsBefore === '' ? evidence.relativeDestination : `${artifactsBefore}\n${evidence.relativeDestination}`, 'exactly one proposal file appeared');
    } finally {
      await session.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('wp14b: changed-context workflow through the real runtime — modified, untracked (spaces), deleted, renamed', async () => {
  const fx = makeE2EFixture();
  try {
    const session = await openSession(fx.configPath);
    try {
      // Project modification: edit, add-with-space, delete, rename.
      writeFileSync(join(fx.workspaceRoot, 'src', 'main.ts'), 'export const x = 2;\n');
      writeFileSync(join(fx.workspaceRoot, 'new file with spaces.txt'), 'spaced\n');
      unlinkSync(join(fx.workspaceRoot, 'README.md'));
      writeFileSync(join(fx.workspaceRoot, 'renamed.txt'), 'renamed\n');
      renameSync(join(fx.workspaceRoot, 'renamed.txt'), join(fx.workspaceRoot, 'renamed-final.txt'));

      // Fresh changed set: modified + untracked (spaces) + deleted + renamed.
      const changes = await session.client.callTool({ name: 'inspect-changes', arguments: { surfaceId: 'alpha', workspaceId: WS } });
      assert.equal(changes.isError, undefined);
      const changesSc = changes.structuredContent as { ok: boolean; result?: { changedFiles: { path: string; indexState: string; worktreeState: string }[]; changedFileCount: number; truncated: boolean } };
      assert.equal(changesSc.ok, true, JSON.stringify(changesSc));
      const paths = changesSc.result!.changedFiles.map((f) => f.path);
      assert.ok(paths.includes('src/main.ts'), 'modified file in the changed set');
      assert.ok(paths.includes('new file with spaces.txt'), 'untracked file with spaces in the changed set');
      assert.ok(paths.includes('README.md'), 'deleted file in the changed set');
      assert.ok(paths.includes('renamed-final.txt') || paths.includes('renamed.txt'), 'rename appears in the changed set');
      assert.equal(changesSc.result!.truncated, false);

      // Bounded diff.
      const diff = await session.client.callTool({ name: 'inspect-changes', arguments: { surfaceId: 'alpha', workspaceId: WS, diff: true } });
      const diffSc = diff.structuredContent as { ok: boolean; result?: { diff?: { text: string; byteLength: number; truncated: boolean } } };
      assert.equal(diffSc.ok, true);
      assert.ok(diffSc.result!.diff!.text.includes('export const x = 2'), 'diff covers the modification');
      assert.equal(diffSc.result!.diff!.truncated, false);

      // Optional changed-file content retrieval (fresh-set member).
      const contents = await session.client.callTool({ name: 'inspect-changes', arguments: { surfaceId: 'alpha', workspaceId: WS, paths: ['src/main.ts', 'new file with spaces.txt'] } });
      const contentsSc = contents.structuredContent as { ok: boolean; result?: { contents?: { path: string; text: string }[] } };
      assert.equal(contentsSc.ok, true, JSON.stringify(contentsSc));
      const text = contentsSc.result!.contents!;
      assert.equal(text.find((c) => c.path === 'src/main.ts')!.text, 'export const x = 2;\n');
      assert.equal(text.find((c) => c.path === 'new file with spaces.txt')!.text, 'spaced\n');

      // The operation cannot read unrelated files through this surface.
      writeFileSync(join(fx.workspaceRoot, 'untouched.txt'), 'committed\n');
      git(['add', 'untouched.txt'], fx.workspaceRoot);
      git(['commit', '-q', '-m', 'untouched'], fx.workspaceRoot);
      const unrelated = await session.client.callTool({ name: 'inspect-changes', arguments: { surfaceId: 'alpha', workspaceId: WS, paths: ['untouched.txt'] } });
      const unrelatedSc = unrelated.structuredContent as { ok: boolean; error?: { code: string } };
      assert.equal(unrelatedSc.ok, false, 'unrelated committed file is not readable through inspect-changes');
      assert.equal(unrelatedSc.error?.code, 'membership-denied');
    } finally {
      await session.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('wp14b: failure/disconnect evidence — typed, redacted, fail-closed, no side effects', async () => {
  const fx = makeE2EFixture();
  try {
    const storeBefore = snapshotStore(fx.storeRoot);
    const session = await openSession(fx.configPath);
    let stderrText = '';
    const stderr = session.transport.stderr as NodeJS.ReadableStream | null;
    if (stderr !== null) {
      stderr.setEncoding('utf8');
      stderr.on('data', (chunk: string) => (stderrText += chunk));
    }
    try {
      // Unsupported tool: no such tool exists on the surface (protocol-level
      // error; the closed vocabulary is enforced by the runtime).
      await assert.rejects(
        session.client.callTool({ name: 'approve-artifact', arguments: {} }),
        (err: unknown) => {
          const e = err as { message?: string; code?: number };
          assert.ok(String(e.message ?? '').includes('not found'), 'the runtime reports the unknown tool');
          return true;
        },
        'an unregistered tool is a protocol-level error',
      );

      // Unsupported kind: ExecutionBundle is draftable but never persistable.
      const bundle = await session.client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: WS, kind: 'ExecutionBundle', content: draftContent(JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'valid', 'bundle-minimal-genesis.json'), 'utf8')) as Record<string, unknown>) } });
      assert.equal(bundle.isError, undefined);
      assert.equal((bundle.structuredContent as { ok: boolean; error?: { code: string } }).ok, false);
      assert.equal((bundle.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'unsupported-artifact-kind');

      // Malformed request: empty kind at the adapter boundary.
      const malformed = await session.client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: WS, kind: '', content: '{}' } });
      assert.equal(malformed.isError, undefined);
      assert.equal((malformed.structuredContent as { ok: boolean; error?: { code: string } }).ok, false);
      assert.equal((malformed.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'invalid-request');

      // Persistence validation failure: semantic violation never reaches WP-11.
      const invalidModel = JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'invalid', 'semantic-task-delegated-context-instruction.json'), 'utf8')) as Record<string, unknown>;
      const invalid = await session.client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: WS, kind: 'TaskSpec', content: draftContent(invalidModel) } });
      const invalidSc = invalid.structuredContent as { ok: boolean; error?: { code: string; findings?: unknown[] } };
      assert.equal(invalidSc.ok, false);
      assert.equal(invalidSc.error?.code, 'validation-failed');
      assert.ok((invalidSc.error?.findings ?? []).length > 0, 'bounded findings returned');

      // Create-only collision: a second persist of the same revision is
      // denied and the existing file is never modified.
      const first = await session.client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: WS, kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal((first.structuredContent as { ok: boolean }).ok, true);
      const firstPath = (first.structuredContent as { ok: boolean; result: { persisted: { relativeDestination: string } } }).result.persisted.relativeDestination;
      const firstBytes = readFileSync(join(fx.artifactRoot, firstPath), 'utf8');
      const collision = await session.client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: WS, kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal((collision.structuredContent as { ok: boolean; error?: { code: string } }).ok, false);
      assert.equal((collision.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'write-denied');
      assert.equal(readFileSync(join(fx.artifactRoot, firstPath), 'utf8'), firstBytes, 'the existing proposal file was never overwritten');

      // Containment denial: an unknown workspace can never be a write target.
      const containment = await session.client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: 'pgw:w:ffffffffffffffff', kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal((containment.structuredContent as { ok: boolean; error?: { code: string } }).ok, false);
      assert.equal((containment.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'write-denied');

      // Changed-context membership denial: unrelated committed file.
      writeFileSync(join(fx.workspaceRoot, 'other.txt'), 'other\n');
      git(['add', 'other.txt'], fx.workspaceRoot);
      git(['commit', '-q', '-m', 'other'], fx.workspaceRoot);
      const membership = await session.client.callTool({ name: 'inspect-changes', arguments: { surfaceId: 'alpha', workspaceId: WS, paths: ['other.txt'] } });
      assert.equal((membership.structuredContent as { ok: boolean; error?: { code: string } }).ok, false);
      assert.equal((membership.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'membership-denied');

      // Unknown surface routing.
      const unknownSurface = await session.client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'nope', workspaceId: WS, kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal((unknownSurface.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'not-found');

      // No half-written state, no side effects: exactly ONE proposal file
      // (from the collision test), store untouched.
      const artifactFiles = readdirSync(fx.artifactRoot).sort();
      assert.equal(artifactFiles.length, 1, 'no half-written proposal state after failures');
      assert.equal(snapshotStore(fx.storeRoot), storeBefore, 'no lifecycle/execution side effect from any failure path');
    } finally {
      await session.close();
    }
    // Lost/closed stdio connection: the server exits cleanly on EOF with no
    // stderr diagnostics (redaction holds for the whole session).
    assert.equal(stderrText.length, 0, 'no stderr diagnostics during normal and failure paths');
  } finally {
    fx.cleanup();
  }
});

test('wp14b: startup failures are fail-closed and redacted (invalid/missing config)', async () => {
  const fx = makeE2EFixture();
  try {
    // Missing config file: nonzero exit, no stdout, bounded stderr.
    const missing = spawn(process.execPath, [CLI_PATH, '--config', join(fx.base, 'does-not-exist.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
    const missingResult = await new Promise<{ out: string; code: number | null }>((resolve) => {
      let out = '';
      missing.stdout.on('data', (c: Buffer) => (out += c.toString()));
      missing.on('close', (code) => resolve({ out, code }));
    });
    assert.equal(missingResult.out.length, 0, 'stdout stays protocol-clean on startup failure');
    assert.notEqual(missingResult.code, 0, 'missing config exits nonzero');

    // Malformed config (unknown field): nonzero exit.
    const badConfig = join(fx.base, 'bad-config.json');
    writeFileSync(badConfig, JSON.stringify({ surfaces: [{ surfaceId: 'alpha', locator: fx.storeDir, configurationIdentity: CID, configurationVersion: '2', workspaces: [], secretToken: 'hunter2' }] }));
    const bad = spawn(process.execPath, [CLI_PATH, '--config', badConfig], { stdio: ['ignore', 'pipe', 'pipe'] });
    let badErr = '';
    bad.stderr.on('data', (c: Buffer) => (badErr += c.toString()));
    const badCode = await new Promise<number | null>((resolve) => bad.on('close', (code) => resolve(code)));
    assert.notEqual(badCode, 0, 'malformed config exits nonzero');
    assert.ok(badErr.includes('unknown field: secretToken'), 'the diagnostic names the closed-field violation');
    assert.equal(badErr.includes('hunter2'), false, 'config content never echoes into diagnostics');
  } finally {
    fx.cleanup();
  }
});
