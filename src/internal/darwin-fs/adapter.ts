/**
 * MAC-2B — narrow Darwin integration adapter for the controlled-write
 * executor (WP-11 Slice 1; `src/writing/executor.ts`).
 *
 * The ONLY production bridge from the writing executor to the accepted
 * MAC-1 native seam (five closed primitives). Executor-specific; NOT a
 * generic filesystem abstraction:
 *
 *   - no absolute-path operations (the canonical root anchor stays in
 *     Node, in the executor);
 *   - no arbitrary flags or modes (the seam owns every flag; the create
 *     mode is the fixed 0600 inside the addon);
 *   - no generic open/unlink (only the executor's exact operations:
 *     single-component directory descent, parent identity evidence,
 *     exclusive create, at-most-one cleanup unlink);
 *   - no fallback behavior: a missing/wrong-arch native addon is a
 *     typed `io-failure` at the executor boundary, never a weaker
 *     pure-Node path;
 *   - no `/proc`, no `/dev/fd`, no shell/subprocess;
 *   - `getPath` output is IDENTITY EVIDENCE ONLY and is never fed back
 *     into an open/create/unlink (no mutation pathname reconstruction).
 *
 * Descriptor rules (MAC-1 §6, unchanged): incoming fds are caller-owned
 * and never closed here; a newly created fd becomes caller-owned only on
 * successful return; every intermediate descent fd is closed on every
 * path (success and failure); the root fd is never closed by this
 * adapter.
 *
 * The executor's JS lexical guards (validateComponent/validateRelativePath)
 * remain the component-validation contract; the native layer re-rejects
 * malformed components as defense in depth (invalid-input -> mapped
 * io-failure, unreachable in practice).
 */
import { closeSync } from 'node:fs';
import { loadGatewayFs } from '#gateway-native';
import type { GatewayFsAddon, NativeFsErrorCode } from '#gateway-native';

/** Inherited executor failure codes reachable from adapter operations. */
export type ExecutorParentOpenCode =
  | 'missing-parent'
  | 'parent-not-directory'
  | 'symlink-loop'
  | 'permission-denied'
  | 'readonly-filesystem'
  | 'unsupported-filesystem'
  | 'io-failure';

export type ExecutorCreateCode =
  | 'exclusive-create-conflict'
  | 'missing-parent'
  | 'parent-not-directory'
  | 'permission-denied'
  | 'readonly-filesystem'
  | 'no-space'
  | 'quota-exceeded'
  | 'unsupported-filesystem'
  | 'io-failure';

export type DescentResult =
  | { readonly ok: true; readonly parentFd: number }
  | { readonly ok: false; readonly code: ExecutorParentOpenCode };

export type IdentityResult = { readonly ok: true } | { readonly ok: false; readonly code: 'parent-not-verified' };

export type CreateResult =
  | { readonly ok: true; readonly fd: number }
  | { readonly ok: false; readonly code: ExecutorCreateCode };

export type CleanupOutcome = 'removed' | 'failed';

/** Lazy seam handle: first use loads the addon; any load failure is a
 * typed executor failure, never a throw across the executor boundary. */
let addon: GatewayFsAddon | null = null;
function native(): GatewayFsAddon {
  if (addon === null) addon = loadGatewayFs();
  return addon;
}

/** Native code -> inherited executor vocabulary, parent-descent position. */
export function mapParentOpen(code: NativeFsErrorCode): ExecutorParentOpenCode {
  switch (code) {
    case 'not-found': return 'missing-parent';
    case 'not-directory': return 'parent-not-directory';
    case 'symlink-refused': return 'symlink-loop';
    case 'permission-denied': return 'permission-denied';
    case 'read-only': return 'readonly-filesystem';
    case 'unsupported': return 'unsupported-filesystem';
    // invalid-input/invalid-fd/exists/no-space/quota/io-failure/unknown:
    // unreachable for O_DIRECTORY|O_NOFOLLOW opens; fail closed.
    default: return 'io-failure';
  }
}

/** Native code -> inherited executor vocabulary, final-create position. */
export function mapCreate(code: NativeFsErrorCode): ExecutorCreateCode {
  switch (code) {
    case 'exists': return 'exclusive-create-conflict';
    case 'symlink-refused': return 'exclusive-create-conflict';
    case 'not-found': return 'missing-parent';
    case 'not-directory': return 'parent-not-directory';
    case 'permission-denied': return 'permission-denied';
    case 'read-only': return 'readonly-filesystem';
    case 'no-space': return 'no-space';
    case 'quota': return 'quota-exceeded';
    case 'unsupported': return 'unsupported-filesystem';
    default: return 'io-failure';
  }
}

/**
 * Descriptor-relative parent descent, one single component per native
 * call (replaces the Linux `/proc/self/fd/<rootFd>/<ancestorRelative>`
 * open). `ancestorRelativePath` is the executor-validated canonical
 * ancestor relative path ('' is handled by the caller: parent = root).
 *
 * Ownership: every intermediate fd is caller-owned; intermediates are
 * closed after the full descent (and on every failure path); the root
 * fd is never closed; the returned final parent fd is caller-owned.
 */
export function descentToParent(rootFd: number, ancestorRelativePath: string): DescentResult {
  const components = ancestorRelativePath.split('/');
  let current = rootFd;
  const opened: number[] = [];
  try {
    for (const component of components) {
      const r = native().openDirectoryAt(current, component);
      if (!r.ok) {
        for (const fd of opened) closeBestEffort(fd);
        return { ok: false, code: mapParentOpen(r.code) };
      }
      opened.push(r.fd);
      current = r.fd;
    }
    const finalFd = opened[opened.length - 1];
    // Unreachable in practice (a non-empty validated relative path always
    // yields >= 1 component, and a failed open returns early); fail closed
    // without leaking if it ever happens.
    if (finalFd === undefined) {
      for (const fd of opened) closeBestEffort(fd);
      return { ok: false, code: 'io-failure' };
    }
    for (const fd of opened.slice(0, -1)) closeBestEffort(fd);
    return { ok: true, parentFd: finalFd };
  } catch {
    // Native-unavailable (loader fail-closed) or unexpected failure:
    // close every intermediate we opened, fail closed.
    for (const fd of opened) closeBestEffort(fd);
    return { ok: false, code: 'io-failure' };
  }
}

/**
 * Descriptor-bound parent identity (replaces
 * `readlinkSync('/proc/self/fd/<parentFd>')`): the seam's F_GETPATH
 * output must equal the accepted canonical ancestor. The returned path
 * is identity evidence only — it is never used for an open/create/unlink.
 */
export function verifyParentIdentity(parentFd: number, expectedCanonicalAncestor: string): IdentityResult {
  try {
    const r = native().getPath(parentFd);
    if (!r.ok) return { ok: false, code: 'parent-not-verified' };
    if (r.path !== expectedCanonicalAncestor) return { ok: false, code: 'parent-not-verified' };
    return { ok: true };
  } catch {
    return { ok: false, code: 'parent-not-verified' };
  }
}

/**
 * Exclusive create of the single final component below the verified
 * parent fd (replaces the Linux `openSync('/proc/self/fd/<parentFd>/…',
 * O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW, 0o600)`). The seam owns the mode
 * (fixed 0600) and every flag; the caller supplies no mode.
 */
export function createExclusiveFile(parentFd: number, finalComponent: string): CreateResult {
  try {
    const r = native().createExclusiveFileAt(parentFd, finalComponent);
    if (!r.ok) return { ok: false, code: mapCreate(r.code) };
    return { ok: true, fd: r.fd };
  } catch {
    return { ok: false, code: 'io-failure' };
  }
}

/**
 * At-most-one cleanup unlink of the object created by the operation,
 * through the SAME verified parent fd and the SAME single final
 * component (replaces `unlinkSync('/proc/self/fd/<parentFd>/…')`).
 * Never an absolute path; no directory deletion; no secondary attempt.
 */
export function unlinkCreated(parentFd: number, finalComponent: string): CleanupOutcome {
  try {
    const r = native().unlinkAt(parentFd, finalComponent);
    return r.ok ? 'removed' : 'failed';
  } catch {
    return 'failed';
  }
}

function closeBestEffort(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // Best-effort close; the typed verdict stands (inherited pattern).
  }
}
