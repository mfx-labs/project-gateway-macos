/**
 * WP-13B — narrow result-write executor (the ONLY filesystem-mutation
 * module in the completion family).
 *
 * Committed contract §3.4 (SCR-WP13-003): write of exactly one canonical
 * file at a deterministic destination inside the WP-6 verified workspace
 * root; EXCLUSIVE CREATE only — never overwrite/replace/truncate/update;
 * no directory creation; containment-bound with point-of-use revalidation.
 *
 * DESCRIPTOR-ANCHORED CONTAINMENT (SIR-WP13B-003; the established
 * WP-11/WP-6 point-of-use pattern; MAC-2C Darwin integration): the
 * verified workspace root is opened O_RDONLY|O_DIRECTORY|O_NOFOLLOW and
 * retained as a descriptor for the whole operation; every directory
 * component of the destination chain is opened RELATIVE TO the previously
 * verified descriptor — on Darwin, one single-component
 * `openat(O_DIRECTORY|O_NOFOLLOW)` per component through the accepted
 * native seam (`src/internal/darwin-fs/writer.ts`, MAC-1 addon) —
 * fstat-verified (directory, service uid), and resolution-path verified
 * (`fcntl(F_GETPATH)` through the seam; must equal the expected canonical
 * path) — an intermediate component replaced by a symlink diverges here
 * and fails closed (`parent-not-verified`/`containment-denied`). The
 * final exclusive create and the EEXIST recovery read both happen relative
 * to the same verified parent descriptor, so there is NO parent-swap
 * window between containment verification and the final operation.
 *
 * EEXIST / ADOPTION PATH (SIR-WP13B-002): the existing final component is
 * opened O_RDONLY|O_NOFOLLOW|O_NONBLOCK THROUGH THE VERIFIED PARENT
 * DESCRIPTOR and fstat-verified (ordinary regular file, service uid)
 * BEFORE any read. O_NONBLOCK is the established repository pattern for
 * type-inspection opens (reader lane): a FIFO at the destination can
 * never block the open (final FIFO defect CLOSED). A symlink (dangling or
 * pointing at the exact expected bytes), FIFO, directory, device, socket,
 * or other non-regular final component fails closed as a typed
 * `exclusive-create-conflict` — a symlink to the exact expected bytes
 * NEVER returns `already-exact`, and NO bytes are read before successful
 * regular-file fstat verification.
 *
 * - destination: `<root>/results/<occurrence>/<attempt>/execution-result.json`
 *   — deterministic for the exact workspace + bundle + occurrence + attempt
 *   (destination clarification, SIR-WP13B-005; NOT derived from the opaque
 *   result instance/revision ids — the file content carries and binds
 *   those). occurrence/attempt are committed `pgw:o:`/`pgw:a:` identities,
 *   so the relative tail can never escape;
 * - an existing ORDINARY FILE with the EXACT expected canonical bytes is
 *   reused as adoption/recovery (crash recovery between artifact creation
 *   and trusted publication) — byte equality alone never confers evaluator
 *   provenance (validation + publication remain required);
 * - an existing destination with conflicting bytes fails closed as a typed
 *   `exclusive-create-conflict` — a second distinct result instance for one
 *   attempt cannot be written;
 * - the byte ceiling is the COMMITTED WP-3 artifact input bound
 *   (`INPUT_BYTE_LIMITS.artifact`, SIR-WP13B-004) — the same bound the
 *   committed WP-4 intake applies, so no schema-valid result accepted by
 *   the committed intake is rejected by an implementation-local ceiling.
 */
import { constants, openSync, closeSync, readSync, writeSync, fstatSync } from 'node:fs';
import * as path from 'node:path';
import { openDirectoryAtWriter, identityOf, createExclusiveFileWriter, openExistingFileWriter, cleanupCreated } from '../internal/darwin-fs/writer.js';
import { INPUT_BYTE_LIMITS } from '../internal/phase.js';

export const RESULT_RELATIVE_DIR = 'results';
export const RESULT_FILE_NAME = 'execution-result.json';
/** Committed WP-3 artifact input byte bound (single source; SIR-WP13B-004). */
export const RESULT_BYTE_LIMIT = INPUT_BYTE_LIMITS.artifact;

const OCCURRENCE_ID_RE = /^pgw:o:[0-9a-f]{32}$/;
const ATTEMPT_ID_RE = /^pgw:a:[0-9a-f]{32}$/;

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = constants;
export type ResultWriteCode =
  | 'invalid-operand'
  | 'bytes-too-large'
  | 'containment-denied'
  | 'missing-parent'
  | 'parent-not-verified'
  | 'ownership-mismatch'
  | 'exclusive-create-conflict'
  | 'io-failure';

export type ResultWriteOutcome =
  | { readonly ok: true; readonly outcome: 'created' | 'already-exact' }
  | { readonly ok: false; readonly code: ResultWriteCode };

export interface ResultWriteInput {
  /** WP-6 verified workspace root (absolute, canonical). */
  readonly root: string;
  readonly serviceUid: number;
  readonly occurrenceId: string;
  readonly attemptId: string;
  /** Exact canonical result bytes. */
  readonly bytes: Uint8Array;
  /**
   * Test/host seam (the WP-11 race-coverage pattern; MAC-3B additions):
   * optional hooks that run at exact deterministic boundaries for
   * hostile-race coverage. Each hook is invoked ONLY when present; absent
   * hooks leave production behavior byte-for-byte unchanged. Hook
   * functions cannot arrive through JSON or MCP schemas (functions are
   * not serializable; no production caller supplies hooks); a hostile
   * non-function value fails closed through the typed writer error path.
   *   - `afterRootOpen`: after the root descriptor is anchored, before
   *     the anchored descent. A throwing hook is a typed failure before
   *     any create.
   *   - `afterCreateConflict`: after the exclusive create reports
   *     `exists`, before the anchored recovery read (MAC-3B). No fd
   *     exists at this boundary (the failed create returned none) and
   *     nothing has been or will be mutated; a throwing hook is a typed
   *     fail-closed `io-failure` that leaves the pre-existing target
   *     untouched (no recovery, no cleanup, no unlink).
   *   - `beforeWrite`: after a successful exclusive create, while the
   *     created fd is owned, immediately before the bounded write loop
   *     (MAC-3B). A throwing hook enters the EXISTING created-path
   *     failure handling: the created object is removed through
   *     `cleanupCreated(parentFd, finalComponent)` (at most one
   *     best-effort attempt) and the result is a typed `io-failure`.
   */
  readonly hooks?: {
    readonly afterRootOpen?: () => void;
    readonly afterCreateConflict?: () => void;
    readonly beforeWrite?: () => void;
  };
}

/** The deterministic destination relative to the result root. */
export function resultRelativePath(occurrenceId: string, attemptId: string): string {
  return `${RESULT_RELATIVE_DIR}/${occurrenceId}/${attemptId}/${RESULT_FILE_NAME}`;
}

function errnoOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code ?? undefined;
}

function closeFd(fd: number | undefined): void {
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    // best-effort close; the typed verdict stands
  }
}

function mapOpenError(code: string | undefined): ResultWriteCode {
  switch (code) {
    case 'ENOENT':
      return 'missing-parent';
    case 'ENOTDIR':
      return 'parent-not-verified';
    case 'ELOOP':
    case 'EMLINK':
      return 'containment-denied';
    default:
      return 'io-failure';
  }
}

/**
 * Open one directory component anchored to an already-verified parent
 * descriptor: single-component `openDirectoryAt` through the Darwin seam
 * (MAC-2C; replaces the Linux `/proc/self/fd/<fd>/<component>` open),
 * fstat-verified (directory, service uid), resolution-path verified
 * against the expected canonical path (F_GETPATH identity evidence — never
 * reopened, never used as mutation authority). The returned descriptor is
 * retained (never re-resolved lexically later); a failure closes any
 * opened descriptor and returns a typed code.
 */
function openVerifiedDirectory(
  parentFd: number,
  component: string,
  expectedResolved: string,
  serviceUid: number,
): { readonly ok: true; readonly fd: number } | { readonly ok: false; readonly code: ResultWriteCode } {
  let fd: number | undefined;
  try {
    const opened = openDirectoryAtWriter(parentFd, component);
    if (!opened.ok) {
      return { ok: false, code: opened.code };
    }
    fd = opened.fd;
    const stat = fstatSync(fd);
    if (!stat.isDirectory()) {
      closeFd(fd);
      fd = undefined;
      return { ok: false, code: 'parent-not-verified' };
    }
    if (stat.uid !== serviceUid) {
      closeFd(fd);
      fd = undefined;
      return { ok: false, code: 'ownership-mismatch' };
    }
    const identity = identityOf(fd, expectedResolved);
    if (!identity.ok) {
      closeFd(fd);
      fd = undefined;
      return { ok: false, code: 'parent-not-verified' };
    }
    return { ok: true, fd };
  } catch (err) {
    closeFd(fd);
    return { ok: false, code: mapOpenError(errnoOf(err)) };
  }
}

/**
 * EEXIST recovery read, anchored to the verified parent descriptor
 * (SIR-WP13B-002): the final component is opened O_RDONLY|O_NOFOLLOW and
 * fstat-verified as an ordinary service-owned regular file BEFORE any
 * read. A symlink/device/socket/FIFO/directory final component fails
 * closed as `exclusive-create-conflict` — never `already-exact`. Reads
 * are bounded by the committed byte ceiling.
 */
function readExistingForRecovery(parentFd: number, finalComponent: string, serviceUid: number, expected: Uint8Array): ResultWriteOutcome {
  let existingFd: number | undefined;
  try {
    // MAC-2C: recovery open through the Darwin seam (openExistingFileAt,
    // fixed O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC). O_NONBLOCK
    // guarantees a FIFO at the destination can never block the open; the
    // fstat below then rejects it as non-regular. A symlinked final
    // component (dangling or not) is never followed (symlink-refused →
    // conflict). A native open success is NEVER acceptance by itself.
    const opened = openExistingFileWriter(parentFd, finalComponent);
    if (!opened.ok) {
      return { ok: false, code: opened.code };
    }
    existingFd = opened.fd;
    const stat = fstatSync(existingFd);
    if (!stat.isFile()) {
      // Directory/device/socket/FIFO/other kind: not an adoptable
      // project-visible result file.
      return { ok: false, code: 'exclusive-create-conflict' };
    }
    if (stat.uid !== serviceUid) {
      return { ok: false, code: 'ownership-mismatch' };
    }
    if (stat.size !== expected.byteLength || stat.size > RESULT_BYTE_LIMIT) {
      return { ok: false, code: 'exclusive-create-conflict' };
    }
    const existing = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      let n: number;
      try {
        n = readSync(existingFd, existing, offset, stat.size - offset, offset);
      } catch {
        return { ok: false, code: 'io-failure' };
      }
      if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, code: 'io-failure' };
      offset += n;
    }
    if (existing.every((b, i) => b === expected[i])) {
      return { ok: true, outcome: 'already-exact' };
    }
    return { ok: false, code: 'exclusive-create-conflict' };
  } finally {
    closeFd(existingFd);
  }
}

/**
 * Write the exact canonical result bytes to the deterministic destination.
 * Creates nothing but the final file component; never touches anything
 * else; typed result only (never throws for expected filesystem outcomes).
 */
export function writeResultArtifact(input: ResultWriteInput): ResultWriteOutcome {
  if (typeof input.root !== 'string' || input.root.length === 0 || !path.isAbsolute(input.root)) {
    return { ok: false, code: 'invalid-operand' };
  }
  if (!OCCURRENCE_ID_RE.test(input.occurrenceId) || !ATTEMPT_ID_RE.test(input.attemptId)) {
    return { ok: false, code: 'invalid-operand' };
  }
  if (typeof input.serviceUid !== 'number' || !Number.isSafeInteger(input.serviceUid) || input.serviceUid < 0) {
    return { ok: false, code: 'invalid-operand' };
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > RESULT_BYTE_LIMIT) {
    return { ok: false, code: input.bytes instanceof Uint8Array && input.bytes.byteLength > RESULT_BYTE_LIMIT ? 'bytes-too-large' : 'invalid-operand' };
  }

  const root = path.resolve(input.root);
  const dirComponents = [RESULT_RELATIVE_DIR, input.occurrenceId, input.attemptId];
  const finalComponent = RESULT_FILE_NAME;

  let rootFd: number | undefined;
  let parentFd: number | undefined;
  let fd: number | undefined;
  let created = false;
  try {
    // 1. Anchor: retain the verified workspace root descriptor (no-follow)
    //    and verify it descriptor-bound (directory, service uid, canonical
    //    resolution path).
    try {
      rootFd = openSync(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
      const rootStat = fstatSync(rootFd);
      if (!rootStat.isDirectory()) return { ok: false, code: 'parent-not-verified' };
      if (rootStat.uid !== input.serviceUid) return { ok: false, code: 'ownership-mismatch' };
      // MAC-2C: root descriptor identity via the seam's F_GETPATH (replaces
      // readlink(/proc/self/fd/<rootFd>)); the accepted canonical root must
      // equal the vnode-canonical path (production canonicalization is
      // symlink-resolved — src/trusted/roots.ts). Mismatch fails closed.
      const rootIdentity = identityOf(rootFd, root);
      if (!rootIdentity.ok) return { ok: false, code: 'parent-not-verified' };
    } catch (err) {
      const code = errnoOf(err);
      if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, code: 'missing-parent' };
      if (code === 'ELOOP' || code === 'EMLINK') return { ok: false, code: 'containment-denied' };
      return { ok: false, code: 'io-failure' };
    }

    // Test/host seam (WP-11 race-coverage pattern): post-anchor
    // root-replacement race tests. A throwing hook is a typed failure
    // before any create.
    try {
      input.hooks?.afterRootOpen?.();
    } catch {
      return { ok: false, code: 'io-failure' };
    }

    // 2. Anchored descent: every directory component is opened relative to
    //    the previously verified descriptor and descriptor-verified. A
    //    component swapped for a symlink before its open is opened through
    //    the retained parent descriptor (which pins the already-verified
    //    inode) and diverges at the resolution check; a swap after its
    //    open cannot redirect the next step at all.
    parentFd = rootFd;
    let resolvedPath = root;
    for (const component of dirComponents) {
      const expectedResolved = `${resolvedPath}/${component}`;
      const opened = openVerifiedDirectory(parentFd, component, expectedResolved, input.serviceUid);
      if (!opened.ok) return { ok: false, code: opened.code };
      if (parentFd !== rootFd) closeFd(parentFd);
      parentFd = opened.fd;
      resolvedPath = expectedResolved;
    }

    // 3. Exclusive create of the single final component through the
    //    verified parent descriptor (the seam's O_EXCL never follows a
    //    symlink; O_NOFOLLOW is belt-and-braces; mode fixed 0600 in the
    //    seam). Any existing final component — regular file, directory,
    //    symlink, dangling symlink, unsupported kind — is reported as
    //    `exists`; the writer routes to the anchored recovery read, never
    //    to an overwrite. (MAC-2C: createExclusiveFileAt through the seam.)
    const createdResult = createExclusiveFileWriter(parentFd, finalComponent);
    if (!createdResult.ok) {
      if (createdResult.code === 'exists') {
        // MAC-3B seam: exact EEXIST→recovery boundary. No fd exists here
        // (the failed create returned none); a throwing hook is a typed
        // fail-closed io-failure with NO recovery read, NO cleanup, and NO
        // unlink of the pre-existing target; parent/root ownership is
        // unchanged (the outer finally still closes them exactly once).
        try {
          input.hooks?.afterCreateConflict?.();
        } catch {
          return { ok: false, code: 'io-failure' };
        }
        return readExistingForRecovery(parentFd, finalComponent, input.serviceUid, input.bytes);
      }
      return { ok: false, code: createdResult.code };
    }
    fd = createdResult.fd;
    created = true;

    // 4. Exact byte write (bounded loop; short writes continue). The
    //    MAC-3B seam runs after the exclusive create, immediately before
    //    the write, INSIDE the created-path failure handling: a throwing
    //    hook is caught by the existing catch below, which performs the
    //    single best-effort cleanupCreated(parentFd, finalComponent) and
    //    returns a typed io-failure; the inner finally closes the created
    //    fd exactly once. Absent hooks: production behavior unchanged.
    try {
      input.hooks?.beforeWrite?.();
      let offset = 0;
      while (offset < input.bytes.byteLength) {
        const written = writeSync(fd, input.bytes, offset, input.bytes.byteLength - offset, offset);
        if (!Number.isSafeInteger(written) || written <= 0) throw new Error('short write');
        offset += written;
      }
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.uid !== input.serviceUid || stat.size !== input.bytes.byteLength) {
        throw new Error('created object verification failed');
      }
      return { ok: true, outcome: 'created' };
    } catch {
      // Best-effort cleanup of the object we created, THROUGH THE SAME
      // VERIFIED PARENT descriptor and the same single final component
      // (MAC-2C: descriptor-relative unlinkAt through the seam).
      if (created) {
        cleanupCreated(parentFd, finalComponent);
      }
      return { ok: false, code: 'io-failure' };
    } finally {
      closeFd(fd);
    }
  } finally {
    if (parentFd !== undefined && parentFd !== rootFd) closeFd(parentFd);
    closeFd(rootFd);
  }
}
