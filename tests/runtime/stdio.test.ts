/**
 * WP-9 Slice 5 — subprocess stdio conformance tests.
 *
 * Launches the built CLI (`dist/runtime/mcp/cli.js`) with an operator
 * startup config over a real initialized store and exercises the MODERN
 * 2026-07-28 MCP path through the official client SDK
 * (`versionNegotiation` pin/auto, `server/discover` opening) plus raw
 * process-level probes: stdout discipline, stderr redaction, EOF shutdown,
 * startup failure behavior, and the no-network-listener invariant.
 *
 * No live OpenAI / tunnel dependency: fully local and deterministic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
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
import { MAX_STARTUP_CONFIG_BYTES } from '../../src/runtime/mcp/config.js';

const UID = process.getuid?.() ?? 0;
const CID = 'sha-256:' + 'a'.repeat(64);
const RECORD_ID = 'pgw:r:aaaa0000000000000000000000000001';
const CLI_PATH = join(import.meta.dirname, '..', '..', '..', 'dist', 'runtime', 'mcp', 'cli.js');

const VALID_TASKSPEC = JSON.stringify({ protocol: { id: 'project-gateway.artifact', version: '1.0', canonicalization: 'jcs-rfc8785-v1' }, kind: { id: 'TaskSpec', version: '1.0' }, instance_id: 'pgw:i:9e74f09cf0287d6787d69e8ebddb5157', revision: { id: 'pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f', generation: 0, predecessor: null, digest: 'sha-256:b6418a37095af165a87a38affb609f42b331d80b15f7d3ed2796bf780ae1868b' }, workspace_binding: { mode: 'portable' }, requirements: { protocol_features: [], consumer_capabilities: [] }, extensions: [], body: { objective: 'Produce a fixture conformance note.', instructions: [{ instruction_id: 'prepare-note', text: 'Create the requested conformance note.' }], expected_deliverables: [{ deliverable_id: 'conformance-note', description: 'A project-visible conformance note.', kind: 'document' }], outcome_constraints: [], project_data_citations: [] } });

const REPO = join(import.meta.dirname, '..', '..', '..');

/** Draft content: the canonical envelope with the derived digest member removed. */
function draftContent(model: Readonly<Record<string, unknown>>): string {
  const revision = { ...(model['revision'] as Readonly<Record<string, unknown>>) };
  delete revision['digest'];
  return JSON.stringify({ ...model, revision });
}

const DRAFT_TASKSPEC = draftContent(JSON.parse(VALID_TASKSPEC) as Record<string, unknown>);
const DRAFT_AUTHORITY_POLICY = draftContent(JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'valid', 'policy-minimal-genesis.json'), 'utf8')) as Record<string, unknown>);

interface StoreFixture {
  readonly dir: string;
  readonly storeRoot: string;
  readonly config: object;
  readonly trustedInput: unknown;
}

function makeStore(publishFixtureRecord = true): StoreFixture {
  const dir = mkdtempSync(join(tmpdir(), 's5stdio-'));
  chmodSync(dir, 0o700);
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CID };
  markValidatedTrustedWorkspaceConfiguration(config);
  const bp = createStorageBootstrapActionProvenance({ actionIdentity: 's5s-b', locator: dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CID, limitProfile: defaultLimitProfile() });
  const ir = createTrustedStorageBootstrapInput(config, bp, { locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
  assert.equal(ir.ok, true);
  const init = initializeTrustedStore({ trustedConfiguration: config, actionProvenance: bp, locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
  assert.equal(init.ok, true, JSON.stringify(init.findings));
  if (!publishFixtureRecord) return { dir, storeRoot: `${dir}/store-v1`, config, trustedInput: ir.input };
  const wp = createStorageWriteActionProvenance({ actionIdentity: 's5s-w', locator: dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CID, limitProfile: defaultLimitProfile() });
  const payload = { approved: true, marker: 'fixture' };
  const rec = { recordKind: 'ApprovalRecord', formatVersion: '1.0', recordId: RECORD_ID, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', trustedActionId: 's5s-w', payload, payloadDigest: computePayloadDigest(payload) };
  const r = publishRecord({ trustedConfiguration: config, bootstrapInput: ir.input, writeActionProvenance: wp, locator: dir, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile(), recordClass: 'approval-record', record: rec, timeSource: { now: () => 1000, processStartTime: 500 } });
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  return { dir, storeRoot: `${dir}/store-v1`, config, trustedInput: ir.input };
}

function writeConfig(dir: string, surfaces: unknown[]): string {
  const configPath = join(dir, 'gateway-config.json');
  writeFileSync(configPath, JSON.stringify({ surfaces }), { mode: 0o600 });
  chmodSync(configPath, 0o600);
  return configPath;
}

function surfaceConfig(env: StoreFixture, surfaceId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { surfaceId, locator: env.dir, configurationIdentity: CID, configurationVersion: '1', ...extra };
}

/** Snapshot of store paths/sizes/mtimes/modes (lstat; no follow). */
function snapshotStore(root: string): string {
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
      return true; // ESRCH: exited
    }
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Probe that the child process has no listening sockets (Linux /proc). */
function assertNoListeningSockets(pid: number): void {
  if (process.platform !== 'linux') return; // /proc-based probe is Linux-only
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6', '/proc/net/udp', '/proc/net/udp6']) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n').slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const localAddress = parts[1] ?? '';
      const state = parts[3] ?? '';
      if (state !== '0A') continue; // LISTEN
      const inode = parts[9];
      if (inode === undefined) continue;
      // Check whether the socket belongs to the child (scan /proc/<pid>/fd).
      let fdDir: string[] = [];
      try {
        fdDir = readdirSync(`/proc/${pid}/fd`);
      } catch {
        continue;
      }
      for (const fd of fdDir) {
        let target = '';
        try {
          // readlink, never readFileSync: opening a socket-backed proc fd
          // can block; readlink resolves the target without opening it.
          target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
        } catch {
          continue;
        }
        if (target.includes(`socket:[${inode}]`)) {
          assert.fail(`child process holds a LISTEN socket: ${file} ${localAddress} (inode ${inode})`);
        }
      }
    }
  }
}

test('stdio: modern 2026-07-28 path — pinned negotiation, discover, nine tools, surface routing', async () => {
  const env = makeStore();
  try {
    const configPath = writeConfig(env.dir, [surfaceConfig(env, 'alpha')]);
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_PATH, '--config', configPath], stderr: 'pipe' });
    const client = new Client({ name: 's5-modern-client', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    let stderrText = '';
    await client.connect(transport);
    try {
      assert.equal(client.getProtocolEra(), 'modern', 'the connection must negotiate the modern 2026-07-28 era');
      assert.ok(client.getDiscoverResult() !== undefined, 'the modern server/discover opening must be answered');
      // Server identity is informational metadata from the package; on the
      // modern path it is a SHOULD in the discover result _meta, so it may
      // be absent — if present it must be the package identity.
      const serverVersion = client.getServerVersion();
      if (serverVersion !== undefined) {
        assert.equal(serverVersion.name, '@project-gateway/macos-core');
      }
      // Exactly nine tools: six WP-9 inspection + one WP-10 drafting
      // + two WP-14A controlled producer tools.
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ['draft-artifact', 'enumerate-class', 'inspect-audit-history', 'inspect-changes', 'inspect-registry', 'inspect-stored-record', 'persist-artifact', 'validate-artifact', 'verify-record']);
      assert.equal(tools.length, 9);
      // The draft-artifact schema is shape/type only (plain strings), with no
      // requestId and no destination/authority operand.
      const draft = tools.find((t) => t.name === 'draft-artifact');
      assert.ok(draft !== undefined);
      const dSchema = draft.inputSchema as { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
      assert.deepEqual(Object.keys(dSchema.properties ?? {}).sort(), ['content', 'kind', 'surfaceId']);
      assert.deepEqual((dSchema.required ?? []).sort(), ['content', 'kind', 'surfaceId']);
      assert.equal(dSchema.additionalProperties, false);
      assert.equal((dSchema.properties?.['kind'] as { type?: string }).type, 'string');
      assert.equal(draft.annotations?.readOnlyHint, true);
      // Representative success with surface routing.
      const ok = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: 'alpha', content: VALID_TASKSPEC } });
      assert.equal(ok.isError, undefined);
      const okSc = ok.structuredContent as { ok: boolean; result: { valid: boolean } };
      assert.equal(okSc.ok, true);
      assert.equal(okSc.result.valid, true);
      const rec = await client.callTool({ name: 'inspect-stored-record', arguments: { surfaceId: 'alpha', recordClass: 'approval-record', recordId: RECORD_ID } });
      assert.equal((rec.structuredContent as { ok: boolean }).ok, true);
      // Representative draft-artifact call through the real CLI: valid draft.
      const draftOk = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal(draftOk.isError, undefined);
      const draftSc = draftOk.structuredContent as { ok: boolean; result: { ok: boolean; valid?: boolean; kind?: string } };
      assert.equal(draftSc.ok, true, 'routing success');
      assert.equal(draftSc.result.ok, true);
      assert.equal(draftSc.result.valid, true);
      assert.equal(draftSc.result.kind, 'TaskSpec');
      // Unsupported kind through a valid surface → inner drafting outcome,
      // successful tool execution (proves the SDK schema is not over-constrained).
      const unsupported = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'ExecutionResult', content: DRAFT_TASKSPEC } });
      assert.equal(unsupported.isError, undefined);
      const us = unsupported.structuredContent as { ok: boolean; result: { ok: boolean; error?: { code: string } } };
      assert.equal(us.ok, true);
      assert.equal(us.result.ok, false);
      assert.equal(us.result.error?.code, 'unsupported-artifact-kind');
      // Unknown surface → committed not-found outcome.
      const unknown = await client.callTool({ name: 'validate-artifact', arguments: { surfaceId: 'nope', content: '{}' } });
      assert.equal(unknown.isError, undefined);
      assert.equal((unknown.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'not-found');
      // Representative committed ok:false outcome (not a protocol exception).
      const missing = await client.callTool({ name: 'inspect-stored-record', arguments: { surfaceId: 'alpha', recordClass: 'approval-record', recordId: 'pgw:r:' + 'c'.repeat(32) } });
      assert.equal(missing.isError, undefined);
      const ms = missing.structuredContent as { ok: boolean; error?: { code: string } };
      assert.equal(ms.ok, false);
      assert.equal(ms.error?.code, 'not-found');
      // No-network-listener probe while the server is live.
      const pid = transport.pid;
      assert.ok(pid !== null);
      assertNoListeningSockets(pid);
      // stderr redaction: collect diagnostics emitted during the session.
      const stderr = transport.stderr as NodeJS.ReadableStream | null;
      if (stderr !== null) {
        stderr.setEncoding('utf8');
        stderr.on('data', (chunk: string) => (stderrText += chunk));
      }
    } finally {
      await client.close();
      // The child must exit after the client closes (EOF); only then is the
      // stderr pipe drained, so assert after the exit.
      const pid = transport.pid;
      if (pid !== null) {
        const exited = await waitForExit(pid, 10000);
        assert.equal(exited, true, 'the server process must exit after close');
      }
      assert.equal(stderrText.length, 0, 'normal operation must not write stderr diagnostics');
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('stdio: auto negotiation also selects the modern era; store is never mutated by the session', async () => {
  const env = makeStore();
  try {
    const configPath = writeConfig(env.dir, [surfaceConfig(env, 'alpha')]);
    const before = snapshotStore(env.storeRoot);
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_PATH, '--config', configPath], stderr: 'pipe' });
    const client = new Client({ name: 's5-auto-client', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(transport);
    try {
      assert.equal(client.getProtocolEra(), 'modern', 'auto negotiation must select the modern era against serveStdio');
      const { tools } = await client.listTools();
      assert.equal(tools.length, 9, 'overall inventory is exactly nine');
      for (const tool of ['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class', 'draft-artifact']) {
        const args = tool === 'validate-artifact' ? { surfaceId: 'alpha', content: VALID_TASKSPEC } : tool === 'draft-artifact' ? { surfaceId: 'alpha', kind: 'TaskSpec', content: DRAFT_TASKSPEC } : tool === 'inspect-registry' ? { surfaceId: 'alpha' } : tool === 'enumerate-class' ? { surfaceId: 'alpha', recordClass: 'approval-record' } : { surfaceId: 'alpha', recordClass: 'approval-record', recordId: RECORD_ID };
        const r = await client.callTool({ name: tool, arguments: args });
        assert.equal(r.isError, undefined, `${tool} must succeed`);
        assert.equal((r.structuredContent as { ok: boolean }).ok, true, `${tool} must return ok`);
      }
      // The WP-14A tools exist on every surface but fail closed with the
      // typed `unsupported` outcome when the surface has no configured
      // workspace lanes (no lane is ever invented).
      const persistR = await client.callTool({ name: 'persist-artifact', arguments: { surfaceId: 'alpha', workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa', kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal(persistR.isError, undefined);
      assert.equal((persistR.structuredContent as { ok: boolean; error?: { code: string } }).ok, false);
      assert.equal((persistR.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'unsupported');
      const changesR = await client.callTool({ name: 'inspect-changes', arguments: { surfaceId: 'alpha', workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa' } });
      assert.equal(changesR.isError, undefined);
      assert.equal((changesR.structuredContent as { ok: boolean; error?: { code: string } }).ok, false);
      assert.equal((changesR.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'unsupported');
      // Drafting through the real CLI does not mutate the store (valid draft,
      // invalid draft, unsupported kind, malformed JSON, unknown surface).
      const bad = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: '{bad' } });
      assert.equal(bad.isError, undefined);
      assert.equal((bad.structuredContent as { ok: boolean }).ok, true);
      const invalid = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: DRAFT_AUTHORITY_POLICY.replace('"kind":{"id":"AuthorityPolicy"', '"kind":{"id":"TaskSpec"') } });
      assert.equal(invalid.isError, undefined);
      const unknown = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'nope', kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal(unknown.isError, undefined);
      assert.equal((unknown.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'not-found');
    } finally {
      await client.close();
    }
    const after = snapshotStore(env.storeRoot);
    assert.equal(after, before, 'the MCP session must not mutate the store');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('stdio: EOF closes the server cleanly and the process exits', async () => {
  const env = makeStore();
  try {
    const configPath = writeConfig(env.dir, [surfaceConfig(env, 'alpha')]);
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_PATH, '--config', configPath], stderr: 'pipe' });
    const client = new Client({ name: 's5-eof-client', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(transport);
    const pid = transport.pid;
    assert.ok(pid !== null);
    await client.close();
    const exited = await waitForExit(pid, 10000);
    assert.equal(exited, true, 'the server process must exit after EOF/close');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('stdio: raw startup probe — stdout carries no banner; EOF alone exits cleanly', async () => {
  const env = makeStore();
  try {
    const configPath = writeConfig(env.dir, [surfaceConfig(env, 'alpha')]);
    const child = spawn(process.execPath, [CLI_PATH, '--config', configPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => (stdout += c));
    child.stderr.on('data', (c: string) => (stderr += c));
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    // Close stdin immediately (EOF): the server must exit cleanly.
    child.stdin.end();
    const code = await Promise.race([exited, new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000))]);
    assert.notEqual(code, null, 'the server must exit on EOF');
    assert.equal(stdout, '', 'stdout must be empty when no protocol traffic occurs (no banner)');
    assert.equal(stderr, '', 'no diagnostics on clean EOF shutdown');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('stdio: startup failures fail fast with bounded stderr and no partial server', async () => {
  const env = makeStore();
  try {
    // (a) malformed config file.
    const badPath = join(env.dir, 'bad.json');
    writeFileSync(badPath, '{not json', { mode: 0o600 });
    const run = (args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI_PATH, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (c: string) => (stdout += c));
        child.stderr.on('data', (c: string) => (stderr += c));
        child.on('exit', (code) => resolve({ code, stdout, stderr }));
        child.stdin.end();
      });
    let r = await run(['--config', badPath]);
    assert.notEqual(r.code, 0);
    assert.equal(r.stdout, '', 'no protocol output on startup failure');
    assert.ok(r.stderr.includes('project-gateway-macos-mcp:'), 'bounded stderr diagnostic expected');
    // (b) unknown flag.
    r = await run(['--bogus']);
    assert.equal(r.code, 2);
    // (c) missing config arg.
    r = await run([]);
    assert.equal(r.code, 2);
    // (d) valid config for a store whose metadata identity does not match.
    const wrongIdentityPath = writeConfig(env.dir, [surfaceConfig(env, 'alpha', { configurationIdentity: 'sha-256:' + 'b'.repeat(64) })]);
    r = await run(['--config', wrongIdentityPath]);
    assert.notEqual(r.code, 0);
    assert.ok(r.stderr.includes('project-gateway-macos-mcp:'), 'bounded stderr diagnostic expected');
    assert.equal(r.stderr.includes(env.storeRoot), false, 'no store path in diagnostics');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ─── F1-F3 correction tests (independent-review findings) ────────────────

function runCli(args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => (stdout += c));
    child.stderr.on('data', (c: string) => (stderr += c));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

test('F1: startup config byte ceiling — at-ceiling config serves; oversized config fails before serving', async () => {
  const env = makeStore();
  try {
    const configPath = writeConfig(env.dir, [surfaceConfig(env, 'alpha')]);
    const base = readFileSync(configPath, 'utf8');
    assert.ok(base.length < MAX_STARTUP_CONFIG_BYTES);
    // Exactly at the ceiling: trailing whitespace is valid JSON, so the
    // document stays valid at MAX_STARTUP_CONFIG_BYTES bytes.
    const padded = base + ' '.repeat(MAX_STARTUP_CONFIG_BYTES - base.length);
    writeFileSync(configPath, padded, { mode: 0o600 });
    assert.equal(readFileSync(configPath).length, MAX_STARTUP_CONFIG_BYTES);
    const before = snapshotStore(env.storeRoot);
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_PATH, '--config', configPath], stderr: 'pipe' });
    const client = new Client({ name: 's5-f1-client', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await client.connect(transport);
    try {
      assert.equal(client.getProtocolEra(), 'modern');
      const r = await client.callTool({ name: 'inspect-stored-record', arguments: { surfaceId: 'alpha', recordClass: 'approval-record', recordId: RECORD_ID } });
      assert.equal((r.structuredContent as { ok: boolean }).ok, true, 'at-ceiling config must serve normally');
    } finally {
      await client.close();
    }
    const after = snapshotStore(env.storeRoot);
    assert.equal(after, before, 'no project/store mutation from the bounded config read');
    // Above the ceiling: must fail before serving with bounded stderr only.
    const overPath = join(env.dir, 'over.json');
    writeFileSync(overPath, '{"surfaces":[' + ' '.repeat(MAX_STARTUP_CONFIG_BYTES - 11) + ']}', { mode: 0o600 });
    const r = await runCli(['--config', overPath]);
    assert.notEqual(r.code, 0, 'oversized config must exit non-zero');
    assert.equal(r.stdout, '', 'no protocol/banner bytes on stdout');
    assert.ok(r.stderr.includes('project-gateway-macos-mcp:'), 'bounded stderr diagnostic expected');
    assert.ok(r.stderr.includes('byte ceiling'), 'diagnostic names the ceiling');
    assert.ok(r.stderr.length < 4096, 'stderr bounded');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('F1/F2: startup config failure atomicity — valid surface A never starts with defective surface B', async () => {
  const envA = makeStore(false);
  const envB = makeStore(false);
  try {
    // B contains a duplicate configurationIdentity key (F2) and a limit
    // override above the hard maximum (F3) in separate documents.
    const validA = JSON.stringify({ surfaceId: 'alpha', locator: envA.dir, configurationIdentity: CID, configurationVersion: '1' });
    const dupB = `{"surfaceId":"beta","locator":"${envB.dir}","configurationIdentity":"${CID}","configurationIdentity":"${'sha-256:' + 'b'.repeat(64)}","configurationVersion":"1"}`;
    const limitB = `{"surfaceId":"beta","locator":"${envB.dir}","configurationIdentity":"${CID}","configurationVersion":"1","limitProfile":{"enumerationResults":65537}}`;
    for (const bad of [dupB, limitB]) {
      const configPath = join(envA.dir, 'atomic.json');
      writeFileSync(configPath, `{"surfaces":[${validA},${bad}]}`, { mode: 0o600 });
      const r = await runCli(['--config', configPath]);
      assert.notEqual(r.code, 0, 'defective surface must fail the whole startup');
      assert.equal(r.stdout, '', 'no partial server means no stdout protocol bytes');
      assert.ok(r.stderr.includes('project-gateway-macos-mcp:'), 'bounded stderr diagnostic expected');
    }
  } finally {
    rmSync(envA.dir, { recursive: true, force: true });
    rmSync(envB.dir, { recursive: true, force: true });
  }
});

test('F2: duplicate JSON object keys are rejected deterministically at every nesting level', async () => {
  const env = makeStore();
  try {
    const surface = `{"surfaceId":"alpha","locator":"${env.dir}","configurationIdentity":"${CID}","configurationVersion":"1"}`;
    const cases: { name: string; doc: string }[] = [
      { name: 'duplicate top-level surfaces', doc: `{"surfaces":[${surface}],"surfaces":[]}` },
      { name: 'duplicate per-surface configurationIdentity', doc: `{"surfaces":[{"surfaceId":"alpha","locator":"${env.dir}","configurationIdentity":"${CID}","configurationIdentity":"${'sha-256:' + 'b'.repeat(64)}","configurationVersion":"1"}]}` },
      { name: 'duplicate surfaceId', doc: `{"surfaces":[{"surfaceId":"alpha","surfaceId":"beta","locator":"${env.dir}","configurationIdentity":"${CID}","configurationVersion":"1"}]}` },
      { name: 'duplicate nested limitProfile field', doc: `{"surfaces":[{"surfaceId":"alpha","locator":"${env.dir}","configurationIdentity":"${CID}","configurationVersion":"1","limitProfile":{"enumerationResults":16,"enumerationResults":32}}]}` },
    ];
    for (const c of cases) {
      const configPath = join(env.dir, 'dup.json');
      writeFileSync(configPath, c.doc, { mode: 0o600 });
      const r = await runCli(['--config', configPath]);
      assert.notEqual(r.code, 0, `${c.name} must fail startup`);
      assert.equal(r.stdout, '', `${c.name}: no stdout protocol bytes`);
      assert.ok(r.stderr.includes('duplicate'), `${c.name}: diagnostic names the duplicate-key rejection`);
    }
    // Non-duplicate valid config still starts.
    const configPath = writeConfig(env.dir, [surfaceConfig(env, 'alpha')]);
    const r = await runCli(['--config', configPath]);
    assert.equal(r.code, 0, 'non-duplicate valid config must start (EOF exit 0)');
    assert.equal(r.stdout, '');
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('F3: limitProfile overrides enforce the committed config-selection contract (LMT-013)', async () => {
  const env = makeStore();
  try {
    const base = `{"surfaceId":"alpha","locator":"${env.dir}","configurationIdentity":"${CID}","configurationVersion":"1"`;
    const cases: { name: string; profile: string }[] = [
      { name: 'above hard maximum', profile: '{"enumerationResults":9007199254740991}' },
      { name: 'above hard maximum +1', profile: '{"enumerationResults":65537}' },
      { name: 'below hard minimum', profile: '{"recordBytes":1}' },
      { name: 'zero', profile: '{"enumerationResults":0}' },
      { name: 'negative', profile: '{"enumerationResults":-4}' },
      { name: 'fractional', profile: '{"enumerationResults":1.5}' },
      { name: 'string number', profile: '{"enumerationResults":"1024"}' },
      { name: 'unsafe integer', profile: '{"enumerationResults":9007199254740992}' },
      { name: 'non-config-selectable name', profile: '{"writers":1}' },
      { name: 'unknown limit name', profile: '{"bogus":5}' },
    ];
    for (const c of cases) {
      const configPath = join(env.dir, 'f3.json');
      writeFileSync(configPath, `{"surfaces":[${base},"limitProfile":${c.profile}}]}`, { mode: 0o600 });
      const r = await runCli(['--config', configPath]);
      assert.notEqual(r.code, 0, `${c.name} must fail startup`);
      assert.equal(r.stdout, '', `${c.name}: no stdout protocol bytes`);
      assert.ok(r.stderr.includes('config-selection contract'), `${c.name}: diagnostic names the contract gate`);
    }
    // Exact accepted boundary values (hard minimum and hard maximum) still work end to end.
    const boundaryPath = writeConfig(env.dir, [surfaceConfig(env, 'alpha', { limitProfile: { enumerationResults: 16, dirEntries: 65536 } })]);
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_PATH, '--config', boundaryPath], stderr: 'pipe' });
    const client = new Client({ name: 's5-f3-client', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await client.connect(transport);
    try {
      const r = await client.callTool({ name: 'enumerate-class', arguments: { surfaceId: 'alpha', recordClass: 'approval-record' } });
      assert.equal((r.structuredContent as { ok: boolean }).ok, true, 'boundary limit values must flow through composition');
    } finally {
      await client.close();
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test('stdio: two registered surfaces route independently through the real CLI', async () => {
  const envA = makeStore(false);
  const envB = makeStore(false);
  try {
    // Same logical record id in both stores with different content.
    const payloadA = { approved: true, marker: 'A' };
    const payloadB = { approved: true, marker: 'B' };
    const writeRec = (env: StoreFixture, payload: Record<string, unknown>): void => {
      const wp = createStorageWriteActionProvenance({ actionIdentity: 's5s-w', locator: env.dir, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CID, limitProfile: defaultLimitProfile() });
      const rec = { recordKind: 'ApprovalRecord', formatVersion: '1.0', recordId: RECORD_ID, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', trustedActionId: 's5s-w', payload, payloadDigest: computePayloadDigest(payload) };
      const r = publishRecord({ trustedConfiguration: env.config, bootstrapInput: env.trustedInput, writeActionProvenance: wp, locator: env.dir, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile(), recordClass: 'approval-record', record: rec, timeSource: { now: () => 1000, processStartTime: 500 } });
      assert.equal(r.ok, true, JSON.stringify(r.findings));
    };
    writeRec(envA, payloadA);
    writeRec(envB, payloadB);
    const configPath = writeConfig(envA.dir, [surfaceConfig(envA, 'alpha'), surfaceConfig(envB, 'beta')]);
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_PATH, '--config', configPath], stderr: 'pipe' });
    const client = new Client({ name: 's5-two-client', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await client.connect(transport);
    try {
      assert.equal(client.getProtocolEra(), 'modern');
      const ra = await client.callTool({ name: 'inspect-stored-record', arguments: { surfaceId: 'alpha', recordClass: 'approval-record', recordId: RECORD_ID } });
      const rb = await client.callTool({ name: 'inspect-stored-record', arguments: { surfaceId: 'beta', recordClass: 'approval-record', recordId: RECORD_ID } });
      assert.equal((ra.structuredContent as { result: { record: { payload: { marker: string } } } }).result.record.payload.marker, 'A');
      assert.equal((rb.structuredContent as { result: { record: { payload: { marker: string } } } }).result.record.payload.marker, 'B');
      // Drafting routes independently over the same two surfaces (no
      // cross-surface leakage, no global fallback surface).
      const da = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'alpha', kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      const db = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'beta', kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal((da.structuredContent as { ok: boolean; result: { ok: boolean } }).result.ok, true, 'draft on alpha succeeds');
      assert.equal((db.structuredContent as { ok: boolean; result: { ok: boolean } }).result.ok, true, 'draft on beta succeeds');
      // No default/global drafting surface: unregistered selector is not-found.
      const dn = await client.callTool({ name: 'draft-artifact', arguments: { surfaceId: 'gamma', kind: 'TaskSpec', content: DRAFT_TASKSPEC } });
      assert.equal((dn.structuredContent as { ok: boolean; error?: { code: string } }).error?.code, 'not-found');
    } finally {
      await client.close();
    }
  } finally {
    rmSync(envA.dir, { recursive: true, force: true });
    rmSync(envB.dir, { recursive: true, force: true });
  }
});
