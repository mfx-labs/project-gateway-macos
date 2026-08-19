/**
 * WP-8-C StoreMetadata and bootstrap-persistence tests (LAY-002; FSL-010;
 * W8C-D05/D13).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, chmodSync, statSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markValidatedTrustedWorkspaceConfiguration } from '../../../src/trusted/configuration-brand.js';
import { createStorageBootstrapActionProvenance, createTrustedStorageBootstrapInput } from '../../../src/storage/trusted-input/bootstrap-input.js';
import { createInitializationCapability, type InitializationCapability } from '../../../src/storage/capabilities/authenticity.js';
import { defaultLimitProfile } from '../../../src/storage/limits/limits.js';
import { buildStoreMetadata, METADATA_RECORD_FORMAT_VERSION } from '../../../src/storage/metadata/store-metadata.js';
import { persistMetadata, replayMetadata, writeAllSync } from '../../../src/storage/metadata/bootstrap-persist.js';
import { jcsSerialize } from '../../../src/canonical/jcs.js';
import { STORAGE_PAYLOAD_DIGEST_DOMAIN, STORAGE_RECORD_BYTES_DIGEST_DOMAIN, computeDomainDigest } from '../../../src/storage/format/envelope.js';
import type { NamespaceIdentity, ProbeResultProfile, RootIdentity, StoreMetadataFacts } from '../../../src/storage/types.js';

const UID = process.getuid?.() ?? 0;
const CONFIG_IDENTITY = 'sha-256:' + 'a'.repeat(64);

const PROBE: ProbeResultProfile = {
  sameDevice: true,
  hardLink: 'supported',
  directoryFsync: 'supported',
  regularFileFsync: 'supported',
  exclusiveCreation: 'supported',
  noFollow: 'supported',
  caseSensitive: true,
};

function genuineConfig(): object {
  const config = { configurationVersion: '1', capabilityVocabularyVersion: '1', hostLane: 'pi', provenance: { sourceKind: 'control-plane' }, workspaces: [], identity: CONFIG_IDENTITY };
  markValidatedTrustedWorkspaceConfiguration(config);
  return config;
}

function makeCapability(parent: RootIdentity): InitializationCapability {
  const p = createStorageBootstrapActionProvenance({ actionIdentity: 'action-meta', locator: parent.canonicalPath, serviceUid: UID, forbiddenRoots: [], configurationIdentity: CONFIG_IDENTITY, limitProfile: defaultLimitProfile() });
  const result = createTrustedStorageBootstrapInput(genuineConfig(), p, { locator: parent.canonicalPath, serviceUid: UID, forbiddenRoots: [], limitProfile: defaultLimitProfile() });
  assert.equal(result.ok, true);
  const capability = createInitializationCapability({ trustedInput: result.input, parentIdentity: parent });
  assert.ok(capability !== undefined);
  return capability;
}

function makeFacts(parent: RootIdentity, kind: NamespaceIdentity['kind'], ns: NamespaceIdentity): StoreMetadataFacts {
  return {
    metadataFormatVersion: '1',
    layoutVersion: 'v1',
    namespaceKind: kind,
    namespaceIdentity: ns,
    parentIdentity: parent,
    lane: 'posix-0700',
    probe: PROBE,
    configurationIdentity: CONFIG_IDENTITY,
    actionIdentity: 'action-meta',
    limitProfileIdentity: { configurationVersion: '1', configurationIdentity: CONFIG_IDENTITY },
  };
}

function makeEnv(): { readonly dir: string; readonly parent: RootIdentity; readonly ns: NamespaceIdentity; readonly capability: InitializationCapability } {
  const dir = mkdtempSync(join(tmpdir(), 'wp8c-meta-'));
  chmodSync(dir, 0o700);
  const stat = statSync(dir);
  const parent: RootIdentity = { canonicalPath: dir, dev: Number(stat.dev), ino: Number(stat.ino), fileType: 'directory' };
  const ns: NamespaceIdentity = { kind: 'configuration', canonicalPath: join(dir, 'config-v1'), dev: Number(stat.dev), ino: Number(stat.ino) + 1 };
  mkdirSync(join(dir, 'metadata'), { mode: 0o700 });
  mkdirSync(join(dir, 'tmp'), { mode: 0o700 });
  return { dir, parent, ns, capability: makeCapability(parent) };
}

test('metadata: digests are deterministic and non-self-referential', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const a = buildStoreMetadata(facts);
  const b = buildStoreMetadata(facts);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.metadata!.canonicalUtf8, b.metadata!.canonicalUtf8);
  assert.equal(a.metadata!.payloadDigest, b.metadata!.payloadDigest);
  assert.equal(a.metadata!.recordByteDigest, b.metadata!.recordByteDigest);
  // Payload digest excludes itself: recompute over payload only.
  const model = JSON.parse(a.metadata!.canonicalUtf8) as { payload: unknown; payloadDigest: string };
  const recomputedPayload = computeDomainDigest(STORAGE_PAYLOAD_DIGEST_DOMAIN, jcsSerialize(model.payload));
  assert.equal(recomputedPayload, model.payloadDigest);
  // Record digest excludes itself but contains the payload digest.
  const envelopeWithoutRecordDigest = JSON.parse(a.metadata!.canonicalUtf8) as Record<string, unknown>;
  assert.equal('recordByteDigest' in envelopeWithoutRecordDigest, false, 'record digest must not be part of its own input');
  assert.equal(envelopeWithoutRecordDigest['payloadDigest'], model.payloadDigest);
  const recomputedRecord = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, jcsSerialize(envelopeWithoutRecordDigest));
  assert.equal(recomputedRecord, a.metadata!.recordByteDigest);
  // Exclusions: no generation, nonce, lock, publication, or head state.
  const raw = a.metadata!.canonicalUtf8;
  for (const forbidden of ['generation', 'nonce', 'lock', 'publication', 'headIndex', 'capability']) {
    assert.equal(raw.includes(forbidden), false, `metadata must not contain ${forbidden}`);
  }
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: bounded write-all loop completes partial writes', () => {
  const buffer = Buffer.from('x'.repeat(100), 'utf8');
  let written = 0;
  const ok = writeAllSync(buffer, (buf, off, len) => {
    const n = Math.min(3, len);
    written += n;
    return n;
  });
  assert.equal(ok, true);
  assert.equal(written, 100);
  const failed = writeAllSync(buffer, () => 0);
  assert.equal(failed, false);
});

test('metadata: no-overwrite persistence then exact replay verification', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  assert.equal(built.ok, true);
  const path = join(env.dir, 'metadata', 'metadata.json');
  const first = persistMetadata(env.capability, path, built.metadata!, UID, join(env.dir, 'metadata'), env.dir);
  assert.equal(first.ok, true);
  assert.equal(first.outcome, 'created');
  const stat = statSync(path);
  assert.equal(stat.size, Buffer.byteLength(built.metadata!.canonicalUtf8, 'utf8'));
  assert.equal(Number(stat.mode) & 0o777, 0o600);
  // EEXIST path: exact replay is verification-only idempotence.
  const second = persistMetadata(env.capability, path, built.metadata!, UID, join(env.dir, 'metadata'), env.dir);
  assert.equal(second.ok, true);
  assert.equal(second.outcome, 'verified');
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: tamper, malformed JSON, duplicate keys, and version drift fail closed', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  assert.equal(built.ok, true);
  const path = join(env.dir, 'metadata', 'metadata.json');
  assert.equal(persistMetadata(env.capability, path, built.metadata!, UID, join(env.dir, 'metadata'), env.dir).ok, true);
  // Tamper: byte flip breaks canonical/digest verification.
  writeFileSync(path, built.metadata!.canonicalUtf8.replace('"lane"', '"laneX"'));
  const tampered = replayMetadata(env.capability, path, facts, UID);
  assert.equal(tampered.ok, false);
  // Malformed JSON.
  writeFileSync(path, '{not json');
  const malformed = replayMetadata(env.capability, path, facts, UID);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, 'ERR-STO-MALFORMED');
  // Duplicate keys must be rejected by the raw scanner.
  writeFileSync(path, '{"recordKind":"store-metadata","recordKind":"store-metadata","formatVersion":"1.0","payload":{},"payloadDigest":"sha-256:' + 'a'.repeat(64) + '"}');
  const dup = replayMetadata(env.capability, path, facts, UID);
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'ERR-STO-MALFORMED');
  // Unsupported version: canonical envelope with valid digests but version 9.9.
  const unsupportedPayload = { metadataFormatVersion: '9', layoutVersion: 'v1', namespaceKind: 'configuration', namespaceIdentity: { dev: env.ns.dev, ino: env.ns.ino }, parentIdentity: { dev: env.parent.dev, ino: env.parent.ino }, lane: 'posix-0700', probe: PROBE, configurationIdentity: CONFIG_IDENTITY, actionIdentity: 'action-meta', limitProfileIdentity: { configurationVersion: '1', configurationIdentity: CONFIG_IDENTITY } };
  const up = computeDomainDigest(STORAGE_PAYLOAD_DIGEST_DOMAIN, jcsSerialize(unsupportedPayload));
  const envelope = { recordKind: 'store-metadata', formatVersion: METADATA_RECORD_FORMAT_VERSION, payload: unsupportedPayload, payloadDigest: up };
  writeFileSync(path, jcsSerialize(envelope));
  const unsupported = replayMetadata(env.capability, path, facts, UID);
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.code, 'ERR-STO-UNSUPPORTED-VERSION');
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: wrong expected stable facts fail closed', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  assert.equal(built.ok, true);
  const path = join(env.dir, 'metadata', 'metadata.json');
  assert.equal(persistMetadata(env.capability, path, built.metadata!, UID, join(env.dir, 'metadata'), env.dir).ok, true);
  const wrongNs = replayMetadata(env.capability, path, { ...facts, namespaceIdentity: { ...env.ns, ino: env.ns.ino + 99 } }, UID);
  assert.equal(wrongNs.ok, false);
  assert.equal(wrongNs.code, 'ERR-STO-INTEGRITY');
  const wrongParent = replayMetadata(env.capability, path, { ...facts, parentIdentity: { ...env.parent, ino: env.parent.ino + 99 } }, UID);
  assert.equal(wrongParent.ok, false);
  const wrongConfig = replayMetadata(env.capability, path, { ...facts, configurationIdentity: 'sha-256:' + 'b'.repeat(64) }, UID);
  assert.equal(wrongConfig.ok, false);
  const wrongAction = replayMetadata(env.capability, path, { ...facts, actionIdentity: 'other-action' }, UID);
  assert.equal(wrongAction.ok, false);
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: APFS st_dev drift is tolerated; inode remains the durable anchor (S1)', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  assert.equal(built.ok, true);
  const path = join(env.dir, 'metadata', 'metadata.json');
  assert.equal(persistMetadata(env.capability, path, built.metadata!, UID, join(env.dir, 'metadata'), env.dir).ok, true);
  // Simulate APFS renumbering st_dev across reboot: the persisted metadata
  // records one dev value while replay observes a different dev, with inode,
  // canonical path, UID/mode, digests, and configuration identity all equal.
  // Recorded dev drift alone must NOT fail durable verification (S1).
  const devDrifted = replayMetadata(env.capability, path, {
    ...facts,
    namespaceIdentity: { ...env.ns, dev: env.ns.dev + 999 },
    parentIdentity: { ...env.parent, dev: env.parent.dev + 999 },
  }, UID);
  assert.equal(devDrifted.ok, true, 'recorded dev drift must not fail durable verification');
  // The inode remains the durable same-object anchor: inode drift still fails.
  const inoDrifted = replayMetadata(env.capability, path, {
    ...facts,
    namespaceIdentity: { ...env.ns, ino: env.ns.ino + 1 },
  }, UID);
  assert.equal(inoDrifted.ok, false);
  assert.equal(inoDrifted.code, 'ERR-STO-INTEGRITY');
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: limit-profile identity is verified exactly on replay (W8C-S01)', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  assert.equal(built.ok, true);
  const path = join(env.dir, 'metadata', 'metadata.json');
  assert.equal(persistMetadata(env.capability, path, built.metadata!, UID, join(env.dir, 'metadata'), env.dir).ok, true);
  // Exact matching limit profile → accepted replay.
  const exact = replayMetadata(env.capability, path, facts, UID);
  assert.equal(exact.ok, true);
  // Structurally reordered but value-equivalent expectation → accepted
  // (comparison is by canonical value, not object reference or key order).
  const reordered = replayMetadata(env.capability, path, { ...facts, limitProfileIdentity: { configurationIdentity: CONFIG_IDENTITY, configurationVersion: '1' } }, UID);
  assert.equal(reordered.ok, true);
  // Mismatched configuration version.
  const wrongVersion = replayMetadata(env.capability, path, { ...facts, limitProfileIdentity: { configurationVersion: '2', configurationIdentity: CONFIG_IDENTITY } }, UID);
  assert.equal(wrongVersion.ok, false);
  assert.equal(wrongVersion.code, 'ERR-STO-INTEGRITY');
  // Mismatched configuration identity.
  const wrongIdentity = replayMetadata(env.capability, path, { ...facts, limitProfileIdentity: { configurationVersion: '1', configurationIdentity: 'sha-256:' + 'c'.repeat(64) } }, UID);
  assert.equal(wrongIdentity.ok, false);
  assert.equal(wrongIdentity.code, 'ERR-STO-INTEGRITY');
  // Self-consistent stored metadata with a wrong expected limit profile:
  // the stored file is internally consistent, but the expectation differs,
  // so it is NOT an exact match and must fail closed.
  const wrongExpected = replayMetadata(env.capability, path, { ...facts, limitProfileIdentity: { configurationVersion: '2', configurationIdentity: CONFIG_IDENTITY } }, UID);
  assert.equal(wrongExpected.ok, false);
  assert.equal(wrongExpected.code, 'ERR-STO-INTEGRITY');
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: zero-progress write terminates with durability-unknown semantics (W8C-S02)', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  assert.equal(built.ok, true);
  const path = join(env.dir, 'metadata', 'metadata.json');
  const result = persistMetadata(env.capability, path, built.metadata!, UID, join(env.dir, 'metadata'), env.dir, { write: () => 0 });
  // Zero-progress after exclusive creation: the loop terminates, no success,
  // no fabricated durability; the file may exist and must not be deleted.
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR-STO-DURABILITY');
  assert.equal(existsSync(path), true, 'created metadata file is never deleted on failure');
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: file-fsync failure reports ERR-STO-DURABILITY and never deletes (W8C-S02)', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  assert.equal(built.ok, true);
  const path = join(env.dir, 'metadata', 'metadata.json');
  const result = persistMetadata(env.capability, path, built.metadata!, UID, join(env.dir, 'metadata'), env.dir, {
    fsyncFile: () => {
      throw new Error('injected file fsync failure');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR-STO-DURABILITY');
  assert.equal(existsSync(path), true, 'created metadata file is never deleted on durability failure');
  // A subsequent invocation classifies/verifies the existing state instead of
  // treating it as absent: the full canonical bytes were written before the
  // fsync failure, so exact replay verifies idempotently.
  const again = persistMetadata(env.capability, path, built.metadata!, UID, join(env.dir, 'metadata'), env.dir);
  assert.equal(again.ok, true);
  assert.equal(again.outcome, 'verified');
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: metadata-directory fsync failure reports ERR-STO-DURABILITY (W8C-S02)', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  assert.equal(built.ok, true);
  const path = join(env.dir, 'metadata', 'metadata.json');
  const metadataDir = join(env.dir, 'metadata');
  const result = persistMetadata(env.capability, path, built.metadata!, UID, metadataDir, env.dir, {
    fsyncDirectory: (p) => {
      if (p === metadataDir) throw new Error('injected metadata-directory fsync failure');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR-STO-DURABILITY');
  assert.equal(existsSync(path), true, 'created metadata file is never deleted on durability failure');
  // The remaining file is the originally created object: identity and bytes
  // are unchanged (no rollback, no re-creation, no overwrite).
  const before = statSync(path);
  const beforeBytes = readFileSync(path, 'utf8');
  // A subsequent normal (non-failing) invocation enters EEXIST replay and
  // verifies the existing metadata; no exclusive re-creation or overwrite
  // occurs and no second metadata object is created.
  const again = persistMetadata(env.capability, path, built.metadata!, UID, metadataDir, env.dir);
  assert.equal(again.ok, true);
  assert.equal(again.outcome, 'verified');
  const after = statSync(path);
  assert.equal(after.ino, before.ino, 'the metadata file must not be re-created');
  assert.equal(readFileSync(path, 'utf8'), beforeBytes, 'the metadata file must not be overwritten');
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: namespace-directory fsync failure reports ERR-STO-DURABILITY (W8C-S02)', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  assert.equal(built.ok, true);
  const path = join(env.dir, 'metadata', 'metadata.json');
  const metadataDir = join(env.dir, 'metadata');
  const result = persistMetadata(env.capability, path, built.metadata!, UID, metadataDir, env.dir, {
    fsyncDirectory: (p) => {
      if (p === env.dir) throw new Error('injected namespace-directory fsync failure');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR-STO-DURABILITY');
  assert.equal(existsSync(path), true, 'created metadata file is never deleted on durability failure');
  // The remaining file is the originally created object: identity and bytes
  // are unchanged (no rollback, no re-creation, no overwrite).
  const before = statSync(path);
  const beforeBytes = readFileSync(path, 'utf8');
  // A subsequent normal (non-failing) invocation enters EEXIST replay and
  // verifies the existing metadata; no exclusive re-creation or overwrite
  // occurs and no second metadata object is created.
  const again = persistMetadata(env.capability, path, built.metadata!, UID, metadataDir, env.dir);
  assert.equal(again.ok, true);
  assert.equal(again.outcome, 'verified');
  const after = statSync(path);
  assert.equal(after.ino, before.ino, 'the metadata file must not be re-created');
  assert.equal(readFileSync(path, 'utf8'), beforeBytes, 'the metadata file must not be overwritten');
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: wrong record kind is MALFORMED, unsupported version is UNSUPPORTED-VERSION (W8C-S04)', () => {
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  assert.equal(built.ok, true);
  const path = join(env.dir, 'metadata', 'metadata.json');
  const model = JSON.parse(built.metadata!.canonicalUtf8) as { payload: unknown; payloadDigest: string };
  // Canonically valid envelope with a WRONG record kind: malformed input,
  // not an unsupported format version.
  const wrongKind = { recordKind: 'approval-record', formatVersion: METADATA_RECORD_FORMAT_VERSION, payload: model.payload, payloadDigest: model.payloadDigest };
  writeFileSync(path, jcsSerialize(wrongKind));
  chmodSync(path, 0o600);
  const kindResult = replayMetadata(env.capability, path, facts, UID);
  assert.equal(kindResult.ok, false);
  assert.equal(kindResult.code, 'ERR-STO-MALFORMED');
  // Recognized kind with an unsupported envelope format version.
  const wrongVersion = { recordKind: 'store-metadata', formatVersion: '9.9', payload: model.payload, payloadDigest: model.payloadDigest };
  writeFileSync(path, jcsSerialize(wrongVersion));
  chmodSync(path, 0o600);
  const versionResult = replayMetadata(env.capability, path, facts, UID);
  assert.equal(versionResult.ok, false);
  assert.equal(versionResult.code, 'ERR-STO-UNSUPPORTED-VERSION');
  rmSync(env.dir, { recursive: true, force: true });
});

test('metadata: replay is descriptor-bound (no path-based read in the persist module)', () => {
  // The static guard enforces descriptor-based reads; here we verify the
  // behavior: a replaced file (new inode) between open and read is detected
  // by the mandatory post-read revalidation logic (pure comparison covered in
  // root.test.ts). Also assert the persist module source contains no
  // path-based readFileSync call.
  const source = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'src', 'storage', 'metadata', 'bootstrap-persist.ts'), 'utf8');
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/readFileSync\(\s*path/.test(withoutComments), false, 'path-based readFileSync is prohibited for replay');
  const env = makeEnv();
  const facts = makeFacts(env.parent, 'configuration', env.ns);
  const built = buildStoreMetadata(facts);
  const path = join(env.dir, 'metadata', 'metadata.json');
  assert.equal(persistMetadata(env.capability, path, built.metadata!, UID, join(env.dir, 'metadata'), env.dir).ok, true);
  // Mode drift on the metadata file is rejected at replay admission.
  chmodSync(path, 0o644);
  const drifted = replayMetadata(env.capability, path, facts, UID);
  assert.equal(drifted.ok, false);
  assert.equal(drifted.code, 'ERR-STO-PERM-DENIED');
  rmSync(env.dir, { recursive: true, force: true });
});
