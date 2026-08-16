/**
 * MAC-3B — bounded child-process pathname-churn actor (TEST-ONLY helper).
 *
 * Parent-side coordinator for `child-actor.mjs`. Consumed by MAC-3C/E
 * hostile-race suites; NOT part of production, never imported by src/**.
 *
 * Contract (MAC-3B §5):
 *   - the child is a SEPARATE Node process running a FIXED built-in
 *     mutation script against a parent-supplied, parent-created,
 *     realpath-canonical fixture root;
 *   - bounded: the budget is a positive safe integer (1..100000); the
 *     child terminates after exactly `budget` iterations;
 *   - explicit startup/ready protocol (`READY <pid>` line) and explicit
 *     completion protocol (`DONE <n>` / `ERROR <msg>` line + exit code);
 *   - bounded timeout: the parent SIGKILLs the child on expiry and always
 *     awaits/reaps it (no orphan possible, including when the consumer
 *     throws — use `withChildActor`);
 *   - no shell command construction anywhere; the child receives data
 *     only (root, budget, script name, optional bounded delay);
 *   - the child is lexically confined to the fixture root by its own
 *     guard (`escape-attempt` self-test proves it);
 *   - no global HOME/workspace mutation: the child never touches
 *     anything outside the fixture root.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Resolve the child script from the compiled helper location:
 *  <root>/dist-test/tests/mac3b/*.js -> <root>/tests/mac3b/*.mjs (3 ups). */
const ACTOR_SCRIPT = fileURLToPath(new URL('../../../tests/mac3b/child-actor.mjs', import.meta.url));

export const ACTOR_BUDGET_MAX = 100_000;
export const ACTOR_TIMEOUT_DEFAULT_MS = 10_000;

export type ActorScript =
  | 'dir-rename-cycle'
  | 'symlink-cycle'
  | 'file-decoy-cycle'
  | 'mixed-churn'
  | 'escape-attempt'
  | 'pause';

export interface ChildActorSpec {
  /** Parent-created, realpath-canonical fixture root. */
  readonly fixtureRoot: string;
  readonly script: ActorScript;
  /** Positive safe integer; the child performs exactly this many iterations. */
  readonly budget: number;
  /** `pause` script only; bounded 0..2000 ms. */
  readonly pauseDelayMs?: number;
  /** Lifecycle bound only — NEVER synchronization evidence. */
  readonly timeoutMs?: number;
}

export interface ChildActorOutcome {
  readonly ok: boolean;
  readonly iterations: number;
  readonly error: string | null;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
}

export interface RunningChildActor {
  readonly pid: number;
  /** Resolves once the child prints `READY <pid>`; rejects on ERROR/exit. */
  readonly ready: Promise<void>;
  /** Resolves when the child has been reaped (exit or kill+exit). */
  readonly wait: () => Promise<ChildActorOutcome>;
  /** SIGKILL the child (idempotent). */
  readonly kill: () => void;
}

const OUTPUT_BUDGET_CHARS = 8192;

/**
 * Spawn a bounded test-only child with the line protocol above. Always
 * kills on timeout and always reaps; the returned handle lets consumers
 * orchestrate (start → await ready → mutate → await completion).
 */
export function startChildActor(spec: ChildActorSpec): RunningChildActor {
  const timeoutMs = spec.timeoutMs ?? ACTOR_TIMEOUT_DEFAULT_MS;
  if (!Number.isSafeInteger(spec.budget) || spec.budget < 1 || spec.budget > ACTOR_BUDGET_MAX) {
    throw new Error(`child-actor: budget must be a positive safe integer <= ${ACTOR_BUDGET_MAX}`);
  }
  const args = [ACTOR_SCRIPT, spec.fixtureRoot, String(spec.budget), spec.script];
  if (spec.pauseDelayMs !== undefined) args.push(String(spec.pauseDelayMs));

  const child: ChildProcess = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let reaped = false;
  let readyResolve: () => void;
  let readyReject: (err: Error) => void;
  const ready = new Promise<void>((resolvePromise, rejectPromise) => {
    readyResolve = resolvePromise;
    readyReject = rejectPromise;
  });
  let settleExit: (outcome: ChildActorOutcome) => void;
  let failExit: (err: Error) => void;
  const exited = new Promise<ChildActorOutcome>((resolvePromise, rejectPromise) => {
    settleExit = resolvePromise;
    failExit = rejectPromise;
  });

  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone; the exit handler reaps
    }
  }, timeoutMs);
  timer.unref();

  const finish = (): void => {
    if (reaped) return;
    reaped = true;
    clearTimeout(timer);
    const lines = stdout.split('\n');
    const last = lines.filter((l) => l.length > 0).pop() ?? '';
    const done = /^DONE (\d+)$/.exec(last);
    const error = /^ERROR (.+)$/.exec(last);
    let outcome: ChildActorOutcome;
    if (timedOut) {
      outcome = { ok: false, iterations: 0, error: 'timeout', exitCode: null, signal: 'SIGKILL', timedOut: true };
    } else if (done && child.exitCode === 0) {
      outcome = { ok: true, iterations: Number(done[1]), error: null, exitCode: 0, signal: null, timedOut: false };
    } else if (error) {
      outcome = { ok: false, iterations: 0, error: error[1] ?? null, exitCode: child.exitCode, signal: child.signalCode, timedOut: false };
    } else {
      outcome = {
        ok: false,
        iterations: 0,
        error: child.signalCode ? `killed:${child.signalCode}` : `unexpected-exit:${String(child.exitCode)}`,
        exitCode: child.exitCode,
        signal: child.signalCode,
        timedOut: false,
      };
    }
    settleExit(outcome);
  };

  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    stdout += chunk;
    if (stdout.length > OUTPUT_BUDGET_CHARS) {
      // Bounded output: kill and fail closed rather than buffer unboundedly.
      timedOut = false;
      child.kill('SIGKILL');
      stdout = stdout.slice(0, OUTPUT_BUDGET_CHARS) + '\nERROR output-budget-exceeded\n';
      return;
    }
    if (!stdout.includes('\n')) return;
    const firstLine = stdout.split('\n')[0] ?? '';
    if (/^READY \d+$/.test(firstLine)) readyResolve();
    if (/^ERROR /.test(firstLine)) readyReject(new Error(firstLine.slice(6)));
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => {
    stderr += chunk;
    if (stderr.length > OUTPUT_BUDGET_CHARS) stderr = stderr.slice(0, OUTPUT_BUDGET_CHARS);
  });
  child.on('error', (err) => {
    timedOut = false;
    failExit(err);
    readyReject(err);
  });
  // 'close' fires after stdio streams are fully flushed — the final
  // DONE/ERROR line is always delivered before the outcome is settled.
  child.on('close', () => {
    finish();
    // If the child exits before READY, the ready promise must not hang.
    if (!stdout.includes('READY')) readyReject(new Error('child exited before READY'));
  });

  return {
    pid: child.pid ?? -1,
    ready,
    wait: () => exited,
    kill: () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already reaped
      }
    },
  };
}

/** Start, await completion, and always reap. */
export async function runChildActor(spec: ChildActorSpec): Promise<ChildActorOutcome> {
  const actor = startChildActor(spec);
  try {
    await actor.ready;
  } catch {
    // ready failure is reported through the outcome below
  }
  return actor.wait();
}

/**
 * Bounded lifecycle wrapper: the child is killed and awaited in `finally`
 * even when the consumer throws — zero orphan processes on assertion
 * failure. The returned handle exposes `pid`/`ready`/`wait`/`kill`.
 */
export async function withChildActor<T>(
  spec: ChildActorSpec,
  fn: (actor: RunningChildActor) => Promise<T>,
): Promise<T> {
  const actor = startChildActor(spec);
  try {
    await actor.ready;
    return await fn(actor);
  } finally {
    actor.kill();
    await actor.wait().catch(() => undefined);
  }
}
