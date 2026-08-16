/**
 * MAC-3B — deterministic A-type interleave support (TEST-ONLY helper).
 *
 * The MAC-3A evidence policy: A = exact deterministic hook/interleave;
 * B = structural descriptor-first sequencing; C = probabilistic
 * scheduler/sleep races (FORBIDDEN for security evidence). This helper
 * exists so MAC-3C/D can record and assert EXACT event ordering and run
 * single-shot boundary actions without sleeps or retry loops.
 *
 * - `makeInterleaveClock`: records boundary names in invocation order and
 *   asserts an exact expected sequence (no timing, no retries);
 * - `once`: runs a boundary action at most once; later calls are no-ops.
 *   A first-call throw propagates to the caller (the operation under test
 *   fails closed through its own error path); the action is not retried.
 *
 * Timeouts for lifecycle bounding belong to the child-actor/fd-pressure
 * helpers, never here: a timeout is not synchronization evidence.
 */
export interface InterleaveClock {
  /** Append a boundary name to the observed order. */
  readonly record: (name: string) => void;
  /** Frozen observed order. */
  readonly order: () => readonly string[];
  /** Fail unless the observed order is exactly the expected sequence. */
  readonly assertExact: (expected: readonly string[]) => void;
}

export function makeInterleaveClock(): InterleaveClock {
  const events: string[] = [];
  return {
    record(name: string): void {
      events.push(name);
    },
    order(): readonly string[] {
      return Object.freeze([...events]);
    },
    assertExact(expected: readonly string[]): void {
      const got = events;
      if (got.length !== expected.length || got.some((e, i) => e !== expected[i])) {
        throw new Error(
          `interleave order mismatch: expected [${expected.join(', ')}], observed [${got.join(', ')}]`,
        );
      }
    },
  };
}

/** Run `fn` at most once; later calls are no-ops. First-call errors propagate. */
export function once<T>(fn: () => T): () => T | undefined {
  let used = false;
  return () => {
    if (used) return undefined;
    used = true;
    return fn();
  };
}
