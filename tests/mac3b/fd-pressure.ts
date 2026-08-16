/**
 * MAC-3B — isolated fd-pressure harness (TEST-ONLY helper).
 *
 * Parent-side coordinator for `fd-pressure.mjs`. Consumed by MAC-3E for
 * RACE-I14 evidence. NOT part of production; never imported by src/**.
 *
 * Isolation contract (MAC-3B §7):
 *   - the pressure child is a SEPARATE process; descriptor pressure is
 *     confined to the child (the parent's fd table is untouched);
 *   - the child opens a parent-provided pad file until EMFILE (bounded by
 *     its own finite fd limit and a hard cap), probes under pressure,
 *     releases every descriptor, then proves post-release usability with
 *     a sanity marker write;
 *   - bounded timeout + deterministic cleanup (SIGKILL + reap) via the
 *     shared bounded-child plumbing in `child-actor.ts`;
 *   - no shell, no production fallback, no machine-wide exhaustion.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve the child script from the compiled helper location:
 *  <root>/dist-test/tests/mac3b/*.js -> <root>/tests/mac3b/*.mjs (3 ups). */
const PRESSURE_SCRIPT = fileURLToPath(new URL('../../../tests/mac3b/fd-pressure.mjs', import.meta.url));

export const PRESSURE_TIMEOUT_DEFAULT_MS = 15_000;

export interface FdPressureSpec {
  /** Parent-created marker directory (also holds pad.bin + sanity.marker). */
  readonly markerDir: string;
  /** Lifecycle bound only — NEVER synchronization evidence. */
  readonly timeoutMs?: number;
}

export interface FdPressureResult {
  readonly ok: boolean;
  readonly preopened: number;
  readonly emfile: boolean;
  readonly probe: 'ok' | 'emfile' | 'error';
  readonly sanity: 'ok' | 'error';
  readonly error: string | null;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
}

/** Create the marker directory and its pad file (idempotent, parent-side). */
export function preparePressureFixture(root: string): string {
  const markerDir = join(root, 'pressure');
  mkdirSync(markerDir, { recursive: true });
  const pad = join(markerDir, 'pad.bin');
  if (!existsSync(pad)) writeFileSync(pad, 'pad');
  return markerDir;
}

/**
 * Run one isolated pressure cycle: EMFILE induction → probe → release →
 * post-release sanity. Always reaps the child; resolves with the parsed
 * RESULT line or a typed failure.
 */
export async function runFdPressure(spec: FdPressureSpec): Promise<FdPressureResult> {
  const timeoutMs = spec.timeoutMs ?? PRESSURE_TIMEOUT_DEFAULT_MS;
  const child = spawn(process.execPath, [PRESSURE_SCRIPT, spec.markerDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let timedOut = false;
  const exited = new Promise<FdPressureResult>((resolvePromise) => {
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, timeoutMs);
    timer.unref();
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 8192) {
        child.kill('SIGKILL');
        stdout = stdout.slice(0, 8192) + '\nERROR output-budget-exceeded\n';
      }
    });
    child.stderr!.resume();
    child.on('close', () => {
      clearTimeout(timer);
      const lines = stdout.split('\n').filter((l) => l.length > 0);
      const result = lines[lines.length - 1] ?? '';
      const m = /^RESULT preopened=(\d+) emfile=(true|false) probe=(ok|emfile|error) sanity=(ok|error)$/.exec(result);
      const error = /^ERROR (.+)$/.exec(result);
      if (timedOut) {
        resolvePromise({
          ok: false, preopened: 0, emfile: false, probe: 'error', sanity: 'error',
          error: 'timeout', exitCode: null, signal: 'SIGKILL', timedOut: true,
        });
      } else if (m) {
        resolvePromise({
          ok: m[4] === 'ok' && m[2] === 'true',
          preopened: Number(m[1]),
          emfile: m[2] === 'true',
          probe: m[3] as FdPressureResult['probe'],
          sanity: m[4] as 'ok' | 'error',
          error: null,
          exitCode: child.exitCode,
          signal: child.signalCode,
          timedOut: false,
        });
      } else if (error) {
        resolvePromise({
          ok: false, preopened: 0, emfile: false, probe: 'error', sanity: 'error',
          error: error[1] ?? null, exitCode: child.exitCode, signal: child.signalCode, timedOut: false,
        });
      } else {
        resolvePromise({
          ok: false, preopened: 0, emfile: false, probe: 'error', sanity: 'error',
          error: `unexpected-exit:${String(child.exitCode)}`, exitCode: child.exitCode,
          signal: child.signalCode, timedOut: false,
        });
      }
    });
  });
  return exited;
}
