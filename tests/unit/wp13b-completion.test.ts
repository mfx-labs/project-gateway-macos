/**
 * WP-13B — completion & result FOCUSED tests.
 *
 * Real WP-5A plan projection, real WP-5B enforcement evidence (hermetic
 * pi-guard fake), real WP-4 validation pipeline, real WP-12 recordValidation
 * command flow (fake store), a real result-write executor over temporary
 * workspace roots, and a fake observation/outcome construction path.
 * Covers: originate, adopt, incompatible candidates, second-instance
 * conflict, no-result paths (EXE-008/009), exact correlation, WP-4
 * rejection, write containment/ownership/recovery, WP-12 recording
 * success/failure/malformed-return containment, no publication/receipt
 * production.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, statSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanupTestEnvs, makeContext, makeFakeStore, makeIntegrationEnv, WS_A, FIXED_NOW } from './wp12-helpers.js';
import { buildWorld, corpusArtifactSet, SUPPORT } from '../pi-adapter/helpers.js';
import { projectExecutionBundleToPi } from '../../src/adapters/pi/projection.js';
import { createPiHostBridge, observePiExecution, isPiExecutionObservation } from '../../src/adapters/pi/index.js';
import { mockSurface, fire, hostCtx, type MockSurface } from '../pi-adapter/unit/mock-surface.js';
import { createFakeGuard, verifiedPackageInspection } from '../pi-adapter/enforcement/fake-guard.js';
import { standardSurface, HOST_TIMESTAMP, TIMESTAMP_SOURCE } from '../pi-adapter/enforcement/world.js';
import { runTrustedEnforcement } from '../../src/adapters/pi/enforcement/index.js';
import { validateArtifactSelf, createSchemaRegistry } from '../../src/api/validate.js';
import { captureSlice1Request } from '../../src/control-plane/subject.js';
import { INPUT_BYTE_LIMITS } from '../../src/internal/phase.js';
import { brandObservationWrapper } from '../../src/adapters/pi/internal/brand.js';
import type { PiInvocationPlan, PiExecutionObservation } from '../../src/adapters/pi/types.js';
import type { ExecutionAttemptDisposition, ExecutionAttemptOutcome } from '../../src/execution/types.js';
import type { ValidatedArtifact } from '../../src/api/types.js';
import type { ControlPlaneStoreBoundary } from '../../src/control-plane/types.js';
import {
  completeExecution,
  createResultValidationBoundary,
  writeResultArtifact,
  RESULT_BYTE_LIMIT,
  COMPLETION_EVALUATOR_ID,
  COMPLETION_EVALUATOR_CAPABILITY_PROFILE_ID,
} from '../../src/completion/index.js';
import type { CompletionInput, CompletionResult, ValidatedResultHandoff, ResultIdentitySource } from '../../src/completion/types.js';

const OCCURRENCE_ID = 'pgw:o:' + 'a'.repeat(32);
const ATTEMPT_ID = 'pgw:a:' + '1'.repeat(32);
const GRANT_ID = 'pgw:l:' + 'c'.repeat(32);
const ATTEMPT_RECORD_ID = 'pgw:l:' + 'd'.repeat(32);
const OCCURRENCE_RECORD_ID = 'pgw:l:' + 'e'.repeat(32);
const ACTIVATION_RECORD_ID = 'pgw:l:' + 'f'.repeat(32);
const SECRET_MARKER = 'SIR-WP13B-SECRET';

const registry = createSchemaRegistry();
const contractArtifact: ValidatedArtifact = (() => {
  const report = validateArtifactSelf(corpusArtifactSet().completion, registry);
  if (report.ok !== true || report.value === undefined) throw new Error('completion contract fixture failed self-validation');
  return report.value;
})();

const roots: string[] = [];
after(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  cleanupTestEnvs();
});

function makePlan(): PiInvocationPlan {
  const world = buildWorld();
  const result = projectExecutionBundleToPi({ ...world.input(), occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID });
  if (!result.ok || result.plan === undefined) throw new Error('plan projection failed');
  return result.plan;
}

/** Real observation derived from fired host events (WP-5A collector). */
function makeObservation(completionText = 'task complete', extraText = ''): PiExecutionObservation {
  const plan = makePlan();
  const surface = mockSurface();
  const wired = createPiHostBridge(surface, plan);
  if (!wired.ok || wired.bridge === undefined) throw new Error('bridge wiring failed');
  const s = surface as MockSurface;
  fire(s, 'session_start', { reason: 'startup' }, hostCtx('sess-1'));
  fire(s, 'turn_start', { turnIndex: 0, timestamp: 1000 });
  fire(s, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: completionText + extraText }] } });
  fire(s, 'agent_settled', {});
  fire(s, 'session_shutdown', { reason: 'quit' });
  const bridge = wired.bridge;
  if (bridge.sessionCorrelationId === undefined || bridge.turnCorrelationId === undefined) throw new Error('no session/turn correlation');
  const obs = observePiExecution(bridge, { sessionCorrelationId: bridge.sessionCorrelationId, turnCorrelationId: bridge.turnCorrelationId });
  if (!isPiExecutionObservation(obs)) throw new Error('observation not branded');
  return obs;
}

/** Real WP-5B enforcement evidence fingerprint over the exact plan. */
function makeEnforcementFingerprint(): string {
  const fake = createFakeGuard('normal');
  const surface = standardSurface();
  const world = buildWorld();
  const plan = makePlan();
  const result = runTrustedEnforcement({
    plan,
    eligibility: world.eligibility,
    activation: {
      decision: 'accepted',
      runtimeGrantId: GRANT_ID,
      reservedOccurrenceId: OCCURRENCE_ID,
      resolvedOccurrenceId: OCCURRENCE_ID,
      attemptId: plan.attemptId,
      grantCurrent: true,
    },
    workspaceIdentity: WS_A,
    capabilityVocabularyVersion: '1',
    expectedToolSources: [],
    evaluatorVersion: '2',
    piHost: { piIdentity: '@earendil-works/pi-coding-agent', piVersion: '0.83.0' },
    consumer: SUPPORT,
    guard: { packageInspection: verifiedPackageInspection(), api: fake.api },
    surface,
    hostTimestamp: HOST_TIMESTAMP,
    timestampSource: TIMESTAMP_SOURCE,
  });
  if (!result.ok) throw new Error('enforcement evidence failed');
  return result.evidence.evidenceFingerprint;
}

function makeAttemptFacts() {
  return {
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    ordinal: 1,
    attemptRecordId: ATTEMPT_RECORD_ID,
    occurrenceRecordId: OCCURRENCE_RECORD_ID,
    activationRecordId: ACTIVATION_RECORD_ID,
    runtimeGrantId: GRANT_ID,
  };
}

function makeOutcome(disposition: ExecutionAttemptDisposition = 'completed'): ExecutionAttemptOutcome {
  const retryable = disposition === 'failed' || disposition === 'cancelled' || disposition === 'timed-out' || disposition === 'crashed';
  return {
    disposition,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    ordinal: 1,
    observedAt: FIXED_NOW,
    retry: { eligible: retryable, ...(retryable ? {} : { reason: disposition === 'completed' ? ('terminal-completed' as const) : disposition === 'rejected' ? ('terminal-rejected' as const) : ('terminal-ambiguous' as const) }) },
  };
}

function newRoot(): string {
  // realpath-canonical root (MAC-2C): the writer verifies the root's
  // descriptor identity against the vnode-canonical F_GETPATH path, and
  // production canonical roots are symlink-resolved (src/trusted/roots.ts).
  // tmpdir() is /var/folders/… whose vnode-canonical form is
  // /private/var/folders/… — lexical roots would fail parent-not-verified.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wp13b-')));
  roots.push(root);
  return root;
}

function freshDestination(root: string): string {
  const dir = join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID);
  mkdirSync(dir, { recursive: true });
  return join(dir, 'execution-result.json');
}

/**
 * Deterministic fake opaque identity source (D-3 pattern): fresh
 * `pgw:i:`/`pgw:r:`/`pgw:e:` identifiers with committed syntax. Values are
 * opaque (never derived from content); the counter only guarantees
 * uniqueness within the test process.
 */
let identityCounter = 0;
function makeIdentitySource(): ResultIdentitySource {
  const next = (prefix: string) => () => `${prefix}${(identityCounter++).toString(16).padStart(32, '0')}`;
  return {
    newResultInstanceId: next('pgw:i:'),
    newResultRevisionId: next('pgw:r:'),
    newEvidenceId: next('pgw:e:'),
  };
}

function makeEnv(overrides: Partial<CompletionInput> = {}): { readonly input: CompletionInput; readonly store: ControlPlaneStoreBoundary; readonly root: string } {
  const integration = makeIntegrationEnv();
  const fake = makeFakeStore();
  const context = makeContext(integration.storeEnv, { store: fake.store });
  const boundary = createResultValidationBoundary(context);
  const root = newRoot();
  freshDestination(root);
  return {
    root,
    store: fake.store,
    input: {
      workspaceId: WS_A,
      attempt: makeAttemptFacts(),
      outcome: makeOutcome(),
      observation: makeObservation(),
      completionContract: contractArtifact,
      enforcementEvidence: { evidenceFingerprint: makeEnforcementFingerprint() },
      resultRoot: root,
      serviceUid: process.getuid?.() ?? 0,
      schemaRegistry: registry,
      controlPlane: boundary,
      identitySource: makeIdentitySource(),
      ...overrides,
    },
  };
}

function producedOf(result: CompletionResult): ValidatedResultHandoff {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.decision, 'produced', JSON.stringify(result));
  return result.handoff;
}

function validationRecords(store: ControlPlaneStoreBoundary): Readonly<Record<string, unknown>>[] {
  const enumerated = store.enumerateLifecycleRecords('validation-record');
  if (!enumerated.ok) return [];
  const out: Readonly<Record<string, unknown>>[] = [];
  for (const id of enumerated.recordIds) {
    const read = store.readLifecyclePayload('validation-record', id);
    if (read.ok && read.payload !== undefined) out.push(read.payload);
  }
  return out;
}

// ─── originate / correlation / determinism ──────────────────────────────────

test('WP-13B: completed attempt originates one result with exact correlation, canonical bytes, and a durable passing ValidationRecord', () => {
  const { input, store, root } = makeEnv();
  const result = completeExecution(input);
  const handoff = producedOf(result);
  assert.equal(handoff.associationMode, 'originated');
  assert.equal(handoff.occurrenceId, OCCURRENCE_ID);
  assert.equal(handoff.attemptId, ATTEMPT_ID);
  assert.equal(handoff.ordinal, 1);
  assert.equal(handoff.evaluatorId, COMPLETION_EVALUATOR_ID);
  assert.equal(handoff.capabilityProfileId, COMPLETION_EVALUATOR_CAPABILITY_PROFILE_ID);
  // SIR-WP13C-001 amendment: the handoff emits the canonical schema-valid
  // opaque provenance identities (committed pgw:ev:/pgw:cp: syntax) — never
  // the legacy human-readable labels, and never content-derived.
  assert.match(handoff.evaluatorId, /^pgw:ev:[0-9a-f]{32}$/);
  assert.match(handoff.capabilityProfileId, /^pgw:cp:[0-9a-f]{32}$/);
  assert.equal(handoff.evaluatorId.includes('project-gateway.completion'), false, 'no legacy dotted provenance label remains in the handoff');
  assert.equal(handoff.capabilityProfileId.includes('project-gateway.completion'), false, 'no legacy dotted provenance label remains in the handoff');
  assert.match(handoff.resultInstanceId, /^pgw:i:[0-9a-f]{32}$/);
  assert.match(handoff.resultRevisionId, /^pgw:r:[0-9a-f]{32}$/);
  assert.match(handoff.resultDigest, /^sha-256:[0-9a-f]{64}$/);
  assert.equal(handoff.writeOutcome, 'created');
  // The file exists with the exact canonical bytes and re-parses to the digest.
  const filePath = join(root, handoff.artifactRelativePath);
  const bytes = readFileSync(filePath);
  const parsed = JSON.parse(bytes.toString('utf8'));
  assert.equal(parsed.instance_id, handoff.resultInstanceId);
  assert.equal(parsed.revision.id, handoff.resultRevisionId);
  assert.equal(parsed.revision.digest, handoff.resultDigest);
  assert.equal(parsed.body.reported_occurrence_id, OCCURRENCE_ID);
  assert.equal(parsed.body.reported_attempt_id, ATTEMPT_ID);
  assert.equal(parsed.body.disposition, 'completed');
  assert.equal(parsed.body.observed_outputs[0].text, 'task complete');
  // The WP-12 store gained exactly one validation-record with the exact subject.
  const records = validationRecords(store);
  assert.equal(records.length, 1);
  const record = records[0]!;
  assert.equal(record['responsible_role'], 'trusted-validator');
  assert.equal(record['structural_outcome'], 'pass');
  assert.equal(record['semantic_outcome'], 'pass');
  const subject = record['subject'] as Readonly<Record<string, unknown>>;
  const kind = subject['kind'] as Readonly<Record<string, unknown>>;
  assert.equal(kind['id'], 'ExecutionResult');
  assert.equal(subject['instance_id'], handoff.resultInstanceId);
  assert.equal(subject['revision_id'], handoff.resultRevisionId);
  assert.equal(subject['digest'], handoff.resultDigest);
  assert.equal(handoff.validationRecordId, String(record['record_id']));
  // No publication / receipt classes exist.
  assert.equal(store.enumerateLifecycleRecords('result-publication-record').recordIds.length, 0);
  assert.equal(store.enumerateLifecycleRecords('trusted-receipt').recordIds.length, 0);
});

test('WP-13B: fresh origination yields fresh opaque identities (no content-derived IDs)', () => {
  const first = makeEnv();
  const second = makeEnv();
  const a = producedOf(completeExecution(first.input));
  const b = producedOf(completeExecution(second.input));
  // Opaque ids (ADR-008): identical committed inputs with a fresh identity
  // source mint DISTINCT instance/revision/evidence ids; nothing derives
  // from workspace/lifecycle/content.
  assert.notEqual(a.resultInstanceId, b.resultInstanceId);
  assert.notEqual(a.resultRevisionId, b.resultRevisionId);
  assert.notEqual(a.resultDigest, b.resultDigest); // the digest covers the ids
  assert.equal(a.evidenceReferences.length, 1);
  assert.equal(b.evidenceReferences.length, 1);
  assert.equal(a.evidenceReferences[0]!.content_digest, b.evidenceReferences[0]!.content_digest, 'the committed WP-5B enforcement fingerprint is deterministic');
  assert.notEqual(a.evidenceReferences[0]!.evidence_id, b.evidenceReferences[0]!.evidence_id);
  // The deterministic evaluation facts are identical.
  const parsedA = JSON.parse(readFileSync(join(first.root, a.artifactRelativePath)).toString('utf8'));
  const parsedB = JSON.parse(readFileSync(join(second.root, b.artifactRelativePath)).toString('utf8'));
  assert.equal(parsedA.body.disposition, parsedB.body.disposition);
  assert.equal(parsedA.body.reported_occurrence_id, parsedB.body.reported_occurrence_id);
  assert.deepEqual(parsedA.body.observed_outputs, parsedB.body.observed_outputs);
  assert.deepEqual(parsedA.body.violations, parsedB.body.violations);
});

test('WP-13B: crash-recovery replay adopts the existing artifact (same opaque ids, same validation record)', () => {
  const { input, store, root } = makeEnv();
  const first = producedOf(completeExecution(input));
  const canonicalBytes = readFileSync(join(root, first.artifactRelativePath));
  // Re-run of the same attempt: fresh origination would mint NEW opaque ids
  // (different bytes → typed conflict), so recovery re-supplies the existing
  // artifact as the adoption candidate (ADR-012 §3.4 recovery semantics).
  const second = producedOf(completeExecution({ ...input, adoptCandidateBytes: canonicalBytes }));
  assert.equal(second.associationMode, 'adopted');
  assert.equal(second.resultInstanceId, first.resultInstanceId, 'adoption preserves the candidate opaque instance id');
  assert.equal(second.resultRevisionId, first.resultRevisionId, 'adoption preserves the candidate opaque revision id');
  assert.equal(second.writeOutcome, 'already-exact');
  assert.equal(second.validationRecordId, first.validationRecordId);
  // SIR-WP13C-001: replay preserves the canonical evaluator provenance.
  assert.equal(second.evaluatorId, first.evaluatorId, 'replay preserves the canonical evaluator identity');
  assert.equal(second.capabilityProfileId, first.capabilityProfileId, 'replay preserves the canonical capability-profile identity');
  assert.equal(validationRecords(store).length, 1, 'no second validation record on exact replay');
  // The file was not rewritten (bytes unchanged).
  assert.deepEqual(readFileSync(join(root, first.artifactRelativePath)), canonicalBytes);
});

// ─── adoption ───────────────────────────────────────────────────────────────

test('WP-13B: exact compatible candidate is adopted (opaque ids preserved, bytes preserved)', () => {
  const first = makeEnv();
  const handoff = producedOf(completeExecution(first.input));
  const canonicalBytes = readFileSync(join(first.root, handoff.artifactRelativePath));
  const { input, store, root } = makeEnv({ adoptCandidateBytes: canonicalBytes });
  const adopted = producedOf(completeExecution(input));
  assert.equal(adopted.associationMode, 'adopted');
  assert.equal(adopted.resultInstanceId, handoff.resultInstanceId, 'adoption preserves the candidate opaque instance id');
  assert.equal(adopted.resultRevisionId, handoff.resultRevisionId, 'adoption preserves the candidate opaque revision id');
  // SIR-WP13C-001: the canonical evaluator provenance is preserved exactly
  // through the adopt path (never re-derived, never replaced).
  assert.equal(adopted.evaluatorId, handoff.evaluatorId, 'adoption preserves the canonical evaluator identity');
  assert.equal(adopted.capabilityProfileId, handoff.capabilityProfileId, 'adoption preserves the canonical capability-profile identity');
  assert.equal(adopted.writeOutcome, 'created');
  assert.equal(readFileSync(join(root, adopted.artifactRelativePath)).byteLength, canonicalBytes.byteLength);
  assert.equal(validationRecords(store).length, 1);
});

test('WP-13B: incompatible candidates are rejected, nothing written', () => {
  const { input, root, store } = makeEnv({ adoptCandidateBytes: new TextEncoder().encode('{"not":"the canonical result"}') });
  const result = completeExecution(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.category, 'RESULT-CANDIDATE-INVALID');
  assert.equal(validationRecords(store).length, 0);
  assert.throws(() => readFileSync(join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json')));

  // A well-formed ExecutionResult envelope with a TAMPERED body (same opaque
  // ids, same evidence reference, different facts) is not the exact
  // compatible candidate → candidate-not-exact, nothing written.
  const first = makeEnv();
  const handoff = producedOf(completeExecution(first.input));
  const canonicalBytes = readFileSync(join(first.root, handoff.artifactRelativePath));
  const tampered = JSON.parse(canonicalBytes.toString('utf8'));
  tampered.body.observed_outputs[0].text = 'tampered'; // violates the exact facts
  const tamperedBytes = new TextEncoder().encode(JSON.stringify(tampered));
  const { input: input2, root: root2, store: store2 } = makeEnv({ adoptCandidateBytes: tamperedBytes });
  const result2 = completeExecution(input2);
  assert.equal(result2.ok, false);
  if (!result2.ok) {
    assert.equal(result2.category, 'RESULT-CANDIDATE-INVALID');
    assert.equal(result2.code, 'result.candidate-not-exact');
  }
  assert.equal(validationRecords(store2).length, 0);
  assert.throws(() => readFileSync(join(root2, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json')));

  // A candidate whose evidence reference carries a DIFFERENT enforcement
  // fingerprint is not the compatible candidate for this attempt.
  const wrongFingerprint = JSON.parse(canonicalBytes.toString('utf8'));
  wrongFingerprint.body.evidence_references[0].content_digest = 'sha-256:' + '0'.repeat(64);
  const wrongFpBytes = new TextEncoder().encode(JSON.stringify(wrongFingerprint));
  const { input: input3, store: store3 } = makeEnv({ adoptCandidateBytes: wrongFpBytes });
  const result3 = completeExecution(input3);
  assert.equal(result3.ok, false);
  if (!result3.ok) {
    assert.equal(result3.category, 'RESULT-CANDIDATE-INVALID');
    assert.equal(result3.code, 'result.candidate-invalid');
  }
  assert.equal(validationRecords(store3).length, 0);
});

// ─── no-result paths (EXE-008/009) ──────────────────────────────────────────

test('WP-13B: rejected disposition never gains a result association (EXE-009)', () => {
  const { input, root, store } = makeEnv({ outcome: makeOutcome('rejected') });
  const result = completeExecution(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.decision, 'no-result');
  assert.equal(result.reason, 'disposition-rejected');
  assert.equal(validationRecords(store).length, 0);
  assert.throws(() => readFileSync(join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json')));
});

test('WP-13B: absent completion evidence produces no fabricated result (EXE-008)', () => {
  const noObservation = completeExecution(makeEnv({ observation: undefined }).input);
  assert.equal(noObservation.ok, true);
  if (!noObservation.ok) return;
  assert.equal(noObservation.decision, 'no-result');
  assert.equal(noObservation.reason, 'evidence-unavailable');

  const noContract = completeExecution(makeEnv({ completionContract: undefined }).input);
  assert.equal(noContract.ok, true);
  if (!noContract.ok) return;
  assert.equal(noContract.decision, 'no-result');
  assert.equal(noContract.reason, 'contract-unavailable');

  const retryable = completeExecution(makeEnv({ outcome: makeOutcome('failed') }).input);
  assert.equal(retryable.ok, true);
  if (!retryable.ok) return;
  assert.equal(retryable.decision, 'no-result');
  assert.equal(retryable.reason, 'disposition-non-completed');

  const ambiguous = completeExecution(makeEnv({ outcome: makeOutcome('incomplete') }).input);
  assert.equal(ambiguous.ok, true);
  if (!ambiguous.ok) return;
  assert.equal(ambiguous.decision, 'no-result');
  assert.equal(ambiguous.reason, 'disposition-ambiguous');
});

// ─── write semantics (exclusive create / recovery / conflict) ───────────────

test('WP-13B: conflicting existing bytes fail closed (second distinct result for the attempt)', () => {
  const { input, root, store } = makeEnv();
  const dest = join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json');
  writeFileSync(dest, '{"conflicting": true}');
  const result = completeExecution(input);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.category, 'RESULT-WRITE-CONFLICT');
    assert.equal(result.code, 'result.write-exclusive-create-conflict');
  }
  assert.equal(validationRecords(store).length, 0);
  // The conflicting file was never overwritten.
  assert.equal(readFileSync(dest, 'utf8'), '{"conflicting": true}');
});

test('WP-13B: exact-existing destination is reused as adoption/recovery without rewrite', () => {
  const first = makeEnv();
  const handoff = producedOf(completeExecution(first.input));
  const canonicalBytes = readFileSync(join(first.root, handoff.artifactRelativePath));
  // Crash recovery between artifact creation and trusted publication: the
  // re-run re-supplies the existing artifact as the adoption candidate
  // (ADR-012 §3.4); the exact-existing destination is recognized without a
  // rewrite.
  const recovered = producedOf(completeExecution({ ...first.input, adoptCandidateBytes: canonicalBytes }));
  assert.equal(recovered.writeOutcome, 'already-exact');
  assert.equal(recovered.resultDigest, handoff.resultDigest);
  assert.equal(recovered.resultInstanceId, handoff.resultInstanceId);
  assert.deepEqual(readFileSync(join(first.root, handoff.artifactRelativePath)), canonicalBytes);
});

test('WP-13B: containment/ownership/path revalidation failures are typed', () => {
  // Symlinked parent component → typed containment failure (anchored
  // no-follow descent; a symlinked component fails closed).
  const rootA = newRoot();
  const dirA = join(rootA, 'results', OCCURRENCE_ID);
  mkdirSync(dirA, { recursive: true });
  symlinkSync(tmpdir(), join(dirA, ATTEMPT_ID));
  const resultA = completeExecution(makeEnv({ resultRoot: rootA }).input);
  assert.equal(resultA.ok, false);
  if (!resultA.ok) {
    assert.equal(resultA.category, 'RESULT-CONTAINMENT-DENIED');
    assert.ok(resultA.code === 'result.write-containment-denied' || resultA.code === 'result.write-parent-not-verified', resultA.code);
  }

  // Missing parent → typed write failure (no directory creation).
  const rootB = newRoot();
  const resultB = completeExecution(makeEnv({ resultRoot: rootB }).input);
  assert.equal(resultB.ok, false);
  if (!resultB.ok) {
    assert.equal(resultB.category, 'RESULT-WRITE-FAILED');
    assert.equal(resultB.code, 'result.write-missing-parent');
  }

  // Wrong service uid → ownership-mismatch.
  const rootC = newRoot();
  freshDestination(rootC);
  const resultC = completeExecution(makeEnv({ resultRoot: rootC, serviceUid: (process.getuid?.() ?? 0) + 1 }).input);
  assert.equal(resultC.ok, false);
  if (!resultC.ok) {
    assert.equal(resultC.category, 'RESULT-CONTAINMENT-DENIED');
    assert.equal(resultC.code, 'result.write-ownership-mismatch');
  }
});

// ─── WP-4 validation ────────────────────────────────────────────────────────

test('WP-13B: WP-4 validation rejection fails closed (registry + oversized content)', () => {
  const rejectingRegistry = { validate: () => ({ valid: false }) };
  const resultA = completeExecution(makeEnv({ schemaRegistry: rejectingRegistry as never }).input);
  assert.equal(resultA.ok, false);
  if (!resultA.ok) assert.equal(resultA.category, 'RESULT-VALIDATION-REJECTED');

  // Observed completion text beyond the committed body bound → structural rejection.
  const resultB = completeExecution(makeEnv({ observation: makeObservation('x'.repeat(9000)) }).input);
  assert.equal(resultB.ok, false);
  if (!resultB.ok) assert.equal(resultB.category, 'RESULT-VALIDATION-REJECTED');
});

// ─── WP-12 recordValidation path ────────────────────────────────────────────

test('WP-13B: recordValidation failure and malformed-return containment are typed', () => {
  // Store publish failure → VALIDATION-RECORDING-FAILED.
  const integration = makeIntegrationEnv();
  const failing = makeFakeStore({ throwOnPublish: true });
  const context = makeContext(integration.storeEnv, { store: failing.store });
  const failingBoundary = createResultValidationBoundary(context);
  const resultA = completeExecution(makeEnv({ controlPlane: failingBoundary }).input);
  assert.equal(resultA.ok, false);
  if (!resultA.ok) assert.equal(resultA.category, 'VALIDATION-RECORDING-FAILED');

  // Throwing boundary → COMPLETION-INTERNAL-FAILURE, no raw text.
  const throwing = { recordValidation: () => { throw new Error(SECRET_MARKER); } };
  const resultB = completeExecution(makeEnv({ controlPlane: throwing as never }).input);
  assert.equal(resultB.ok, false);
  if (!resultB.ok) {
    assert.equal(resultB.category, 'COMPLETION-INTERNAL-FAILURE');
    assert.equal(resultB.message.includes(SECRET_MARKER), false);
    assert.equal(resultB.message.includes('Error'), false);
  }

  // Malformed return (null) → COMPLETION-INTERNAL-FAILURE, no raw throw.
  const malformed = { recordValidation: () => null };
  const resultC = completeExecution(makeEnv({ controlPlane: malformed as never }).input);
  assert.equal(resultC.ok, false);
  if (!resultC.ok) {
    assert.equal(resultC.category, 'COMPLETION-INTERNAL-FAILURE');
    assert.equal(resultC.code, 'validation.recording-malformed');
  }
});

// ─── input hygiene / correlation ────────────────────────────────────────────

test('WP-13B: malformed input shapes fail closed as COMPLETION-INPUT-INVALID', () => {
  const base = makeEnv().input;
  const cases: readonly { readonly label: string; readonly input: CompletionInput }[] = [
    { label: 'workspace', input: { ...base, workspaceId: 'not-a-workspace' } },
    { label: 'attempt', input: { ...base, attempt: { ...base.attempt, attemptId: 'garbage' } } },
    { label: 'outcome', input: { ...base, outcome: { ...base.outcome, disposition: 'bogus' } as never } },
    { label: 'observation', input: { ...base, observation: { not: 'branded' } as never } },
    { label: 'contract', input: { ...base, completionContract: { level: 'structural-valid' } as never } },
    { label: 'fingerprint', input: { ...base, enforcementEvidence: { evidenceFingerprint: 'not-a-fingerprint' } } },
    { label: 'boundary', input: { ...base, controlPlane: {} as never } },
    { label: 'candidate', input: { ...base, adoptCandidateBytes: new TextEncoder().encode('') } },
    { label: 'identity-source-missing', input: { ...base, identitySource: {} as never } },
    { label: 'identity-source-member', input: { ...base, identitySource: { newResultInstanceId: 42 } as never } },
  ];
  for (const c of cases) {
    const result = completeExecution(c.input);
    assert.equal(result.ok, false, c.label);
    if (!result.ok) assert.equal(result.category, 'COMPLETION-INPUT-INVALID', c.label);
  }
});

test('WP-13B: uncorrelated outcome/observation/attempt facts fail closed', () => {
  const base = makeEnv().input;
  const wrongAttempt = { ...base, outcome: { ...base.outcome, attemptId: 'pgw:a:' + '9'.repeat(32) } };
  const result = completeExecution(wrongAttempt);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'input.correlation-mismatch');
});

test('WP-13B: raw secret content never reaches findings from any boundary', () => {
  // Non-string message/category shapes are never trusted or copied into findings.
  const hostile = { recordValidation: () => ({ ok: false, category: { secret: SECRET_MARKER }, code: { secret: SECRET_MARKER }, message: { secret: SECRET_MARKER } }) };
  const result = completeExecution({ ...makeEnv().input, controlPlane: hostile as never });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.category, 'VALIDATION-RECORDING-FAILED');
    assert.equal(result.message.includes(SECRET_MARKER), false);
    assert.equal(result.code.includes(SECRET_MARKER), false);
  }
  // A throwing boundary never leaks exception text.
  const throwing = { recordValidation: () => { throw new Error(SECRET_MARKER); } };
  const thrown = completeExecution({ ...makeEnv().input, controlPlane: throwing as never });
  assert.equal(thrown.ok, false);
  if (!thrown.ok) {
    assert.equal(thrown.category, 'COMPLETION-INTERNAL-FAILURE');
    assert.equal(JSON.stringify(thrown).includes(SECRET_MARKER), false);
  }
});

// ─── SIR-WP13B-001: opaque identity boundary containment ────────────────────

test('WP-13B: malformed/throwing identity source fails typed and closed', () => {
  const base = makeEnv();
  // Throwing instance-id source → typed internal failure, no raw text.
  const throwing = { ...makeIdentitySource(), newResultInstanceId: () => { throw new Error(SECRET_MARKER); } };
  const r1 = completeExecution({ ...base.input, identitySource: throwing as never });
  assert.equal(r1.ok, false);
  if (!r1.ok) {
    assert.equal(r1.category, 'COMPLETION-INTERNAL-FAILURE');
    assert.equal(r1.code, 'identity.instance-id-exception');
    assert.equal(r1.message.includes(SECRET_MARKER), false);
  }
  // Malformed revision id (wrong syntax) → typed malformed.
  const malformed = { ...makeIdentitySource(), newResultRevisionId: () => 'not-an-opaque-id' };
  const r2 = completeExecution({ ...base.input, identitySource: malformed as never });
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.equal(r2.category, 'COMPLETION-INTERNAL-FAILURE');
    assert.equal(r2.code, 'identity.revision-id-malformed');
  }
  // Wrong evidence-id prefix → typed malformed.
  const badPrefix = { ...makeIdentitySource(), newEvidenceId: () => 'pgw:x:' + '0'.repeat(32) };
  const r3 = completeExecution({ ...base.input, identitySource: badPrefix as never });
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.code, 'identity.evidence-id-malformed');
  // No records on any identity failure.
  assert.equal(validationRecords(base.store).length, 0);
});

// ─── SIR-WP13B-002: EEXIST final-component safety (writer-level) ────────────

test('WP-13B: symlinked final destination is rejected — a symlink to the exact bytes is NEVER already-exact', () => {
  const bytes = new TextEncoder().encode('{"canonical":"exact-bytes-0123456789abcdef"}');
  const uid = process.getuid?.() ?? 0;
  const mk = () => {
    const root = newRoot();
    mkdirSync(join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID), { recursive: true });
    return root;
  };
  // Symlink → regular file holding the EXACT expected bytes.
  const root1 = mk();
  const outside = join(root1, 'outside.json');
  writeFileSync(outside, bytes);
  symlinkSync(outside, join(root1, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json'));
  const out1 = writeResultArtifact({ root: root1, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes });
  assert.deepEqual(out1, { ok: false, code: 'exclusive-create-conflict' }, 'symlink to exact bytes must fail closed');
  // Dangling symlink.
  const root2 = mk();
  symlinkSync(join(root2, 'nope'), join(root2, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json'));
  const out2 = writeResultArtifact({ root: root2, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes });
  assert.deepEqual(out2, { ok: false, code: 'exclusive-create-conflict' });
  // Directory final component.
  const root3 = mk();
  mkdirSync(join(root3, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json'), { recursive: true });
  const out3 = writeResultArtifact({ root: root3, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes });
  assert.deepEqual(out3, { ok: false, code: 'exclusive-create-conflict' });
  // FIFO final component: O_RDONLY|O_NOFOLLOW|O_NONBLOCK — never blocks,
  // rejected as non-regular (dedicated child-process promptness test below).
  const rootFifo = mk();
  const fifoPath = join(rootFifo, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json');
  execFileSync('mkfifo', [fifoPath]);
  const outFifo = writeResultArtifact({ root: rootFifo, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes });
  assert.deepEqual(outFifo, { ok: false, code: 'exclusive-create-conflict' });
  assert.equal(statSync(fifoPath).isFIFO(), true, 'the FIFO remains unchanged');
  assert.deepEqual(readdirSync(join(rootFifo, 'results', OCCURRENCE_ID, ATTEMPT_ID)), ['execution-result.json'], 'no alternate file created');
  // Conflicting regular file: typed conflict.
  const root4 = mk();
  writeFileSync(join(root4, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json'), '{"conflicting":true}');
  const out4 = writeResultArtifact({ root: root4, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes });
  assert.deepEqual(out4, { ok: false, code: 'exclusive-create-conflict' });
  // Exact regular file: adoption/recovery.
  const root5 = mk();
  writeFileSync(join(root5, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json'), bytes);
  const out5 = writeResultArtifact({ root: root5, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes });
  assert.deepEqual(out5, { ok: true, outcome: 'already-exact' });
});

test('WP-13B: FIFO at the exact result destination returns promptly and fails closed (never blocks)', () => {
  const bytes = new TextEncoder().encode('{"canonical":"fifo-promptness-bytes"}');
  const root = newRoot();
  mkdirSync(join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID), { recursive: true });
  const fifoPath = join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID, 'execution-result.json');
  execFileSync('mkfifo', [fifoPath]);
  // Run the writer in a CHILD PROCESS with a hard timeout: a regression that
  // removes O_NONBLOCK would hang the blocking FIFO open and the child is
  // killed — the test fails cleanly instead of hanging the suite.
  const writerEntry = new URL('../../src/completion/index.js', import.meta.url).href;
  const script =
    `import { writeResultArtifact } from ${JSON.stringify(writerEntry)};\n` +
    `const out = writeResultArtifact({ root: process.argv[1], serviceUid: process.getuid?.() ?? 0, occurrenceId: ${JSON.stringify(OCCURRENCE_ID)}, attemptId: ${JSON.stringify(ATTEMPT_ID)}, bytes: new TextEncoder().encode(${JSON.stringify(new TextDecoder().decode(bytes))}) });\n` +
    `console.log(JSON.stringify(out));`;
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script, root], { timeout: 8000, encoding: 'utf8' });
  } catch (err) {
    assert.fail(`the result write did not return promptly (FIFO open blocked or child failed): ${String(err)}`);
    return;
  }
  const outcome = JSON.parse(stdout.trim()) as { readonly ok: boolean; readonly code?: string };
  assert.deepEqual(outcome, { ok: false, code: 'exclusive-create-conflict' });
  // The FIFO remains a FIFO; no alternate destination/file was created.
  assert.equal(statSync(fifoPath).isFIFO(), true);
  assert.deepEqual(readdirSync(join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID)), ['execution-result.json']);
});

// ─── SIR-WP13B-003: fd-anchored containment (race coverage) ────────────────

test('WP-13B: parent swap after root anchoring fails closed (anchored containment)', () => {
  const bytes = new TextEncoder().encode('{"canonical":"swap-test-bytes"}');
  const root = newRoot();
  const dir = join(root, 'results', OCCURRENCE_ID, ATTEMPT_ID);
  mkdirSync(dir, { recursive: true });
  // Swap the attempt directory for a symlink AFTER the root descriptor is
  // anchored but BEFORE the descent (WP-11 race-coverage seam pattern): the
  // anchored no-follow descent must fail closed.
  const swap = () => {
    rmSync(dir, { recursive: true, force: true });
    symlinkSync(tmpdir(), dir);
  };
  const out = writeResultArtifact({
    root,
    serviceUid: process.getuid?.() ?? 0,
    occurrenceId: OCCURRENCE_ID,
    attemptId: ATTEMPT_ID,
    bytes,
    hooks: { afterRootOpen: swap },
  });
  assert.equal(out.ok, false);
  if (!out.ok) {
    // The anchored no-follow descent detects the swapped component (open
    // fails or the resolution path diverges) and fails typed.
    assert.ok(out.code === 'containment-denied' || out.code === 'parent-not-verified', out.code);
  }
});

// ─── MAC-2C §15: vnode-canonical root identity on real APFS ───────────────

test('WP-13B: root descriptor identity is vnode-canonical — lexical /var spelling and symlink aliases fail closed, canonical succeeds (MAC-2C)', () => {
  const bytes = new TextEncoder().encode('{"canonical":"vnode-canonical-identity"}');
  const uid = process.getuid?.() ?? 0;
  // On this host tmpdir() is /var/folders/… whose vnode-canonical form
  // (F_GETPATH) is /private/var/folders/…. The writer's root identity
  // check is exact equality against the vnode-canonical path; there is NO
  // lexical normalization as a substitute for identity.
  const canonical = newRoot();
  freshDestination(canonical);
  assert.ok(canonical.startsWith('/private/var/'), `expected a /private/var canonical root on this host, got ${canonical}`);
  // Deliberately NON-canonical evidence: the same directory through the
  // lexical /var alias. Must fail closed — never normalized.
  const lexicalAlias = canonical.replace(/^\/private\/var\//, '/var/');
  assert.notEqual(lexicalAlias, canonical);
  const outLexical = writeResultArtifact({ root: lexicalAlias, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes });
  assert.deepEqual(outLexical, { ok: false, code: 'parent-not-verified' }, 'lexical /var spelling must not be normalized into identity');
  // A symlink alias of the root is refused at the O_NOFOLLOW root open.
  const aliasLink = join(tmpdir(), `wp13b-alias-${aliasCounter++}`);
  symlinkSync(canonical, aliasLink);
  roots.push(aliasLink);
  const outLink = writeResultArtifact({ root: aliasLink, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes });
  // Fail-closed refusal at the O_NOFOLLOW root anchor. Inherited root-open
  // errno mapping: Linux yields ELOOP -> containment-denied; on this kernel
  // O_DIRECTORY|O_NOFOLLOW on a symlink yields ENOTDIR -> missing-parent.
  // Both are inherited closed codes; the symlink is never followed.
  assert.equal(outLink.ok, false);
  if (!outLink.ok) {
    assert.ok(['containment-denied', 'missing-parent'].includes(outLink.code), `code was ${outLink.code}`);
  }
  // The canonical spelling succeeds.
  const out = writeResultArtifact({ root: canonical, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes });
  assert.deepEqual(out, { ok: true, outcome: 'created' });
});

let aliasCounter = 0;

// ─── SIR-WP13B-004: committed byte ceiling ──────────────────────────────────

test('WP-13B: byte ceiling is the committed WP-3 artifact bound (no implementation-local ceiling)', () => {
  // The writer reuses the COMMITTED artifact input byte bound — the same
  // bound the committed WP-4 intake applies — never an implementation-local
  // smaller ceiling.
  assert.equal(RESULT_BYTE_LIMIT, INPUT_BYTE_LIMITS.artifact);
  const uid = process.getuid?.() ?? 0;
  // The writer accepts the largest payload the committed intake permits.
  const root = newRoot();
  freshDestination(root);
  const max = Buffer.alloc(RESULT_BYTE_LIMIT, 0x61);
  const out = writeResultArtifact({ root, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes: max });
  assert.deepEqual(out, { ok: true, outcome: 'created' });
  // Beyond the committed bound → typed bytes-too-large (identical content is
  // rejected by the committed WP-4 intake before the writer is reached).
  const over = Buffer.alloc(RESULT_BYTE_LIMIT + 1, 0x61);
  const out2 = writeResultArtifact({ root, serviceUid: uid, occurrenceId: OCCURRENCE_ID, attemptId: ATTEMPT_ID, bytes: over });
  assert.deepEqual(out2, { ok: false, code: 'bytes-too-large' });
  // Flow-level: a result whose canonical bytes exceed the committed bound is
  // rejected by the COMMITTED WP-4 intake (RESULT-VALIDATION-REJECTED), not
  // by the writer — the writer is never reached.
  const inflatedObs = { ...makeObservation(), hostErrors: Object.freeze(Array.from({ length: 200_000 }, (_, i) => `error-${i}`)) };
  brandObservationWrapper(inflatedObs);
  const inflated = makeEnv({ observation: inflatedObs as never });
  const flow = completeExecution(inflated.input);
  assert.equal(flow.ok, false);
  if (!flow.ok) assert.equal(flow.category, 'RESULT-VALIDATION-REJECTED');
});

// ─── subject-gate scope (unchanged by SIR-WP13B corrections) ───────────────

test('WP-13B: recordValidation is the ONLY slice-1 operation accepting an ExecutionResult subject', () => {
  const subject = {
    protocolId: 'project-gateway.artifact',
    protocolVersion: '1.0',
    kindId: 'ExecutionResult',
    kindVersion: '1.0',
    instanceId: 'pgw:i:' + 'a'.repeat(32),
    revisionId: 'pgw:r:' + 'b'.repeat(32),
    digest: 'sha-256:' + 'c'.repeat(64),
    workspaceId: WS_A,
  };
  const record = captureSlice1Request({ operation: 'recordValidation', workspaceId: WS_A, subject, reason: 'wp-13b' });
  assert.equal(record.ok, true, 'recordValidation must accept the committed ExecutionResult subject form');
  const approve = captureSlice1Request({ operation: 'approve', workspaceId: WS_A, subject, purpose: 'completion-review', validationRecordIds: [], reason: 'wp-13b' });
  assert.equal(approve.ok, false, 'approve must keep rejecting ExecutionResult subjects');
  if (!approve.ok) assert.equal(approve.reason, 'subject-syntax');
  const issue = captureSlice1Request({ operation: 'issue', workspaceId: WS_A, subject, useClass: 'ordinary-use', reason: 'wp-13b' });
  assert.equal(issue.ok, false, 'issue must keep rejecting ExecutionResult subjects');
  if (!issue.ok) assert.equal(issue.reason, 'subject-syntax');
});
