/**
 * WP-11 Slice 1 — controlled-write static security guards.
 *
 * Proves the writing module family:
 *   - the pure core (`controlled-write.ts`, `types.ts`) performs NO
 *     filesystem I/O: `node:fs` appears ONLY in the injected host executor
 *     module (`executor.ts`);
 *   - the core reuses the accepted WP-6 Phase 2B containment implementation
 *     (`evaluateProspectiveArtifactDestination`) and introduces NO parallel
 *     traversal/ancestor/symlink/containment/evidence logic;
 *   - no lifecycle, storage (WP-8), Git, execution, MCP, or transport
 *     machinery is imported anywhere in the family;
 *   - the fixed four-kind vocabulary is the accepted
 *     `ARTIFACT_DRAFT_LOCATION_KINDS` (no second list);
 *   - the executor is create-only (O_CREAT|O_EXCL|O_NOFOLLOW) with a fixed
 *     implementation-owned mode; no generic write/overwrite/rename/append
 *     API exists;
 *   - the executor anchors the mutation to a retained artifact-root
 *     descriptor and verifies the parent's descriptor-bound resolution
 *     path through the accepted Darwin native seam
 *     (`src/internal/darwin-fs/adapter.ts`, MAC-1 five-primitive addon;
 *     MAC-2B) — no absolute lexical re-walk, no `/proc`, no `/dev/fd`;
 *   - the Darwin adapter is the executor's ONLY filesystem bridge
 *     besides `node:fs` descriptor ops: single-component openat descent,
 *     F_GETPATH identity evidence, exclusive create, at-most-one
 *     cleanup unlink; no generic filesystem authority;
 *   - no network, subprocess, timers, randomness, environment, or global
 *     fetch access (equivalent-or-stronger than the generic security scan
 *     from which src/writing is excluded by boundary);
 *   - bare `fs` import spellings, `fs/promises`, dynamic fs imports, and
 *     `require('fs')` are forbidden everywhere (only `node:fs` in the
 *     executor and the adapter);
 *   - the package root and `./mcp` do not expose the write capability.
 *
 * Future files added under src/writing/** or src/internal/darwin-fs/**
 * are automatically covered (the directories are walked at guard runtime).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const WRITING_SRC = join(REPO, 'src', 'writing');
const DARWIN_FS_SRC = join(REPO, 'src', 'internal', 'darwin-fs');

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

const writingFiles = collectTsFiles(WRITING_SRC);
const darwinFsFiles = collectTsFiles(DARWIN_FS_SRC);
const familyFiles = [...writingFiles, ...darwinFsFiles];
assert.ok(writingFiles.length >= 3, 'the writing source tree must exist');
assert.ok(darwinFsFiles.length >= 1, 'the darwin-fs adapter tree must exist');

/** Strip comments so accurate mechanism documentation never trips token checks; code is scanned verbatim. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

test('writing static guard: node:fs appears only in the executor and the Darwin adapter', () => {
  for (const file of familyFiles) {
    const content = codeOf(file);
    if (file.endsWith('executor.ts')) {
      assert.equal(content.includes("from 'node:fs'"), true, 'the executor owns the filesystem boundary');
      assert.equal(content.includes('openSync'), true);
      assert.equal(content.includes('writeSync'), true);
      assert.equal(content.includes('unlinkSync'), false, 'cleanup goes through the native unlinkAt seam (MAC-2B)');
    } else if (file.endsWith('adapter.ts')) {
      assert.equal(content.includes("from 'node:fs'"), true, 'the adapter closes intermediate descent fds');
      assert.equal(content.includes('closeSync'), true);
      // The adapter is the executor's bridge to the native seam only.
      assert.equal(content.includes('openSync'), false, 'the adapter never opens by path');
      assert.equal(content.includes('writeSync'), false, 'the adapter never writes');
      assert.equal(content.includes('unlinkSync'), false, 'the adapter never unlinks by path');
      assert.equal(content.includes('readlinkSync'), false, 'identity comes from the native getPath seam');
      assert.equal(content.includes('realpath'), false, 'no pathname canonicalization in the adapter');
    } else {
      assert.equal(content.includes('node:fs'), false, `${rel(file)} must be I/O-free (no node:fs)`);
      assert.equal(content.includes('openSync'), false, `${rel(file)} must not reach fs primitives`);
      assert.equal(content.includes('writeSync'), false, `${rel(file)} must not reach fs primitives`);
      assert.equal(content.includes('unlinkSync'), false, `${rel(file)} must not reach fs primitives`);
    }
  }
});

test('writing static guard: no bare/dynamic fs import spellings or fs/promises anywhere (equivalent to the generic dist scan)', () => {
  for (const file of writingFiles) {
    const content = codeOf(file);
    // The executor's canonical 'node:fs' import never contains these tokens.
    for (const forbidden of [
      "from 'fs'", 'from "fs"', "from 'fs/promises'", 'from "fs/promises"',
      "require('fs')", 'require("fs")', "require('fs/promises')", 'require("fs/promises")',
      'node:fs/promises',
      'import("fs")', 'import("node:fs")', "import('fs')", "import('node:fs')",
      "import('fs/promises')", 'import("fs/promises")',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});

test('writing static guard: the core reuses the accepted Phase 2B containment implementation — no parallel containment logic', () => {
  const core = readFileSync(join(WRITING_SRC, 'controlled-write.ts'), 'utf8');
  assert.equal(core.includes('evaluateProspectiveArtifactDestination'), true, 'the core must call the accepted containment evaluator');
  assert.equal(core.includes('ARTIFACT_DRAFT_LOCATION_KINDS'), true, 'the accepted four-kind vocabulary is reused');
  assert.equal(core.includes('computeArtifactDigestOverCanonicalUtf8'), true, 'the accepted digest correlation check is reused');
  // No traversal/ancestor/symlink/containment/evidence logic may exist in the family outside the accepted evaluator.
  for (const file of writingFiles) {
    if (file.endsWith('executor.ts')) continue; // the executor performs the descriptor-bound open pattern only
    const content = codeOf(file);
    for (const forbidden of ['lstat', 'realpath', 'readdir', 'readlink', 'statSync', 'isSymbolicLink', 'resolveProspectiveDestination = (', 'walk(', 'ancestorOf', 'contains(']) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not implement parallel filesystem observation or containment logic (${forbidden})`);
    }
  }
});

test('writing static guard: no lifecycle, storage, Git, execution, MCP, transport, network, or fetch capability', () => {
  for (const file of writingFiles) {
    const content = codeOf(file);
    for (const forbidden of [
      '../../storage/', '../storage/', 'publishRecord', 'publishImmutableRecord', 'WriteCapability', 'createWriteCapability',
      '../../lifecycle/', '../lifecycle/', 'RuntimeGrant', 'approve', 'issue(', 'activate', 'revoke',
      '../../git/', '../git/', 'child_process', 'spawn(', 'exec(',
      '../../runtime/', '../runtime/', '@modelcontextprotocol', 'mcp/',
      'node:net', 'node:http', 'node:https', 'node:tls', 'node:dgram', 'WebSocket',
      'fetch(',
      'Math.random', 'Date.now', 'setTimeout', 'setInterval', 'process.env',
    ]) {
      assert.equal(content.includes(forbidden), false, `${rel(file)} must not reach ${forbidden}`);
    }
  }
});

test('writing static guard: the executor is create-only with a fixed mode and descriptor anchoring — no generic write/overwrite/rename/append API', () => {
  const executor = codeOf(join(WRITING_SRC, 'executor.ts'));
  assert.equal(executor.includes('createExclusiveFile'), true, 'exclusive create through the sealed native seam');
  assert.equal(/DRAFT_FILE_MODE = 0o600/.test(executor), true, 'fixed implementation-owned mode');
  for (const forbidden of ['renameSync', 'copyFileSync', 'appendFileSync', 'truncateSync', 'mkdirSync', 'writeFileSync', 'rmSync', 'chownSync']) {
    assert.equal(executor.includes(forbidden), false, `executor must not reach ${forbidden}`);
  }
  assert.equal(executor.includes('O_TRUNC'), false, 'no truncate/overwrite flag');
  assert.equal(executor.includes('fsyncSync'), false, 'fsync/durability policy remains deferred');
  // Exactly one target-create call and exactly one cleanup-unlink call
  // (at most one bounded best-effort partial-write removal attempt), both
  // through the native seam.
  assert.equal((executor.match(/createExclusiveFile\(/g) ?? []).length, 1, 'exactly one target create site through the seam');
  assert.equal(executor.includes('unlinkSync'), false, 'no direct unlink remains in the executor');
  assert.equal((executor.match(/function cleanupCreatedTarget\(/g) ?? []).length, 1, 'single bounded cleanup helper definition');
  // Descriptor anchoring: the mutation is derived relative to a retained
  // artifact-root descriptor and verified against the accepted canonical
  // ancestor — never an absolute lexical re-walk, never /proc.
  assert.equal(executor.includes('/proc/self/fd/'), false, 'no active /proc dependency remains (MAC-2B)');
  assert.equal(executor.includes('readlinkSync'), false, 'descriptor identity comes from the native getPath seam');
  assert.equal(executor.includes('parent-not-verified'), true, 'intermediate-swap divergence fails closed');
  assert.equal(executor.includes('canonicalAncestorRelativePath'), true, 'decision-derived canonical ancestor relative path');
  assert.equal(executor.includes('destinationTailComponents'), true, 'decision-derived missing tail');
  // Single-component create invariant: the create/unlink path is exactly
  // ONE final component below the verified parent. A multi-component tail
  // must fail closed before any mutation, and no joined-tail path may ever
  // reach the seam (O_NOFOLLOW protects only a final component).
  assert.equal(executor.includes('tail.length !== 1'), true, 'single-component tail invariant enforced before mutation');
  assert.equal(executor.includes('tail.length === 0'), true, 'zero-length tail classified as invalid evidence');
  assert.equal(executor.includes('tail.join'), false, 'no joined multi-component tail path may exist');
  assert.equal(executor.includes('finalComponent'), true, 'create/unlink consume the single final component');
  assert.equal(executor.includes('missing-parent'), true, 'multi-component tail fails closed as missing-parent');
  assert.equal((executor.match(/cleanupCreatedTarget\(parentFd, finalComponent\)/g) ?? []).length >= 4, true, 'every post-create failure cleanup uses the same verified parent + single component');
});

test('writing static guard: the Darwin adapter exposes only the executor bridge — no generic filesystem authority, no /proc, no /dev/fd', () => {
  const adapter = codeOf(join(DARWIN_FS_SRC, 'adapter.ts'));
  // The adapter's only imports: node:fs (best-effort close) and the
  // sealed native seam loader. Nothing else.
  assert.equal(adapter.includes("from '#gateway-native'"), true, 'adapter bridges the accepted native seam');
  assert.equal(adapter.includes("from 'node:fs'"), true, 'adapter may close intermediate fds');
  for (const forbidden of [
    '/proc', '/dev/fd', 'openSync', 'writeSync', 'unlinkSync', 'readlinkSync', 'realpath',
    'renameSync', 'mkdirSync', 'rmSync', 'chmodSync', 'chownSync', 'readdirSync', 'opendirSync',
    "from 'fs'", "from 'fs/promises'", 'fs/promises', "require('fs')", "require('fs/promises')",
    'child_process', 'spawn(', 'exec(', 'node:net', 'node:http', 'fetch(', 'process.env',
    'Math.random', 'Date.now', 'setTimeout', 'setInterval',
  ]) {
    assert.equal(adapter.includes(forbidden), false, `adapter must not reach ${forbidden}`);
  }
  // No exported operation accepts an absolute path or arbitrary flags/modes.
  for (const signature of ['open(', 'unlink(', 'mkdir(', 'chmod(', 'createExclusiveFileAt(parentFd, finalComponent,']) {
    assert.equal(adapter.includes(signature), false, `adapter must not expose ${signature}`);
  }
  // getPath output is identity evidence only: the adapter must never feed
  // a path back into an open/create/unlink. (Structural: the adapter has
  // no path-accepting operation other than the executor-validated single
  // component; descent/identity/create/unlink are the only exports.)
  assert.equal(adapter.includes('getPath(parentFd)'), true, 'identity evidence via getPath');
  assert.equal(adapter.includes('r.path'), true, 'getPath result is compared, never reopened');
});

test('writing static guard: the write capability is not exposed through the package root or ./mcp', () => {
  const root = readFileSync(join(REPO, 'src', 'index.ts'), 'utf8');
  const mcp = readFileSync(join(REPO, 'src', 'adapters', 'mcp', 'index.ts'), 'utf8');
  for (const forbidden of ['persistValidatedArtifactDraft', 'executeDraftFileWrite', 'writeLoop', 'from \'../writing/', 'from \'../../writing/', 'controlled-write', 'writing/']) {
    assert.equal(root.includes(forbidden), false, `package root must not expose ${forbidden}`);
    assert.equal(mcp.includes(forbidden), false, `./mcp must not expose ${forbidden}`);
  }
});
