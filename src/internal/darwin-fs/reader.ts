/**
 * MAC-2D — narrow Darwin integration adapter for the WP-7 reader
 * (`src/reader/fs.ts`).
 *
 * Reader-specific position-aware wrappers over the accepted six-primitive
 * native seam. Read-only: no mutation, no absolute paths, no arbitrary
 * flags/modes, no generic open; no /proc, no /dev/fd, no fallback
 * pathname reopening; `getPath`/F_GETPATH is never used as authority here
 * at all (the reader's S-07 identity evidence comes from dev/ino fstat,
 * which stays in Node).
 *
 * Native codes -> the reader fs-layer vocabulary
 * (`'not-found' | 'permission-denied' | 'unsupported-type' | 'error'`),
 * preserving the inherited openForRead/openForListDirectory errno
 * mapping (ENOENT/ELOOP/ENOTDIR -> not-found; EACCES/EPERM ->
 * permission-denied; ENXIO -> unsupported-type; default -> error). A
 * final symlink is now refused at open (O_NOFOLLOW) instead of being
 * opened and rejected later — earlier fail-closed timing, same reader
 * taxonomy.
 *
 * Descriptor ownership (MAC-1/MAC-2D-NATIVE rules): incoming fds are
 * caller-owned and never closed here; a newly opened fd becomes
 * caller-owned only on successful return; intermediates are closed by
 * the reader's descent on every path; the root fd is never closed by
 * this adapter.
 */
import { loadGatewayFs } from '#gateway-native';
import type { GatewayFsAddon, NativeFsErrorCode } from '#gateway-native';

/** Inherited reader fs-layer open codes. */
export type ReaderFsCode = 'not-found' | 'permission-denied' | 'unsupported-type' | 'error';

export type ReaderOpenResult =
  | { readonly ok: true; readonly fd: number }
  | { readonly ok: false; readonly code: ReaderFsCode };

export type ReaderEnumerationResult =
  | {
      readonly ok: true;
      readonly entries: readonly { readonly name: string; readonly kindHint: 'file' | 'directory' | 'symlink' | 'other' }[];
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly code: ReaderFsCode };

/** Lazy seam handle (require cache makes repeated loads cheap). */
let addon: GatewayFsAddon | null = null;
function native(): GatewayFsAddon {
  if (addon === null) addon = loadGatewayFs();
  return addon;
}

/** Native code -> inherited reader fs-layer vocabulary (open position). */
export function mapReaderOpen(code: NativeFsErrorCode, notDirectory: 'not-found' | 'unsupported-type'): ReaderFsCode {
  switch (code) {
    case 'not-found': return 'not-found';
    case 'not-directory': return notDirectory;
    case 'symlink-refused': return 'not-found';
    case 'permission-denied': return 'permission-denied';
    // invalid-fd/invalid-input/unsupported/io-failure/exists/read-only/
    // no-space/quota/unknown: inherited default -> error.
    default: return 'error';
  }
}

/**
 * One descriptor-relative directory step (intermediate OR final):
 * single-component `openDirectoryAt` (O_RDONLY|O_DIRECTORY|O_NOFOLLOW).
 * `notDirectory` is the inherited ENOTDIR mapping for the operation:
 * read ops -> 'not-found', list ops -> 'unsupported-type' (inherited
 * openForRead vs openForListDirectory errno tables).
 */
export function openDirectoryAtReader(
  parentFd: number,
  component: string,
  notDirectory: 'not-found' | 'unsupported-type',
): ReaderOpenResult {
  try {
    const r = native().openDirectoryAt(parentFd, component);
    if (!r.ok) return { ok: false, code: mapReaderOpen(r.code, notDirectory) };
    return { ok: true, fd: r.fd };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/**
 * Final file open for reads: `openExistingFileAt` (fixed
 * O_RDONLY|O_NOFOLLOW|O_NONBLOCK — a FIFO can never block; a swapped
 * final symlink is refused directly, mapping to the inherited
 * not-found). Legitimate in-workspace symlinks never reach this open:
 * containment resolves them (SYM-006) and the reader descends the
 * RESOLVED canonical relative, whose final component is the real
 * target.
 */
export function openExistingFileAtReader(parentFd: number, component: string): ReaderOpenResult {
  try {
    const r = native().openExistingFileAt(parentFd, component);
    if (!r.ok) return { ok: false, code: mapReaderOpen(r.code, 'not-found') };
    return { ok: true, fd: r.fd };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/**
 * Descriptor-bound bounded enumeration: `readDirectoryEntries(fd)`.
 * Raw entries + native truncated flag; deterministic sorting and
 * maxEntries truncation stay in the reader (JS). A native failure maps
 * to 'error' (or 'permission-denied') — unreachable in the integrated
 * flow (the target was just opened as a verified directory) and surfaced
 * by the reader's inherited throw-shaped path.
 */
export function readDirectoryEntriesReader(fd: number): ReaderEnumerationResult {
  try {
    const r = native().readDirectoryEntries(fd);
    if (!r.ok) return { ok: false, code: r.code === 'permission-denied' ? 'permission-denied' : 'error' };
    return { ok: true, entries: r.entries, truncated: r.truncated };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/**
 * The reader's canonical relative path is '' exactly when the workspace
 * ROOT itself is the target (parseWorkspaceRelativePath: '.' -> []). The
 * inherited Linux open of `/proc/self/fd/<rootFd>/` produced a fresh
 * descriptor; on Darwin the root case instead BORROWS the cached root fd
 * (no fresh descriptor is obtainable without a seventh primitive): the
 * target marks `ownsFd: false` and its close() is a no-op — the root fd
 * remains owned by the workspace-root cache. Behavior is identical
 * (directory open succeeds; a read of the root still fails closed as
 * unsupported-type on the non-regular fstat).
 */
export function isRootTarget(relative: string): boolean {
  return relative === '';
}
