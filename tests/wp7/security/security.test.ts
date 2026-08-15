/**
 * WP-7-B/C — Security evidence tests (corrected per WP-7-C senior closure
 * review findings C-02/C-05/C-06).
 *
 * Static audits (no shell, single child_process owner, no fs in FFF,
 * no network, no public export, no dependency) and dynamic mutation
 * tripwires for ALL NINE operations plus representative failure paths
 * (workspace/.git/HOME/TMPDIR/binary unchanged), ownership-aware git
 * child-process evidence (PID/PPID lineage, not a global name scan),
 * a leak-detection control, and unrelated-host-git isolation.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createWp7Fixture, createGitFixture, fingerprintTree, assertTreesEqual, sha256File, type Wp7Fixture, WORKSPACE_ALPHA } from '../helpers.js';
import { WorkspaceInspectionService } from '../../../src/reader/service.js';
import { FffProvider } from '../../../src/fff/provider.js';
import { GitInspectionService } from '../../../src/git/service.js';
import { initializeGitHostLane, type GitHostLaneDescriptor } from '../../../src/git/host-lane.js';
import { executeGit } from '../../../src/git/wrapper.js';
import { validateTrustedWorkspaceConfiguration, TRUSTED_HOST_LANE } from '../../../src/trusted/index.js';

const GIT_BIN = process.env.WP7_GIT_BINARY ?? '/usr/bin/git';
// Z-03: repository root derived from this file's location, never from the
// invocation working directory (dist-test/tests/wp7/security -> repo root).
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// ---------------------------------------------------------------------------
// Static audits
// ---------------------------------------------------------------------------

function walkDir(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walkDir(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('WP-7 security: static audits', () => {
  const srcDir = path.join(PROJECT_ROOT, 'src');
  const readerSrc = walkDir(path.join(srcDir, 'reader'));
  const gitSrc = walkDir(path.join(srcDir, 'git'));
  const fffSrc = walkDir(path.join(srcDir, 'fff'));

  it('FFF provider source never imports node:fs', () => {
    for (const p of fffSrc) {
      const src = fs.readFileSync(p, 'utf8');
      assert.ok(!src.includes('node:fs'), `node:fs forbidden in ${p}`);
    }
  });

  it('no network modules anywhere in WP-7', () => {
    for (const p of [...readerSrc, ...gitSrc, ...fffSrc]) {
      const src = fs.readFileSync(p, 'utf8');
      for (const needle of ['node:net', 'node:http', 'node:https', 'node:dgram']) {
        assert.ok(!src.includes(needle), `${needle} forbidden in ${p}`);
      }
    }
  });

  it('node:child_process is owned only by the two narrowly scoped Git modules', () => {
    const owners: string[] = [];
    for (const p of [...readerSrc, ...gitSrc, ...fffSrc]) {
      const src = fs.readFileSync(p, 'utf8');
      if (src.includes('node:child_process')) owners.push(p);
    }
    assert.deepEqual(owners.sort(), [
      path.join(srcDir, 'git', 'host-lane.ts'),
      path.join(srcDir, 'git', 'wrapper.ts'),
    ]);
  });

  it('no shell invocation anywhere in WP-7', () => {
    for (const p of [...readerSrc, ...gitSrc, ...fffSrc]) {
      const src = fs.readFileSync(p, 'utf8');
      assert.ok(!src.includes('shell: true'), `shell: true forbidden in ${p}`);
      assert.ok(!src.includes('shell:true'), `shell:true forbidden in ${p}`);
    }
  });

  it('no dynamic await import of child_process in WP-7 services', () => {
    for (const p of [...gitSrc, ...readerSrc, ...fffSrc]) {
      const src = fs.readFileSync(p, 'utf8');
      assert.ok(!src.includes("await import('node:child_process')"), `dynamic import forbidden in ${p}`);
    }
  });

  it('reader fs layer uses raw-fd ownership only (MAC-2D): no /proc, no opendirSync, no FileHandle target methods, no descriptor-path reopening', () => {
    const codeOf = (p: string): string => fs.readFileSync(p, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    const fsSrc = codeOf(path.join(srcDir, 'reader', 'fs.ts'));
    const serviceSrc = codeOf(path.join(srcDir, 'reader', 'service.ts'));
    for (const needle of ['/proc/self/fd', '/dev/fd', 'opendirSync', 'target.handle', 'handle.read', 'readlinkSync']) {
      assert.ok(!fsSrc.includes(needle), `fs.ts must not reach ${needle}`);
      assert.ok(!serviceSrc.includes(needle), `service.ts must not reach ${needle}`);
    }
    // The workspace-root FileHandle (bindWorkspaceRoot) legitimately keeps
    // its own handle.close() — only TARGET handle usage is forbidden.
    // The MAC-2D ownership model: targets close their owned raw fd via
    // close() exactly once (borrowed-root targets are no-ops); byte reads
    // are raw-fd readSync; enumeration goes through the native seam.
    assert.ok(fsSrc.includes('closeSync'), 'raw-fd closure');
    assert.ok(fsSrc.includes('readSync'), 'raw-fd byte reads');
    assert.ok(fsSrc.includes('readDirectoryEntries'), 'enumeration through the native seam');
    assert.ok(fsSrc.includes('ownsFd'), 'ownership is explicit in the target type');
    assert.ok(serviceSrc.includes('.close()'), 'targets close via the single ownership method');
    assert.ok(!serviceSrc.includes('.handle'), 'no FileHandle target surface remains in the service');
  });

  it('no Git mutation subcommands in the allowlist', () => {
    const wrapper = fs.readFileSync(path.join(srcDir, 'git', 'wrapper.ts'), 'utf8');
    const service = fs.readFileSync(path.join(srcDir, 'git', 'service.ts'), 'utf8');
    for (const mutation of ['commit', 'add', 'rm', 'checkout', 'reset', 'revert', 'cherry-pick', 'merge', 'rebase', 'fetch', 'pull', 'push', 'clean', 'tag', 'branch', 'config ']) {
      assert.ok(!service.includes(`'${mutation}'`) || mutation === 'config ', `mutation subcommand ${mutation} not in service`);
    }
  });

  it('WP-7 is not exported from the package root', () => {
    const index = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    for (const name of ['WorkspaceInspectionService', 'GitInspectionService', 'FffProvider', 'fff-discover', 'list-directory']) {
      assert.ok(!index.includes(name), `package root must not export ${name}`);
    }
  });

  it('no dependency additions beyond the WP-9 Slice 5 runtime SDK', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    // WP-9 Slice 5 added the official MCP server SDK + zod for the local
    // stdio runtime; WP-7 itself added no dependency.
    assert.deepEqual(Object.keys(pkg.dependencies ?? {}).sort(), ['@modelcontextprotocol/server', 'ajv', 'zod']);
  });

  it('no raw absolute-root or stderr disclosure in failure paths', async () => {
    const fixture = createWp7Fixture();
    try {
      const svc = new WorkspaceInspectionService({
        configuration: fixture.configuration,
        resolveExistingPath: fixture.resolveExistingPath,
      });
      const r = await svc.readText(
        { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: '../escape' },
        {},
      );
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.ok(!r.failure.messageKey.includes(fixture.root), 'no root in message key');
        assert.ok(!JSON.stringify(r.failure).includes(fixture.root), 'no root in failure');
      }
      await svc.dispose();
    } finally {
      fixture.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Ownership-aware child-process observation (C-02)
// ---------------------------------------------------------------------------

interface ProcInfo {
  pid: number;
  ppid: number;
  comm: string;
  starttime: string;
}

function readProcInfo(pid: number): ProcInfo | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const comm = stat.slice(stat.indexOf('(') + 1, close);
    const rest = stat.slice(close + 2).split(' ');
    return {
      pid,
      ppid: Number(rest[1]), // field 4
      comm,
      starttime: rest[19] ?? '', // field 22
    };
  } catch {
    return null;
  }
}

/**
 * Git-named descendants of a specific ancestor PID, derived from
 * PID/PPID lineage (not a global name scan). (pid, starttime) pairs are
 * returned so PID reuse cannot confuse observation.
 */
function gitDescendants(ancestorPid: number): Array<{ pid: number; starttime: string }> {
  const all: ProcInfo[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const info = readProcInfo(Number(entry));
    if (info) all.push(info);
  }
  const byPid = new Map(all.map((i) => [i.pid, i]));
  const out: Array<{ pid: number; starttime: string }> = [];
  for (const info of all) {
    if (!/git/.test(info.comm)) continue;
    let cur: ProcInfo | null = info;
    let hops = 0;
    while (cur && hops < 64) {
      if (cur.pid === ancestorPid) {
        out.push({ pid: info.pid, starttime: info.starttime });
        break;
      }
      cur = byPid.get(cur.ppid) ?? null;
      hops++;
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(5);
  }
  assert.ok(cond(), label);
}

// ---------------------------------------------------------------------------
// Mutation tripwires (C-05)
// ---------------------------------------------------------------------------

describe('WP-7 security: mutation tripwires — nine operations', () => {
  let fixture: Wp7Fixture;
  let git: { root: string; cleanup(): void };
  let readerService: WorkspaceInspectionService;
  let gitService: GitInspectionService;
  let fffProvider: FffProvider;
  let lane: { descriptor: GitHostLaneDescriptor };

  before(async () => {
    fixture = createWp7Fixture();
    git = createGitFixture();
    const report = validateTrustedWorkspaceConfiguration(
      {
        configurationVersion: '1',
        capabilityVocabularyVersion: 'v1',
        provenance: { sourceKind: 'trusted-local-control-plane' },
        workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: git.root }],
      },
      { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p) => p },
    );
    if (!report.ok) throw new Error('security fixture config invalid');
    const laneResult = await initializeGitHostLane(GIT_BIN);
    if (!laneResult.ok) throw new Error('lane init failed');
    lane = laneResult;
    readerService = new WorkspaceInspectionService({
      configuration: report.configuration!,
      resolveExistingPath: fixture.resolveExistingPath,
    });
    gitService = new GitInspectionService({
      configuration: report.configuration!,
      gitLane: lane.descriptor,
      envDirs: { HOME: fixture.home, TMPDIR: fixture.tmpdir },
    });
    fffProvider = new FffProvider({
      workspaceId: WORKSPACE_ALPHA,
      reader: readerService,
      budget: { visitedEntries: 0, candidateFiles: 0, totalContentBytes: 0 },
    });
  });

  after(async () => {
    await readerService.dispose().catch(() => {});
    gitService.dispose();
    git.cleanup();
    fixture.cleanup();
  });

  function tripwireState() {
    return {
      ws: fingerprintTree(git.root),
      home: fingerprintTree(fixture.home),
      tmp: fingerprintTree(fixture.tmpdir),
      bin: sha256File(GIT_BIN),
    };
  }

  function assertTripwireUnchanged(before: ReturnType<typeof tripwireState>, label: string): void {
    const after = tripwireState();
    assertTreesEqual(after.ws, before.ws, `${label}: workspace`);
    assertTreesEqual(after.home, before.home, `${label}: HOME`);
    assertTreesEqual(after.tmp, before.tmp, `${label}: TMPDIR`);
    assert.equal(after.bin, before.bin, `${label}: Git binary`);
  }

  it('list-directory leaves workspace, .git, HOME, TMPDIR, and binary unchanged', async () => {
    const before = tripwireState();
    const r = await readerService.listDirectory(
      { operation: 'list-directory', workspaceId: WORKSPACE_ALPHA, path: '.' },
      {},
    );
    assert.equal(r.ok, true);
    assertTripwireUnchanged(before, 'list-directory');
  });

  it('inspect-metadata leaves workspace, .git, HOME, TMPDIR, and binary unchanged', async () => {
    const before = tripwireState();
    const r = await readerService.inspectMetadata(
      { operation: 'inspect-metadata', workspaceId: WORKSPACE_ALPHA, path: 'file.txt' },
      {},
    );
    assert.equal(r.ok, true);
    assertTripwireUnchanged(before, 'inspect-metadata');
  });

  it('read-text leaves the actual read tree, .git, HOME, TMPDIR, and binary unchanged', async () => {
    // C-05: the operation runs on the workspace rooted at git.root; the
    // tripwire must fingerprint the tree the operation actually reads.
    const before = tripwireState();
    const r = await readerService.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'file.txt' },
      {},
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.equal((r.value as { text: string }).text, 'content\n');
    assertTripwireUnchanged(before, 'read-text');
  });

  it('read-bytes leaves workspace, .git, HOME, TMPDIR, and binary unchanged', async () => {
    const before = tripwireState();
    const r = await readerService.readBytes(
      { operation: 'read-bytes', workspaceId: WORKSPACE_ALPHA, path: 'file.txt' },
      {},
    );
    assert.equal(r.ok, true);
    assertTripwireUnchanged(before, 'read-bytes');
  });

  it('git-status leaves workspace, .git, HOME, TMPDIR, and binary unchanged', async () => {
    const before = tripwireState();
    const r = await gitService.status({ operation: 'git-status', workspaceId: WORKSPACE_ALPHA }, {});
    assert.equal(r.ok, true);
    assertTripwireUnchanged(before, 'git-status');
  });

  it('git-diff leaves workspace, .git, HOME, TMPDIR, and binary unchanged', async () => {
    const before = tripwireState();
    const r = await gitService.diff({ operation: 'git-diff', workspaceId: WORKSPACE_ALPHA }, {});
    assert.equal(r.ok, true);
    assertTripwireUnchanged(before, 'git-diff');
  });

  it('git-log leaves workspace, .git, HOME, TMPDIR, and binary unchanged', async () => {
    const before = tripwireState();
    const r = await gitService.log({ operation: 'git-log', workspaceId: WORKSPACE_ALPHA, maxRecords: 5 }, {});
    assert.equal(r.ok, true);
    assertTripwireUnchanged(before, 'git-log');
  });

  it('git-show leaves workspace, .git, HOME, TMPDIR, and binary unchanged', async () => {
    const log = await gitService.log({ operation: 'git-log', workspaceId: WORKSPACE_ALPHA }, {});
    assert.equal(log.ok, true);
    if (!log.ok) throw new Error('unreachable');
    const commitId = (log.value as { records: readonly { commitId: string }[] }).records[0]?.commitId;
    assert.ok(commitId, 'repo must have at least one commit');
    const before = tripwireState();
    const r = await gitService.show(
      { operation: 'git-show', workspaceId: WORKSPACE_ALPHA, commitId },
      {},
    );
    assert.equal(r.ok, true);
    assertTripwireUnchanged(before, 'git-show');
  });

  it('fff-discover leaves workspace, .git, HOME, TMPDIR, and binary unchanged', async () => {
    const before = tripwireState();
    const r = await fffProvider.discover(
      { operation: 'fff-discover', workspaceId: WORKSPACE_ALPHA, query: 'file' },
      {},
    );
    assert.equal(r.ok, true);
    assertTripwireUnchanged(before, 'fff-discover');
  });
});

// ---------------------------------------------------------------------------
// Failure-path tripwires (C-05)
// ---------------------------------------------------------------------------

describe('WP-7 security: failure-path tripwires', () => {
  let fixture: Wp7Fixture;
  let git: { root: string; cleanup(): void };
  let readerService: WorkspaceInspectionService;
  let gitService: GitInspectionService;
  let lane: { descriptor: GitHostLaneDescriptor };

  before(async () => {
    fixture = createWp7Fixture();
    git = createGitFixture();
    const report = validateTrustedWorkspaceConfiguration(
      {
        configurationVersion: '1',
        capabilityVocabularyVersion: 'v1',
        provenance: { sourceKind: 'trusted-local-control-plane' },
        workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: git.root }],
      },
      { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p) => p },
    );
    if (!report.ok) throw new Error('security fixture config invalid');
    const laneResult = await initializeGitHostLane(GIT_BIN);
    if (!laneResult.ok) throw new Error('lane init failed');
    lane = laneResult;
    readerService = new WorkspaceInspectionService({
      configuration: report.configuration!,
      resolveExistingPath: fixture.resolveExistingPath,
    });
    gitService = new GitInspectionService({
      configuration: report.configuration!,
      gitLane: lane.descriptor,
      envDirs: { HOME: fixture.home, TMPDIR: fixture.tmpdir },
    });
  });

  after(async () => {
    await readerService.dispose().catch(() => {});
    gitService.dispose();
    git.cleanup();
    fixture.cleanup();
  });

  function tripwireState() {
    return {
      ws: fingerprintTree(git.root),
      home: fingerprintTree(fixture.home),
      tmp: fingerprintTree(fixture.tmpdir),
      bin: sha256File(GIT_BIN),
    };
  }

  function assertTripwireUnchanged(before: ReturnType<typeof tripwireState>, label: string): void {
    const after = tripwireState();
    assertTreesEqual(after.ws, before.ws, `${label}: workspace`);
    assertTreesEqual(after.home, before.home, `${label}: HOME`);
    assertTreesEqual(after.tmp, before.tmp, `${label}: TMPDIR`);
    assert.equal(after.bin, before.bin, `${label}: Git binary`);
  }

  it('invalid request failure leaves everything unchanged', async () => {
    const before = tripwireState();
    const r = await readerService.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: '' },
      {},
    );
    assert.equal(r.ok, false);
    assertTripwireUnchanged(before, 'invalid request');
  });

  it('traversal denial failure leaves everything unchanged', async () => {
    const before = tripwireState();
    const r = await readerService.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: '../..' },
      {},
    );
    assert.equal(r.ok, false);
    assertTripwireUnchanged(before, 'traversal denial');
  });

  it('containment denial (symlink escape) failure leaves everything unchanged', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-escape-'));
    const linkPath = path.join(git.root, 'escape-link.txt');
    try {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
      fs.symlinkSync(path.join(outside, 'secret.txt'), linkPath);
      const before = tripwireState();
      const r = await readerService.readText(
        { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'escape-link.txt' },
        {},
      );
      assert.equal(r.ok, false);
      assertTripwireUnchanged(before, 'containment denial');
    } finally {
      fs.rmSync(linkPath, { force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('special-file (FIFO) rejection leaves everything unchanged', async () => {
    const fifoPath = path.join(git.root, 'pipe.fifo');
    try {
      try {
        execFileSync('mkfifo', [fifoPath], { stdio: 'ignore' });
      } catch (err: unknown) {
        throw new Error(`mkfifo unavailable on the supported Linux lane: ${String(err)}`);
      }
      const before = tripwireState();
      const r = await readerService.readText(
        { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'pipe.fifo' },
        {},
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.failure.code, 'ERR-FTYPE-UNSUPPORTED');
      assertTripwireUnchanged(before, 'special file');
    } finally {
      fs.rmSync(fifoPath, { force: true });
    }
  });

  it('malformed UTF-8 failure leaves everything unchanged', async () => {
    const p = path.join(git.root, 'split.txt');
    try {
      fs.writeFileSync(p, Buffer.from([0x61, 0x62, 0xc3, 0xa9, 0x63]));
      const before = tripwireState();
      const r = await readerService.readText(
        { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'split.txt', maxBytes: 3 },
        {},
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.failure.code, 'ERR-TEXT-MALFORMED');
      assertTripwireUnchanged(before, 'malformed UTF-8');
    } finally {
      fs.rmSync(p, { force: true });
    }
  });

  it('cancellation failure leaves everything unchanged', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const before = tripwireState();
    const r = await readerService.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'file.txt' },
      { signal: ctrl.signal },
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.code, 'ERR-OP-CANCELLED');
    assertTripwireUnchanged(before, 'cancellation');
  });

  it('git timeout leaves everything unchanged', async () => {
    const before = tripwireState();
    // Deterministic hang: `git cat-file --batch` blocks on stdin (a pipe the
    // wrapper never closes); the wrapper enforces OPERATION_TIMEOUT_MS and
    // kills the child.
    const result = await executeGit(
      lane.descriptor,
      { HOME: fixture.home, TMPDIR: fixture.tmpdir },
      git.root,
      'cat-file',
      ['--batch'],
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'timeout');
    assertTripwireUnchanged(before, 'git timeout');
  });

  it('hostile Git config denial leaves everything unchanged', async () => {
    const hostile = createGitFixture('[include]\n\tpath = /etc/passwd\n');
    const home = fingerprintTree(fixture.home);
    const tmp = fingerprintTree(fixture.tmpdir);
    const bin = sha256File(GIT_BIN);
    try {
      const report = validateTrustedWorkspaceConfiguration(
        {
          configurationVersion: '1',
          capabilityVocabularyVersion: 'v1',
          provenance: { sourceKind: 'trusted-local-control-plane' },
          workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: hostile.root }],
        },
        { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p) => p },
      );
      if (!report.ok) throw new Error('hostile fixture config invalid');
      const laneResult = await initializeGitHostLane(GIT_BIN);
      if (!laneResult.ok) throw new Error('lane init failed');
      const hostileService = new GitInspectionService({
        configuration: report.configuration!,
        gitLane: laneResult.descriptor,
        envDirs: { HOME: fixture.home, TMPDIR: fixture.tmpdir },
      });
      try {
        const r = await hostileService.status({ operation: 'git-status', workspaceId: WORKSPACE_ALPHA }, {});
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.failure.code, 'ERR-GIT-STATE-UNSUPPORTED');
      } finally {
        hostileService.dispose();
      }
    } finally {
      hostile.cleanup();
    }
    assertTreesEqual(fingerprintTree(fixture.home), home, 'hostile config: HOME');
    assertTreesEqual(fingerprintTree(fixture.tmpdir), tmp, 'hostile config: TMPDIR');
    assert.equal(sha256File(GIT_BIN), bin, 'hostile config: Git binary');
  });

  it('preflight-to-launch drift detection prevents process creation', async () => {
    const beforeWs = fingerprintTree(git.root);
    const lane2 = await initializeGitHostLane(GIT_BIN);
    assert.equal(lane2.ok, true);
    if (!lane2.ok) throw new Error('lane re-init failed');
    const { revalidateGitHostLane } = await import('../../../src/git/host-lane.js');
    const fake = { ...lane2.descriptor, initialFingerprint: { ...lane2.descriptor.initialFingerprint, ino: -1 } };
    assert.notEqual(revalidateGitHostLane(fake), null, 'drift must be detected');
    assertTreesEqual(fingerprintTree(git.root), beforeWs, 'workspace unchanged');
  });

  it('output-limit truncation leaves everything unchanged', async () => {
    const before = tripwireState();
    const r = await readerService.readText(
      { operation: 'read-text', workspaceId: WORKSPACE_ALPHA, path: 'file.txt', maxBytes: 4 },
      {},
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      const v = r.value as { byteLength: number; truncated: boolean };
      assert.equal(v.byteLength, 4);
      assert.equal(v.truncated, true);
    }
    assertTripwireUnchanged(before, 'output limit');
  });

  it('FFF budget exhaustion leaves everything unchanged', async () => {
    // A 10k-entry tree exhausts the pinned FFF visited/candidate limits,
    // forcing truncation; the scan must not mutate the workspace.
    const big = createWp7Fixture();
    try {
      for (let i = 0; i < 10_000; i++) {
        fs.writeFileSync(path.join(big.root, `f${String(i).padStart(5, '0')}.txt`), 'x\n');
      }
      const report = validateTrustedWorkspaceConfiguration(
        {
          configurationVersion: '1',
          capabilityVocabularyVersion: 'v1',
          provenance: { sourceKind: 'trusted-local-control-plane' },
          workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: big.root }],
        },
        { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p) => p },
      );
      if (!report.ok) throw new Error('big fixture config invalid');
      const bigReader = new WorkspaceInspectionService({
        configuration: report.configuration!,
        resolveExistingPath: big.resolveExistingPath,
      });
      const bigFff = new FffProvider({
        workspaceId: WORKSPACE_ALPHA,
        reader: bigReader,
        budget: { visitedEntries: 0, candidateFiles: 0, totalContentBytes: 0 },
      });
      try {
        const beforeWs = fingerprintTree(big.root);
        const beforeHome = fingerprintTree(big.home);
        const beforeTmp = fingerprintTree(big.tmpdir);
        const r = await bigFff.discover(
          { operation: 'fff-discover', workspaceId: WORKSPACE_ALPHA, query: 'f0000' },
          {},
        );
        assert.equal(r.ok, true);
        if (r.ok) {
          const v = r.value as { truncated: boolean };
          assert.equal(v.truncated, true, 'scan must be truncated by the FFF budget');
        }
        assertTreesEqual(fingerprintTree(big.root), beforeWs, 'FFF budget: workspace');
        assertTreesEqual(fingerprintTree(big.home), beforeHome, 'FFF budget: HOME');
        assertTreesEqual(fingerprintTree(big.tmpdir), beforeTmp, 'FFF budget: TMPDIR');
      } finally {
        await bigReader.dispose().catch(() => {});
      }
    } finally {
      big.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Ownership-aware child-process evidence (C-02)
// ---------------------------------------------------------------------------

describe('WP-7 security: ownership-aware child-process evidence', () => {
  // These tests observe the host process table via /proc — a Linux-only
  // mechanism. On Darwin (MAC-2D lane) they are skipped with the reason
  // recorded; the child-process reaping contract itself is exercised by
  // the git lane tests on every platform.
  const linuxOnly = process.platform !== 'linux';
  let fixture: Wp7Fixture;
  let git: { root: string; cleanup(): void };
  let readerService: WorkspaceInspectionService;
  let gitService: GitInspectionService;

  before(async () => {
    if (linuxOnly) return;
    fixture = createWp7Fixture();
    git = createGitFixture();
    const report = validateTrustedWorkspaceConfiguration(
      {
        configurationVersion: '1',
        capabilityVocabularyVersion: 'v1',
        provenance: { sourceKind: 'trusted-local-control-plane' },
        workspaces: [{ workspaceId: WORKSPACE_ALPHA, root: git.root }],
      },
      { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p) => p },
    );
    if (!report.ok) throw new Error('security fixture config invalid');
    const lane = await initializeGitHostLane(GIT_BIN);
    if (!lane.ok) throw new Error('lane init failed');
    readerService = new WorkspaceInspectionService({
      configuration: report.configuration!,
      resolveExistingPath: fixture.resolveExistingPath,
    });
    gitService = new GitInspectionService({
      configuration: report.configuration!,
      gitLane: lane.descriptor,
      envDirs: { HOME: fixture.home, TMPDIR: fixture.tmpdir },
    });
  });

  after(async () => {
    if (linuxOnly) return;
    await readerService.dispose().catch(() => {});
    gitService.dispose();
    git.cleanup();
    fixture.cleanup();
  });

  it('WP-7 git children spawned during operations are observed, then reaped', async (t: { skip: (m: string) => void }) => {
    if (linuxOnly) { t.skip('/proc process-table observation is Linux-only (MAC-2D lane)'); return; }
    const me = process.pid;
    const observed = new Set<string>();
    const poll = setInterval(() => {
      for (const d of gitDescendants(me)) observed.add(`${d.pid}:${d.starttime}`);
    }, 2);
    try {
      // Several operations so observation is robust; every child is a git
      // process launched through the constrained wrapper.
      for (let i = 0; i < 3; i++) {
        const r1 = await gitService.status({ operation: 'git-status', workspaceId: WORKSPACE_ALPHA }, {});
        assert.equal(r1.ok, true);
        const r2 = await gitService.log({ operation: 'git-log', workspaceId: WORKSPACE_ALPHA, maxRecords: 3 }, {});
        assert.equal(r2.ok, true);
      }
    } finally {
      clearInterval(poll);
    }
    assert.ok(observed.size >= 1, 'must observe at least one WP-7-owned git child during operations');
    await waitFor(() => gitDescendants(me).length === 0, 2000, 'all WP-7-owned git children must be reaped');
    assert.deepEqual(gitDescendants(me), [], 'no WP-7-owned git child may remain after operations');
  });

  it('leak-detection control: a deliberately leaked git child is detected, then cleaned up', async (t: { skip: (m: string) => void }) => {
    if (linuxOnly) { t.skip('/proc process-table observation is Linux-only (MAC-2D lane)'); return; }
    const me = process.pid;
    // Z-03: cwd pinned to the controlled git fixture repo — the evidence
    // never depends on the invocation working directory.
    const child = spawn(GIT_BIN, ['cat-file', '--batch'], { stdio: ['pipe', 'ignore', 'pipe'], cwd: git.root });
    child.stdin!.on('error', () => {});
    try {
      await new Promise<void>((resolve) => child.once('spawn', () => resolve()));
      await waitFor(() => gitDescendants(me).length > 0, 3000, 'detector must observe the deliberately leaked git child');
      assert.ok(gitDescendants(me).length >= 1, 'ownership-aware detector must flag the leaked child');
    } finally {
      try { child.stdin!.end(); } catch { /* stdin already closed */ }
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve();
        else child.once('exit', () => resolve());
      });
    }
    assert.deepEqual(gitDescendants(me), [], 'after cleanup, no WP-7-owned git child may remain');
  });

  it('unrelated host git processes are ignored (ownership-aware)', async (t: { skip: (m: string) => void }) => {
    if (linuxOnly) { t.skip('/proc process-table observation is Linux-only (MAC-2D lane)'); return; }
    const me = process.pid;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-unrelated-'));
    const fifoPath = path.join(scratch, 'stdin-fifo');
    const pidFile = path.join(scratch, 'pid');
    const scratchRepo = path.join(scratch, 'scratch-repo');
    try {
      try {
        execFileSync('mkfifo', [fifoPath], { stdio: 'ignore' });
      } catch (err: unknown) {
        throw new Error(`mkfifo unavailable on the supported Linux lane: ${String(err)}`);
      }
      // Z-03: the controlled unrelated Git process runs against a dedicated
      // scratch repository initialized here, with cwd pinned to it — the
      // evidence never depends on the caller being inside a Git repository.
      fs.mkdirSync(scratchRepo);
      execFileSync(GIT_BIN, ['init', '-q', scratchRepo], { stdio: 'ignore' });
      execFileSync(GIT_BIN, ['-C', scratchRepo, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
      execFileSync(GIT_BIN, ['-C', scratchRepo, 'config', 'user.name', 't'], { stdio: 'ignore' });
      fs.writeFileSync(path.join(scratchRepo, 'f.txt'), 'x\n');
      execFileSync(GIT_BIN, ['-C', scratchRepo, 'add', 'f.txt'], { stdio: 'ignore' });
      execFileSync(GIT_BIN, ['-C', scratchRepo, 'commit', '-q', '-m', 'init'], { stdio: 'ignore' });
      // Double-fork: a throwaway node process opens the FIFO O_RDWR (no
      // EOF possible, open never blocks) and spawns a detached git whose
      // stdin is that FIFO; the helper then exits, so git is reparented to
      // init and is NOT a descendant of this test process.
      const helperScript = `
        const { spawn } = require('node:child_process');
        const fs = require('node:fs');
        const fd = fs.openSync(${JSON.stringify(fifoPath)}, 'r+');
        const c = spawn(${JSON.stringify(GIT_BIN)}, ['cat-file', '--batch'], {
          stdio: [fd, 'ignore', 'ignore'],
          detached: true,
          cwd: ${JSON.stringify(scratchRepo)},
        });
        c.unref();
        fs.writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
        setTimeout(() => process.exit(0), 200);
      `;
      execFileSync(process.execPath, ['-e', helperScript], { stdio: 'ignore', timeout: 10_000 });
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      assert.ok(pid > 0, 'unrelated git pid must be recorded');
      await waitFor(
        () => {
          const info = readProcInfo(pid);
          return info !== null && info.ppid !== me && info.ppid !== 0;
        },
        3000,
        'unrelated git must be reparented away from the test process',
      );
      const info = readProcInfo(pid);
      assert.ok(info && /git/.test(info.comm), 'unrelated git process must be alive and named git');
      assert.deepEqual(
        gitDescendants(me).filter((d) => d.pid === pid),
        [],
        'unrelated host git process must be ignored by the ownership-aware detector',
      );
    } finally {
      try {
        process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL');
      } catch {
        /* already gone */
      }
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Z-05 — fingerprint helper fail-closed evidence
// ---------------------------------------------------------------------------

describe('WP-7 security: fingerprint helper fail-closed behavior', () => {
  function scratchTree(): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-fp-'));
    fs.mkdirSync(path.join(base, 'tree'));
    return base;
  }

  it('unreadable directory entry fails closed with a relative diagnostic', () => {
    const base = scratchTree();
    const tree = path.join(base, 'tree');
    try {
      fs.mkdirSync(path.join(tree, 'secret'));
      fs.writeFileSync(path.join(tree, 'secret', 'f.txt'), 'x');
      fs.chmodSync(path.join(tree, 'secret'), 0o000);
      try {
        fingerprintTree(tree);
        assert.fail('fingerprintTree must throw on an unreadable directory');
      } catch (err) {
        const msg = String((err as Error).message);
        assert.ok(msg.includes('secret'), `diagnostic must name the relative path: ${msg}`);
        assert.ok(!msg.includes(base), 'diagnostic must not disclose the absolute host path');
      }
    } finally {
      try { fs.chmodSync(path.join(tree, 'secret'), 0o700); } catch { /* best effort */ }
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('unreadable file entry fails closed with a relative diagnostic', () => {
    const base = scratchTree();
    const tree = path.join(base, 'tree');
    try {
      fs.writeFileSync(path.join(tree, 'locked.txt'), 'x');
      fs.chmodSync(path.join(tree, 'locked.txt'), 0o000);
      try {
        fingerprintTree(tree);
        assert.fail('fingerprintTree must throw when a file cannot be hashed');
      } catch (err) {
        const msg = String((err as Error).message);
        assert.ok(msg.includes('locked.txt'), `diagnostic must name the relative path: ${msg}`);
        assert.ok(!msg.includes(base), 'diagnostic must not disclose the absolute host path');
      }
    } finally {
      try { fs.chmodSync(path.join(tree, 'locked.txt'), 0o600); } catch { /* best effort */ }
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('a missing root fails closed (disappearing-root class)', () => {
    const base = scratchTree();
    try {
      assert.throws(() => fingerprintTree(path.join(base, 'nope')), /fingerprint/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('broken symlinks are recorded as links, never followed', () => {
    const base = scratchTree();
    const tree = path.join(base, 'tree');
    try {
      fs.symlinkSync(path.join(tree, 'does-not-exist.txt'), path.join(tree, 'broken-link'));
      const fp = fingerprintTree(tree);
      const link = fp.entries.get('broken-link');
      assert.ok(link, 'broken symlink must be recorded');
      assert.equal(link!.kind, 'link');
      assert.equal(link!.linkTarget, path.join(tree, 'does-not-exist.txt'));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('external symlink targets are recorded but never traversed', () => {
    const base = scratchTree();
    const tree = path.join(base, 'tree');
    const outside = path.join(base, 'outside');
    try {
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
      fs.symlinkSync(outside, path.join(tree, 'link-out'));
      const fp = fingerprintTree(tree);
      const link = fp.entries.get('link-out');
      assert.ok(link, 'external symlink must be recorded');
      assert.equal(link!.kind, 'link');
      assert.equal(link!.linkTarget, outside);
      const keys = [...fp.entries.keys()];
      assert.ok(!keys.includes('link-out/'), 'symlinked directory must not be traversed');
      assert.ok(!keys.some((k) => k.includes('secret.txt')), 'external target contents must never appear');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('special files (FIFO) are recorded without blocking or throwing', () => {
    const base = scratchTree();
    const tree = path.join(base, 'tree');
    try {
      try {
        execFileSync('mkfifo', [path.join(tree, 'pipe.fifo')], { stdio: 'ignore' });
      } catch (err: unknown) {
        throw new Error(`mkfifo unavailable on the supported Linux lane: ${String(err)}`);
      }
      const fp = fingerprintTree(tree);
      const entry = fp.entries.get('pipe.fifo');
      assert.ok(entry, 'FIFO must be recorded by path set');
      assert.equal(entry!.kind, 'other');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('roundtrip: two fingerprints of an unchanged tree are equal', () => {
    const base = scratchTree();
    const tree = path.join(base, 'tree');
    try {
      fs.mkdirSync(path.join(tree, 'sub'));
      fs.writeFileSync(path.join(tree, 'sub', 'a.txt'), 'aaa');
      fs.writeFileSync(path.join(tree, 'b.txt'), 'bbb');
      fs.symlinkSync('b.txt', path.join(tree, 'b-link'));
      const fp1 = fingerprintTree(tree);
      const fp2 = fingerprintTree(tree);
      assertTreesEqual(fp1, fp2, 'roundtrip');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
