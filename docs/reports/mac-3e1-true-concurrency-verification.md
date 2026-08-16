# MAC-3E1 — True Concurrency Verification (Gate Report)

**Verdict: `MAC-3E1 — CLOSED / LOCALLY BASELINED`** (final durable
state; historical verdicts `MAC-3E1 — READY FOR SENIOR REVIEW` →
`MAC-3E1 SENIOR REVIEW — CORRECTIONS REQUIRED` → `MAC-3E1 — READY FOR
FOCUSED REREVIEW` → `MAC-3E1 FOCUSED REREVIEW — ACCEPTED` preserved —
see the Correction Addendum at the end of this report)
**Baseline SHA:** `5f6a425b50fea0018f3938a40a5b4e3b1502c5ec` (verified by
`git rev-parse HEAD` — exact match; `test: establish MAC-3D hostile
reader verification`).
**Recovery state:** `MAC-3E — EXECUTION PAUSED FOR DECOMPOSITION`
(accepted pause report; this gate continues ONLY the concurrency
decomposition slice and does not restart the broad MAC-3E execution).
**Date:** host local time at gate execution
**Host:** macOS 12.6 (Darwin 21.6.0, xnu-8020.240.18.709.2), x86_64
(Intel), Node v22.23.1, Git 2.37.1 (Apple Git-137.1). Runtime evidence
is **Intel x86_64 only**.

---

## 1. Paused-execution provenance

This gate reuses MAC-3E evidence already created before the accepted
pause. Prior recorded evidence (pause report §5):
`mac3e-concurrency.test.js — 3/3 pass × 3 runs`. The implementation
artifacts inspected in this gate are byte-identical to the ones that
produced that evidence (source `tests/unit/mac3e-concurrency.test.ts`
mtime 09:45 < compiled `dist-test/tests/unit/mac3e-concurrency.test.js`
mtime 09:49 — the compiled artifact is current; no recompile, no
rewrite).

## 2. Exact owned artifacts (this gate owns ONLY these)

| Artifact | Role | Verified |
|---|---|---|
| `tests/mac3e/race-writer.mjs` | the racer child: one REAL production write (`writeResultArtifact` / `executeDraftFileWrite`, compiled dist modules) per OS process against the shared destination | present, untracked, unchanged since the pause |
| `tests/unit/mac3e-concurrency.test.ts` | parent coordinator: N independent child processes, READY barrier, GO release, bounded timeout/kill/reap, deterministic outcome-set assertions | present, untracked, unchanged since the pause |
| `docs/reports/mac-3e1-true-concurrency-verification.md` | this report | new |

## 3. Out-of-scope MAC-3E artifacts — explicitly present but NOT owned

These remain in the working tree exactly as left by the paused
execution; this gate did NOT delete, rewrite, stage, run, or reinterpret
them:

- `tests/mac3e/pressure-consumer.mjs`
- `tests/unit/mac3e-fd-pressure.test.ts`
- `tests/unit/mac3e-churn.test.ts`
- `tests/runtime/mac3e-mcp-two-session.test.ts`
- `.DS_Store` (pre-existing hygiene event)
- `/private/tmp/mac3e-baseline-wt` (auxiliary baseline-verification
  worktree created during the paused execution; left in place, unused
  here)

No fd-pressure work, no churn work, no MCP integration work, no full
regression was run in this gate.

## 4. True-process concurrency mechanism (verified by inspection)

- Each racer is a **separate Node OS process**:
  `spawn(process.execPath, [race-writer.mjs, fixtureRoot, mode, payload, goFile])`
  — one process per payload, four processes per scenario. Independent
  process starts, independent fd tables, no shared in-process state, no
  reentrant hook simulation.
- **Barrier:** every child prints `READY <pid>` after validating the
  realpath-canonical fixture; the parent waits for ALL READY (bounded
  10 s deadline) and then writes a single `GO` file. Children poll the
  GO file with a bounded deadline (10 s, 2 ms interval) — a lifecycle
  synchronization barrier, explicitly NOT evidence; the evidence is the
  deterministic outcome-set invariant under any scheduling.
- **Exactly one production write per child:** the compiled production
  modules are imported once, then `writeResultArtifact` (completion) or
  `executeDraftFileWrite` (executor) is called exactly once against the
  shared destination. No hooks are passed (`race-writer.mjs` contains
  zero hook references — verified by inspection); no production hook or
  test seam was added for concurrency anywhere.
- **Lifecycle bounding:** per-child 15 s timeout → SIGKILL; the child's
  own GO deadline; every child is awaited via its `close` event and
  reaped (`Promise.all` over all racers). No orphan possible: the pause
  gate and this gate both verified zero leftover racer processes after
  the suite (`pgrep` empty).
- **Evidence policy:** no sleeps, no retry-until-win, no statistical
  acceptance. Every assertion is an invariant over the complete outcome
  set that must hold under ANY interleaving (at most one created; loser
  vocabulary; disk bytes; confinement).

## 5. The three concurrency scenarios (exact outcomes verified)

### 5.1 Completion — four identical concurrent payloads
- Exactly **one** `{ok:true, outcome:'created'}`.
- Exactly **three** `{ok:true, outcome:'already-exact'}` (the accepted
  exact-existing recovery adoption — each loser recovered the winner's
  exact canonical bytes).
- On-disk bytes exactly the canonical payload — no interleaving, no
  overwrite.
- Fixture base contains exactly the racer tree — no cross-root object.

### 5.2 Completion — mixed payloads (2 exact + 2 conflict)
- Exactly **one** `created` (the winner among all four).
- Every loser outcome is inside the accepted vocabulary:
  `already-exact` (only when the disk holds THAT racer's payload) or
  `exclusive-create-conflict` — per-racer consistency asserted against
  the on-disk winner.
- Disk bytes equal exactly one racer payload; no competing payload
  overwrote the winner.
- Fixture base contains exactly the racer tree — no cross-root object.

### 5.3 Executor — four identical concurrent writes
- Exactly **one** `{ok:true, outcome:'created', persistedByteCount}`
  (exact byte count; E1-F1 — the persisted byte count is now
  regression-locked, see the Correction Addendum).
- Exactly **three** `{ok:false, code:'exclusive-create-conflict',
  cleanup:'not-needed'}` — the accepted exclusive-create conflict; E1-F1
  additionally regression-locks each loser's `ok === false`, exact
  `code`, and exact `cleanup === 'not-needed'` disposition per racer.
- On-disk bytes exactly the canonical payload; the destination
  directory contains only the target (plus the test barrier GO file) —
  no sibling/partial file leaked; no cross-root object.

## 6. Confirmation run (this gate)

`node --test dist-test/tests/unit/mac3e-concurrency.test.js` →
**3/3 pass, 0 fail, 0 cancelled**; zero orphan racer processes after the
run (verified by `pgrep`). Combined with the pause-recorded 3/3 × 3, the
total recorded evidence is **4 clean runs, 12/12 scenario executions,
all green**. Directly affected completion/writing neighbors were NOT
rerun in this gate: the paused execution already recorded them green
(completion family 62/62 incl. wp13b suites + mac3c suites; writing
family 63/63) against byte-identical sources; no test state changed
since. Tests-compile/typecheck: not required (compiled artifact verified
newer than source). `git diff --check` clean.

## 7. Coverage decision — RACE-I15 and W-C7 only

The child-process evidence directly proves the frozen concurrent
same-destination property (MAC-3A §5 RACE-I15, §12 primary mechanism,
§20 planned closure): two-or-more concurrent valid creators for the same
final destination produce **at most one created object**, every loser
fails closed inside the accepted vocabulary (`already-exact` /
`exclusive-create-conflict`), never an overwrite, never adoption of a
competing payload, authority never leaves the configured root, and every
process is bounded, awaited, and reaped.

| Row | Before | After | Basis |
|---|---|---|---|
| RACE-I15 | UNPROVEN | **PROVEN** | §5.1–5.3 true OS-process races (completion + executor lanes) — the accepted §12 child-process mechanism |
| W-C7 | PARTIALLY PROVEN | **PROVEN** | §5.1/5.2 completion races (the MAC-3C reentrant evidence remains ordering-only; THIS is the concurrent closure) |

**Provisional matrix after E1:** **40 PROVEN / 2 PARTIAL / 0 UNPROVEN**
(42 rows). Remaining PARTIAL rows: **RACE-I14** and **RACE-I16**
(decomposition slices E2/E3). No reader row, no other MAC-3C/D row, and
no RACE-I14/I16 status was changed in this gate.

## 8. Explicit non-claims

- **Full MAC-3 closure is NOT claimed.** This gate closes only the
  concurrency slice; RACE-I14 (integrated fd pressure) and RACE-I16
  (integrated cross-root/churn) remain PARTIALLY PROVEN, and the
  MAC-3E integrated closure report does not exist.
- The MCP two-session artifact (`tests/runtime/mac3e-mcp-two-session.test.ts`)
  exists in the tree from the paused execution but was NOT run,
  validated, or interpreted in this gate.
- Production/native/schema/MCP delta = **ZERO** (working tree shows no
  tracked modification; all deltas are new untracked test-only files).
- Native surface = **six** exports; MCP surface = **nine** tools
  (unchanged; surface guards were run green in the paused execution).
- Runtime evidence = Intel x86_64 only; arm64 remains deferred to MAC-5.
- No commit, no push, no tag, no release.

---

## Correction Addendum — focused report correction (E1-F1)

**Gate chronology:**

1. **initial:** `MAC-3E1 — READY FOR SENIOR REVIEW`;
2. **independent senior review:** `MAC-3E1 SENIOR REVIEW — CORRECTIONS
   REQUIRED` — one report/test finding, zero evidence or mechanism
   defects:
   - **E1-F1 (MINOR — test-assertion strength / claim precision):** the
     executor 4-identical scenario filtered losers by shape instead of
     asserting each racer's exact result; the loser `cleanup`
     disposition and the winner `persistedByteCount` were observed by
     construction but not regression-locked.
3. **focused correction (this gate — test + report ONLY; no production,
   native, schema, MCP, or E2/E3 change):**
   - **E1-F1 = CLOSED.** `tests/unit/mac3e-concurrency.test.ts` executor
     scenario now asserts, per racer: winner `ok === true`,
     `outcome === 'created'`, `persistedByteCount === EXACT_BYTES.length`;
     every loser `ok === false`, `code === 'exclusive-create-conflict'`,
     `cleanup === 'not-needed'` — the exact loser cleanup disposition and
     the exact winner persisted-byte count are now REGRESSION-LOCKED, not
     merely observed. Existing assertions preserved: exactly one winner,
     exactly three losers, canonical on-disk bytes, no sibling/partial
     artifact, confinement. No new scenarios; concurrency mechanism,
     barrier, and child lifecycle logic unchanged.

**Verification (this correction):** `tsc -p tsconfig.tests.json` exit 0
(TS source changed); `mac3e-concurrency.test.js` **3/3 pass** twice
(one required run + one determinism confirmation); zero `race-writer.mjs`
orphan processes after each run (verified `pgrep`); `git diff --check`
clean. No neighbor or full-regression rerun performed (not required —
the delta is confined to the one scenario's assertions).

**Preserved unchanged:** RACE-I15 = PROVEN; W-C7 = PROVEN; provisional
matrix = 40 PROVEN / 2 PARTIAL / 0 UNPROVEN; remaining PARTIAL =
RACE-I14 + RACE-I16; full MAC-3 closure NOT claimed; E2/E3 artifacts
(`tests/mac3e/pressure-consumer.mjs`, `tests/unit/mac3e-fd-pressure.test.ts`,
`tests/unit/mac3e-churn.test.ts`, `tests/runtime/mac3e-mcp-two-session.test.ts`)
out of scope and untouched; production/native/schema/MCP delta = ZERO;
native surface = six; MCP surface = nine; Intel-only runtime evidence;
nothing committed, pushed, tagged, or released through the focused
rereview (the closure commit below is this gate's single baseline
commit).

4. **focused rereview:** `MAC-3E1 FOCUSED REREVIEW — ACCEPTED` —
   E1-F1 = CLOSED; per-racer winner/loser assertions regression-locked;
   focused suite 3/3; zero orphans; `git diff --check` clean;
   `MAC-3E1 — READY FOR LOCAL BASELINE CLOSURE`;
5. **closure (this gate):** **`MAC-3E1 — CLOSED / LOCALLY BASELINED`**
   — exactly one local baseline commit
   `test: establish MAC-3E1 true concurrency verification` (parent
   `5f6a425b50fea0018f3938a40a5b4e3b1502c5ec`); SHA recorded in the
   closure gate summary (a commit cannot contain its own SHA). The
   three authorized E1 artifacts entered the repository by this
   closure commit: `tests/mac3e/race-writer.mjs`,
   `tests/unit/mac3e-concurrency.test.ts`, and this report.

**Closure record:** E1-F1 = CLOSED; RACE-I15 = PROVEN; W-C7 = PROVEN;
provisional matrix 40 PROVEN / 2 PARTIAL / 0 UNPROVEN; RACE-I14 and
RACE-I16 remain PARTIALLY PROVEN; full MAC-3 closure NOT claimed;
E2/E3/E4 NOT STARTED as independent gates; production/native/schema/MCP
delta = ZERO; native surface = six; MCP surface = nine; Intel-only
runtime evidence; nothing pushed, tagged, or released. The E2/E3
artifacts remain untracked and untouched in the working tree; `.DS_Store`
remains outside the repository.

**MAC-3E1 — CLOSED / LOCALLY BASELINED**
