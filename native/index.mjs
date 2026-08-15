/**
 * gateway-fs loader (MAC-1) — fail-closed native addon selection.
 *
 * Distribution model (MAC-0 contract §6): prebuilt binaries only.
 * The loader selects exactly one binary by platform + architecture:
 *
 *   native/darwin-x64/gateway_fs.node
 *   native/darwin-arm64/gateway_fs.node
 *
 * Fail-closed behavior (this module is the packaging seam; it is NOT
 * wired into Gateway production composition yet — that is MAC-2):
 *
 *   - unsupported platform/arch  -> NativeAddonError('unsupported-platform')
 *   - missing binary             -> NativeAddonError('missing-addon')
 *   - invalid or wrong-arch bin  -> NativeAddonError('invalid-addon')
 *
 * There is NO fallback: no pure-Node path, no /proc, no /dev/fd, no
 * arch mismatch tolerance. A failed load is an explicit typed failure.
 *
 * The `options` overrides (platform/arch/baseDir/path) are test seams
 * for loader behavior; production callers use the defaults.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export const ADDON_BASE = 'native';
export const ADDON_FILE = 'gateway_fs.node';

/** The closed set of supported prebuilt lanes. */
export const SUPPORTED_ADDON_LANES = Object.freeze(['darwin-x64', 'darwin-arm64']);

export class NativeAddonError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'NativeAddonError';
    this.code = code; // 'unsupported-platform' | 'missing-addon' | 'invalid-addon'
    if (cause !== undefined) this.cause = cause;
  }
}

/** Exact addon path for a platform/arch lane, or null when unsupported. */
export function resolveAddonPath(platform, arch, baseDir) {
  const lane = `${platform}-${arch}`;
  if (!SUPPORTED_ADDON_LANES.includes(lane)) return null;
  return join(baseDir, ADDON_BASE, lane, ADDON_FILE);
}

/**
 * Load the native addon for the current (or overridden) host lane.
 * Throws NativeAddonError on any failure; never falls back.
 */
export function loadGatewayFs(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const baseDir = options.baseDir ?? join(dirname(fileURLToPath(import.meta.url)), '..'); // repo root; addon lives at <root>/native/<lane>/
  const addonPath = options.path ?? resolveAddonPath(platform, arch, baseDir);

  if (addonPath === null) {
    throw new NativeAddonError(
      'unsupported-platform',
      `gateway-fs: unsupported host lane ${platform}-${arch}; supported: ${SUPPORTED_ADDON_LANES.join(', ')}`,
    );
  }
  if (!existsSync(addonPath)) {
    throw new NativeAddonError('missing-addon', `gateway-fs: native addon not found at ${addonPath}`);
  }
  const require = createRequire(import.meta.url);
  try {
    return require(addonPath);
  } catch (err) {
    throw new NativeAddonError(
      'invalid-addon',
      `gateway-fs: native addon failed to load from ${addonPath} (invalid or wrong-architecture binary)`,
      err,
    );
  }
}
