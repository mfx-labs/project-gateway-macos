/**
 * WP-14A — stateless changed-context inspection adapter tests.
 *
 * Proves the changed-context surface over REAL WP-7 controlled services
 * (real Git lane + real workspace reader): fresh changed-set resolution,
 * bounded status/diff, content reads confined to the fresh changed set,
 * unrelated-path rejection, point-of-use containment/membership rechecks
 * (symlink-escape drift fails closed), bounds, binary/unsupported
 * delegation, and no silent partial success.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, mkdirSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateTrustedWorkspaceConfiguration, TRUSTED_HOST_LANE } from '../../../src/trusted/index.js';
import { initializeGitHostLane } from '../../../src/git/host-lane.js';
import { GitInspectionService } from '../../../src/git/service.js';
import { WorkspaceInspectionService } from '../../../src/reader/service.js';
import { createMcpChangesRegistry, MCP_CHANGES_TOOLS, MAX_CHANGES_CONTENT_PATHS, MAX_CHANGES_PATH_LENGTH, MAX_CHANGES_REPORTED_FILES } from '../../../src/adapters/mcp/index.js';
import type { ChangesResponse, McpChangesRegistry } from '../../../src/adapters/mcp/index.js';

const GIT_BIN = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'].find((p) => existsSync(p)) ?? 'git';
const WS = 'pgw:w:aaaaaaaaaaaaaaaa';

function git(args: string[], root: string): void {
  execFileSync(GIT_BIN, ['-C', root, ...args], { stdio: 'ignore' });
}

interface ChangesFixture {
  readonly root: string;
  readonly registry: McpChangesRegistry;
  readonly cleanup: () => void;
}

async function makeChangesFixture(): Promise<ChangesFixture> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'wp14a-changes-')));
  const root = join(base, 'workspace');
  const home = join(base, 'home');
  const tmp = join(base, 'tmpdir');
  for (const dir of [root, home, tmp]) {
    mkdirSync(dir, { recursive: true });
  }
  chmodSync(home, 0o700);
  chmodSync(tmp, 0o700);
  git(['init', '-q'], root);
  git(['config', 'user.email', 't@t'], root);
  git(['config', 'user.name', 't'], root);
  writeFileSync(join(root, 'file.txt'), 'content\n');
  writeFileSync(join(root, 'docs.md'), 'docs\n');
  git(['add', '.'], root);
  git(['commit', '-q', '-m', 'init'], root);
  git(['remote', 'add', 'origin', 'https://example.invalid/project.git'], root);
  git(['remote', 'add', 'ori"gin', 'https://example.invalid/quoted.git'], root);
  git(['config', 'remote..url', 'https://example.invalid/empty.git'], root);

  const report = validateTrustedWorkspaceConfiguration(
    {
      configurationVersion: '1',
      capabilityVocabularyVersion: 'v1',
      provenance: { sourceKind: 'trusted-local-control-plane' },
      workspaces: [{ workspaceId: WS, root }],
    },
    { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p) => p },
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.code).join(','));
  const configuration = report.configuration!;

  const laneResult = await initializeGitHostLane(GIT_BIN);
  assert.equal(laneResult.ok, true, laneResult.ok ? '' : laneResult.error.code);
  const reader = new WorkspaceInspectionService({
    configuration,
    resolveExistingPath: (p) => {
      try {
        return { ok: true, canonical: realpathSync(p) };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ELOOP') return { ok: false, code: 'loop' };
        return { ok: false, code: 'not-found' };
      }
    },
  });
  const gitService = new GitInspectionService({
    configuration,
    gitLane: laneResult.descriptor,
    envDirs: { HOME: home, TMPDIR: tmp },
  });
  const built = createMcpChangesRegistry({ registrations: [{ surfaceId: 'alpha', lane: { configuration, git: gitService, reader } }] });
  assert.equal(built.ok, true, built.message ?? '');
  const registry = built.registry as McpChangesRegistry;
  const cleanup = () => {
    gitService.dispose();
    void reader.dispose();
    rmSync(base, { recursive: true, force: true });
  };
  return { root, registry, cleanup };
}

let fixture: ChangesFixture;
before(async () => {
  fixture = await makeChangesFixture();
});
after(() => {
  fixture.cleanup();
});

function resultOf(r: ChangesResponse): Extract<ChangesResponse, { ok: true }> {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as Extract<ChangesResponse, { ok: true }>;
}

test('changes: fresh changed-set resolution — modified and untracked files appear', async () => {
  writeFileSync(join(fixture.root, 'file.txt'), 'content\nchanged\n');
  writeFileSync(join(fixture.root, 'new.txt'), 'new\n');
  const r = resultOf(await fixture.registry.changes('alpha', { workspaceId: WS }));
  const paths = r.result.changedFiles.map((f) => f.path).sort();
  assert.deepEqual(paths, ['file.txt', 'new.txt']);
  assert.equal(r.result.changedFileCount, 2);
  assert.equal(r.result.truncated, false);
  assert.equal(r.result.diff, undefined);
  assert.equal(r.result.contents, undefined);
});

test('changes: bounded diff output', async () => {
  const r = resultOf(await fixture.registry.changes('alpha', { workspaceId: WS, diff: true }));
  assert.ok(r.result.diff !== undefined);
  assert.ok(r.result.diff.text.includes('changed'), 'diff text covers the modification');
  assert.ok(r.result.diff.byteLength > 0);
  assert.equal(r.result.diff.truncated, false);
});

test('changes: content reads are confined to the fresh changed set', async () => {
  const r = resultOf(await fixture.registry.changes('alpha', { workspaceId: WS, paths: ['file.txt', 'new.txt'] }));
  assert.ok(r.result.contents !== undefined);
  assert.equal(r.result.contents.length, 2);
  const file = r.result.contents.find((c) => c.path === 'file.txt')!;
  assert.equal(file.text, 'content\nchanged\n');
  assert.equal(file.byteLength, Buffer.byteLength(file.text, 'utf8'));
  assert.equal(file.truncated, false);
});

test('changes: unrelated path rejection — an untouched project file is not readable through this surface', async () => {
  const r = await fixture.registry.changes('alpha', { workspaceId: WS, paths: ['docs.md'] });
  assert.equal(r.ok, false);
  assert.equal((r as Extract<ChangesResponse, { ok: false }>).error.code, 'membership-denied');
});

test('changes: no silent partial success — one non-member path fails the whole request', async () => {
  const r = await fixture.registry.changes('alpha', { workspaceId: WS, paths: ['file.txt', 'docs.md'] });
  assert.equal(r.ok, false);
  assert.equal((r as Extract<ChangesResponse, { ok: false }>).error.code, 'membership-denied');
});

test('changes: point-of-use containment recheck — a changed symlink escaping the workspace fails closed', async () => {
  // A symlink INSIDE the workspace that points OUTSIDE it is a changed
  // member, but the WP-7 read boundary re-checks containment at point of
  // use and rejects it (no drift/escape can be read through this surface).
  const target = join(fixture.root, '..', 'escape-target.txt');
  writeFileSync(target, 'secret\n');
  try {
    const link = join(fixture.root, 'escape-link.txt');
    symlinkSync('../escape-target.txt', link);
    git(['add', 'escape-link.txt'], fixture.root);
    const r = await fixture.registry.changes('alpha', { workspaceId: WS, paths: ['escape-link.txt'] });
    assert.equal(r.ok, false);
    const code = (r as Extract<ChangesResponse, { ok: false }>).error.code;
    assert.ok(code === 'membership-denied' || code === 'content-unreadable', `escape must fail closed through typed semantics, got ${code}`);
  } finally {
    rmSync(target, { force: true });
  }
});

test('changes: binary/unsupported content delegates to the WP-7 typed semantics', async () => {
  writeFileSync(join(fixture.root, 'bin.dat'), Buffer.from([0x00, 0x41, 0x42]));
  git(['add', 'bin.dat'], fixture.root);
  const r = await fixture.registry.changes('alpha', { workspaceId: WS, paths: ['bin.dat'] });
  assert.equal(r.ok, false);
  assert.equal((r as Extract<ChangesResponse, { ok: false }>).error.code, 'content-unreadable');
});

test('changes: bounds — content-path count and path length are capped', async () => {
  const many = Array.from({ length: MAX_CHANGES_CONTENT_PATHS + 1 }, (_, i) => `f${i}.txt`);
  const r1 = await fixture.registry.changes('alpha', { workspaceId: WS, paths: many });
  assert.equal(r1.ok, false);
  assert.equal((r1 as Extract<ChangesResponse, { ok: false }>).error.code, 'limit-exceeded');
  const long = 'x'.repeat(MAX_CHANGES_PATH_LENGTH + 1);
  const r2 = await fixture.registry.changes('alpha', { workspaceId: WS, paths: [long] });
  assert.equal(r2.ok, false);
  assert.equal((r2 as Extract<ChangesResponse, { ok: false }>).error.code, 'invalid-request');
});

test('changes: truthful truncation of a very large changed set', async () => {
  const bulk = join(fixture.root, 'bulk');
  mkdirSync(bulk);
  for (let i = 0; i < MAX_CHANGES_REPORTED_FILES + 10; i++) {
    writeFileSync(join(bulk, `f${i}.txt`), `${i}\n`);
  }
  git(['add', 'bulk'], fixture.root);
  try {
    const r = resultOf(await fixture.registry.changes('alpha', { workspaceId: WS }));
    assert.equal(r.result.truncated, true);
    assert.equal(r.result.changedFiles.length, MAX_CHANGES_REPORTED_FILES, 'reporting is capped');
    assert.ok(r.result.changedFileCount > MAX_CHANGES_REPORTED_FILES, 'the true count is still reported');
  } finally {
    rmSync(bulk, { recursive: true, force: true });
  }
});

test('changes: routing — unknown surface, laneless surface, unknown workspace, requestId echo', async () => {
  const notFound = await fixture.registry.changes('nope', { workspaceId: WS });
  assert.equal(notFound.ok, false);
  assert.equal((notFound as Extract<ChangesResponse, { ok: false }>).error.code, 'not-found');

  const laneless = createMcpChangesRegistry({ registrations: [{ surfaceId: 'beta' }] });
  assert.equal(laneless.ok, true);
  const unsupported = await (laneless.registry as McpChangesRegistry).changes('beta', { workspaceId: WS });
  assert.equal(unsupported.ok, false);
  assert.equal((unsupported as Extract<ChangesResponse, { ok: false }>).error.code, 'unsupported');

  const unknownWs = await fixture.registry.changes('alpha', { workspaceId: 'pgw:w:ffffffffffffffff' });
  assert.equal(unknownWs.ok, false);
  assert.equal((unknownWs as Extract<ChangesResponse, { ok: false }>).error.code, 'workspace-unavailable');

  const echo = await fixture.registry.changes('alpha', { workspaceId: WS, requestId: 'req-42' });
  assert.equal(echo.ok, true);
  assert.equal((echo as Extract<ChangesResponse, { ok: true }>).requestId, 'req-42');

  assert.deepEqual([...MCP_CHANGES_TOOLS], ['inspect-changes']);
});
