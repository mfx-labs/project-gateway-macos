/**
 * WP-11 Slice 1 — host write executor (the ONLY filesystem-mutation boundary
 * of the controlled-write core).
 *
 * Receives already-correlated trusted destination evidence derived from the
 * accepted containment/revalidation flow (canonical artifact root, the
 * RESOLVED canonical existing-directory ancestor, the missing destination
 * tail, and the exact accepted payload). It NEVER accepts an arbitrary
 * caller-provided absolute path and never re-walks a caller lexical
 * absolute destination.
 *
 * DESCRIPTOR-ANCHORED MODEL (accepted WP-7 / reader lane precedent,
 * SYM-009/SYM-010/SYM-011; `src/reader/fs.ts`; MAC-2B Darwin
 * integration):
 *
 *   1. open the accepted canonical artifact root O_RDONLY|O_DIRECTORY|
 *      O_NOFOLLOW and retain its descriptor for the whole operation;
 *      fstat-verify it (directory, service UID);
 *   2. open the destination parent RELATIVE TO THAT RETAINED DESCRIPTOR
 *      — on Darwin, one single-component `openat(O_DIRECTORY|O_NOFOLLOW)`
 *      per path component through the accepted native seam
 *      (`src/internal/darwin-fs/adapter.ts`, MAC-1 addon); fstat-verify
 *      it (directory, service UID); verify its descriptor-bound
 *      resolution path (`fcntl(F_GETPATH)` through the seam) equals the
 *      accepted canonical existing-directory ancestor — an intermediate
 *      component replaced by a symlink after revalidation diverges here
 *      and fails closed (`parent-not-verified`);
 *   3. exclusive-create the target through the anchored parent — the
 *      create/unlink path is EXACTLY ONE FINAL COMPONENT below the
 *      verified parent: a multi-component tail (missing intermediate
 *      directories) fails closed with `missing-parent` BEFORE any
 *      filesystem operation, and no tail component is ever traversed,
 *      followed, or created; O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW with the
 *      fixed implementation-owned mode (0600, owned by the native
 *      seam);
 *   4. fchmod to the fixed mode (umask-independent), fstat-verify the
 *      created object (regular file, service UID, exact mode);
 *   5. write the exact bytes (bounded loop; short writes continue);
 *   6. close; return a typed result.
 *
 * Darwin mechanism note (MAC-2B): the inherited Linux
 * `/proc/self/fd/<fd>/<relative>` descriptor-relative opens and
 * `readlink('/proc/self/fd/<fd>')` identity checks are replaced by the
 * accepted five-function native seam (openat/unlinkat/F_GETPATH).
 * `getPath` output is identity evidence only and is never used for an
 * open/create/unlink. Node's public fs API cannot express
 * descriptor-relative opens on Darwin; the seam is the ONLY
 * filesystem-mutation boundary below this module.
 *
 * The retained root descriptor pins the artifact-root inode: a root
 * replacement AFTER anchoring cannot redirect the write (the anchored chain
 * stays in the already-verified object). Root replacement BEFORE the
 * per-operation anchor is limited to what the lane permits through the
 * bound descriptor (SYM-011): the anchor is opened from the accepted
 * decision evidence and no stronger root-replacement claim is made.
 *
 * CREATE-ONLY: any existing target (regular file, directory, symlink,
 * dangling symlink, unsupported kind) fails closed through the exclusive
 * create — EEXIST is a typed `exclusive-create-conflict`, never an
 * overwrite. The accepted WP-6 destination protocol may legitimately yield
 * a multi-component missing tail (intermediate directories missing); that
 * does NOT authorize traversal or directory creation — Slice 1 has no
 * directory-creation authority, so a tail longer than one component fails
 * closed with `missing-parent` before any filesystem mutation. No fsync/
 * durability claim is made (fsync policy remains deferred).
 *
 * PARTIAL-WRITE FAILURE: if this operation created the target and then
 * failed before successful completion, exactly one bounded best-effort
 * unlink attempt is made THROUGH THE SAME VERIFIED PARENT descriptor and
 * the SAME single final component (descriptor-relative `unlinkat` through
 * the native seam) — cleanup never re-resolves an arbitrary absolute
 * lexical path and can never leave the verified parent. The result
 * distinguishes `removed` from
 * `failed` (indeterminate state).
 *
 * Errors are typed closed-vocabulary codes; raw errno, paths, and stacks
 * never cross this boundary. The defensive lexical evidence checks below
 * are defense in depth only — the confinement mechanism is the descriptor
 * anchoring, not path strings.
 *
 * HOST-COMPOSITION PREREQUISITE (see the WP-11 Slice 1 report): the
 * supported lane requires the descriptor-verified artifact-location parent
 * and the created file to satisfy the service-user ownership checks below;
 * unsupported ownership layouts fail closed.
 */
import { constants, openSync, closeSync, writeSync, fchmodSync, fstatSync } from 'node:fs';
import { ARTIFACT_DRAFT_LOCATION_KINDS } from '../trusted/index.js';
import { descentToParent, verifyParentIdentity, createExclusiveFile, unlinkCreated } from '../internal/darwin-fs/adapter.js';
import { WRITE_CANONICAL_UTF8_MAX_BYTES } from './types.js';
import type {
  DraftWriteExecutorFailureCode,
  DraftWriteExecutorInput,
  DraftWriteExecutorResult,
} from './types.js';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = constants;

/** Fixed implementation-owned artifact draft file mode (the caller never controls it). */
export const DRAFT_FILE_MODE = 0o600;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Defensive lexical component guard on accepted decision evidence (NOT a
 * containment algorithm): rejects empty, `.`, `..`, separators, backslash,
 * and NUL spellings in already-validated relative components.
 */
function validateComponent(component: string): boolean {
  return component.length > 0
    && component !== '.'
    && component !== '..'
    && !component.includes('/')
    && !component.includes('\\')
    && !component.includes('\u0000');
}

/** Defensive lexical guard for a root-relative path ('' = the root itself). */
function validateRelativePath(relative: string): boolean {
  if (relative.length === 0) return true;
  if (relative.startsWith('/') || relative.includes('\\') || relative.includes('\u0000')) return false;
  return relative.split('/').every(validateComponent);
}

/**
 * Bounded write loop over one exact payload: continues on short writes
 * (positive safe-integer partial counts), fails closed on zero/negative/
 * non-integer/oversize results and on throws. PURE helper (callback-injected;
 * carries no filesystem authority of its own).
 */
export function writeLoop(writeOnce: (offset: number, length: number) => number, totalBytes: number): 'ok' | 'failed' {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) return 'failed';
  let written = 0;
  while (written < totalBytes) {
    let n: number;
    try {
      n = writeOnce(written, totalBytes - written);
    } catch {
      return 'failed';
    }
    if (!Number.isSafeInteger(n) || n <= 0 || n > totalBytes - written) return 'failed';
    written += n;
  }
  return 'ok';
}

function mapOpenError(code: string | undefined): DraftWriteExecutorFailureCode {
  switch (code) {
    case 'EEXIST':
    case 'EISDIR':
      return 'exclusive-create-conflict';
    case 'ENOENT':
      return 'missing-parent';
    case 'ENOTDIR':
      return 'parent-not-directory';
    case 'EROFS':
      return 'readonly-filesystem';
    case 'ENOSPC':
      return 'no-space';
    case 'EDQUOT':
      return 'quota-exceeded';
    case 'EACCES':
    case 'EPERM':
      return 'permission-denied';
    case 'ELOOP':
      return 'symlink-loop';
    case 'EOPNOTSUPP':
    case 'ENOTSUP':
      return 'unsupported-filesystem';
    default:
      return 'io-failure';
  }
}

/** Root-anchor open failures (the artifact root itself is unavailable). */
function mapRootOpenError(code: string | undefined): DraftWriteExecutorFailureCode {
  if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') return 'artifact-root-unavailable';
  return mapOpenError(code);
}

function errnoOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code ?? undefined;
}

/**
 * At most one bounded best-effort removal attempt of a target created by
 * THIS operation, through the SAME verified parent descriptor that created
 * it and the SAME single final component — never through a re-resolved
 * absolute lexical path and never through a joined multi-component path.
 * (MAC-2B: descriptor-relative unlinkat through the native seam.)
 */
function cleanupCreatedTarget(parentFd: number, finalComponent: string): 'removed' | 'failed' {
  return unlinkCreated(parentFd, finalComponent);
}

/**
 * Execute the create-only draft file write. Typed result only; never throws
 * for expected filesystem outcomes (a throwing caller hook is treated as a
 * write-stage failure and routed through the cleanup path).
 */
export function executeDraftFileWrite(input: DraftWriteExecutorInput): DraftWriteExecutorResult {
  // Evidence validation: only the accepted correlated evidence shape is
  // accepted; anything else is a host-side internal failure. Defensive
  // lexical checks are defense in depth — the descriptor anchor confines.
  if (!isRecord(input)) return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  if (input.operationClass !== 'artifact-draft-destination' || input.purpose !== 'persist-validated-artifact-draft') {
    return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  }
  if (typeof input.configurationIdentity !== 'string' || input.configurationIdentity.length === 0
    || typeof input.workspaceId !== 'string' || input.workspaceId.length === 0) {
    return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  }
  if (typeof input.artifactKind !== 'string' || !(ARTIFACT_DRAFT_LOCATION_KINDS as readonly string[]).includes(input.artifactKind)) {
    return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  }
  if (typeof input.canonicalUtf8 !== 'string' || input.canonicalUtf8.length === 0) {
    return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  }
  if (!Number.isSafeInteger(input.expectedByteCount) || input.expectedByteCount <= 0 || input.expectedByteCount > WRITE_CANONICAL_UTF8_MAX_BYTES) {
    return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  }
  const bytes = Buffer.from(input.canonicalUtf8, 'utf8');
  if (bytes.byteLength !== input.expectedByteCount) {
    return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  }
  if (typeof input.canonicalArtifactRoot !== 'string' || input.canonicalArtifactRoot === '/' || input.canonicalArtifactRoot.length === 0 || input.canonicalArtifactRoot.endsWith('/')) {
    return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  }
  if (typeof input.canonicalExistingDirectoryAncestor !== 'string' || input.canonicalExistingDirectoryAncestor.length === 0) {
    return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  }
  if (typeof input.canonicalAncestorRelativePath !== 'string' || !validateRelativePath(input.canonicalAncestorRelativePath)) {
    return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  }
  const tail = input.destinationTailComponents;
  if (!Array.isArray(tail) || tail.length === 0 || tail.some((c) => typeof c !== 'string' || !validateComponent(c))) {
    return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
  }
  // Slice-1 single-component create invariant: the create/unlink path is
  // EXACTLY ONE final component below the verified parent descriptor. A
  // multi-component tail means intermediate directories are missing; Slice 1
  // has no directory-creation authority and never traverses, follows, or
  // creates tail components (O_NOFOLLOW would protect only a final
  // component, so no multi-component path may ever reach the create/unlink
  // boundary (the native seam accepts exactly one final component).
  // A zero-length tail is inconsistent with an accepted `missing` decision
  // (TAD-037) and is invalid evidence.
  if (tail.length !== 1) {
    if (tail.length === 0) {
      return { ok: false, code: 'invalid-evidence', cleanup: 'not-needed' };
    }
    return { ok: false, code: 'missing-parent', cleanup: 'not-needed' };
  }
  const finalComponent = tail[0];

  const serviceUid = process.getuid?.() ?? 0;
  let rootFd: number | undefined;
  let parentFd: number | undefined;
  let fd: number | undefined;
  let created = false;
  try {
    // 1. Anchor: retain the accepted canonical artifact root descriptor
    //    (no-follow) and verify it descriptor-bound (directory, service UID).
    try {
      rootFd = openSync(input.canonicalArtifactRoot, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
      const rootStat = fstatSync(rootFd);
      if (!rootStat.isDirectory() || rootStat.uid !== serviceUid) {
        return { ok: false, code: 'artifact-root-unavailable', cleanup: 'not-needed' };
      }
    } catch (err) {
      return { ok: false, code: mapRootOpenError(errnoOf(err)), cleanup: 'not-needed' };
    }
    // Test/host seam: post-anchor root-replacement race tests. A throwing
    // hook is a host-seam failure before any create (typed, no cleanup).
    try {
      input.hooks?.afterRootOpen?.();
    } catch {
      return { ok: false, code: 'io-failure', cleanup: 'not-needed' };
    }

    // 2. Parent THROUGH THE ANCHORED CHAIN (descriptor-relative, no-follow)
    //    with descriptor-bound verification and resolution-path identity
    //    against the accepted canonical ancestor. When the accepted
    //    ancestor IS the artifact root, the retained root descriptor is the
    //    verified parent. (MAC-2B: single-component openat descent through
    //    the native seam; identity via fcntl(F_GETPATH).)
    if (input.canonicalAncestorRelativePath !== '') {
      const descended = descentToParent(rootFd, input.canonicalAncestorRelativePath);
      if (!descended.ok) {
        return { ok: false, code: descended.code, cleanup: 'not-needed' };
      }
      parentFd = descended.parentFd;
      try {
        const parentStat = fstatSync(parentFd);
        if (!parentStat.isDirectory()) {
          return { ok: false, code: 'parent-not-directory', cleanup: 'not-needed' };
        }
        if (parentStat.uid !== serviceUid) {
          return { ok: false, code: 'permission-denied', cleanup: 'not-needed' };
        }
      } catch {
        return { ok: false, code: 'io-failure', cleanup: 'not-needed' };
      }
      // SYM-009 resolution-path verification: the opened parent's
      // descriptor must resolve to the accepted canonical ancestor; an
      // intermediate component replaced after revalidation diverges here.
      const identity = verifyParentIdentity(parentFd, input.canonicalExistingDirectoryAncestor);
      if (!identity.ok) {
        return { ok: false, code: 'parent-not-verified', cleanup: 'not-needed' };
      }
    } else {
      parentFd = rootFd;
    }

    // 3. Exclusive create through the anchored parent: EXACTLY ONE final
    //    component below the verified parent descriptor (no intermediate
    //    components exist in the create path), no-follow, fixed mode 0600
    //    (owned by the native seam). Any existing target (file, directory,
    //    symlink, dangling symlink, unsupported kind) fails closed here as
    //    a typed conflict — never overwrite/update. (MAC-2B:
    //    createExclusiveFileAt through the native seam.)
    const createdResult = createExclusiveFile(parentFd, finalComponent);
    if (!createdResult.ok) {
      return { ok: false, code: createdResult.code, cleanup: 'not-needed' };
    }
    fd = createdResult.fd;
    created = true;
    const targetFd = fd;

    // 4. Fixed mode (umask-independent) and descriptor verification of the
    //    created object.
    try {
      fchmodSync(targetFd, DRAFT_FILE_MODE);
      const stat = fstatSync(targetFd);
      if (!stat.isFile() || stat.uid !== serviceUid || (stat.mode & 0o777) !== DRAFT_FILE_MODE) {
        return { ok: false, code: 'verify-failed', cleanup: cleanupCreatedTarget(parentFd, finalComponent) };
      }
    } catch (err) {
      if (created) {
        return { ok: false, code: 'verify-failed', cleanup: cleanupCreatedTarget(parentFd, finalComponent) };
      }
      return { ok: false, code: 'io-failure', cleanup: 'not-needed' };
    }

    // 5. Exact byte write (bounded loop; short writes continue). The
    //    test/host seam runs after the exclusive create, before the write;
    //    a throwing hook is a write-stage failure routed through the
    //    cleanup path.
    try {
      input.hooks?.beforeWrite?.();
    } catch {
      return { ok: false, code: 'write-failed', cleanup: cleanupCreatedTarget(parentFd, finalComponent) };
    }
    const writeResult = writeLoop((offset, length) => writeSync(targetFd, bytes, offset, length, offset), bytes.byteLength);
    if (writeResult !== 'ok') {
      return { ok: false, code: 'write-failed', cleanup: cleanupCreatedTarget(parentFd, finalComponent) };
    }

    // 6. Close. A close failure after a full write is still a failure
    //    before successful completion: route through the cleanup path.
    try {
      input.hooks?.afterWrite?.(targetFd);
    } catch {
      return { ok: false, code: 'write-failed', cleanup: cleanupCreatedTarget(parentFd, finalComponent) };
    }
    try {
      closeSync(targetFd);
      fd = undefined;
    } catch {
      return { ok: false, code: 'close-failed', cleanup: cleanupCreatedTarget(parentFd, finalComponent) };
    }
    return { ok: true, outcome: 'created', persistedByteCount: bytes.byteLength };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort close; the typed verdict stands.
      }
    }
    if (parentFd !== undefined && parentFd !== rootFd) {
      try {
        closeSync(parentFd);
      } catch {
        // Best-effort close; the typed verdict stands.
      }
    }
    if (rootFd !== undefined) {
      try {
        closeSync(rootFd);
      } catch {
        // Best-effort close; the typed verdict stands.
      }
    }
  }
}
