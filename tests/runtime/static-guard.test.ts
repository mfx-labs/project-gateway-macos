/**
 * WP-9 Slice 5 — runtime static security guards.
 *
 * Proves the local stdio MCP runtime:
 *   - imports the MCP SDK only in runtime/server modules (never in the
 *     accepted domain/storage/adapter layers);
 *   - imports no HTTP/net/server framework, no tunnel-client, no auth/OAuth
 *     dependency;
 *   - never writes to stdout (no console.log / process.stdout) in runtime
 *     production source — stdout is MCP protocol only;
 *   - keeps trust creators localized to the composition root (compose.ts);
 *   - reaches no storage mutation owner from the protocol registration layer;
 *   - registers exactly the six committed inspection tools;
 *   - exposes no trusted creators through package exports;
 *   - the package `bin` entry maps to the runtime CLI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_INSPECTION_TOOLS, MCP_DRAFT_TOOLS, MCP_PERSIST_TOOLS, MCP_CHANGES_TOOLS } from '../../src/adapters/mcp/index.js';

const REPO = join(import.meta.dirname, '..', '..', '..');
const RUNTIME_SRC = join(REPO, 'src', 'runtime', 'mcp');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...collectTsFiles(full));
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function rel(file: string): string {
  return file.slice(REPO.length + 1);
}

const runtimeFiles = collectTsFiles(RUNTIME_SRC);
assert.ok(runtimeFiles.length >= 4, 'the runtime source tree must exist');

test('runtime static guard: no stdout writes, no network, no tunnel, no auth, no subprocess in runtime production source', () => {
  for (const file of runtimeFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of ['console.log', 'console.info', 'console.warn', 'process.stdout.write', 'node:net', 'node:http', 'net.createServer', 'http.createServer', 'WebSocket', 'node:tls', 'node:https', '@modelcontextprotocol/tunnel', 'tunnel-client', 'oauth', 'OAuth', 'child_process', 'spawn(', 'exec(', 'node:dgram']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not use ${forbidden}`);
    }
  }
});

test('runtime static guard: SDK imports appear only in server/cli modules, never in accepted layers', () => {
  for (const file of runtimeFiles) {
    const content = readFileSync(file, 'utf8');
    if (content.includes('@modelcontextprotocol/')) {
      assert.equal(/(server\.ts|cli\.ts)$/.test(file), true, `${rel(file)} may import the SDK only in the server/cli modules`);
    }
  }
  // The accepted layers stay SDK-independent.
  for (const dir of ['src/adapters/mcp', 'src/storage', 'src/api', 'src/schema', 'src/trusted']) {
    for (const file of collectTsFiles(join(REPO, dir))) {
      const content = readFileSync(file, 'utf8');
      assert.equal(content.includes('@modelcontextprotocol'), false, `${rel(file)} must not import the MCP SDK`);
    }
  }
  const rootIndex = readFileSync(join(REPO, 'src', 'index.ts'), 'utf8');
  assert.equal(rootIndex.includes('@modelcontextprotocol'), false, 'src/index.ts must stay SDK-free');
});

test('runtime static guard: trust creators are localized to the composition root and never re-exported', () => {
  for (const file of runtimeFiles) {
    const content = readFileSync(file, 'utf8');
    if (file.endsWith('compose.ts')) {
      assert.equal(content.includes('createTrustedStorageBootstrapInput'), true, 'compose.ts owns the trusted-input creation');
      assert.equal(content.includes('createStorageBootstrapActionProvenance'), true, 'compose.ts owns the provenance creation');
      assert.equal(content.includes('markValidatedTrustedWorkspaceConfiguration'), true, 'compose.ts owns the configuration brand');
      // In-process capability-generation seeding: the initialization
      // capability is created only to establish the generation entry and is
      // disposed immediately; no mutation operation is ever performed.
      assert.equal(content.includes('createInitializationCapability'), true, 'compose.ts owns the generation seeding');
      assert.equal(content.includes('.dispose()'), true, 'the seeded capability must be disposed');
      assert.equal(content.includes('namespace-initialize'), false, 'no initialization operation may be invoked');
    } else {
      for (const forbidden of ['createTrustedStorageBootstrapInput', 'createStorageBootstrapActionProvenance', 'createRecoveryActionProvenance', 'createStorageWriteActionProvenance', 'createInitializationCapability', 'markValidatedTrustedWorkspaceConfiguration']) {
        assert.equal(content.includes(forbidden), false, `${rel(file)} must not create trusted material`);
      }
    }
  }
  const entry = readFileSync(join(REPO, 'src', 'adapters', 'mcp', 'index.ts'), 'utf8');
  for (const forbidden of ['createTrustedStorageBootstrapInput', 'createStorageBootstrapActionProvenance', 'createRecoveryCapability', 'createWriteCapability']) {
    assert.equal(entry.includes(forbidden), false, `the ./mcp entry must not export ${forbidden}`);
  }
});

test('runtime static guard: no storage mutation vocabulary in the runtime', () => {
  for (const file of runtimeFiles) {
    const content = readFileSync(file, 'utf8');
    for (const forbidden of ['publishRecord', 'publishImmutableRecord', 'executeRecoveryMutation', 'executeRetentionMutation', 'acquireWriterLock', 'releaseWriterLock', 'breakWriterLock', 'executeConfigurationRecovery', 'persistRecoveryConfigurationMetadata', 'unlinkSync', 'writeFileSync', 'mkdirSync', 'rmSync', 'chmodSync', 'renameSync']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});

test('runtime static guard: exactly nine tools are registered — six WP-9 inspection plus one WP-10 drafting plus two WP-14A controlled producer tools', () => {
  const serverSrc = readFileSync(join(RUNTIME_SRC, 'server.ts'), 'utf8');
  const types = readFileSync(join(REPO, 'src', 'adapters', 'mcp', 'types.ts'), 'utf8');
  // The committed WP-9 inspection vocabulary remains exactly six — never widened.
  assert.equal(/MCP_INSPECTION_TOOLS = \['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class'\]/.test(types), true);
  for (const tool of MCP_INSPECTION_TOOLS) {
    assert.equal(serverSrc.includes(`registerTool(\n    '${tool}'`), true, `server.ts must register ${tool}`);
  }
  // The WP-10 drafting vocabulary is exactly one tool, registered once.
  assert.deepEqual([...MCP_DRAFT_TOOLS], ['draft-artifact']);
  assert.equal(serverSrc.includes("registerTool(\n    'draft-artifact'"), true, 'server.ts must register draft-artifact');
  // The WP-14A controlled-producer vocabulary is exactly two tools.
  assert.deepEqual([...MCP_PERSIST_TOOLS], ['persist-artifact']);
  assert.deepEqual([...MCP_CHANGES_TOOLS], ['inspect-changes']);
  assert.equal(serverSrc.includes("registerTool(\n    'persist-artifact'"), true, 'server.ts must register persist-artifact');
  assert.equal(serverSrc.includes("registerTool(\n    'inspect-changes'"), true, 'server.ts must register inspect-changes');
  // Distinct classes: inspection = 6, drafting = 1, persist = 1, changes = 1, overall = 9.
  const registered = [...serverSrc.matchAll(/registerTool\(\n\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(registered.length, 9, `exactly nine registerTool calls, got ${registered.length}`);
  const inspection = registered.filter((t): t is string => typeof t === 'string' && (MCP_INSPECTION_TOOLS as readonly string[]).includes(t));
  const drafting = registered.filter((t): t is string => typeof t === 'string' && (MCP_DRAFT_TOOLS as readonly string[]).includes(t));
  const persist = registered.filter((t): t is string => typeof t === 'string' && (MCP_PERSIST_TOOLS as readonly string[]).includes(t));
  const changes = registered.filter((t): t is string => typeof t === 'string' && (MCP_CHANGES_TOOLS as readonly string[]).includes(t));
  assert.equal(inspection.length, 6, 'exactly six inspection registrations');
  assert.equal(drafting.length, 1, 'exactly one drafting registration');
  assert.equal(persist.length, 1, 'exactly one persistence registration');
  assert.equal(changes.length, 1, 'exactly one changed-context registration');
  assert.deepEqual(registered.sort(), [...MCP_INSPECTION_TOOLS, ...MCP_DRAFT_TOOLS, ...MCP_PERSIST_TOOLS, ...MCP_CHANGES_TOOLS].sort(), 'no tenth tool');
  // No admin/registration/health/list-stores tool names anywhere in the runtime.
  for (const forbidden of ['list-stores', 'register-store', 'select-store', 'unregister-store', 'health']) {
    assert.equal(serverSrc.includes(`'${forbidden}'`), false, `no ${forbidden} tool`);
  }
  // No tool name implying approval/issue/execute/activate/revoke or a
  // generic file-write: the ONLY write surface is the WP-14A controlled
  // proposal persistence tool (`persist-artifact`), which routes through
  // the WP-11 boundary and is not a generic write.
  for (const forbidden of ['save-artifact', 'write-artifact', 'publish-artifact', 'approve-artifact', 'issue-artifact', 'execute-artifact', 'activate-artifact', 'revoke-artifact']) {
    assert.equal(serverSrc.includes(`'${forbidden}'`), false, `no ${forbidden} tool`);
  }
  // The drafting input schema is shape/type only: no kind enum, no byte
  // ceiling, no requestId, no destination/authority operand.
  const draftBlock = serverSrc.match(/registerTool\(\n    'draft-artifact',\n[\s\S]*?annotations:/);
  assert.ok(draftBlock !== null, 'draft-artifact registration block must be findable');
  const block = draftBlock[0] ?? '';
  assert.equal(/kind: z\.string\(\)/.test(block), true, 'kind is a plain string at the SDK layer');
  assert.equal(block.includes('z.enum'), false, 'no kind enum at the SDK layer (inner unsupported-artifact-kind must be reachable)');
  assert.equal(/content: z\.string\(\)/.test(block), true, 'content is a plain string at the SDK layer');
  assert.equal(block.includes('requestId'), false, 'no requestId tool argument');
  assert.equal(block.includes('maxLength'), false, 'no byte ceiling at the SDK layer (inner limit-exceeded must be reachable)');
  // The drafting handler must route through the accepted drafting registry
  // envelope { kind, content } without inventing a requestId.
  const draftCall = serverSrc.match(/draftingRegistry\.draft\([^;]*\);/);
  assert.ok(draftCall !== null, 'the drafting handler must route through draftingRegistry.draft');
  const call = draftCall[0] ?? '';
  assert.equal(call.includes('requestId'), false, 'the runtime must not invent a requestId');
  assert.equal(/draft\(surfaceId as string, \{ kind, content \}\)/.test(call), true, 'the runtime envelope is exactly { kind, content }');
});

test('runtime static guard: the package bin entries map to the accepted operator and runtime CLIs', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { bin?: Record<string, string> };
  const bin = pkg.bin ?? {};
  assert.equal(bin['pgw'], './dist/operator/cli.js', 'operator CLI `pgw` must map to the operator entry');
  assert.equal(bin['project-gateway-macos-mcp'], './dist/runtime/mcp/cli.js', 'MCP runtime must map to the runtime CLI entry');
  assert.deepEqual(Object.keys(bin).sort(), ['pgw', 'project-gateway-macos-mcp'], 'exactly the two approved bin entries, no alias');
  // The CLI is the modern stdio entry: serveStdio, never connect(StdioServerTransport).
  const cliSrc = readFileSync(join(RUNTIME_SRC, 'cli.ts'), 'utf8');
  assert.equal(cliSrc.includes("from '@modelcontextprotocol/server/stdio'"), true);
  assert.equal(cliSrc.includes('serveStdio('), true);
  assert.equal(cliSrc.includes('StdioServerTransport'), false, 'the CLI must not hand-connect transports');
  assert.equal(cliSrc.includes('legacy:'), false, 'the CLI must use the SDK default legacy compatibility behavior');
});
