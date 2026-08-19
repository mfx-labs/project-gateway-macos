/**
 * S2 — `pgw remove <path-or-id>`.
 *
 * Deregistration only: removes exactly one registry entry (by exact id or by
 * canonicalized path). Never deletes the Gateway store, git-home/git-tmp, or
 * project contents; never writes tombstones/revocation/migration records.
 */
import { realpathSync } from 'node:fs';
import { loadRegistry, saveRegistry } from './registry.js';
import { defaultRegistryPath } from './paths.js';

export interface RemoveInput {
  readonly selector: string;
  readonly registryPath?: string;
}

export type RemoveResult =
  | { readonly ok: true; readonly removedId: string }
  | { readonly ok: false; readonly message: string };

export function removeProject(input: RemoveInput): RemoveResult {
  const registryPath = input.registryPath ?? defaultRegistryPath();
  const loaded = loadRegistry(registryPath);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  let index = loaded.registry.projects.findIndex((p) => p.id === input.selector);
  if (index === -1) {
    let canonical: string | null = null;
    try {
      canonical = realpathSync(input.selector);
    } catch {
      canonical = null;
    }
    if (canonical !== null) {
      index = loaded.registry.projects.findIndex((p) => p.path === canonical);
    }
  }
  // S2-REV-002: deregister a stale entry by its recorded canonical path even
  // when the directory no longer exists (realpathSync fails). Exact-string
  // match only against the already-recorded canonical path — no normalization
  // or recreation of arbitrary nonexistent paths.
  if (index === -1) {
    index = loaded.registry.projects.findIndex((p) => p.path === input.selector);
  }
  if (index === -1) return { ok: false, message: `project not found: ${input.selector}` };

  const removedId = loaded.registry.projects[index]!.id;
  const saved = saveRegistry({ projects: loaded.registry.projects.filter((_, i) => i !== index) }, registryPath);
  if (!saved.ok) return { ok: false, message: saved.message };
  return { ok: true, removedId };
}
