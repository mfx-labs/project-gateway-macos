/**
 * S2 — fixed operator path roots.
 *
 * One fixed per-user layout: registry under ~/.config, state under ~/.local.
 * No environment-variable or other path override exists.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Operator home base: the process user's home directory only. */
export function operatorHome(): string {
  return homedir();
}

/** Registry path: `~/.config/project-gateway-macos/registry.json`. */
export function defaultRegistryPath(): string {
  return join(operatorHome(), '.config', 'project-gateway-macos', 'registry.json');
}

/** Per-project state base: `~/.local/state/project-gateway-macos/`. */
export function defaultStateBase(): string {
  return join(operatorHome(), '.local', 'state', 'project-gateway-macos');
}
