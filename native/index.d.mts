/**
 * Type declarations for the gateway-fs native loader (MAC-1 seam).
 *
 * The JS-visible addon surface is the closed five-primitive set; the
 * loader is the fail-closed packaging seam. Declaration-only file: the
 * implementation is native/index.mjs + the MAC-1 C addon.
 */
export type NativeFsErrorCode =
  | 'not-found'
  | 'exists'
  | 'not-directory'
  | 'symlink-refused'
  | 'permission-denied'
  | 'read-only'
  | 'no-space'
  | 'quota'
  | 'unsupported'
  | 'invalid-fd'
  | 'invalid-input'
  | 'io-failure';

export type NativeOpenResult =
  | { readonly ok: true; readonly fd: number }
  | { readonly ok: false; readonly code: NativeFsErrorCode };

export type NativeUnlinkResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: NativeFsErrorCode };

export type NativePathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: NativeFsErrorCode };

/** The closed five-function native seam (MAC-1). */
export interface GatewayFsAddon {
  readonly openDirectoryAt: (parentFd: number, component: string) => NativeOpenResult;
  readonly createExclusiveFileAt: (parentFd: number, component: string) => NativeOpenResult;
  readonly openExistingFileAt: (parentFd: number, component: string) => NativeOpenResult;
  readonly unlinkAt: (parentFd: number, component: string) => NativeUnlinkResult;
  readonly getPath: (fd: number) => NativePathResult;
}

export type NativeAddonErrorCode = 'unsupported-platform' | 'missing-addon' | 'invalid-addon';

export class NativeAddonError extends Error {
  readonly code: NativeAddonErrorCode;
  readonly cause?: unknown;
}

export const ADDON_BASE: string;
export const ADDON_FILE: string;
export const SUPPORTED_ADDON_LANES: readonly string[];

export function resolveAddonPath(platform: string, arch: string, baseDir: string): string | null;

export function loadGatewayFs(options?: {
  readonly platform?: string;
  readonly arch?: string;
  readonly baseDir?: string;
  readonly path?: string;
}): GatewayFsAddon;
