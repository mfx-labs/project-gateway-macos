/**
 * S2 — `pgw list`.
 *
 * Reads the registry and returns the registered projects. No status probes,
 * no store verification, no Git inspection, no doctor behavior.
 */
import { loadRegistry, type RegistryProject } from './registry.js';
import { defaultRegistryPath } from './paths.js';

export type ListResult =
  | { readonly ok: true; readonly projects: readonly RegistryProject[] }
  | { readonly ok: false; readonly message: string };

export function listProjects(registryPath: string = defaultRegistryPath()): ListResult {
  const loaded = loadRegistry(registryPath);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  return { ok: true, projects: loaded.registry.projects };
}
