/**
 * WP-11 Slice 1 — controlled-write core tests (transport-free create-only
 * persistence of an accepted validated WP-10 draft).
 *
 * Proves: the fixed four-kind gate; ExecutionBundle/ExecutionResult and
 * lookalike rejection; invalid WP-10 shapes cannot become write inputs;
 * accepted Phase 2B destination grammar/containment reuse (no parallel
 * logic); existing-target reject-only policy; point-of-use revalidation
 * mandatory and stale-evidence-proof; exclusive-create conflict on raced
 * targets; exact canonicalUtf8 byte persistence; digest consistency;
 * executor boundary; redaction; typed failure categories; partial-write
 * cleanup disposition; single-file mutation scope; zero lifecycle/store/
 * audit/Git side effects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
import { persistValidatedArtifactDraft } from '../../src/writing/controlled-write.js';
import { executeDraftFileWrite } from '../../src/writing/executor.js';
import { createDraftProposal } from '../../src/drafting/proposal.js';
import { computeArtifactDigest } from '../../src/api/validate.js';
import type { ControlledWriteResult, DraftWriteExecutor, DraftWriteExecutorInput, DraftWriteExecutorResult } from '../../src/writing/types.js';
import type { ValidDraftProposalResult } from '../../src/drafting/proposal.js';
import {
  WS_A,
  WRITEABLE_KINDS,
  createdResult,
  countingResolver,
  draftContent,
  fakeExecutor,
  fixedStateResolver,
  makeFsWorkspace,
  realFsResolver,
  recordingExecutor,
  validDraft,
  validatedConfigFor,
  validFixtureModel,
} from './helpers.js';

interface WriteEnv {
  readonly workspace: ReturnType<typeof makeFsWorkspace>;
  readonly draft: ValidDraftProposalResult;
}

function env(): WriteEnv {
  const workspace = makeFsWorkspace();
  const result = validDraft('TaskSpec');
  assert.equal(result.ok, true);
  if (result.ok !== true || result.valid !== true) throw new Error('fixture draft must be a valid proposal');
  return { workspace, draft: result };
}

function writeInput(ws: ReturnType<typeof makeFsWorkspace>, draft: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const config = validatedConfigFor(ws);
  return {
    draft,
    workspaceId: WS_A,
    destination: 'task.json',
    expectedConfigurationIdentity: config.identity,
    ...overrides,
  };
}

function writeOptions(ws: ReturnType<typeof makeFsWorkspace>, executor: DraftWriteExecutor, resolver = realFsResolver()) {
  return { configuration: validatedConfigFor(ws), resolveProspectiveDestination: resolver, writeDraftFile: executor };
}

function rejected(r: ControlledWriteResult): Extract<ControlledWriteResult, { ok: false }> {
  assert.equal(r.ok, false);
  return r as Extract<ControlledWriteResult, { ok: false }>;
}

function readdirRecursive(root: string): string[] {
  const entries: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = join(dir, name);
      const childRel = rel === '' ? name : `${rel}/${name}`;
      entries.push(childRel);
      if (fs.statSync(full).isDirectory()) walk(full, childRel);
    }
  };
  walk(root, '');
  return entries.sort();
}

// ─── 1-3. kind gate ────────────────────────────────────────────────────────

test('writing: all four writeable kinds pass the kind gate and reach the executor', () => {
  const { workspace: ws, draft } = env();
  try {
    const seen: string[] = [];
    const executor: DraftWriteExecutor = (input) => {
      seen.push(input.artifactKind);
      return createdResult(123);
    };
    for (const kind of WRITEABLE_KINDS) {
      const r = persistValidatedArtifactDraft(writeInput(ws, validDraft(kind)), writeOptions(ws, executor)) as ControlledWriteResult;
      assert.equal(r.ok, true, kind);
      if (r.ok) {
        assert.equal(r.outcome, 'created');
        assert.equal(r.evidence.artifactKind, kind);
      }
    }
    assert.deepEqual(seen.sort(), [...WRITEABLE_KINDS].sort(), 'executor consulted for exactly the four kinds');
  } finally {
    ws.remove();
  }
});

test('writing: ExecutionBundle is rejected for persistence (draft-not-writeable, kind gate)', () => {
  const { workspace: ws } = env();
  try {
    const draft = validDraft('ExecutionBundle');
    assert.equal(draft.ok, true);
    const exec = fakeExecutor(createdResult(1));
    const r = rejected(persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, exec.executor)));
    assert.equal(r.category, 'draft-not-writeable');
    assert.equal(r.code, 'ERR-WRITE-KIND-UNSUPPORTED');
    assert.equal(exec.calls(), 0, 'no executor call for a non-writeable kind');
  } finally {
    ws.remove();
  }
});

test('writing: ExecutionResult and lifecycle/control-plane lookalike kinds are rejected', () => {
  const { workspace: ws, draft } = env();
  try {
    for (const kind of ['ExecutionResult', 'ApprovalRecord', 'IssuanceRecord', 'RuntimeGrant', 'TrustedWorkspaceConfiguration', 'TrustedReceipt', 'RegistrySnapshot', 'TaskSpecX', 'taskspec']) {
      const forged: Record<string, unknown> = { ...(draft as object), kind };
      const exec = fakeExecutor(createdResult(1));
      const r = rejected(persistValidatedArtifactDraft(writeInput(ws, forged), writeOptions(ws, exec.executor)));
      assert.equal(r.category, 'draft-not-writeable', kind);
      assert.equal(r.code, 'ERR-WRITE-KIND-UNSUPPORTED', kind);
      assert.equal(exec.calls(), 0, kind);
    }
  } finally {
    ws.remove();
  }
});

// ─── 4. invalid WP-10 shapes ───────────────────────────────────────────────

test('writing: invalid WP-10 results (valid:false, ok:false, forged shapes) cannot become write inputs', () => {
  const { workspace: ws } = env();
  try {
    const invalidModel = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'artifacts', 'invalid', 'semantic-task-delegated-context-instruction.json'), 'utf8')) as Record<string, unknown>;
    const invalidDraft = createDraftProposal({ kind: 'TaskSpec', content: draftContent(invalidModel) });
    assert.equal(invalidDraft.ok, true);
    if (invalidDraft.ok) assert.equal(invalidDraft.valid, false);
    const okFalseDraft = createDraftProposal({ kind: 'ExecutionResult' as never, content: draftContent(validFixtureModel('TaskSpec')) });
    assert.equal(okFalseDraft.ok, false);
    const exec = fakeExecutor(createdResult(1));
    const cases: unknown[] = [
      invalidDraft,
      okFalseDraft,
      null,
      'draft',
      42,
      { ok: true, valid: true, kind: 'TaskSpec' },
      { ok: true, valid: true, kind: 'TaskSpec', proposal: {}, validation: {} },
      { ok: true, valid: true, kind: 'TaskSpec', proposal: { instanceId: '', revisionId: '', digest: 'x', canonicalUtf8: '', level: '', model: {} }, validation: { level: '', ruleIds: [] } },
      { ok: true, valid: true, kind: 'TaskSpec', proposal: { instanceId: 'i', revisionId: 'r', digest: 'sha-256:' + '0'.repeat(64), canonicalUtf8: 'x', level: 'l', model: {} }, validation: { level: 'l', ruleIds: [1] } },
      { ok: 'true', valid: true, kind: 'TaskSpec', proposal: {}, validation: {} },
    ];
    for (const bad of cases) {
      const r = rejected(persistValidatedArtifactDraft(writeInput(ws, bad), writeOptions(ws, exec.executor)));
      assert.equal(r.category, 'draft-not-writeable', JSON.stringify(bad)?.slice(0, 80));
    }
    assert.equal(exec.calls(), 0, 'no executor call for any invalid draft shape');
  } finally {
    ws.remove();
  }
});

// ─── 5-7. destination grammar (accepted Phase 2B reuse) ────────────────────

test('writing: destination length boundaries 4095/4096 pass grammar; 4097 rejected (TAD-012)', () => {
  const { workspace: ws, draft } = env();
  try {
    const exec = fakeExecutor(createdResult(1));
    for (const length of [4095, 4096]) {
      const r = persistValidatedArtifactDraft(writeInput(ws, draft, { destination: 'a'.repeat(length) }), writeOptions(ws, exec.executor)) as ControlledWriteResult;
      assert.equal(r.ok, true, `length ${length} must pass grammar and reach the executor`);
    }
    const r = rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { destination: 'a'.repeat(4097) }), writeOptions(ws, exec.executor)));
    assert.equal(r.category, 'containment-denied');
    assert.ok(r.findings?.some((f) => f.code === 'TAD-012'), '4097 must fail with the accepted TAD-012 finding');
    assert.equal(exec.calls(), 2, 'only the two in-boundary requests reached the executor');
  } finally {
    ws.remove();
  }
});

test('writing: dot-dot traversal and other invalid destination forms are rejected by the accepted grammar', () => {
  const { workspace: ws, draft } = env();
  try {
    const exec = fakeExecutor(createdResult(1));
    const invalid = [
      '..', '../escape.json', 'a/../../b', 'a/..', '/abs.json', '/a/b', 'C:/win.json', '\\\\unc\\share\\x.json',
      'a\\b.json', 'a//b.json', 'a/b/', 'a//', './a.json', 'a/./b.json', 'a/\u0000b.json', 'a/\u0001b.json', '',
    ];
    for (const destination of invalid) {
      const r = rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { destination }), writeOptions(ws, exec.executor)));
      assert.equal(r.category, 'containment-denied', destination);
      assert.ok(r.findings !== undefined && r.findings.length > 0, destination);
      assert.equal(r.findings!.some((f) => ['TAD-008', 'TAD-009', 'TAD-010', 'TAD-011', 'TAD-012'].includes(f.code)), true, destination);
    }
    assert.equal(exec.calls(), 0, 'no executor call for any malformed destination');
  } finally {
    ws.remove();
  }
});

// ─── 8-10. existing target states / missing-only ───────────────────────────

test('writing: all existing target states fail closed (TAD-039..043); missing is the only state reaching the executor', () => {
  const { workspace: ws, draft } = env();
  try {
    const expectedCode: Record<string, string> = {
      'existing-file': 'TAD-039',
      'existing-directory': 'TAD-040',
      'existing-symlink': 'TAD-041',
      'dangling-symlink': 'TAD-042',
      'unsupported-kind': 'TAD-043',
    };
    for (const [state, code] of Object.entries(expectedCode)) {
      const exec = fakeExecutor(createdResult(1));
      const r = rejected(persistValidatedArtifactDraft(
        writeInput(ws, draft),
        writeOptions(ws, exec.executor, fixedStateResolver(state as never)),
      ));
      assert.equal(r.category, 'containment-denied', state);
      assert.equal(r.findings?.some((f) => f.code === code), true, `${state} must fail with ${code}`);
      assert.equal(exec.calls(), 0, `${state}: no executor call`);
    }
    const exec = fakeExecutor(createdResult(7));
    const ok = persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, exec.executor, fixedStateResolver('missing'))) as ControlledWriteResult;
    assert.equal(ok.ok, true);
    assert.equal(exec.calls(), 1, 'missing is the only state that reaches write sequencing');
  } finally {
    ws.remove();
  }
});

test('writing: symlink and dangling-symlink targets cannot reach a write (real filesystem)', () => {
  const { workspace: ws, draft } = env();
  try {
    symlinkSync('nowhere', join(ws.artifactRoot, 'dangling.json'));
    const exec = fakeExecutor(createdResult(1));
    const r = rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { destination: 'dangling.json' }), writeOptions(ws, exec.executor)));
    assert.equal(r.findings?.some((f) => f.code === 'TAD-042'), true);
    assert.equal(exec.calls(), 0);
    writeFileSync(join(ws.artifactRoot, 'real-target.json'), '{}');
    symlinkSync('real-target.json', join(ws.artifactRoot, 'link.json'));
    const r2 = rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { destination: 'link.json' }), writeOptions(ws, exec.executor)));
    assert.equal(r2.findings?.some((f) => f.code === 'TAD-041'), true);
    assert.equal(exec.calls(), 0);
  } finally {
    ws.remove();
  }
});

// ─── 11. missing intermediate directories ──────────────────────────────────

test('writing: missing intermediate directories are never created; destination fails closed', () => {
  const { workspace: ws, draft } = env();
  try {
    const exec = recordingExecutor(executeDraftFileWrite);
    const r = rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { destination: 'missing-dir/task.json' }), writeOptions(ws, exec.executor)));
    assert.equal(r.category, 'executor-failure');
    assert.equal(r.reason, 'missing-parent', 'missing intermediate directory fails closed at the executor');
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'missing-dir')), false, 'no directory was created');
  } finally {
    ws.remove();
  }
});

// ─── 12-14. point-of-use revalidation / raced targets ──────────────────────

test('writing: point-of-use revalidation is mandatory — exactly two evaluations on success; stale prospective evidence cannot authorize a write', () => {
  const { workspace: ws, draft } = env();
  try {
    const counted = countingResolver(realFsResolver());
    const exec = fakeExecutor(createdResult(5));
    const ok = persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, exec.executor, counted.resolver)) as ControlledWriteResult;
    assert.equal(ok.ok, true);
    assert.equal(counted.calls(), 2, 'exactly one prospective + one point-of-use evaluation');
    // Stale prospective evidence: missing at first, existing at point-of-use.
    let calls = 0;
    const staleResolver = (request: { canonicalArtifactRoot: string; absoluteProspectiveDestination: string }) => {
      calls++;
      return calls === 1 ? fixedStateResolver('missing')(request as never) : fixedStateResolver('existing-file')(request as never);
    };
    const exec2 = fakeExecutor(createdResult(5));
    const denied = rejected(persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, exec2.executor, staleResolver as never)));
    assert.equal(denied.category, 'point-of-use-conflict');
    assert.equal(denied.findings?.some((f) => f.code === 'TAD-039'), true, 'point-of-use revalidation reports the appeared target');
    assert.equal(exec2.calls(), 0, 'stale prospective evidence never reaches the executor');
  } finally {
    ws.remove();
  }
});

test('writing: a target that appears between evaluation and open produces an exclusive-create conflict and is never overwritten', () => {
  const { workspace: ws, draft } = env();
  try {
    // The resolver observations (prospective + point-of-use) claim missing
    // while the target already exists on disk — exactly the race window
    // between revalidation and open. The executor's exclusive create must
    // fail closed and never overwrite.
    writeFileSync(join(ws.artifactRoot, 'task.json'), 'PRECIOUS-ORIGINAL');
    const exec = recordingExecutor(executeDraftFileWrite);
    const r = rejected(persistValidatedArtifactDraft(
      writeInput(ws, draft),
      writeOptions(ws, exec.executor, fixedStateResolver('missing')),
    ));
    assert.equal(r.category, 'point-of-use-conflict');
    assert.equal(r.code, 'ERR-WRITE-TARGET-CONFLICT');
    assert.equal(readFileSync(join(ws.artifactRoot, 'task.json'), 'utf8'), 'PRECIOUS-ORIGINAL', 'the appeared target was never overwritten');
    assert.equal(exec.inputs.length, 1, 'the executor was reached with correlated evidence and reported the conflict');
  } finally {
    ws.remove();
  }
});

test('writing: an intermediate directory swapped after revalidation cannot redirect the create outside the artifact region', () => {
  const { workspace: ws, draft } = env();
  try {
    // The accepted flow observes artifacts/sub/d2 as real directories and
    // the target as missing (both evaluations). The race then replaces the
    // intermediate component sub with a symlink to another service-owned
    // location before the executor runs. The descriptor-anchored executor
    // must fail closed and create nothing outside the configured region.
    fs.mkdirSync(join(ws.artifactRoot, 'sub'), { mode: 0o700 });
    fs.mkdirSync(join(ws.artifactRoot, 'sub', 'd2'), { mode: 0o700 });
    const outside = join(ws.workspaceRoot, 'outside');
    fs.mkdirSync(outside, { mode: 0o700 });
    fs.mkdirSync(join(outside, 'd2'), { mode: 0o700 });
    const executor: DraftWriteExecutor = (input) => {
      fs.rmSync(join(ws.artifactRoot, 'sub'), { recursive: true });
      fs.symlinkSync(outside, join(ws.artifactRoot, 'sub'));
      return executeDraftFileWrite(input);
    };
    const r = rejected(persistValidatedArtifactDraft(
      writeInput(ws, draft, { destination: 'sub/d2/task.json' }),
      writeOptions(ws, executor),
    ));
    assert.equal(r.category, 'executor-failure');
    // Fail-closed race outcome: on Linux the anchored walk follows the
    // swapped symlink and diverges at the resolution-path identity check
    // (parent-not-verified); on Darwin the per-component O_NOFOLLOW
    // descent refuses the symlink at open (parent-not-directory or
    // symlink-loop — strictly stronger, MAC-2B). All three are closed
    // executor codes; nothing was created either way.
    assert.equal(['parent-not-verified', 'parent-not-directory', 'symlink-loop'].includes(r.reason ?? ''), true, `unexpected reason ${r.reason}`);
    assert.equal(fs.existsSync(join(outside, 'd2', 'task.json')), false, 'no file was created outside the artifact region');
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'sub', 'd2', 'task.json')), false, 'no file was created through the swapped component');
  } finally {
    ws.remove();
  }
});

test('writing: the descriptor anchor keeps the create inside the originally verified root across a post-anchor root replacement', () => {
  const { workspace: ws, draft } = env();
  try {
    // The host/test seam replaces the artifact root after the executor has
    // anchored it (rename away + replacement at the same path). The write
    // must remain bound to the already-verified object.
    const moved = `${ws.artifactRoot}-moved`;
    const executor: DraftWriteExecutor = (input) => executeDraftFileWrite({
      ...input,
      hooks: {
        afterRootOpen: () => {
          fs.renameSync(ws.artifactRoot, moved);
          fs.mkdirSync(ws.artifactRoot, { mode: 0o700 });
        },
      },
    });
    const r = persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, executor)) as ControlledWriteResult;
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(fs.existsSync(join(moved, 'task.json')), true, 'the create stayed in the originally anchored root');
      assert.equal(fs.existsSync(join(ws.artifactRoot, 'task.json')), false, 'the replacement root received nothing');
    }
    fs.rmSync(moved, { recursive: true, force: true });
  } finally {
    ws.remove();
  }
});

test('writing: a raced missing tail component cannot redirect the create outside the artifact region (scenario A)', () => {
  const { workspace: ws, draft } = env();
  try {
    // Both accepted evaluations observe `a` as missing (multi-component
    // tail). The race then replaces the first tail component with a symlink
    // to a service-owned outside directory before the executor runs. The
    // single-component invariant must fail closed before any mutation.
    const outside = join(ws.workspaceRoot, 'outside');
    fs.mkdirSync(outside, { mode: 0o700 });
    const executor: DraftWriteExecutor = (input) => {
      fs.symlinkSync(outside, join(ws.artifactRoot, 'a'));
      return executeDraftFileWrite(input);
    };
    const r = rejected(persistValidatedArtifactDraft(
      writeInput(ws, draft, { destination: 'a/b.json' }),
      writeOptions(ws, executor),
    ));
    assert.equal(r.category, 'executor-failure');
    assert.equal(r.reason, 'missing-parent');
    assert.equal(fs.existsSync(join(outside, 'b.json')), false, 'no file was created outside the artifact region');
    assert.deepEqual(fs.readdirSync(ws.artifactRoot), ['a'], 'artifact root contains only the test-installed symlink');
  } finally {
    ws.remove();
  }
});

test('writing: a pre-existing tail symlink cannot redirect the create outside the artifact region (scenario B, no race)', () => {
  const { workspace: ws, draft } = env();
  try {
    // The first tail component is ALREADY a symlink to a service-owned
    // outside directory when the request is evaluated — no race required.
    // The accepted evaluation legitimately yields a multi-component missing
    // tail; Slice 1 must fail closed without traversing it.
    const outside = join(ws.workspaceRoot, 'outside');
    fs.mkdirSync(outside, { mode: 0o700 });
    fs.symlinkSync(outside, join(ws.artifactRoot, 'a'));
    const r = rejected(persistValidatedArtifactDraft(
      writeInput(ws, draft, { destination: 'a/b.json' }),
      writeOptions(ws, executeDraftFileWrite),
    ));
    assert.equal(r.category, 'executor-failure');
    assert.equal(r.reason, 'missing-parent');
    assert.equal(fs.existsSync(join(outside, 'b.json')), false, 'no file was created outside the artifact region');
    assert.deepEqual(fs.readdirSync(ws.artifactRoot), ['a'], 'artifact root contains only the pre-existing symlink');
  } finally {
    ws.remove();
  }
});

test('writing: a multi-component missing tail below a verified ancestor cannot redirect the create (scenario E)', () => {
  const { workspace: ws, draft } = env();
  try {
    // The verified ancestor sub exists; the tail is multi-component and
    // missing. The race installs the first missing tail component as a
    // symlink toward a service-owned outside directory before create.
    fs.mkdirSync(join(ws.artifactRoot, 'sub'), { mode: 0o700 });
    const outside = join(ws.workspaceRoot, 'outside');
    fs.mkdirSync(outside, { mode: 0o700 });
    fs.mkdirSync(join(outside, 'm2'), { mode: 0o700 });
    const executor: DraftWriteExecutor = (input) => {
      fs.symlinkSync(outside, join(ws.artifactRoot, 'sub', 'm1'));
      return executeDraftFileWrite(input);
    };
    const r = rejected(persistValidatedArtifactDraft(
      writeInput(ws, draft, { destination: 'sub/m1/m2/file.json' }),
      writeOptions(ws, executor),
    ));
    assert.equal(r.category, 'executor-failure');
    assert.equal(r.reason, 'missing-parent');
    assert.equal(fs.existsSync(join(outside, 'm2', 'file.json')), false, 'no file was created outside the artifact region');
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'sub', 'm1', 'm2', 'file.json')), false, 'no file was created through the swapped component');
    assert.equal(fs.existsSync(join(ws.artifactRoot, 'sub', 'm1')), true, 'only the test-installed symlink exists');
    assert.deepEqual(fs.readdirSync(join(ws.artifactRoot, 'sub')), ['m1'], 'no unintended file in the verified parent');
  } finally {
    ws.remove();
  }
});

// ─── 15-17. exact bytes / digest consistency ───────────────────────────────

test('writing: canonicalUtf8 is persisted byte-for-byte (no newline, wrapper, reserialization, or normalization)', () => {
  const { workspace: ws, draft } = env();
  try {
    const expected = draft.proposal.canonicalUtf8;
    const r = persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, executeDraftFileWrite)) as ControlledWriteResult;
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.evidence.persistedByteCount, Buffer.byteLength(expected, 'utf8'));
      const persisted = readFileSync(join(ws.artifactRoot, 'task.json'), 'utf8');
      assert.equal(persisted, expected, 'byte-for-byte identical canonical bytes');
      assert.equal(persisted.endsWith('\n'), expected.endsWith('\n'), 'no invented trailing newline');
      assert.equal(Buffer.byteLength(persisted, 'utf8'), Buffer.byteLength(expected, 'utf8'), 'no length transformation');
    }
  } finally {
    ws.remove();
  }
});

test('writing: persisted bytes remain digest-consistent with the accepted draft', () => {
  const { workspace: ws, draft } = env();
  try {
    const r = persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, executeDraftFileWrite)) as ControlledWriteResult;
    assert.equal(r.ok, true);
    const persisted = readFileSync(join(ws.artifactRoot, 'task.json'), 'utf8');
    // The persisted canonical bytes are the accepted canonical projection
    // (the derived digest member is intentionally absent from canonicalUtf8);
    // the accepted digest computation over the persisted bytes must equal
    // the accepted draft digest.
    const model = JSON.parse(persisted) as Record<string, unknown>;
    const { digest } = computeArtifactDigest(model);
    assert.equal(digest, draft.proposal.digest, 'recomputed digest over the persisted bytes equals the accepted draft digest');
    assert.equal(model['instance_id'], draft.proposal.instanceId);
    const revision = model['revision'] as Record<string, unknown>;
    assert.equal(revision['id'], draft.proposal.revisionId);
  } finally {
    ws.remove();
  }
});

test('writing: forged draft with a non-corresponding digest cannot reach containment or the executor', () => {
  const { workspace: ws, draft } = env();
  try {
    const exec = fakeExecutor(createdResult(1));
    const forgedDigest = { ...draft, proposal: { ...draft.proposal, digest: 'sha-256:' + '0'.repeat(64) } };
    const r = rejected(persistValidatedArtifactDraft(writeInput(ws, forgedDigest), writeOptions(ws, exec.executor)));
    assert.equal(r.category, 'draft-not-writeable');
    assert.equal(r.code, 'ERR-WRITE-DRAFT-DIGEST-MISMATCH');
    assert.equal(exec.calls(), 0, 'no executor call for a digest-mismatched draft');
  } finally {
    ws.remove();
  }
});

test('writing: canonicalUtf8 mutated while retaining the accepted digest is rejected', () => {
  const { workspace: ws, draft } = env();
  try {
    const exec = fakeExecutor(createdResult(1));
    const mutated = { ...draft, proposal: { ...draft.proposal, canonicalUtf8: draft.proposal.canonicalUtf8 + ' ' } };
    const r = rejected(persistValidatedArtifactDraft(writeInput(ws, mutated), writeOptions(ws, exec.executor)));
    assert.equal(r.category, 'draft-not-writeable');
    assert.equal(r.code, 'ERR-WRITE-DRAFT-DIGEST-MISMATCH');
    assert.equal(exec.calls(), 0);
    const mutated2 = { ...draft, proposal: { ...draft.proposal, canonicalUtf8: draft.proposal.canonicalUtf8.slice(0, -1) } };
    const r2 = rejected(persistValidatedArtifactDraft(writeInput(ws, mutated2), writeOptions(ws, exec.executor)));
    assert.equal(r2.category, 'draft-not-writeable');
    assert.equal(r2.code, 'ERR-WRITE-DRAFT-DIGEST-MISMATCH');
    assert.equal(exec.calls(), 0);
  } finally {
    ws.remove();
  }
});

test('writing: bounded non-JSON canonicalUtf8 with a non-corresponding accepted digest is rejected', () => {
  const { workspace: ws, draft } = env();
  try {
    const exec = fakeExecutor(createdResult(1));
    const nonJson = { ...draft, proposal: { ...draft.proposal, canonicalUtf8: 'not json at all, just bytes', digest: 'sha-256:' + '0'.repeat(64) } };
    const r = rejected(persistValidatedArtifactDraft(writeInput(ws, nonJson), writeOptions(ws, exec.executor)));
    assert.equal(r.category, 'draft-not-writeable');
    assert.equal(r.code, 'ERR-WRITE-DRAFT-DIGEST-MISMATCH');
    assert.equal(exec.calls(), 0, 'correlation rejection happens before containment/executor authority');
  } finally {
    ws.remove();
  }
});

// ─── 18-19. authority boundary / executor isolation ────────────────────────

test('writing: a valid draft object alone cannot invoke write authority; uncorrelated operands never reach the executor', () => {
  const { workspace: ws, draft } = env();
  try {
    const exec = fakeExecutor(createdResult(1));
    const r1 = rejected(persistValidatedArtifactDraft({ draft }, writeOptions(ws, exec.executor)));
    assert.equal(r1.category, 'request-invalid');
    const r2 = rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { workspaceId: 'pgw:w:cccccccccccccccc' }), writeOptions(ws, exec.executor)));
    assert.equal(r2.category, 'containment-denied');
    assert.ok(r2.findings?.some((f) => f.code === 'TAD-003'));
    const r3 = rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { expectedConfigurationIdentity: 'sha-256:' + 'b'.repeat(64) }), writeOptions(ws, exec.executor)));
    assert.equal(r3.category, 'containment-denied');
    assert.ok(r3.findings?.some((f) => f.code === 'TAD-005'));
    assert.equal(exec.calls(), 0, 'no executor call for any uncorrelated or forged input');
  } finally {
    ws.remove();
  }
});

test('writing: caller-controlled roots or absolute executor paths cannot be introduced', () => {
  const { workspace: ws, draft } = env();
  try {
    // Extra request fields (root/path/mode/overwrite/surfaceId/resolver)
    // are rejected at the request boundary.
    for (const extra of [{ root: '/etc' }, { path: '/etc/passwd' }, { mode: 0o777 }, { overwrite: true }, { surfaceId: 'x' }, { resolveProspectiveDestination: realFsResolver() }]) {
      const r = rejected(persistValidatedArtifactDraft(writeInput(ws, draft, extra), writeOptions(ws, executeDraftFileWrite)));
      assert.equal(r.category, 'request-invalid', JSON.stringify(extra));
    }
    // The executor only ever receives decision-derived evidence.
    const exec = recordingExecutor(executeDraftFileWrite);
    const ok = persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, exec.executor)) as ControlledWriteResult;
    assert.equal(ok.ok, true);
    const input = exec.inputs[0]!;
    assert.equal(input.canonicalArtifactRoot, ws.artifactRoot);
    assert.equal(input.canonicalExistingDirectoryAncestor, ws.artifactRoot);
    assert.equal(input.canonicalAncestorRelativePath, '', 'destination in the root: the accepted ancestor IS the root');
    assert.deepEqual(input.destinationTailComponents, ['task.json']);
    assert.equal(input.artifactKind, 'TaskSpec');
    assert.equal(input.canonicalUtf8, draft.proposal.canonicalUtf8);
    assert.equal(input.operationClass, 'artifact-draft-destination');
    assert.equal(input.purpose, 'persist-validated-artifact-draft');
    assert.equal('path' in input, false);
    assert.equal('mode' in input, false);
    assert.equal('canonicalArtifactRelativeDestination' in input, false, 'no caller lexical destination reaches the executor');
    // The executor itself rejects crafted absolute/traversal evidence.
    const forgedAncestorAbs: DraftWriteExecutorInput = { ...input, canonicalAncestorRelativePath: '/etc' };
    assert.equal(executeDraftFileWrite(forgedAncestorAbs).ok, false);
    const forgedAncestorDotDot: DraftWriteExecutorInput = { ...input, canonicalAncestorRelativePath: 'a/../b' };
    assert.equal(executeDraftFileWrite(forgedAncestorDotDot).ok, false);
    const forgedTailEscape: DraftWriteExecutorInput = { ...input, destinationTailComponents: ['../escape.json'] };
    assert.equal(executeDraftFileWrite(forgedTailEscape).ok, false);
    const forgedTailSlash: DraftWriteExecutorInput = { ...input, destinationTailComponents: ['a/b.json'] };
    assert.equal(executeDraftFileWrite(forgedTailSlash).ok, false);
    const forgedRoot: DraftWriteExecutorInput = { ...input, canonicalArtifactRoot: '/' };
    assert.equal(executeDraftFileWrite(forgedRoot).ok, false);
    const forgedAncestorMismatch: DraftWriteExecutorInput = { ...input, canonicalExistingDirectoryAncestor: '/etc' };
    assert.equal(executeDraftFileWrite(forgedAncestorMismatch).ok, false);
  } finally {
    ws.remove();
  }
});

// ─── 20-22. failure model ──────────────────────────────────────────────────

test('writing: returned failures satisfy redaction requirements', () => {
  const { workspace: ws, draft } = env();
  try {
    const failures: Extract<ControlledWriteResult, { ok: false }>[] = [];
    failures.push(rejected(persistValidatedArtifactDraft({ draft, workspaceId: WS_A }, writeOptions(ws, executeDraftFileWrite))));
    failures.push(rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { destination: '../x.json' }), writeOptions(ws, executeDraftFileWrite))));
    failures.push(rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { workspaceId: 'pgw:w:dddddddddddddddd' }), writeOptions(ws, executeDraftFileWrite))));
    failures.push(rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { destination: 'no-dir/x.json' }), writeOptions(ws, executeDraftFileWrite))));
    failures.push(rejected(persistValidatedArtifactDraft(
      writeInput(ws, draft),
      writeOptions(ws, () => {
        throw new Error('SECRET-INTERNAL-DETAIL stack=deep');
      }),
    )));
    for (const f of failures) {
      const serialized = JSON.stringify(f);
      assert.equal(serialized.includes(ws.artifactRoot), false, 'no absolute artifact root in failures');
      assert.equal(serialized.includes(ws.workspaceRoot), false, 'no workspace root in failures');
      assert.equal(/SECRET|stack=|errno|ENOENT|EACCES|ENOSPC|EEXIST|\/dev|\/etc|\/tmp/.test(serialized), false, 'no internals in failures');
      assert.equal(f.message.length < 512, true, 'bounded messages');
    }
  } finally {
    ws.remove();
  }
});

test('writing: internal/executor failures are distinguished from expected target-state conflicts', () => {
  const { workspace: ws, draft } = env();
  try {
    const conflict = fakeExecutor({ ok: false, code: 'exclusive-create-conflict', cleanup: 'not-needed' });
    const r1 = rejected(persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, conflict.executor)));
    assert.equal(r1.category, 'point-of-use-conflict');
    assert.equal(r1.code, 'ERR-WRITE-TARGET-CONFLICT');
    const io = fakeExecutor({ ok: false, code: 'io-failure', cleanup: 'not-needed' });
    const r2 = rejected(persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, io.executor)));
    assert.equal(r2.category, 'executor-failure');
    assert.equal(r2.code, 'ERR-WRITE-EXECUTOR-FAILED');
    assert.equal(r2.reason, 'io-failure');
    const nosys = fakeExecutor({ ok: false, code: 'no-space', cleanup: 'removed' });
    const r3 = rejected(persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, nosys.executor)));
    assert.equal(r3.category, 'executor-failure');
    assert.equal(r3.reason, 'no-space');
    const tad = rejected(persistValidatedArtifactDraft(writeInput(ws, draft, { destination: 'a/../b.json' }), writeOptions(ws, conflict.executor)));
    assert.equal(tad.category, 'containment-denied');
  } finally {
    ws.remove();
  }
});

test('writing: partial-write cleanup is bounded and typed (removed vs indeterminate)', () => {
  const { workspace: ws, draft } = env();
  try {
    const cleaned = fakeExecutor({ ok: false, code: 'write-failed', cleanup: 'removed' });
    const r1 = rejected(persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, cleaned.executor)));
    assert.equal(r1.category, 'executor-failure');
    assert.equal(r1.reason, 'write-failed');
    const indeterminate = fakeExecutor({ ok: false, code: 'close-failed', cleanup: 'failed' });
    const r2 = rejected(persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, indeterminate.executor)));
    assert.equal(r2.category, 'cleanup-indeterminate');
    assert.equal(r2.code, 'ERR-WRITE-CLEANUP-INDETERMINATE');
    assert.equal(r2.reason, 'close-failed');
    // Real executor: a mid-write failure (injected via the test seam after
    // the exclusive create) removes the partial file (observable cleanup).
    const target = join(ws.artifactRoot, 'task.json');
    const r3 = rejected(persistValidatedArtifactDraft(
      writeInput(ws, draft),
      writeOptions(ws, (input) => executeDraftFileWrite({ ...input, hooks: { beforeWrite: () => { throw new Error('injected write failure'); } } })),
    ));
    assert.equal(r3.category, 'executor-failure');
    assert.equal(r3.reason, 'write-failed');
    assert.equal(fs.existsSync(target), false, 'the partial file was removed by the single cleanup attempt');
    // Indeterminate cleanup: cleanup unlink fails (parent made read-only by
    // the test seam) → typed cleanup-indeterminate.
    const target2 = join(ws.artifactRoot, 'indeterminate.json');
    const before = JSON.stringify(readdirRecursive(ws.artifactRoot));
    const r4 = rejected(persistValidatedArtifactDraft(
      writeInput(ws, draft, { destination: 'indeterminate.json' }),
      writeOptions(ws, (input) => executeDraftFileWrite({ ...input, hooks: { beforeWrite: () => { fs.chmodSync(ws.artifactRoot, 0o500); throw new Error('injected'); } } })),
    ));
    fs.chmodSync(ws.artifactRoot, 0o700);
    assert.equal(r4.category, 'cleanup-indeterminate');
    assert.equal(r4.code, 'ERR-WRITE-CLEANUP-INDETERMINATE');
    assert.equal(fs.existsSync(target2), true, 'the partial file could not be removed (indeterminate state reported truthfully)');
    fs.unlinkSync(target2);
    fs.chmodSync(ws.artifactRoot, 0o700);
    assert.equal(JSON.stringify(readdirRecursive(ws.artifactRoot)), before, 'only the expected partial artifact was affected');
  } finally {
    fs.chmodSync(ws.artifactRoot, 0o700);
    ws.remove();
  }
});

// ─── 23-25. mutation scope / never overwrite ───────────────────────────────

test('writing: mutation scope is exactly one newly-created artifact file; existing targets never reach overwrite behavior', () => {
  const { workspace: ws, draft } = env();
  try {
    const r = persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, executeDraftFileWrite)) as ControlledWriteResult;
    assert.equal(r.ok, true);
    assert.deepEqual(readdirRecursive(ws.artifactRoot), ['task.json'], 'exactly one new file; nothing else created');
    const before2 = JSON.stringify(readdirRecursive(ws.artifactRoot));
    // Second attempt with honest observations: the accepted policy reports
    // the existing file (TAD-039) at the prospective stage.
    const r2 = rejected(persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, executeDraftFileWrite)));
    assert.equal(r2.category, 'containment-denied');
    assert.equal(r2.findings?.some((f) => f.code === 'TAD-039'), true, 'the existing file is reported by the accepted policy');
    assert.equal(JSON.stringify(readdirRecursive(ws.artifactRoot)), before2, 'no mutation from the rejected second attempt');
    // Second attempt with stale observations: the executor's exclusive create
    // fails closed as a target conflict; the file is never overwritten.
    const before3 = readFileSync(join(ws.artifactRoot, 'task.json'), 'utf8');
    const r3 = rejected(persistValidatedArtifactDraft(
      writeInput(ws, draft),
      writeOptions(ws, executeDraftFileWrite, fixedStateResolver('missing')),
    ));
    assert.equal(r3.category, 'point-of-use-conflict');
    assert.equal(r3.code, 'ERR-WRITE-TARGET-CONFLICT');
    assert.equal(readFileSync(join(ws.artifactRoot, 'task.json'), 'utf8'), before3, 'existing file never reached overwrite behavior');
  } finally {
    ws.remove();
  }
});

test('writing: zero lifecycle/store/audit/Git side effects — only the artifact file appears', () => {
  const { workspace: ws, draft } = env();
  try {
    const r = persistValidatedArtifactDraft(writeInput(ws, draft), writeOptions(ws, executeDraftFileWrite)) as ControlledWriteResult;
    assert.equal(r.ok, true);
    const all = readdirRecursive(ws.workspaceRoot);
    assert.deepEqual(all, ['artifacts', 'artifacts/task.json'], 'no store-v1, config-v1, audit, lifecycle, or git layout appears');
    assert.equal(fs.existsSync(join(ws.workspaceRoot, '.git')), false);
  } finally {
    ws.remove();
  }
});

// ─── determinism / hostility / result immutability ─────────────────────────

test('writing: results are deterministic, deeply frozen, and hostile request objects fail closed', () => {
  const { workspace: ws, draft } = env();
  try {
    const r1 = persistValidatedArtifactDraft(writeInput(ws, draft, { destination: 'a.json' }), writeOptions(ws, executeDraftFileWrite)) as ControlledWriteResult;
    const r2 = persistValidatedArtifactDraft(writeInput(ws, draft, { destination: 'b.json' }), writeOptions(ws, executeDraftFileWrite)) as ControlledWriteResult;
    assert.equal(r1.ok && r2.ok, true);
    if (r1.ok && r2.ok) {
      const a = { ...r1.evidence, relativeDestination: 'same' };
      const b = { ...r2.evidence, relativeDestination: 'same' };
      assert.deepEqual(a, b, 'deterministic result modulo the destination operand');
      assert.equal(Object.isFrozen(r1), true);
      assert.equal(Object.isFrozen(r1.evidence), true);
      assert.equal(Object.isFrozen(r2), true);
      assert.equal(Object.getOwnPropertySymbols(r1).length, 0, 'no brand symbols on results');
    }
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'draft', { get: () => { throw new Error('trap'); }, enumerable: true });
    const r3 = rejected(persistValidatedArtifactDraft({ ...writeInput(ws, draft, { destination: 'c.json' }), draft: hostile }, writeOptions(ws, executeDraftFileWrite)));
    assert.equal(r3.category, 'request-invalid', 'hostile request structures fail closed before any field read');
  } finally {
    ws.remove();
  }
});
