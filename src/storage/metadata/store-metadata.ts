/**
 * WP-8-C StoreMetadata profile and canonical bytes (LAY-002; FSL-010;
 * W8C-D05/D13 digest model).
 *
 * One immutable StoreMetadata object per namespace, recording only stable
 * facts. The digest construction is non-self-referential (accepted WP-8-B
 * helpers): the payload digest is computed over the canonical payload bytes
 * only; the record-byte digest is computed over the canonical envelope bytes,
 * which contain the payload digest but never the record digest itself.
 * Capability generations, live capability identity, process-local object
 * identity, random nonces, lock state, publication state, and mutable head
 * indexes are excluded. No new envelope is invented: the accepted WP-8-B
 * record envelope profile is reused.
 */
import { jcsSerialize } from '../../canonical/jcs.js';
import {
  STORAGE_PAYLOAD_DIGEST_DOMAIN,
  STORAGE_RECORD_BYTES_DIGEST_DOMAIN,
  computeDomainDigest,
  isValidDigestSyntax,
} from '../format/envelope.js';
import type { StoreMetadataExpectation, StoreMetadataFacts, VerifiedStoreMetadata } from '../types.js';

export const METADATA_FORMAT_VERSION = '1';
export const METADATA_RECORD_KIND = 'store-metadata';
export const METADATA_RECORD_FORMAT_VERSION = '1.0';
/** Bounded metadata size for raw-parse rejection (constant, not a normative limit). */
export const METADATA_MAX_BYTES = 64 * 1024;

export type { StoreMetadataExpectation } from '../types.js';

export interface MetadataBuildResult {
  readonly ok: boolean;
  readonly metadata?: VerifiedStoreMetadata;
  readonly code?: string;
  readonly message?: string;
}

/** Canonical persisted envelope for one namespace's metadata. */
export interface StoreMetadataEnvelope {
  readonly recordKind: typeof METADATA_RECORD_KIND;
  readonly formatVersion: typeof METADATA_RECORD_FORMAT_VERSION;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadDigest: string;
}

/** Build the immutable metadata model: canonical payload, digests, envelope. */
export function buildStoreMetadata(facts: StoreMetadataFacts): MetadataBuildResult {
  if (facts.metadataFormatVersion !== METADATA_FORMAT_VERSION) {
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: 'metadata format version mismatch at build' };
  }
  const payload: Readonly<Record<string, unknown>> = {
    metadataFormatVersion: facts.metadataFormatVersion,
    layoutVersion: facts.layoutVersion,
    namespaceKind: facts.namespaceKind,
    namespaceIdentity: { dev: facts.namespaceIdentity.dev, ino: facts.namespaceIdentity.ino },
    parentIdentity: { dev: facts.parentIdentity.dev, ino: facts.parentIdentity.ino },
    lane: facts.lane,
    probe: facts.probe,
    configurationIdentity: facts.configurationIdentity,
    actionIdentity: facts.actionIdentity,
    limitProfileIdentity: {
      configurationVersion: facts.limitProfileIdentity.configurationVersion,
      configurationIdentity: facts.limitProfileIdentity.configurationIdentity,
    },
  };
  const canonicalPayload = jcsSerialize(payload);
  const payloadDigest = computeDomainDigest(STORAGE_PAYLOAD_DIGEST_DOMAIN, canonicalPayload);
  if (!isValidDigestSyntax(payloadDigest)) {
    return { ok: false, code: 'ERR-STO-INTERNAL-INVARIANT', message: 'payload digest failed syntax check' };
  }
  const envelope: StoreMetadataEnvelope = {
    recordKind: METADATA_RECORD_KIND,
    formatVersion: METADATA_RECORD_FORMAT_VERSION,
    payload,
    payloadDigest,
  };
  const canonicalUtf8 = jcsSerialize(envelope);
  const recordByteDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, canonicalUtf8);
  return {
    ok: true,
    metadata: {
      facts,
      payloadDigest,
      recordByteDigest,
      canonicalUtf8,
    },
  };
}

/** Parse + verify a metadata model from canonical bytes (duplicate keys rejected upstream). */
export function verifyMetadataModel(model: Readonly<Record<string, unknown>>, expected: StoreMetadataExpectation): MetadataBuildResult {
  if (model['recordKind'] !== METADATA_RECORD_KIND) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata record kind mismatch' };
  }
  if (model['formatVersion'] !== METADATA_RECORD_FORMAT_VERSION) {
    return { ok: false, code: 'ERR-STO-UNSUPPORTED-VERSION', message: 'metadata record format version is not supported' };
  }
  const payload = model['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata payload must be an object' };
  }
  const declaredPayloadDigest = model['payloadDigest'];
  if (typeof declaredPayloadDigest !== 'string' || !isValidDigestSyntax(declaredPayloadDigest)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata payload digest is malformed' };
  }
  const canonicalPayload = jcsSerialize(payload);
  const recomputedPayloadDigest = computeDomainDigest(STORAGE_PAYLOAD_DIGEST_DOMAIN, canonicalPayload);
  if (recomputedPayloadDigest !== declaredPayloadDigest) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata payload digest mismatch' };
  }
  const p = payload as Readonly<Record<string, unknown>>;
  if (p['metadataFormatVersion'] !== METADATA_FORMAT_VERSION) {
    return { ok: false, code: 'ERR-STO-UNSUPPORTED-VERSION', message: 'metadata format version is not supported' };
  }
  if (p['layoutVersion'] !== expected.layoutVersion) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata layout version mismatch' };
  }
  if (p['namespaceKind'] !== expected.namespaceKind) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata namespace kind mismatch' };
  }
  const nsId = p['namespaceIdentity'] as Readonly<Record<string, unknown>>;
  // S1: persisted `dev` is NOT a durable equality requirement — APFS
  // renumbers st_dev across reboot. The inode remains the durable same-object
  // anchor alongside the canonical path; all other checks below are unchanged.
  if (nsId === null || typeof nsId !== 'object' || nsId['ino'] !== expected.namespaceIdentity.ino) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata namespace identity mismatch' };
  }
  const parentId = p['parentIdentity'] as Readonly<Record<string, unknown>>;
  if (parentId === null || typeof parentId !== 'object' || parentId['ino'] !== expected.parentIdentity.ino) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata trusted-parent identity mismatch' };
  }
  if (p['lane'] !== expected.lane) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata lane mismatch' };
  }
  if (p['configurationIdentity'] !== expected.configurationIdentity) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata configuration identity mismatch' };
  }
  if (p['actionIdentity'] !== expected.actionIdentity) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata action identity mismatch' };
  }
  // Limit-profile identity must match the caller's verified expected identity
  // exactly (W8C-S01): a self-consistent stored metadata with a different
  // limit profile is NOT an exact match and must fail closed. Both components
  // of the recorded identity (configuration version, configuration identity)
  // are compared deterministically by canonical value.
  const recordedProfile = p['limitProfileIdentity'] as Readonly<Record<string, unknown>> | null | undefined;
  if (recordedProfile === null || typeof recordedProfile !== 'object' || Array.isArray(recordedProfile)) {
    return { ok: false, code: 'ERR-STO-MALFORMED', message: 'metadata limit-profile identity is malformed' };
  }
  if (recordedProfile['configurationVersion'] !== expected.limitProfileIdentity.configurationVersion) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata limit-profile configuration version mismatch' };
  }
  if (recordedProfile['configurationIdentity'] !== expected.limitProfileIdentity.configurationIdentity) {
    return { ok: false, code: 'ERR-STO-INTEGRITY', message: 'metadata limit-profile configuration identity mismatch' };
  }
  const canonicalUtf8 = jcsSerialize(model);
  const recordByteDigest = computeDomainDigest(STORAGE_RECORD_BYTES_DIGEST_DOMAIN, canonicalUtf8);
  return {
    ok: true,
    metadata: {
      facts: expected,
      payloadDigest: declaredPayloadDigest,
      recordByteDigest,
      canonicalUtf8,
    },
  };
}
