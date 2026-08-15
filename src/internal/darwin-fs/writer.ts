/**
 * MAC-2C — narrow Darwin integration adapter for the completion result
 * writer (WP-13B; `src/completion/writer.ts`).
 *
 * Sibling of the writing-executor adapter (`./adapter.ts`) in the same
 * private `src/internal/darwin-fs/` boundary. Completion-specific
 * position-aware wrappers over the accepted MAC-1 five-primitive seam,
 * with the INHERITED completion error vocabulary:
 *
 *   - not-found        -> `missing-parent`   (descent) / `io-failure` (recovery)
 *   - not-directory    -> `parent-not-verified`
 *   - symlink-refused  -> `containment-denied` (descent) / `exclusive-create-conflict` (recovery)
 *   - exists           -> `exists` (create; routes to the inherited EEXIST
 *                          recovery path — the writer decides adoption)
 *   - everything else  -> `io-failure` (the inherited writer collapses
 *                          permission/read-only/storage failures into
 *                          io-failure — MAC-2A §5; not "improved" here)
 *
 * The writer keeps its own control flow: per-component fstat directory/
 * UID verification, bounded recovery reads, and exact-byte comparison
 * stay in `src/completion/writer.ts` (Node on the returned raw fd). The
 * adapter owns NO node:fs surface at all — it is a pure seam wrapper.
 *
 * Same non-negotiable rules as the executor adapter:
 *   - single components only; no absolute paths; no arbitrary
 *     flags/modes; no generic open/unlink; no fallback behavior;
 *   - no /proc, no /dev/fd, no shell/subprocess;
 *   - `getPath` output is identity evidence only (shared
 *     `verifyParentIdentity`) and is never fed into a mutation.
 */
import { loadGatewayFs } from '#gateway-native';
import type { GatewayFsAddon, NativeFsErrorCode } from '#gateway-native';
import { verifyParentIdentity, unlinkCreated } from './adapter.js';
import type { IdentityResult } from './adapter.js';

/** Inherited completion writer codes reachable from adapter operations. */
export type WriterDescentCode = 'missing-parent' | 'parent-not-verified' | 'containment-denied' | 'io-failure';
export type WriterCreateCode = 'exists' | 'missing-parent' | 'parent-not-verified' | 'containment-denied' | 'io-failure';
export type WriterRecoveryCode = 'exclusive-create-conflict' | 'io-failure';

export type WriterOpenResult =
  | { readonly ok: true; readonly fd: number }
  | { readonly ok: false; readonly code: WriterDescentCode };

export type WriterCreateResult =
  | { readonly ok: true; readonly fd: number }
  | { readonly ok: false; readonly code: WriterCreateCode };

export type WriterRecoveryOpenResult =
  | { readonly ok: true; readonly fd: number }
  | { readonly ok: false; readonly code: WriterRecoveryCode };

/** Lazy seam handle (require cache makes repeated loads cheap). */
let addon: GatewayFsAddon | null = null;
function native(): GatewayFsAddon {
  if (addon === null) addon = loadGatewayFs();
  return addon;
}

/** Native code -> inherited completion vocabulary, descent position. */
export function mapWriterDescent(code: NativeFsErrorCode): WriterDescentCode {
  switch (code) {
    case 'not-found': return 'missing-parent';
    case 'not-directory': return 'parent-not-verified';
    case 'symlink-refused': return 'containment-denied';
    // permission/read-only/unsupported/invalid-*/exists/io-failure/unknown:
    // the inherited writer collapses these into io-failure (mapOpenError
    // default) — preserved, not "improved".
    default: return 'io-failure';
  }
}

/** Native code -> inherited completion vocabulary, final-create position. */
export function mapWriterCreate(code: NativeFsErrorCode): WriterCreateCode {
  switch (code) {
    // The writer MUST see `exists` distinctly: it routes to the inherited
    // EEXIST recovery/adoption path (never a silent conflict). The other
    // branches mirror the inherited mapOpenError table (EEXIST handled
    // above; EISDIR is unreachable via openat O_CREAT|O_EXCL — existing
    // directories report EEXIST and are rejected by the recovery fstat).
    case 'exists': return 'exists';
    case 'not-found': return 'missing-parent';
    case 'not-directory': return 'parent-not-verified';
    case 'symlink-refused': return 'containment-denied';
    default: return 'io-failure';
  }
}

/** Native code -> inherited completion vocabulary, recovery-open position. */
export function mapWriterRecovery(code: NativeFsErrorCode): WriterRecoveryCode {
  switch (code) {
    case 'symlink-refused': return 'exclusive-create-conflict';
    default: return 'io-failure';
  }
}

/**
 * One verified-descent step (replaces the Linux
 * `openSync('/proc/self/fd/<parentFd>/<component>', O_RDONLY|O_DIRECTORY|
 * O_NOFOLLOW)`): single-component `openDirectoryAt`. The writer performs
 * the fstat directory/UID verification and the expected-canonical-path
 * identity check itself (openVerifiedDirectory), keeping its exact
 * per-component semantics.
 */
export function openDirectoryAtWriter(parentFd: number, component: string): WriterOpenResult {
  try {
    const r = native().openDirectoryAt(parentFd, component);
    if (!r.ok) return { ok: false, code: mapWriterDescent(r.code) };
    return { ok: true, fd: r.fd };
  } catch {
    return { ok: false, code: 'io-failure' };
  }
}

/** Shared descriptor identity evidence (F_GETPATH equality). */
export function identityOf(fd: number, expectedResolved: string): IdentityResult {
  return verifyParentIdentity(fd, expectedResolved);
}

/**
 * Exclusive create of the single final component below the verified
 * parent fd (replaces the Linux `openSync('/proc/self/fd/<parentFd>/…',
 * O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW, 0o600)`). The seam owns the mode
 * (fixed 0600) and every flag. `exists` is returned distinctly so the
 * writer's inherited EEXIST recovery/adoption path runs.
 */
export function createExclusiveFileWriter(parentFd: number, finalComponent: string): WriterCreateResult {
  try {
    const r = native().createExclusiveFileAt(parentFd, finalComponent);
    if (!r.ok) return { ok: false, code: mapWriterCreate(r.code) };
    return { ok: true, fd: r.fd };
  } catch {
    return { ok: false, code: 'io-failure' };
  }
}

/**
 * Recovery type-inspection open (replaces the Linux
 * `openSync('/proc/self/fd/<parentFd>/…', O_RDONLY|O_NOFOLLOW|O_NONBLOCK)`):
 * FIXED flags in the seam (O_NONBLOCK guarantees a FIFO can never block).
 * The writer's fstat regular-file/UID/size checks and the bounded exact
 * comparison still gate acceptance — a native open success is NEVER
 * acceptance by itself.
 */
export function openExistingFileWriter(parentFd: number, finalComponent: string): WriterRecoveryOpenResult {
  try {
    const r = native().openExistingFileAt(parentFd, finalComponent);
    if (!r.ok) return { ok: false, code: mapWriterRecovery(r.code) };
    return { ok: true, fd: r.fd };
  } catch {
    return { ok: false, code: 'io-failure' };
  }
}

/** Best-effort cleanup through the same verified parent fd (shared). */
export function cleanupCreated(parentFd: number, finalComponent: string): 'removed' | 'failed' {
  return unlinkCreated(parentFd, finalComponent);
}
