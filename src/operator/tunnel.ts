/**
 * macOS — `pgw tunnel`.
 *
 * High-level operator command: run the one-time macOS tunnel setup workflow.
 *
 *   pgw tunnel
 *     -> packaged scripts/setup-tunnel-client-macos.sh
 *          -> packaged scripts/tunnel-client-common.sh
 *
 * The setup helper installs/reuses the pinned tunnel-client, configures/reuses
 * the `project-gateway` profile, obtains/validates the tunnel ID, stores/reuses
 * the Runtime API Key in the macOS Keychain, and verifies the resulting state.
 * It never starts the Gateway runtime.
 *
 * This is part of the installed operator runtime. The setup helper and its
 * common helper are packaged into the distributable, and are resolved relative
 * to the installed package that owns this module — NOT from the original
 * checkout, NOT from the current working directory, NOT from any hard-coded
 * developer path, and NOT from any environment variable.
 *
 * Testability is provided by explicit dependency injection (TunnelDependencies),
 * not by environment overrides: the production CLI router always calls
 * `runTunnel()` with trusted defaults derived from the installed module
 * location. Tests may import this deep module and call `runTunnel(deps)` with a
 * temporary package root / fake spawn. No production surface reads an
 * environment variable to select a helper root.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { diagnostic } from './diagnostic.js';

export const TUNNEL_SETUP_REL = join('scripts', 'setup-tunnel-client-macos.sh');
export const TUNNEL_COMMON_REL = join('scripts', 'tunnel-client-common.sh');

/** Outcome of launching the setup helper. */
export interface TunnelSpawnResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

/** Injectable dependencies for `pgw tunnel` (production defaults are env-independent). */
export interface TunnelDependencies {
  readonly packageRoot: string;
  readonly spawnSetup: (setupBin: string) => TunnelSpawnResult;
}

/** Package root that owns this installed CLI (dist/operator -> root). Never env-derived. */
function productionPackageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** Production launch: `bash <setup helper>` attached to the terminal. */
function productionSpawnSetup(setupBin: string): TunnelSpawnResult {
  return spawnSync('bash', [setupBin], { stdio: 'inherit' });
}

/** Production defaults — fixed, env-independent. */
export function productionTunnelDeps(): TunnelDependencies {
  return {
    packageRoot: productionPackageRoot(),
    spawnSetup: productionSpawnSetup,
  };
}

export async function runTunnel(deps: TunnelDependencies = productionTunnelDeps()): Promise<number> {
  const setupBin = join(deps.packageRoot, TUNNEL_SETUP_REL);
  const commonBin = join(deps.packageRoot, TUNNEL_COMMON_REL);

  if (!existsSync(setupBin) || !existsSync(commonBin)) {
    diagnostic(`tunnel: packaged setup helper missing under ${deps.packageRoot} (expected ${TUNNEL_SETUP_REL} and ${TUNNEL_COMMON_REL})`);
    return 1;
  }

  const res = deps.spawnSetup(setupBin);
  if (res.error) {
    diagnostic(`tunnel: failed to launch setup helper: ${res.error.message}`);
    return 1;
  }
  if (res.signal) return 1;
  return res.status ?? 1;
}
