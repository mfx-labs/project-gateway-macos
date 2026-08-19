/**
 * S2 — minimal version reporting.
 *
 * No generated build metadata, no commit descriptor, no release identity.
 * Only: package version (from package.json) + runtime platform/architecture.
 */
import { readFileSync } from 'node:fs';

export interface VersionInfo {
  readonly name: 'pgw';
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
}

export function versionInfo(): VersionInfo {
  let version = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { readonly version?: string };
    version = pkg.version ?? '0.0.0';
  } catch {
    // package.json unavailable: keep the fallback version.
  }
  return { name: 'pgw', version, platform: process.platform, arch: process.arch };
}

export function formatVersion(info: VersionInfo): string {
  return `${info.name} ${info.version} (${info.platform} ${info.arch})`;
}
