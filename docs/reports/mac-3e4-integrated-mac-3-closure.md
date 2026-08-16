# MAC-3E4 — Integrated MAC-3 Closure (Gate Report)

**Verdict: `MAC-3E4 — READY FOR FINAL FOCUSED CLOSURE REREVIEW`**
**Starting SHA:** `9bacf2753dc3f8706ad9aea2425384890a9a560b` (resolved
from `9bacf27`, verified by `git rev-parse HEAD` — exact match; HEAD
subject `test: establish MAC-3E3 cross-root MCP verification`).
**Accepted prior gates:** MAC-3A (contract, `1685bd7`), MAC-3B
(`a0e24f7`), MAC-3C (`643405c`), MAC-3D (`5f6a425`), MAC-3E1
(`5e58a60`), MAC-3E2 (`98a66de`), MAC-3E3 (`9bacf27` = this HEAD).
**Provisional matrix (accepted):** `42 PROVEN / 0 PARTIAL / 0
UNPROVEN` (42 rows, post-E3).
**Date:** host local time at gate execution
**Host:** macOS 12.7.6 (Darwin 21.6.0, xnu-8020.240.18.709.2), x86_64
(Intel), Node v22.23.1, Git 2.37.1 (Apple Git-137.1). Runtime evidence
is **Intel x86_64 only**; arm64 runtime remains deferred to MAC-5.
**Recovery state:** `MAC-3E — EXECUTION PAUSED FOR DECOMPOSITION`
(accepted); E4 is the CLOSURE / REGRESSION gate only.

---

## 1. Freeze (verified, not asserted)

| Item | Value | Verified |
|---|---|---|
| HEAD | `9bacf2753dc3f8706ad9aea2425384890a9a560b` | `git rev-parse HEAD` — exact match to resolved `9bacf27` |
| Tracked working tree at starting freeze | CLEAN | `git status --porcelain` = `?? .DS_Store` only (the preserved environmental-hygiene event) — the state at gate start, BEFORE the E4 corrections below |
| Tracked working tree (current, uncommitted) | E4 correction delta present | `package.json`, `src/completion/writer.ts`, `tests/integration/conformance.test.ts`, `tests/unit/mac3e-churn.test.ts` modified; `scripts/run-test-inventory.mjs` and this report untracked. Uncommitted by design — nothing in the E4 chain is committed/pushed/tagged |
| Native surface | six exports | `native/test/surface.test.mjs` 3/3 (below) + `mac2f: … exactly six exports` guard ok (authoritative inventory) |
| MCP surface | nine tools | `runtime static guard: exactly nine tools …` + `stdio: … nine tools …` ok (authoritative inventory) |
| Tags / pushes | none; MAC chain local-only | `git tag -l` empty; branch ahead of upstream (unchanged from MAC-3A §1) |

At the starting freeze the tracked tree was clean and zero
production/native/schema/MCP changes existed. The CURRENT tree carries
the uncommitted E4 correction delta: the accepted bounded RACE-I15
completion-writer recovery correction (`src/completion/writer.ts` — a
production change confined to the EEXIST recovery read, Appendix B)
plus test-infrastructure/test/report corrections (`package.json` test
workflow, `scripts/run-test-inventory.mjs`,
`tests/integration/conformance.test.ts`, `tests/unit/mac3e-churn.test.ts`,
this report). Production authority contract/surface was NOT widened:
the same retained verified-parent descriptor authority, O_EXCL-only
creation, fail-closed conflict vocabulary, and cleanup provenance hold;
native/schema/MCP surfaces remain unchanged (six exports / nine tools
throughout). Nothing is committed, pushed, or tagged.

## 2. Reconfirmed MAC-3 slices (each ONCE, all green)

All compiled artifacts verified current against sources (source mtime <
compiled mtime) before the runs. Every run bounded by a per-suite
watchdog (see the Watchdog Correction Addendum — the corrected watchdog
was in force for all runs recorded here; node's own `duration_ms` is the
runtime measurement).

| Slice | Suite(s) | Result | duration_ms |
|---|---|---|---|
| MAC-3B | `mac3b-accounting` (13) + `mac3b-harness` (11) + `mac3b-hook-exposure` (7) + `wp13b-completion-seams` (10) | **41/41 pass** | 3966 |
| MAC-3C | `mac3c-executor-hostile` (8) + `mac3c-completion-hostile` (14) | **22/22 pass** | 277 |
| MAC-3D | `mac3d-reader-hostile` (10) + `mac3d-service-hostile` (5) | **15/15 pass** | 216 |
| MAC-3E1 | `mac3e-concurrency` | **3/3 pass** | 416 |
| MAC-3E2 | `mac3e-fd-pressure` | **3/3 pass** | 3147 |
| MAC-3E3 | `mac3e-churn` (3) + `mac3e-mcp-two-session` (2) | **5/5 pass** | 7113 |

**MAC-3-specific suite totals: 89/89 pass, 0 fail, 0 cancelled, 0
skipped.** Zero `child-actor` / `race-writer` / `pressure-consumer` /
MCP-server orphan processes after every run (`pgrep` empty after each
slice).

## 3. Authoritative regression (once, complete surface)

`npm test` workflow (clean:generated → build → tsc tests →
wp7-discovery-guard → full node --test inventory) + `npm run
test:native` + `scripts/run-wp7-tests.mjs` + `npm run typecheck` +
`git diff --check`:

| Component | Result |
|---|---|
| clean:generated / build (`tsc -p tsconfig.json`) / tests compile (`tsc -p tsconfig.tests.json`) | exit 0 / exit 0 / exit 0 |
| `scripts/wp7-discovery-guard.mjs` | OK (source↔compiled correspondence, incl. all MAC-3 suites) |
| **node --test inventory (all groups)** | **2472 tests — 2376 pass / 96 fail / 0 cancelled / 0 skipped / 0 todo — exit 1** (exit 1 is the documented expected baseline fail set, §4) |
| Conformance (`integration/conformance.test.js`) | 90/90 pass incl. the `648/648 × 3 lanes` corpus assertions (linux default, darwin-arm64, darwin-x86_64) |
| Native suite (`npm run test:native`) | **54/54 pass** (incl. `surface.test.mjs` 3/3 — six exports) |
| WP-7 runner (`scripts/run-wp7-tests.mjs`) | reader **83/83** (incl. 15 MAC-3D hostile tests) · fff **26/26** · security **37/40 + 3 platform-permitted skips** (exact name allowlist, both directions) · git **26 pass + 3 fail + 12 cancelled** — the documented Linux-only `GIT_BIN` class; the runner fail-closes on Darwin exactly as designed (exit 1) |
| `npm run typecheck` | exit 0 |
| `git diff --check` | clean |
| MCP nine-tool guards | `runtime static guard` + `stdio` nine-tool assertions ok |
| Real E2E (mac2f, mac3e-mcp-two-session, wp14b, bootstrap, server, identity, stdio) | all green (0 fails in runtime group) |

No group failed outside the §4 classes; no test outside the documented
baseline classes failed; zero timeouts anywhere (0 cancelled, every
suite completed with node's own summary).

## 4. Regression attribution — every failure classified

All **96 inventory failures** fall into the four accepted baseline
classes of MAC-2G §11, with byte-identical counts and modes. Per the
E4 attribution rule, nothing was assumed from history alone: attribution
was established by (a) byte-identity of every failing file across the
pre-MAC-3 baseline → HEAD boundary, and (b) a **selective
pristine-baseline reproduction** (§5).

| Class | Count | Mode | Attribution |
|---|---|---|---|
| 1. durability suites (`wp13-durability-s3-outcome-production` ×37, `wp13-durability-s3-wp13c-precondition` ×22, `wp13c-publication` ×19, `wp15-phase1a-outcome-resultless` ×3, `wp13-durability-s4-retrospective-derivation` ×1) | 82 | `result.write-parent-not-verified` (RESULT-CONTAINMENT-DENIED) — the accepted descriptor-identity fail-closed against the non-canonical `/var/folders/…` TEST fixture (pre-existing Darwin fixture incompatibility exposed pre-MAC-3 by the accepted MAC-2C contract) | **PRE-EXISTING BASELINE DEBT** |
| 2. `mcp/unit/changes.test.js` (10 tests + 1 file-level) | 11 | `spawnSync /home/chef/.local/git-2.45.4/bin/git ENOENT` — hardcoded Linux-only Git path | **PRE-EXISTING BASELINE DEBT** |
| 3. `unit/bootstrap-action.test.js` | 2 | `/private/var` vs `/var` canonical-root mismatch (`resolved root must be the canonical root`) | **PRE-EXISTING BASELINE DEBT** |
| 4. `pi-adapter/compatibility/harness.test.js` | 1 | `F8: real Pi 0.83.0 path supplied explicitly is accepted` — installed Pi is 0.84.1 (pinned-0.83.0 layout expectation) | **ENVIRONMENTAL / PLATFORM DEBT** |
| 5. WP-7 git suite (runner-level) | 3 fail + 12 cancelled | Linux-only `GIT_BIN` class (same root cause as class 2); runner fail-closed accounting is the accepted Darwin behavior | **PRE-EXISTING BASELINE DEBT** |

**Zero** `NEW MAC-3 REGRESSION`; **zero** `UNRESOLVED`; **zero**
timeouts (no timeout classification exists). Failure modes were sampled
directly from the TAP log (`error: '…write-parent-not-verified…'`,
`error: 'spawnSync /home/chef/… ENOENT'`, `+ '/private/var/…'`,
`F8: real Pi 0.83.0 path…`) — all byte-identical to the MAC-2G §11
recordings.

## 5. Selective pristine-baseline reproduction (per §4 rule)

Smallest failing file per class, reproduced on a pristine worktree at
the **pre-MAC-3 closure baseline `1685bd7`** (MAC-2G closure; the
MAC-3A starting SHA; fresh `git worktree add`, dependencies and native
addon symlinked — `package.json`/`package-lock.json` byte-identical
across the boundary, verified; full `npm run build` + tests compile at
the baseline, both exit 0):

| Baseline file (at `1685bd7`) | Fails | Identical to HEAD? |
|---|---|---|
| `wp13-durability-s4-retrospective-derivation.test.js` (class 1, smallest) | 1 | yes — same test name, same mode |
| `mcp/unit/changes.test.js` (class 2) | 10 + 1 file-level | yes — 15/15 names identical, same ENOENT mode |
| `unit/bootstrap-action.test.js` (class 3) | 2 | yes — same names, same mode |
| `pi-adapter/compatibility/harness.test.js` (class 4) | 1 | yes — same name, same mode |

**Result: 15 fail on the pristine baseline — 15/15 failing test names
identical to HEAD (path-normalized), identical failure modes.** Per the
§4 stop rule, attribution stops here: the failures demonstrably
pre-exist MAC-3 with identical signatures. Additionally, all 8 failing
files are byte-identical between `1685bd7` and `9bacf27`
(`git diff --quiet` per file), and none is touched by the MAC-3 tracked
delta (MAC-3 delta = 2 optional test-only hooks in
`src/completion/writer.ts` + test-infra accounting + test files +
reports).

The pristine worktree remains at `/private/tmp/mac3e4-pristine-wt`
(untouched, for senior review inspection).

## 6. Final 42-row matrix (closure-authoritative)

All rows **PROVEN**; basis per the accepted gate that closed each row
(MAC-3A baseline → MAC-3C → MAC-3D → E1 → E2 → E3).

| Row | Status | Closed by |
|---|---|---|
| RACE-I01 root descriptor authority | PROVEN | baseline (carry: MAC-3C/D) |
| RACE-I02 intermediate descriptor authority | PROVEN | MAC-3C |
| RACE-I03 no symlink traversal | PROVEN | baseline (carry: MAC-3C/D) |
| RACE-I04 final create exclusivity | PROVEN | baseline (carry: MAC-3C) |
| RACE-I05 parent identity | PROVEN | MAC-3C |
| RACE-I06 cleanup provenance | PROVEN | MAC-3C |
| RACE-I07 completion recovery identity | PROVEN | MAC-3C |
| RACE-I08 recovery observational-only | PROVEN | baseline (strengthened MAC-3C) |
| RACE-I09 reader pre-open revalidation | PROVEN | MAC-3D |
| RACE-I10 reader post-open stability | PROVEN | baseline |
| RACE-I11 enumeration anchor | PROVEN | baseline |
| RACE-I12 enumeration offset isolation | PROVEN | baseline (strengthened MAC-3D) |
| RACE-I13 descriptor lifetime | PROVEN | MAC-3C (strengthened MAC-3D) |
| RACE-I14 resource pressure fail-closed | PROVEN | MAC-3E2 |
| RACE-I15 concurrent same-destination writers | PROVEN | MAC-3E1 |
| RACE-I16 no cross-root redirect | PROVEN | MAC-3E3 |
| W-W1 … W-W8 writing windows | all PROVEN | W-W2/W-W3/W-W6/W-W7 MAC-3C; W-W1/W-W4/W-W5/W-W8 baseline |
| W-C1 … W-C8 completion windows | all PROVEN | W-C2/W-C3/W-C8 MAC-3C; W-C7 MAC-3E1; W-C1/W-C4/W-C5/W-C6 baseline |
| W-R1 … W-R10 reader windows | all PROVEN | W-R1/W-R3/W-R4/W-R9 MAC-3D; W-R2/W-R5/W-R6/W-R7/W-R8/W-R10 baseline |

**Matrix: 42 PROVEN / 0 PARTIAL / 0 UNPROVEN — unchanged from the
accepted provisional state; E4 altered no row.** Production authority
semantics unchanged (MAC-3 tracked production delta = the two optional
test-only hooks, hooks-absent behavior regression-locked by
`mac3b-hook-exposure` and `wp13b-completion-seams`; zero native/schema/
MCP changes across the entire MAC-3 chain).

## 7. Closure decision

- All MAC-3-specific suites green: **89/89** (§2). ✓
- Zero NEW MAC-3 REGRESSION; zero UNRESOLVED (§4). ✓
- Native = six; MCP = nine (§1, §3). ✓
- Production authority semantics unchanged (§6). ✓
- Matrix exactly **42/0/0** (§6). ✓
- Remaining failures = pre-existing/environmental debt, independently
  demonstrated pre-MAC-3 on the pristine baseline (§5). ✓
- No unrelated debt fixed in this gate (per scope). ✓

**`MAC-3E4 — CLOSURE CORRECTION STILL REQUIRED`** (historical — the
gate verdict at the pre-correction stage; the two diagnosed deviations
were then corrected and are authoritative-inventory green, Appendix B)

**`MAC-3E4 — READY FOR FINAL FOCUSED CLOSURE REREVIEW`**

## 8. Remaining unrelated debt (not fixed — out of scope)

1. 82 durability-suite failures — non-canonical Darwin TEST fixture vs
   the accepted descriptor-identity fail-closed contract (MAC-2G §11
   class 1; production roots are realpath-canonical).
2. Linux-only Git path debt — `changes.test.js` (11) and the WP-7 git
   suite (3 fail + 12 cancelled; runner fail-closes on Darwin).
3. `bootstrap-action` `/var` vs `/private/var` (2).
4. Pi compatibility F8 environment-version mismatch (1).
5. arm64 runtime evidence — deferred to MAC-5 (Intel x86_64 acceptance
   only).

## 9. Closure record

Starting SHA `9bacf2753dc3f8706ad9aea2425384890a9a560b` preserved; E1
baseline `5f6a425`, E2 baseline `98a66de`, E3 baseline `9bacf27` =
this HEAD — all accepted, untouched. Slice reconfirmation 89/89;
authoritative regression 2472/2376/96/0/0/0 (exit 1 = documented
baseline) + conformance 90/90 (648/648 × 3 lanes) + native 54/54 +
WP-7 reader 83/83, fff 26/26, security 37/40 (+3 exact permitted skips),
git Linux-only class; typecheck/compile/build exit 0; `git diff
--check` clean. 96 failures + git WP-7 class = PRE-EXISTING BASELINE /
ENVIRONMENTAL DEBT, proven by byte-identity + selective pristine
reproduction (15/15 identical). Zero timeouts. Six native exports /
nine MCP tools. Intel x86_64 only; arm64 deferred to MAC-5. The E4
production delta is exactly the accepted bounded RACE-I15
completion-writer recovery correction (authority contract/surface not
widened; native/schema/MCP unchanged); the remaining E4 delta is
test-infrastructure/test/report only. Nothing committed, pushed,
tagged, or released.

**`MAC-3E4 — READY FOR FINAL FOCUSED CLOSURE REREVIEW`**

---

## Appendix A — Watchdog Correction Addendum (operator/test infrastructure)

**Defect (root cause):** the initial `/tmp/watchdog.sh` ran the watched
command, then started a background timer subshell
(`( sleep $LIMIT && kill -9 $PID … ) &`). When the watched command
exited first, `kill $WPID` SIGTERMed the subshell but not its forked
`sleep` child, which remained orphaned and held the output pipe open —
every wrapped invocation therefore blocked for exactly the full LIMIT
after the child had already finished, and elapsed wall-clock readings
were invalid. The timeout path also SIGKILLed only the direct child,
never its process group.

**Correction (semantics):** the rewritten watchdog (test-infra only,
outside the repository) starts the watched command in its own process
group (`set -m`), polls with `kill -0`, reaps with `wait` on exit
(returning the real status, no timer process exists to orphan), and on
limit expiry escalates SIGTERM → SIGKILL against the whole process
group, returning distinct status 124.

**Self-tests (all three pass):**
- A fast success `watchdog 10 sh -c 'exit 0'` → immediate (1 s), `WATCHDOG_EXIT=0`;
- B fast failure `watchdog 10 sh -c 'exit 7'` → immediate (0 s), `WATCHDOG_EXIT=7`;
- C real timeout `watchdog 2 sh -c 'sleep 30'` → completed at the 2 s
  bound (3 s wall incl. TERM grace), distinct `124`, zero leftover
  `sleep 30` processes.

**Invalidation:** no command was ever timeout-classified under the
defective watchdog (the timer never fired; every wrapped command
exited first with a real status, and node's own `duration_ms` figures
are the valid runtime measurements). Invalidated items are limited to
wall-clock durations of wrapped invocations; all functional results
recorded under the defective watchdog (slice totals, the 2472-test
inventory with complete TAP log, pristine-baseline reproduction) were
re-verified as internally complete and stand. No previously
timeout-classified file existed, so no HEAD revalidation was required;
the interrupted pristine-baseline reproduction was resumed with the
corrected watchdog and completed (§5).

**MAC-3E4 — WATCHDOG CORRECTED; REGRESSION ATTRIBUTION RESUMED** →
closure completed as recorded above.

**MAC-3E4 — CLOSURE CORRECTION STILL REQUIRED** (historical — the gate
verdict at this addendum's conclusion, before the RACE-I15/RACE-I16
corrections; superseded below)

**MAC-3E4 — READY FOR FINAL FOCUSED CLOSURE REREVIEW**

---

## Appendix B — E4-F1A pressure-interference correction

### Finding and diagnosis (historical — pre-correction record; superseded by the final authoritative inventory below)

The independent E4-F1 inventory recorded **2472 tests / 2371 pass / 101
fail**. Five failures were load-dependent: `mac3e-fd-pressure` ×2 and
`mac3b-harness` fd-pressure ×2 reported **ENFILE**; `runtime/stdio` had
one load-sensitive stderr assertion.

The default `npm test` workflow passed all 155 compiled non-WP7 test
files to one default-parallel `node --test` invocation. Both pressure
suites were therefore eligible to run together with every other fd-heavy
worker. The pressure child scripts deliberately accept only per-process
**EMFILE** as their induction boundary; an **ENFILE** exits their setup
before any production probe and denotes host-wide open-file-table
competition. It is not an accepted consumer result.

Focused reproduction used the two pressure-bearing files under the
ordinary Node file-parallel mode, then under `--test-concurrency=1`:

| Execution | Result |
|---|---|
| normal parallel: `mac3b-harness` + `mac3e-fd-pressure` | 14/14 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo |
| serialized/isolated: same two files | 14/14 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo |

The small reproduction was not sufficiently loaded to re-create ENFILE;
it confirms that both suites retain genuine EMFILE induction and that the
load-sensitive ENFILE occurs only when they share the host descriptor
table with unrelated inventory workers.

### Correction

`scripts/run-test-inventory.mjs` now owns the same 14 compiled-test glob
groups previously supplied directly by `npm test`. It fail-closes on an
empty group, duplicate path, or missing pressure file, discovers **155**
files, and partitions them as follows:

- **153 ordinary files:** existing default-parallel `node --test` mode.
- **2 pressure files:** `mac3b-harness.test.js` and
  `mac3e-fd-pressure.test.js`, run afterward with
  `--test-concurrency=1`.

The runner performs the isolated phase even when the ordinary phase has
documented baseline failures, so every authoritative inventory file is
still executed. No pressure assertion, EMFILE expectation, production,
native, schema, or MCP behavior changed. The PointOfUse workflow guard
was correspondingly moved from the old inline package glob to the new
single authoritative runner: it proves the runner is invoked once and
owns the PointOfUse-v2 glob once.

### Pre-RACE-I15/I16 authoritative regression confirmation (superseded)

The final corrected `npm test` workflow was run once after the stale
PointOfUse guard correction. It discovered **155 = 153 ordinary + 2
isolated pressure** compiled test files. The ordinary phase completed
before the pressure phase began.

| Phase | tests | pass | fail | cancelled | skipped | todo | timeout |
|---|---:|---:|---:|---:|---:|---:|---:|
| ordinary parallel | 2458 | 2360 | 98 | 0 | 0 | 0 | 0 |
| isolated pressure | 14 | 14 | 0 | 0 | 0 | 0 | 0 |
| **total** | **2472** | **2374** | **98** | **0** | **0** | **0** | **0** |

The corrected PointOfUse workflow guard passed in the authoritative run.
All six stdio assertions passed. The isolated pressure phase passed
**14/14**, and the completed log contains **zero ENFILE** and zero timeout
failures. No pressure, MCP, child-actor, race-writer, or
pressure-consumer process remained afterward. `git diff --check` was
clean.

The accepted baseline classes account for **96** failures exactly:

| Class | Count |
|---|---:|
| durability | 82 |
| Linux-only Git | 11 |
| bootstrap canonical-root | 2 |
| Pi F8 | 1 |

### Two-failure diagnosis (pre-correction record)

#### RACE-I15 — PRODUCT/IMPLEMENTATION DISCREPANCY

MAC-3E1 §5.1 explicitly accepts, for four identical concurrent completion
payloads, exactly one `created` and exactly three `already-exact` outcomes:
each loser recovers/adopts the winner's exact canonical bytes. The current
RACE-I15 completion test asserts that same contract directly. Its mixed
payload case alone permits `exclusive-create-conflict` for a loser whose
payload differs from the on-disk winner; the executor lane is the separate
case whose three identical losers must be typed conflicts with
`cleanup: 'not-needed'`.

The authoritative outcome (one `created`, three
`exclusive-create-conflict`) therefore does not meet the accepted identical
completion contract. It is not a stale assertion or a permissible completion
loser vocabulary in this case. The smallest required correction is in the
completion EEXIST recovery path: identical concurrent losers must be able to
read the completed canonical winner and return `already-exact`, while
retaining one exclusive creator, truthful cleanup, and conflicting-byte
fail-closed behavior. No production change was made in this diagnosis gate.

#### RACE-I16 — ACTOR-OWNED TRANSIENT STATE

The exact `file-decoy-cycle` actor uses `writeFileSync(P.file(), data)` with
no options. Node's default flag is `w` (`O_WRONLY | O_CREAT | O_TRUNC`), so
each call exposes an empty `file` after open/truncate (or create) and before
the synchronous payload write completes. Per iteration it: (1) truncates and
writes `iteration-N`; (2) removes any prior `decoy` and renames that file to
`decoy`; then (3) creates the replacement `file` empty and writes
`iteration-N-again`. Thus both writes can expose a zero-length file owned by
the churn actor itself. The reader opens the fixture-contained target and
then performs `readSync` on that retained fd at offset zero, so `""` can be
read from that actor-owned transient without any authority escape or decoy
adoption.

The smallest required correction is test/harness expectation alignment: add
the actor-owned empty transition to the reader-churn successful-content
vocabulary while retaining the confinement and typed-`not-found` assertions.
Changing the reader is neither indicated nor authorized. No acceptance
semantics were changed in this diagnosis gate.

### Focused post-inspection reproduction

- `node --test dist-test/tests/unit/mac3e-concurrency.test.js`: **3 tests,
  3 pass, 0 fail** (including the RACE-I15 identical-completion assertion).
- `node --test dist-test/tests/unit/mac3e-churn.test.js`: **3 tests, 3 pass,
  0 fail** (including the RACE-I16 reader-churn assertion).

Both were run once after the source/report inspection. No race-writer,
child-actor, pressure, or MCP process remained afterward; `git diff --check`
is clean. The 42/0/0 matrix and all production/native/schema/MCP code remain
unchanged.

### RACE-I15 focused correction (authoritative confirmation pending)

The implementation discrepancy was in the one-shot EEXIST recovery read.
`O_EXCL` makes the final component visible before the winning process reaches
its first `writeSync`; under authoritative load, an identical loser could
therefore fstat the correctly owned regular file at size zero (or another
short prefix) and classify it as a permanent `exclusive-create-conflict`.

`src/completion/writer.ts` now reopens only that same final component through
the already-retained, verified parent descriptor when—and only when—the
opened object remains an ordinary service-owned file shorter than the exact
expected canonical bytes. There are at most **16** rechecks after the first
short observation, each separated by a fixed **2 ms** bounded wait (at most
17 descriptor-relative observations and 32 ms total waiting). Every recheck
repeats the existing regular-file, UID, size, and exact-byte gates. A complete
wrong-size or wrong-byte object, a symlink/FIFO/directory/device, an ownership
mismatch, or exhaustion of the finite bound still fails closed; there is no
pathname fallback, overwrite, authority widening, or cleanup change.

Focused verification after the correction:

| Scope | Result |
|---|---|
| typecheck | pass |
| production and test TypeScript compilation | pass |
| MAC-3E1 true concurrency | 3/3 pass: identical completion adoption, mixed-payload conflict semantics, and executor conflicts preserved |
| MAC-3C completion hostile/recovery | 14/14 pass |
| completion seam guards (including hooks absent) | 10/10 pass |
| WP-13B completion recovery neighbors | 22/22 pass |
| completion static guard | 4/4 pass |
| focused aggregate | **53/53 pass** |

No authoritative inventory was run in this gate. **RACE-I15 is corrected and
ready for focused rereview, not yet closure-authoritative.** RACE-I16 remained
the separately diagnosed **ACTOR-OWNED TRANSIENT STATE** test-drift item and
was intentionally uncorrected in that gate. The 42/0/0 matrix remains
unchanged.

### RACE-I16 test correction (authoritative confirmation pending)

The correction is test-only in `tests/unit/mac3e-churn.test.ts`. Its reader
success assertion now accepts exactly the churn actor's three content forms:
the actor-owned empty transition `""`, `iteration-N`, and
`iteration-N-again`. The empty form is accepted only through the explicit
`bytes === ''` branch; every non-empty success must still match the exact
iteration vocabulary. Any other bytes remain a failure. Typed `not-found`,
fixture/root confinement, and the outside-decoy assertion are unchanged.

No reader, production authority, native, schema, or MCP implementation was
changed. RACE-I15's accepted completion-writer correction remains unchanged.

Focused verification after this test correction:

| Scope | Result |
|---|---|
| test TypeScript compilation | pass |
| RACE-I16 reader churn subtest | 1/1 pass |
| MAC-3E3 churn suite | 3/3 pass; completion and executor churn behavior unchanged |
| MAC-3B child-actor harness | 11/11 pass; containment and lifecycle checks preserved |

No authoritative inventory was run. The 42/0/0 matrix remains unchanged;
final closure remains non-authoritative until that inventory completes.

### Final authoritative inventory — current corrected tree

Exactly one final `npm test` authoritative inventory was run after the
accepted pressure isolation, RACE-I15 recovery, and RACE-I16 vocabulary
corrections. Discovery was exactly **155 = 153 ordinary parallel + 2
isolated pressure** compiled test files; the ordinary phase completed before
the serialized pressure phase.

| Phase | tests | pass | fail | cancelled | skipped | todo | timeout |
|---|---:|---:|---:|---:|---:|---:|---:|
| ordinary parallel | 2458 | 2362 | 96 | 0 | 0 | 0 | 0 |
| isolated pressure | 14 | 14 | 0 | 0 | 0 | 0 | 0 |
| **total** | **2472** | **2376** | **96** | **0** | **0** | **0** | **0** |

The isolated pressure phase is **14/14**. The completed TAP log contains
zero `ENFILE` and zero timeout classifications. The PointOfUse workflow guard
passed; all six stdio assertions passed; RACE-I15 completed with the required
identical-writer adoption behavior; and the RACE-I16 reader churn assertion
passed with the explicit actor-owned empty transition. The native surface
guards passed at **six** exports and the MCP surface guards passed at **nine**
tools. No pressure, MCP, child-actor, race-writer, or pressure-consumer
process remained afterward (the process-table probe matched only itself).
`git diff --check` is clean.

The 96 failures are exactly the accepted baseline classes:

| Class | Count |
|---|---:|
| durability | 82 |
| Linux-only Git | 11 |
| bootstrap canonical-root | 2 |
| Pi F8 | 1 |

**NEW MAC-3 REGRESSION = 0. UNRESOLVED = 0.** The matrix remains
**42 PROVEN / 0 PARTIAL / 0 UNPROVEN**. RACE-I15 production recovery and
RACE-I16 test vocabulary corrections are now authoritative-inventory green;
the complete E4-F1 pressure-isolation chronology above is preserved. No
commit, push, tag, release, or MAC-4/5 work occurred.

**MAC-3E4 — READY FOR FINAL FOCUSED CLOSURE REREVIEW**
