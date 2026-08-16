# MAC-3E2 — Integrated FD-Pressure Verification (Gate Report)

**Verdict: `MAC-3E2 — CLOSED / LOCALLY BASELINED`** (final durable
state; historical verdicts `MAC-3E2 — READY FOR SENIOR REVIEW` →
`MAC-3E2 SENIOR REVIEW — CORRECTIONS REQUIRED` → `MAC-3E2 — READY FOR
FOCUSED REREVIEW` → `MAC-3E2 FOCUSED REREVIEW — ACCEPTED` preserved —
see the Correction Addendum at the end of this report)
**Baseline SHA:** `5e58a60d920f690ed3bc7da78676c46ffd353d2e` (verified by
`git rev-parse HEAD` — exact match; `test: establish MAC-3E1 true
concurrency verification`).
**Recovery state:** `MAC-3E — EXECUTION PAUSED FOR DECOMPOSITION`
(accepted pause report); this gate continues ONLY the fd-pressure
decomposition slice (E2) and does not restart broad MAC-3E work.
**Starting matrix:** `40 PROVEN / 2 PARTIAL / 0 UNPROVEN` (post-E1).
**Date:** host local time at gate execution
**Host:** macOS 12.6 (Darwin 21.6.0, xnu-8020.240.18.709.2), x86_64
(Intel), Node v22.23.1, Git 2.37.1 (Apple Git-137.1). Runtime evidence
is **Intel x86_64 only**.

---

## 1. Paused-execution provenance

Prior recorded evidence (pause report §5): `mac3e-fd-pressure.test.js —
3/3 pass × 2 runs`. The artifacts inspected in this gate are
byte-identical to those that produced that evidence: source
`tests/unit/mac3e-fd-pressure.test.ts` and `tests/mac3e/pressure-consumer.mjs`
both mtime 09:47, unchanged; compiled `dist-test/tests/unit/mac3e-fd-pressure.test.js`
mtime 12:46 (rebuilt by the E1 correction's test compile) — current
against the unchanged source. No recompile was required in this gate.

## 2. Owned artifacts (this gate owns ONLY these)

| Artifact | Role |
|---|---|
| `tests/mac3e/pressure-consumer.mjs` | the pressure child: bounded EMFILE induction in a SEPARATE Node process, probe of the REAL production consumer under held pressure, release of every held fd, post-release recovery run of the same consumer; line protocol `READY` → `RESULT <json>` |
| `tests/unit/mac3e-fd-pressure.test.ts` | parent coordinator: spawn/bound/kill/reap per child, parses the RESULT payload, asserts exact typed outcomes, child-side probe disposition, parent-fd-table stability |
| `docs/reports/mac-3e2-integrated-fd-pressure-verification.md` | this report |

Out of scope, present but untouched: `tests/unit/mac3e-churn.test.ts`,
`tests/runtime/mac3e-mcp-two-session.test.ts`, `.DS_Store`, the
auxiliary baseline verification worktree, and the MAC-3E1 committed
artifacts. No churn work, no MCP work, no full regression was run here.

## 3. Pressure-harness architecture (verified by inspection)

- **Isolation:** the pressure child is a separate OS process
  (`spawn(process.execPath, [pressure-consumer.mjs, fixtureDir, consumer])`);
  the parent's fd table is untouched — E2-F1: now directly
  regression-asserted (`after ≤ before + 2` on `/dev/fd`) for ALL THREE
  consumers (completion, executor, reader), not merely for the
  completion scenario.
- **Deterministic EMFILE induction:** the child opens a parent-provided
  pad file repeatedly until `open` fails with `EMFILE` (bounded by the
  process fd limit and the hard cap 100 000 — always terminates); the
  child FAILS (`emfile-not-reached`) if EMFILE is not genuinely induced
  before any consumer runs. The native addon is warmed BEFORE pressure
  (the property under test is the consumer's descriptor operation, not
  the loader).
- **Probe under pressure:** the real production consumer runs while
  every fd slot is held — completion `writeResultArtifact`, executor
  `executeDraftFileWrite`, or reader `openForRead` (root bound before
  pressure, the production composition's already-held descriptor).
- **Release + recovery:** every held fd is closed, then the SAME
  consumer runs again and must succeed — no permanent corruption, no
  descriptor leak; the child's post-release usability is further proven
  by the pad-existence sanity marker.
- **Lifecycle bounding:** parent timeout 20 s → SIGKILL; every child is
  awaited via its `close` event; zero-orphan verified after each run.
- **Evidence policy:** deliberate bounded exhaustion in an isolated
  child only; no machine-wide exhaustion; deterministic phases; no
  sleep/retry-until-win/statistical acceptance; no production fallback
  path exists or was added (fail-closed typed outcomes only).

## 4. Exact consumer outcomes (all three scenarios)

### 4.1 Completion consumer
- Probe under EMFILE: `{ok:false, code:'io-failure'}` — the accepted
  typed vocabulary; no untyped throw crosses the consumer boundary.
- Child-side probe disposition: `probeLeft === false` — NO partial
  object at the destination (observed before release/post).
- Post-release: exactly `{ok:true, outcome:'created'}`; on-disk bytes
  exactly the canonical payload.

### 4.2 Executor consumer
- Probe: `{ok:false, code:'io-failure', cleanup:'not-needed'}` — typed
  fail-closed with the TRUTHFUL cleanup disposition (nothing was
  created, so nothing needed cleaning).
- `probeLeft === false` — no partial/sibling artifact.
- Post-release: `{ok:true, outcome:'created',
  persistedByteCount: <exact>}`; on-disk bytes exactly the canonical
  payload.

### 4.3 Reader consumer (descent under pressure)
- Probe: `{ok:false, code:'error'}` — the accepted typed reader
  vocabulary mapping; no untyped throw; no pathname fallback, no
  authority widening (the pre-bound root fd is the only authority; the
  source file is byte-identical after the failed probe).
- Post-release: the same descriptor descent reads the EXACT original
  bytes.

## 5. Lifecycle evidence

All held pad fds closed (release loop, best-effort per fd); child
remains usable after release (post consumer success + sanity marker);
bounded timeout (20 s) with SIGKILL; every child awaited and reaped
(`close` handler settles every outcome; zero orphans verified via
`pgrep` after each run). Parent fd table unaffected (per-scenario
`/dev/fd` assertions).

## 6. Confirmation run (this gate)

`node --test dist-test/tests/unit/mac3e-fd-pressure.test.js` →
**3/3 pass, 0 fail, 0 cancelled**; zero `pressure-consumer.mjs` orphans
after the run. Combined with the pause-recorded 3/3 × 2, the recorded
evidence is **3 clean runs, 9/9 scenario executions, all green**.
Tests-compile not required (compiled artifact verified current against
unchanged sources). `git diff --check` clean. No neighbor or harness
rerun required (delta-free reuse of paused evidence).

## 7. Coverage decision — RACE-I14 only

The integrated controlled-EMFILE evidence directly proves the frozen
resource-pressure property (MAC-3A §5 RACE-I14, §15): under genuinely
induced EMFILE, every real production consumer fails closed with a typed
outcome inside its accepted vocabulary, creates no partial object,
performs no pathname fallback or authority widening, releases every
descriptor, and recovers exactly after pressure release — all in an
isolated child with the parent and machine untouched.

| Row | Before | After | Basis |
|---|---|---|---|
| RACE-I14 | PARTIALLY PROVEN | **PROVEN** | §4.1–4.3 integrated pressure probes + recovery + lifecycle evidence |

**Provisional matrix after E2:** **41 PROVEN / 1 PARTIAL / 0 UNPROVEN**
(42 rows). Remaining PARTIAL row: **RACE-I16** (decomposition slice E3).
No other row changed; the post-E1 RACE-I15/W-C7 statuses are preserved.

## 8. Explicit non-claims

- **Full MAC-3 closure is NOT claimed.** RACE-I16 remains PARTIALLY
  PROVEN; the MAC-3E integrated closure report does not exist.
- The churn and MCP two-session artifacts exist from the paused
  execution but were NOT run, validated, or interpreted in this gate.
- **E3/E4 = NOT STARTED** in this gate.
- Production/native/schema/MCP delta = **ZERO** (working tree shows no
  tracked modification; all deltas are new untracked test-only files).
- Native surface = **six** exports; MCP surface = **nine** tools.
- Intel x86_64 acceptance only; arm64 runtime remains deferred to MAC-5.
- No commit, no push, no tag, no release.

---

## Correction Addendum — focused report correction (E2-F1)

**Gate chronology:**

1. **initial:** `MAC-3E2 — READY FOR SENIOR REVIEW`;
2. **independent senior review:** `MAC-3E2 SENIOR REVIEW — CORRECTIONS
   REQUIRED` — one report/test finding, zero evidence or mechanism
   defects:
   - **E2-F1 (MINOR — report-claim precision / test-assertion
     coverage):** the report claimed parent-fd-table isolation for all
     consumers, but only the completion scenario directly asserted the
     `/dev/fd` stability tolerance; the executor and reader scenarios
     relied on the shared harness without the per-scenario assertion.
3. **focused correction (this gate — test + report ONLY; no production,
   native, schema, MCP, or E3 change):**
   - **E2-F1 = CLOSED.** `tests/unit/mac3e-fd-pressure.test.ts` now
     captures the parent fd count BEFORE spawning the pressure child and
     AFTER child completion/reap in BOTH the executor and the reader
     scenarios, asserting the SAME accepted tolerance
     (`after <= before + 2`, existing `fdCount()` helper, no new
     threshold, no helper-semantics change). Parent-fd stability is now
     directly regression-asserted for all three consumers: completion,
     executor, reader. Every existing assertion preserved: genuine
     EMFILE induction, exact typed probe outcome, truthful cleanup, no
     partial artifact, post-release recovery, canonical/exact bytes,
     bounded kill/reap lifecycle.

**Verification (this correction):** `tsc -p tsconfig.tests.json` exit 0
(TS source changed); `mac3e-fd-pressure.test.js` **3/3 pass, 0 fail,
0 cancelled**; zero `pressure-consumer.mjs` orphan processes after the
run (verified `pgrep`); `git diff --check` clean. No neighbor or
full-regression rerun performed (not required — the delta is confined to
the two scenarios' parent-fd assertions).

**Preserved unchanged:** RACE-I14 = PROVEN; provisional matrix = 41
PROVEN / 1 PARTIAL / 0 UNPROVEN; remaining PARTIAL = RACE-I16; full
MAC-3 closure NOT claimed; E3 artifacts
(`tests/unit/mac3e-churn.test.ts`,
`tests/runtime/mac3e-mcp-two-session.test.ts`) untouched; E3/E4 NOT
STARTED; production/native/schema/MCP delta = ZERO; native surface =
six; MCP surface = nine; Intel-only runtime evidence; nothing
committed, pushed, tagged, or released through the focused rereview
(the closure commit below is this gate's single baseline commit).

4. **focused rereview:** `MAC-3E2 FOCUSED REREVIEW — ACCEPTED` —
   E2-F1 = CLOSED; per-scenario parent-fd assertions for all three
   consumers; focused suite 3/3; zero orphans; `git diff --check`
   clean; `MAC-3E2 — READY FOR LOCAL BASELINE CLOSURE`;
5. **closure (this gate):** **`MAC-3E2 — CLOSED / LOCALLY BASELINED`**
   — exactly one local baseline commit
   `test: establish MAC-3E2 fd-pressure verification` (parent
   `5e58a60d920f690ed3bc7da78676c46ffd353d2e`); SHA recorded in the
   closure gate summary (a commit cannot contain its own SHA). The
   three authorized E2 artifacts entered the repository by this
   closure commit: `tests/mac3e/pressure-consumer.mjs`,
   `tests/unit/mac3e-fd-pressure.test.ts`, and this report.

**Closure record:** E2-F1 = CLOSED; RACE-I14 = PROVEN; provisional
matrix 41 PROVEN / 1 PARTIAL / 0 UNPROVEN; RACE-I16 remains PARTIALLY
PROVEN; full MAC-3 closure NOT claimed; E3/E4 NOT STARTED as
independent gates; production/native/schema/MCP delta = ZERO; native
surface = six; MCP surface = nine; Intel-only runtime evidence;
nothing pushed, tagged, or released. The E3 artifacts remain untracked
and untouched in the working tree; `.DS_Store` remains outside the
repository.

**MAC-3E2 — CLOSED / LOCALLY BASELINED**
