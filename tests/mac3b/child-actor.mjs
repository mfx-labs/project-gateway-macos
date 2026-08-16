#!/usr/bin/env node
/**
 * MAC-3B — bounded hostile pathname-churn actor (TEST-ONLY child process).
 *
 * NOT part of production; never imported by src/**. Executed by the
 * test-only helper `tests/mac3b/child-actor.ts` as a separate Node child.
 *
 * Contract (MAC-3B §5):
 *   - argv: <fixtureRoot> <budget> <scriptName> [pauseDelayMs]
 *   - the fixture root is supplied by the parent and MUST already exist
 *     and be realpath-canonical; the child refuses anything else;
 *   - every filesystem path the scripts touch is constructed from the
 *     fixed script vocabulary below and passed through a lexical
 *     containment guard (resolve + root prefix); an escape attempt is a
 *     typed `escape-attempt-blocked` failure of that single operation,
 *     never an outside write;
 *   - scripts are a FIXED built-in set keyed by name; the parent never
 *     supplies code or shell text, only data (root, budget, name, delay);
 *   - no shell is invoked anywhere;
 *   - the budget is a bounded positive integer (1..100000); the child
 *     performs exactly `budget` script iterations and then terminates;
 *   - ready protocol: prints `READY <pid>` after validating the fixture;
 *   - completion protocol: prints `DONE <iterations>` and exits 0;
 *     failure prints `ERROR <message>` and exits 1;
 *   - the parent owns lifecycle bounding (timeout → SIGKILL → reap).
 *
 * The `pause` script is used ONLY to exercise the parent timeout/kill
 * path in the harness self-tests; it is not synchronization evidence.
 * The `escape-attempt` script is used ONLY to prove lexical containment.
 */
import {
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';

const BUDGET_MAX = 100000;

const [fixtureRootArg, budgetArg, scriptName, delayArg] = process.argv.slice(2);

function fail(message) {
  process.stdout.write(`ERROR ${message}\n`);
  process.exit(1);
}

const budget = Number(budgetArg);
if (!Number.isSafeInteger(budget) || budget < 1 || budget > BUDGET_MAX) fail('invalid-budget');

const delay = delayArg === undefined ? 0 : Number(delayArg);
if (!Number.isSafeInteger(delay) || delay < 0 || delay > 2000) fail('invalid-delay');

const root = resolve(fixtureRootArg);
try {
  const st = lstatSync(root);
  if (!st.isDirectory()) fail('fixture-root-not-a-directory');
} catch {
  fail('fixture-root-missing');
}
// Canonical pin: the parent passes a realpath-canonical fixture root; a
// non-canonical spelling is refused (mirrors the MAC-2C root-identity rule).
if (realpathSync(root) !== root) fail('fixture-root-not-canonical');

/** Lexical containment guard: every script path must stay under root. */
function guard(absolutePath) {
  const r = resolve(absolutePath);
  if (r !== root && !r.startsWith(root + sep)) throw new Error('escape-attempt-blocked');
  return r;
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function exists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Fixed per-iteration mutation vocabulary (all paths guarded). */
const P = {
  alpha: () => guard(join(root, 'alpha')),
  alphaMoved: () => guard(join(root, 'alpha-moved')),
  link: () => guard(join(root, 'link')),
  target: () => guard(join(root, 'target')),
  file: () => guard(join(root, 'file')),
  decoy: () => guard(join(root, 'decoy')),
  escape: () => guard(join(root, '..', `mac3b-escape-${process.pid}`)),
};

const SCRIPTS = {
  /** rename + replacement-directory cycle (self-initializing). */
  'dir-rename-cycle'() {
    if (exists(P.alpha())) {
      renameSync(P.alpha(), P.alphaMoved());
      mkdirSync(P.alpha());
    } else if (exists(P.alphaMoved())) {
      renameSync(P.alphaMoved(), P.alpha());
    } else {
      mkdirSync(P.alpha());
    }
  },
  /** symlink insertion/removal cycle. */
  'symlink-cycle'() {
    if (!exists(P.target())) mkdirSync(P.target());
    if (isSymlink(P.link())) unlinkSync(P.link());
    else symlinkSync('target', P.link());
  },
  /** regular-file decoy cycle. */
  'file-decoy-cycle'(i) {
    writeFileSync(P.file(), `iteration-${i}`);
    if (exists(P.decoy())) unlinkSync(P.decoy());
    renameSync(P.file(), P.decoy());
    writeFileSync(P.file(), `iteration-${i}-again`);
  },
  /** mixed churn (rotate through the three primitives). */
  'mixed-churn'(i) {
    SCRIPTS[['dir-rename-cycle', 'symlink-cycle', 'file-decoy-cycle'][i % 3]]();
  },
  /** escape probe: one guarded outside write per iteration; must be blocked. */
  'escape-attempt'() {
    try {
      writeFileSync(P.escape(), 'x');
      throw new Error('escape-not-blocked');
    } catch (e) {
      if (e && e.message === 'escape-not-blocked') throw e;
    }
  },
  /** lifecycle-boundary pause (timeout/kill self-tests only; never evidence). */
  'pause'() {
    const end = Date.now() + delay;
    while (Date.now() < end) {
      /* bounded spin; the parent's timeout owns termination */
    }
  },
};

const script = SCRIPTS[scriptName];
if (typeof script !== 'function') fail('unknown-script');

process.stdout.write(`READY ${process.pid}\n`);
let iterations = 0;
try {
  for (let i = 0; i < budget; i++) {
    script(i);
    iterations++;
  }
} catch (e) {
  const message = e && typeof e.message === 'string' ? e.message : 'script-failed';
  process.stdout.write(`ERROR ${message}\n`);
  process.exit(1);
}
process.stdout.write(`DONE ${iterations}\n`);
process.exit(0);
