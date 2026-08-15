/**
 * WP-7 — Descriptor-bound filesystem access.
 *
 * Implements the accepted Darwin/Node strategy (MAC-2D):
 * - Retain a descriptor for the workspace root (Node FileHandle).
 * - Open targets descriptor-relative through the accepted native seam
 *   (`src/internal/darwin-fs/reader.ts`, MAC-1 + MAC-2D-NATIVE addons):
 *   single-component openat descent; final file via `openExistingFileAt`
 *   (O_RDONLY|O_NOFOLLOW|O_NONBLOCK), final directory via
 *   `openDirectoryAt` (O_RDONLY|O_DIRECTORY|O_NOFOLLOW); enumeration via
 *   `readDirectoryEntries(fd)`.
 * - Use O_NOFOLLOW at every descriptor-relative open (the seam's fixed
 *   flags) — stricter than the inherited Linux single-path open, and the
 *   same fail-closed reader taxonomy (ELOOP/ENOTDIR -> not-found).
 * - Perform fstat on opened descriptors (raw fds).
 * - Bind reads to the opened descriptor (raw-fd readSync).
 * - Never reopen by original path after validation.
 *
 * Target ownership (MAC-2D): every OpenedTarget owns its raw fd and
 * closes it exactly once via close(); the only exception is the
 * borrowed-root target (`ownsFd: false`, canonical relative ''), whose
 * fd belongs to the workspace-root cache and is never closed by the
 * target.
 */
import { open as fsOpen, type FileHandle } from 'node:fs/promises';
import { constants, fstatSync, lstatSync, statSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import {
  openDirectoryAtReader,
  openExistingFileAtReader,
  readDirectoryEntriesReader,
  isRootTarget,
} from '../internal/darwin-fs/reader.js';
import type { ReaderOpenResult } from '../internal/darwin-fs/reader.js';
import type { DirectoryEntry, InspectMetadataResult, MetadataKind } from './types.js';

// ---------------------------------------------------------------------------
// Bound workspace root
// ---------------------------------------------------------------------------

export interface BoundWorkspaceRoot {
  readonly rootPath: string;
  readonly rootFd: number;
  close(): Promise<void>;
}

export async function bindWorkspaceRoot(rootPath: string): Promise<BoundWorkspaceRoot> {
  const handle = await fsOpen(rootPath, constants.O_RDONLY | constants.O_DIRECTORY);
  const rootFd = handle.fd;
  return {
    rootPath,
    rootFd,
    async close() {
      try { await handle.close(); } catch { /* best-effort */ }
    },
  };
}

function fsPath(root: BoundWorkspaceRoot, relative: string): string {
  return join(root.rootPath, relative);
}

// ---------------------------------------------------------------------------
// Open modes (descriptor-relative opens carry the seam's FIXED flags)
// ---------------------------------------------------------------------------

// The final file open uses the seam's fixed O_RDONLY|O_NOFOLLOW|O_NONBLOCK:
// O_NONBLOCK prevents a blocking FIFO open during type inspection; the
// final O_NOFOLLOW is STRICTER than the inherited Linux single-path open
// (containment resolves the full symlink chain SYM-001…SYM-006, so
// canonical paths are symlink-free; a post-revalidation symlink swap now
// fails at open with the inherited not-found mapping instead of being
// opened and rejected by the S-07 identity check — earlier fail-closed
// timing, identical reader taxonomy).

// ---------------------------------------------------------------------------
// Type classification from fstat/lstat result
// ---------------------------------------------------------------------------

function classifyStat(st: ReturnType<typeof fstatSync>): {
  kind: MetadataKind;
  isRegularFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  isSpecial: boolean;
  sizeBytes: number;
} {
  const isRegularFile = st.isFile();
  const isDirectory = st.isDirectory();
  const isSymbolicLink = st.isSymbolicLink();
  const isSpecial = st.isFIFO() || st.isSocket() || st.isBlockDevice() || st.isCharacterDevice();
  const kind: MetadataKind =
    isSymbolicLink ? 'symlink' :
    isDirectory ? 'directory' :
    isRegularFile ? 'file' :
    'other';
  return { kind, isRegularFile, isDirectory, isSymbolicLink, isSpecial, sizeBytes: Number(st.size) };
}

// ---------------------------------------------------------------------------
// Opened target (raw-fd ownership model, MAC-2D)
// ---------------------------------------------------------------------------

export interface OpenedTarget {
  /** The target's raw descriptor (native-opened, or the borrowed root fd). */
  readonly fd: number;
  /** true = the target owns `fd` and close() closes it exactly once. */
  readonly ownsFd: boolean;
  readonly relative: string;
  readonly kind: MetadataKind;
  readonly isRegularFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly isSpecial: boolean;
  readonly sizeBytes: number;
  /** Close the owned fd exactly once; a borrowed root target is a no-op. */
  close(): void;
}

function makeTarget(
  fd: number,
  ownsFd: boolean,
  relative: string,
  classified: ReturnType<typeof classifyStat>,
): OpenedTarget {
  let closed = false;
  return {
    fd,
    ownsFd,
    relative,
    ...classified,
    close() {
      if (!ownsFd || closed) return;
      closed = true;
      try {
        closeSync(fd);
      } catch {
        // best-effort close; the typed verdict stands
      }
    },
  };
}

/** Best-effort close of a caller-owned intermediate descent fd. */
function closeFd(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // best-effort
  }
}

/** Close every intermediate descent fd (never the root; never the final). */
function closeOpened(opened: readonly number[]): void {
  for (const fd of opened) closeFd(fd);
}

// ---------------------------------------------------------------------------
// Descriptor-relative descent + final open (shared by read and list)
// ---------------------------------------------------------------------------

/**
 * Open a workspace-relative target descriptor-relative to the bound root.
 *
 * MAC-2D mapping clarification (recorded in the gate report): the descent
 * base is the CONTAINMENT-RESOLVED canonical relative (derived from the
 * decision's realpath-canonical `resolvedAbsolutePath`, which is
 * symlink-free — SYM-006 resolves ALL in-workspace symlinks in
 * containment), NOT the lexical canonical relative. The inherited reader
 * opened the lexical path and let the kernel follow final/intermediate
 * symlinks, with S-07 dev/ino verification as the backstop; on Darwin the
 * seam's fixed O_NOFOLLOW flags make that impossible, and descending the
 * resolved path preserves the reader's EXTERNAL contract exactly
 * (symlink reads succeed with the target's content; S-07 unchanged) while
 * making every O_NOFOLLOW flag the strict post-revalidation guard.
 *
 * Descent: single-component openat per component; the final component is
 * opened per `finalKind`; failure closes every intermediate fd; the final
 * fd is caller-owned on success.
 */
function descentAndOpen(
  root: BoundWorkspaceRoot,
  relative: string,
  resolvedRelative: string,
  finalKind: 'file' | 'directory',
): { ok: true; target: OpenedTarget } | { ok: false; code: 'not-found' | 'permission-denied' | 'unsupported-type' | 'error' } {
  // The workspace root itself (resolved relative ''): the target BORROWS
  // the cached root fd (see isRootTarget in the reader adapter) — the root
  // fd stays owned by the workspace-root cache and is never closed by the
  // target. The fstat classification below still rejects a root read as
  // unsupported-type (non-regular), matching the inherited behavior.
  if (isRootTarget(resolvedRelative)) {
    let st: ReturnType<typeof fstatSync>;
    try {
      st = fstatSync(root.rootFd);
    } catch {
      return { ok: false, code: 'error' };
    }
    const classified = classifyStat(st);
    if (finalKind === 'file' && !classified.isRegularFile) {
      return { ok: false, code: 'unsupported-type' };
    }
    if (finalKind === 'directory' && !classified.isDirectory) {
      return { ok: false, code: 'unsupported-type' };
    }
    return { ok: true, target: makeTarget(root.rootFd, false, relative, classified) };
  }

  const notDirectoryCode: 'not-found' | 'unsupported-type' = finalKind === 'file' ? 'not-found' : 'unsupported-type';
  const components = resolvedRelative.split('/');
  const opened: number[] = [];
  let current = root.rootFd;
  try {
    // Intermediates: every component is a real directory (resolved path).
    for (let i = 0; i < components.length - 1; i++) {
      const r = openDirectoryAtReader(current, components[i]!, notDirectoryCode);
      if (!r.ok) {
        // F-1 correction: every successfully opened intermediate fd is
        // closed before the typed failure return (previously leaked).
        closeOpened(opened);
        return { ok: false, code: r.code };
      }
      opened.push(r.fd);
      current = r.fd;
    }
    // Final component per kind.
    const finalComponent = components[components.length - 1]!;
    const finalResult: ReaderOpenResult = finalKind === 'file'
      ? openExistingFileAtReader(current, finalComponent)
      : openDirectoryAtReader(current, finalComponent, 'unsupported-type');
    if (!finalResult.ok) {
      // F-1 correction: same cleanup on the final-open failure path (the
      // final open failed, so no final fd exists to close; the
      // successfully transferred final fd is never closed here).
      closeOpened(opened);
      return { ok: false, code: finalResult.code };
    }
    closeOpened(opened);
    opened.length = 0;

    // fstat + classification (inherited type gates).
    let st: ReturnType<typeof fstatSync>;
    try {
      st = fstatSync(finalResult.fd);
    } catch {
      closeFd(finalResult.fd);
      return { ok: false, code: 'error' };
    }
    const classified = classifyStat(st);
    if (finalKind === 'file' && !classified.isRegularFile) {
      closeFd(finalResult.fd);
      return { ok: false, code: 'unsupported-type' };
    }
    if (finalKind === 'directory' && !classified.isDirectory) {
      closeFd(finalResult.fd);
      return { ok: false, code: 'unsupported-type' };
    }
    return { ok: true, target: makeTarget(finalResult.fd, true, relative, classified) };
  } catch {
    // Unreachable in the integrated flow (adapter returns typed results;
    // loader failure maps to 'error'); defensive: close intermediates and
    // fail closed.
    closeOpened(opened);
    return { ok: false, code: 'error' };
  }
}

// ---------------------------------------------------------------------------
// Open for read (text or bytes): descriptor-relative descent, final file
// open via the seam's fixed O_RDONLY|O_NOFOLLOW|O_NONBLOCK, then fstat.
// Only regular files pass.
// ---------------------------------------------------------------------------

export async function openForRead(
  root: BoundWorkspaceRoot,
  relative: string,
  resolvedRelative: string,
): Promise<
  | { ok: true; target: OpenedTarget }
  | { ok: false; code: 'not-found' | 'permission-denied' | 'unsupported-type' | 'error' }
> {
  // MAC-2D: descriptor-relative descent (containment-RESOLVED relative)
  // + final open through the native seam (fixed
  // O_RDONLY|O_NOFOLLOW|O_NONBLOCK); fstat gates below.
  const result = descentAndOpen(root, relative, resolvedRelative, 'file');
  if (!result.ok) return result;
  return { ok: true, target: result.target };
}

// ---------------------------------------------------------------------------
// Open for list-directory: descriptor-relative descent + O_DIRECTORY final.
// ---------------------------------------------------------------------------

export async function openForListDirectory(
  root: BoundWorkspaceRoot,
  relative: string,
  resolvedRelative: string,
): Promise<
  | { ok: true; target: OpenedTarget }
  | { ok: false; code: 'not-found' | 'permission-denied' | 'unsupported-type' | 'error' }
> {
  const result = descentAndOpen(root, relative, resolvedRelative, 'directory');
  if (!result.ok) return result;
  return { ok: true, target: result.target };
}

// ---------------------------------------------------------------------------
// Logical-entry inspection (lstat — does not follow final symlink)
// ---------------------------------------------------------------------------

export function inspectLogicalEntry(
  root: BoundWorkspaceRoot,
  relative: string,
): { ok: true; metadata: InspectMetadataResult } | { ok: false; code: 'not-found' | 'permission-denied' | 'error' } {
  const fpath = fsPath(root, relative);
  let lst: ReturnType<typeof lstatSync>;
  try {
    lst = lstatSync(fpath);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return { ok: false, code: 'not-found' };
    if (e.code === 'EACCES' || e.code === 'EPERM') return { ok: false, code: 'permission-denied' };
    return { ok: false, code: 'error' };
  }
  const classified = classifyStat(lst);
  return {
    ok: true,
    metadata: {
      kind: classified.kind,
      sizeBytes: classified.isRegularFile ? classified.sizeBytes : undefined,
      isRegularFile: classified.isRegularFile,
      isDirectory: classified.isDirectory,
      isSymbolicLink: classified.isSymbolicLink,
      isSpecial: classified.isSpecial,
    },
  };
}

// ---------------------------------------------------------------------------
// Read entries from an opened directory target (list-directory)
// MAC-2D: descriptor-bound enumeration through the native seam
// (readDirectoryEntries on the target's raw fd); deterministic UTF-8
// byte-order sorting and maxEntries truncation stay in JS below.
// ---------------------------------------------------------------------------

export function listDirectoryEntries(
  target: OpenedTarget,
  maxEntries: number,
): { entries: DirectoryEntry[]; truncated: boolean } {
  // MAC-2D: descriptor-bound enumeration through the native seam
  // (readDirectoryEntries on the target's raw fd). The native layer
  // returns bounded raw entries + its own hard-cap truncated flag;
  // deterministic UTF-8 byte-order sorting and maxEntries truncation are
  // the reader's JS responsibilities (unchanged). A native enumeration
  // failure is unreachable in the integrated flow (the target was just
  // opened as a verified directory) and throws through the inherited
  // shape (opendirSync previously threw here too).
  const raw = readDirectoryEntriesReader(target.fd);
  if (!raw.ok) {
    throw new Error('directory enumeration failed');
  }
  const sorted = raw.entries.slice().sort((a, b) => {
    const bufA = Buffer.from(a.name, 'utf8');
    const bufB = Buffer.from(b.name, 'utf8');
    const len = Math.min(bufA.length, bufB.length);
    for (let i = 0; i < len; i++) {
      const diff = (bufA[i] ?? 0) - (bufB[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return bufA.length - bufB.length;
  });
  // Truthful truncation from BOTH sources: native hard-cap truncation
  // (unseen entries exist beyond 10_000) OR more entries than the
  // requested maxEntries. The reader never reports truncated:false when
  // unseen entries exist (native cap 10_000 >= maxEntries always).
  const truncated = raw.truncated || sorted.length > maxEntries;
  return { entries: sorted.slice(0, maxEntries), truncated };
}

// ---------------------------------------------------------------------------
// Descriptor identity binding (S-07)
//
// Proves the opened descriptor is the same object accepted by point-of-use
// containment: fstat the opened descriptor and compare device + inode against
// a trusted internal stat of the containment-resolved absolute target taken
// immediately around descriptor acquisition.
// ---------------------------------------------------------------------------

export interface ObjectIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

export function statIdentity(st: ReturnType<typeof fstatSync>): ObjectIdentity {
  return {
    dev: Number(st.dev),
    ino: Number(st.ino),
    isDirectory: st.isDirectory(),
    isFile: st.isFile(),
    isSymbolicLink: st.isSymbolicLink(),
  };
}

/**
 * Obtain trusted internal identity evidence for the containment-accepted
 * resolved absolute target. This is a trusted-process-internal stat of the
 * resolved target, taken immediately around descriptor acquisition; it never
 * uses the hostile original request path.
 */
export function statResolvedTarget(resolvedAbsolutePath: string): ObjectIdentity | null {
  try {
    return statIdentity(statSync(resolvedAbsolutePath));
  } catch {
    return null;
  }
}

/**
 * Verify the opened descriptor identity against the accepted resolved-target
 * identity. Fails closed on any mismatch (device, inode, or object type).
 */
export function verifyDescriptorIdentity(
  opened: ObjectIdentity,
  accepted: ObjectIdentity,
): boolean {
  return (
    opened.dev === accepted.dev &&
    opened.ino === accepted.ino &&
    opened.isDirectory === accepted.isDirectory &&
    opened.isFile === accepted.isFile &&
    opened.isSymbolicLink === accepted.isSymbolicLink
  );
}

// ---------------------------------------------------------------------------
// Read bytes from an opened regular file
// ---------------------------------------------------------------------------

export async function readFileBytes(
  target: OpenedTarget,
  maxBytes: number,
): Promise<{ bytes: Buffer; truncated: boolean }> {
  // MAC-2D: raw-fd read (readSync) — identical semantics to the inherited
  // FileHandle.read: one bounded read at offset 0, short-read aware,
  // truncation computed from the classified size.
  const buf = Buffer.alloc(maxBytes);
  const bytesRead = readSync(target.fd, buf, 0, maxBytes, 0);
  return {
    bytes: buf.subarray(0, bytesRead),
    truncated: bytesRead < target.sizeBytes && bytesRead === maxBytes,
  };
}
