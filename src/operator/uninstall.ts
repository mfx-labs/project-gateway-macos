/**
 * S4 — `pgw uninstall`.
 *
 * Removes the installed application/runtime only (install root + operator CLI
 * link) and preserves all user/project state by default: the registry
 * (`~/.config/project-gateway-macos/registry.json`), the Gateway state root
 * (`~/.local/state/project-gateway-macos/`), every registered project root,
 * and every Gateway store. No tombstones, receipts, revocation records,
 * deregistration, or migration.
 *
 * Ownership rule (S4-REV-002): the operator link is removed only when it is
 * the Gateway-owned canonical symlink (resolving exactly to
 * `~/.local/share/project-gateway-macos/current/bin/pgw`). An absent path is
 * a no-op; a regular file, directory, non-symlink object, or a symlink to any
 * unrelated target is preserved, and the result reports that it was kept.
 *
 * Idempotent: a second uninstall creates no new state. Self-uninstall is safe
 * because the running process has already loaded its modules; all paths are
 * resolved up front, removals are performed, a bounded result is printed, and
 * the process exits.
 */
import { lstatSync, readlinkSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { defaultBinLink, defaultInstallRoot } from './paths.js';

export interface UninstallInput {
  /** Install root override (tests only). Defaults to the fixed per-user root. */
  readonly installRoot?: string;
  /** Operator CLI link override (tests only). Defaults to `~/.local/bin/pgw`. */
  readonly binLink?: string;
}

export type UninstallResult =
  | { readonly ok: true; readonly preservedBinLink?: boolean }
  | { readonly ok: false; readonly message: string };

/** Ownership decision for the bin link: 'absent' | 'gateway' | 'unrelated'. */
function inspectBinLink(linkPath: string, canonicalTarget: string): 'absent' | 'gateway' | 'unrelated' {
  let lst;
  try {
    lst = lstatSync(linkPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    // unreadable for any other reason: never delete — preserve it.
    return 'unrelated';
  }
  if (!lst.isSymbolicLink()) return 'unrelated';
  const raw = readlinkSync(linkPath);
  const resolvedTarget = isAbsolute(raw) ? normalize(raw) : resolve(dirname(linkPath), raw);
  return resolvedTarget === normalize(canonicalTarget) ? 'gateway' : 'unrelated';
}

export function uninstall(input: UninstallInput = {}): UninstallResult {
  const installRoot = input.installRoot ?? defaultInstallRoot();
  const binLink = input.binLink ?? defaultBinLink();
  const canonicalTarget = join(installRoot, 'current', 'bin', 'pgw');

  let preservedBinLink = false;
  switch (inspectBinLink(binLink, canonicalTarget)) {
    case 'gateway': {
      try {
        unlinkSync(binLink);
      } catch (err) {
        return { ok: false, message: `could not remove operator link (${(err as NodeJS.ErrnoException).code ?? 'unknown'})` };
      }
      break;
    }
    case 'unrelated':
      preservedBinLink = true; // preserve; never delete an unrelated object
      break;
    case 'absent':
      break;
  }

  try {
    rmSync(installRoot, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, message: `could not remove install root (${(err as NodeJS.ErrnoException).code ?? 'unknown'})` };
  }
  return preservedBinLink ? { ok: true, preservedBinLink: true } : { ok: true };
}
