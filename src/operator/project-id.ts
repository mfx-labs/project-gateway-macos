/**
 * S2 — deterministic project identity.
 *
 * `pgw:w:` + sha256(canonicalPath).slice(0, 32), reusing the existing
 * workspace-id grammar from the trusted core. No new identity type or mapping
 * database exists.
 */
import { createHash } from 'node:crypto';
import { WORKSPACE_ID_PREFIX } from '../trusted/workspace-id.js';

export function projectIdFromPath(canonicalPath: string): string {
  const opaque = createHash('sha256').update(canonicalPath).digest('hex').slice(0, 32);
  return `${WORKSPACE_ID_PREFIX}${opaque}`;
}
