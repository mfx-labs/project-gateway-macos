/**
 * macOS — `pgw up`.
 *
 * High-level operator command: starts the configured macOS Project Gateway
 * connectivity stack in the foreground:
 *
 *   interactive Terminal
 *     -> `pgw up` preflight
 *     -> Runtime API Key loaded from macOS Keychain (never printed)
 *     -> foreground `tunnel-client run --profile project-gateway`
 *          -> tunnel-client invokes `pgw start` (stdio MCP child)
 *
 * `pgw up` never installs, provisions, or configures anything. If setup is
 * incomplete it fails with actionable guidance and exits non-zero. It never
 * calls `pgw start` itself, so there is no recursion between `up` and `start`.
 *
 * This module is part of the installed operator runtime and is fully
 * self-contained: it derives its constants from the canonical operator
 * state/install locations and does not depend on any repository checkout or
 * shell script.
 *
 * TRUST MODEL: production resolves tunnel-client, the `/usr/bin/security`
 * executable, and the profile path from trusted canonical locations and from
 * the real process terminal state — never from arbitrary environment
 * variables. Testability is provided by explicit dependency injection
 * (UpDependencies); the production CLI router always calls `runUp()` with
 * trusted defaults. The only environment influence production honors is the
 * standard per-user configuration variable XDG_CONFIG_HOME (and HOME), which
 * the tunnel-client profile resolution contract already uses.
 */
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { diagnostic } from './diagnostic.js';

export const UP_PROFILE_NAME = 'project-gateway';
export const UP_KEYCHAIN_SERVICE = 'com.mfx-labs.project-gateway.tunnel';
export const UP_KEYCHAIN_ACCOUNT = 'tunnel-runtime-key';
export const UP_TUNNEL_CLIENT_REL = join('.local', 'bin', 'tunnel-client');

const SETUP_GUIDANCE = 'run once: pgw tunnel';

/** Outcome of launching the credential-bearing tunnel-client child. */
export interface UpSpawnResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

/** Injectable dependencies for `pgw up` (production defaults are env-independent). */
export interface UpDependencies {
  readonly platform: NodeJS.Platform;
  readonly isTTY: boolean;
  readonly homeDir: string;
  readonly tunnelClientPath: string;
  readonly securityPath: string;
  readonly profilePath: string;
  /** Read the runtime credential from Keychain via `securityPath`; returns null on failure. */
  readonly readKeychain: (securityPath: string) => string | null;
  /** Launch the tunnel-client child with the given environment (credential-bearing). */
  readonly spawn: (cmd: string, args: readonly string[], env: NodeJS.ProcessEnv) => UpSpawnResult;
}

function incomplete(detail: string): number {
  diagnostic(`up: ${detail}. Project Gateway tunnel setup is incomplete; ${SETUP_GUIDANCE}`);
  return 1;
}

/** Read the runtime credential from Keychain without printing it. */
function productionReadKeychain(securityPath: string): string | null {
  const res = spawnSync(securityPath, ['find-generic-password', '-s', UP_KEYCHAIN_SERVICE, '-a', UP_KEYCHAIN_ACCOUNT, '-w'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (res.error || res.status !== 0) return null;
  const stdout = res.stdout?.toString('utf8') ?? '';
  return stdout.replace(/\r?\n$/, '');
}

/** Production launch: foreground spawn attached to the terminal. */
function productionSpawn(cmd: string, args: readonly string[], env: NodeJS.ProcessEnv): UpSpawnResult {
  return spawnSync(cmd, args as readonly string[], { env, stdio: 'inherit' });
}

/**
 * Production defaults. tunnel-client and the profile resolve from canonical
 * per-user locations; `security` is the trusted macOS system executable; TTY
 * is read from the real process terminal. No PGW_* environment variable is
 * consulted. The only environment influence is the standard XDG_CONFIG_HOME
 * (falling back to HOME/.config) used by the tunnel-client profile contract.
 */
export function productionUpDeps(): UpDependencies {
  const homeDir = homedir();
  const profileDir = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'tunnel-client')
    : join(homeDir, '.config', 'tunnel-client');
  return {
    platform: process.platform,
    isTTY: Boolean(process.stdin.isTTY),
    homeDir,
    tunnelClientPath: join(homeDir, UP_TUNNEL_CLIENT_REL),
    securityPath: '/usr/bin/security',
    profilePath: join(profileDir, `${UP_PROFILE_NAME}.yaml`),
    readKeychain: productionReadKeychain,
    spawn: productionSpawn,
  };
}

export async function runUp(deps: UpDependencies = productionUpDeps()): Promise<number> {
  // macOS-only for now; fail explicitly rather than applying Keychain
  // assumptions on an unsupported platform.
  if (deps.platform !== 'darwin') {
    diagnostic(`up: macOS is required for the foreground tunnel workflow (found ${deps.platform})`);
    return 2;
  }
  if (!deps.isTTY) {
    diagnostic('up: requires an interactive Terminal session (stdin is not a TTY)');
    return 2;
  }

  if (!existsSync(deps.tunnelClientPath)) return incomplete(`tunnel-client not installed at ${deps.tunnelClientPath}`);
  if (!existsSync(deps.profilePath)) return incomplete(`tunnel profile ${UP_PROFILE_NAME} missing at ${deps.profilePath}`);

  const key = deps.readKeychain(deps.securityPath);
  if (key === null) return incomplete('runtime credential missing from macOS Keychain');
  if (key.length === 0) return incomplete('runtime credential in macOS Keychain is empty');

  // Expose the credential only to the launched runtime environment.
  const env: NodeJS.ProcessEnv = { ...process.env, CONTROL_PLANE_API_KEY: key };

  const res = deps.spawn(deps.tunnelClientPath, ['run', '--profile', UP_PROFILE_NAME], env);
  if (res.error) {
    diagnostic(`up: failed to launch tunnel-client: ${res.error.message}`);
    return 1;
  }
  if (res.signal) return 1;
  return res.status ?? 1;
}
