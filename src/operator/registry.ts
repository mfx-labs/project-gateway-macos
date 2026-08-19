/**
 * S2 — persistent operator project registry.
 *
 * One source of truth: `~/.config/project-gateway-macos/registry.json` with
 * shape `{ "projects": [{ "id", "path" }] }`. This is locally generated
 * application configuration, not hostile artifact input: ordinary JSON
 * parsing plus minimal structural validation only (the repository's
 * duplicate-key hostile JSON scanner is deliberately NOT used here).
 * Persistence is atomic (temp file + rename) so a partial write is never left
 * behind.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isValidWorkspaceId } from '../trusted/workspace-id.js';
import { defaultRegistryPath } from './paths.js';

export interface RegistryProject {
  readonly id: string;
  readonly path: string;
}

export interface Registry {
  readonly projects: readonly RegistryProject[];
}

export type LoadResult =
  | { readonly ok: true; readonly registry: Registry }
  | { readonly ok: false; readonly message: string };

export type SaveResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

const EMPTY: Registry = { projects: [] };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateProject(raw: unknown, index: number): { readonly ok: true; readonly project: RegistryProject } | { readonly ok: false; readonly message: string } {
  if (!isRecord(raw)) return { ok: false, message: `projects[${index}] must be an object` };
  const id = raw['id'];
  if (typeof id !== 'string' || !isValidWorkspaceId(id)) {
    return { ok: false, message: `projects[${index}].id must be a valid workspace identifier` };
  }
  const path = raw['path'];
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return { ok: false, message: `projects[${index}].path must be an absolute path` };
  }
  return { ok: true, project: { id, path } };
}

export function loadRegistry(path: string = defaultRegistryPath()): LoadResult {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, registry: EMPTY };
    return { ok: false, message: `registry could not be read (${(err as NodeJS.ErrnoException).code ?? 'unknown'})` };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'registry is not valid JSON' };
  }
  if (!isRecord(doc)) return { ok: false, message: 'registry must be a JSON object' };
  const projects = doc['projects'];
  if (!Array.isArray(projects)) return { ok: false, message: 'registry.projects must be an array' };
  const parsed: RegistryProject[] = [];
  for (let i = 0; i < projects.length; i++) {
    const validated = validateProject(projects[i], i);
    if (!validated.ok) return { ok: false, message: validated.message };
    parsed.push(validated.project);
  }
  return { ok: true, registry: { projects: parsed } };
}

export function saveRegistry(registry: Registry, path: string = defaultRegistryPath()): SaveResult {
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify({ projects: registry.projects }, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
    return { ok: true };
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup of the temp file
    }
    return { ok: false, message: `registry could not be written (${(err as NodeJS.ErrnoException).code ?? 'unknown'})` };
  }
}
