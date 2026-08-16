#!/usr/bin/env node
/**
 * MAC-3B — isolated fd-pressure child (TEST-ONLY).
 *
 * NOT part of production. Executed by `tests/mac3b/fd-pressure.ts` as a
 * separate Node child so that descriptor pressure NEVER touches the parent
 * process or the machine (RACE-I14 harness; MAC-3E consumes it).
 *
 * Phases (deterministic):
 *   1. pressure: open a parent-provided pad file repeatedly until open()
 *      fails with EMFILE (hard bounded cap; always terminates — the
 *      process fd limit is finite);
 *   2. probe under pressure: one more open of the pad file — must fail
 *      with EMFILE while pressure is held (recorded, not asserted here);
 *   3. release: close every held descriptor;
 *   4. sanity after release: write a marker file in the parent-provided
 *      marker directory — proves the child remains usable post-release.
 *
 * Protocol: `READY <pid>` then `RESULT preopened=<n> emfile=<true|false>
 * probe=<ok|emfile|error> sanity=<ok|error>`; exit 0 iff EMFILE was
 * reached and the sanity write succeeded. Bounded: the cap (100000) and
 * the parent's timeout own the lifecycle; no shell is used.
 */
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PRESSURE_CAP = 100000;

const [markerDirArg] = process.argv.slice(2);

function fail(message) {
  process.stdout.write(`ERROR ${message}\n`);
  process.exit(1);
}

const markerDir = join(markerDirArg);
try {
  const probe = openSync(markerDir, 'r');
  closeSync(probe);
} catch {
  fail('marker-dir-unavailable');
}

const PAD = join(markerDir, 'pad.bin');
const MARKER = join(markerDir, 'sanity.marker');

process.stdout.write(`READY ${process.pid}\n`);

const held = [];
let preopened = 0;
let emfile = false;
try {
  for (let i = 0; i < PRESSURE_CAP; i++) {
    try {
      held.push(openSync(PAD, 'r'));
      preopened++;
    } catch (e) {
      if (e && e.code === 'EMFILE') {
        emfile = true;
        break;
      }
      throw e;
    }
  }
  // Probe under pressure: with every descriptor slot consumed up to the
  // limit, a further open must be EMFILE (deterministic while held).
  let probeOutcome = 'ok';
  try {
    const fd = openSync(PAD, 'r');
    closeSync(fd);
  } catch (e) {
    probeOutcome = e && e.code === 'EMFILE' ? 'emfile' : 'error';
  }
  // Release: every held descriptor closes (best effort; nothing leaks).
  for (const fd of held) {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
  }
  held.length = 0;
  // Sanity after release: the child must be fully usable again.
  let sanity = 'ok';
  try {
    writeFileSync(MARKER, 'sanity');
  } catch {
    sanity = 'error';
  }
  process.stdout.write(`RESULT preopened=${preopened} emfile=${emfile} probe=${probeOutcome} sanity=${sanity}\n`);
  process.exit(sanity === 'ok' && emfile ? 0 : 1);
} catch (e) {
  for (const fd of held) {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
  }
  const code = e && typeof e.code === 'string' ? e.code : 'pressure-failed';
  process.stdout.write(`ERROR ${code}\n`);
  process.exit(1);
}
