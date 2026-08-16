# MAC-3B — Deterministic Harness Foundation + Test Accounting (Gate Report)

**Verdict: `MAC-3B — CLOSED / LOCALLY BASELINED`** (final durable
state; historical verdicts `MAC-3B — READY FOR SENIOR REVIEW` →
`MAC-3B SENIOR REVIEW — CORRECTIONS REQUIRED` → `MAC-3B FOCUSED
REREVIEW — CORRECTIONS REQUIRED` (MAC3B-F1 terminology) → `MAC-3B
FINAL FOCUSED REREVIEW — ACCEPTED` preserved — see the Correction
Addendum at the end of this report)
**Starting SHA:** `21d0f22851ac3914d994324dffdf7faae16c6e0e` (verified:
`docs: establish MAC-3 hostile-race verification contract`; tracked
working tree clean at freeze; only
`docs/reports/mac-2-aborted-gate-rollback.md` untracked, preserved).
**Accepted contract:** `MAC-3A — CLOSED / LOCALLY BASELINED`
(`docs/reports/mac-3a-hostile-race-threat-matrix-and-verification-contract.md`).
**Date:** host local time at gate execution
**Host:** macOS 12.6 (Darwin 21.6.0, xnu-8020.240.18.709.2), x86_64
(Intel), Node v22.23.1, Git 2.37.1 (Apple Git-137.1). Runtime evidence
remains **Intel x86_64 only**; no Apple Silicon runtime claim (§14).

MAC-3B owns harness foundation + test accounting ONLY. It does NOT
implement hostile race verification (MAC-3C/3D/3E own that).

---

## 1. Exact delta

| File | Change | Scope |
|---|---|---|
| `scripts/run-wp7-tests.mjs` | WP-7 accounting repair (reader 62→68; security 39→40 executed with explicit per-platform skip allowlist); strengthened skip parsing (strict ` # SKIP` marker, multiset reconciliation) | TEST-INFRA |
| `scripts/run-wp7-tests.d.mts` | type declarations for the runner's exported accounting helpers (inert at runtime) — added at focused correction (MAC3B-F1) | TEST-INFRA |
| `tests/unit/mac3b-accounting.test.ts` | durable candidate accounting regression suite (13 tests, MAC3B-F1 closure) — committed-to-delta but NOT yet Git-committed; the local baseline commit is pending MAC-3B closure | TEST-ONLY |
| `src/completion/writer.ts` | EXACTLY two new optional test-only hook members: `afterCreateConflict`, `beforeWrite` (+ seam documentation) | PRODUCTION-MODULE (hooks absent → behavior unchanged; the only authorized production-module change) |
| `tests/mac3b/child-actor.mjs` | bounded hostile pathname-churn actor (child process) | TEST-ONLY |
| `tests/mac3b/child-actor.ts` | parent coordinator (spawn/ready/budget/timeout/kill/reap, `withChildActor` no-orphan wrapper) | TEST-ONLY |
| `tests/mac3b/fd-pressure.mjs` | isolated EMFILE pressure child (pressure → probe → release → sanity) | TEST-ONLY |
| `tests/mac3b/fd-pressure.ts` | parent coordinator for the pressure child | TEST-ONLY |
| `tests/mac3b/interleave.ts` | deterministic A-type interleave helpers (`makeInterleaveClock`, `once`) — no sleeps, no retries | TEST-ONLY |
| `tests/unit/mac3b-harness.test.ts` | harness self-tests (11) | TEST-ONLY |
| `tests/unit/wp13b-completion-seams.test.ts` | seam-contract tests (10) | TEST-ONLY |
| `tests/unit/mac3b-hook-exposure.test.ts` | production non-exposure guards (7) | TEST-ONLY |
| `docs/reports/mac-3b-deterministic-harness-foundation-and-test-accounting.md` | this report | DOC |

No change to: `native/**`, reader implementation, writing-executor
behavior, MCP production surface, schemas, trusted identities, package
dependencies (Node built-ins only: `node:child_process`, `node:fs`,
`node:path`, `node:url`).

---

## 2. WP-7 exact accounting repair (MAC-2G FINDING-3)

`scripts/run-wp7-tests.mjs`:

- `EXPECTED_COUNTS` now `{ reader: 68, git: 41, fff: 26, security: 40 }`
  (was `62/41/26/39`; total 175 executed vs 168).
- New `PERMITTED_SKIPS`: an exact **per-suite × per-platform
  permitted-skip allowlist by TAP test NAME**. The security suite's three
  `/proc` process-table tests are documented Linux-only (MAC-2D lane) and
  are the ONLY permitted Darwin skips:
  1. `WP-7 git children spawned during operations are observed, then reaped`
  2. `leak-detection control: a deliberately leaked git child is detected, then cleaned up`
  3. `unrelated host git processes are ignored (ownership-aware)`
- `parseSkippedNames(stdout)`: collects the exact names of every test the
  TAP stream reports as skipped.
- `evaluateSuite(…, permittedSkips)`: enforces, with NO exactness
  weakening:
  - exact executed-test count (`s.tests === expected`);
  - `fail == cancelled == todo == 0`;
  - skip count == permitted count for the current platform;
  - the observed skipped-name set equals the permitted set **in both
    directions** — an unexpected skip FAILS, and a permitted skip that
    does not occur also FAILS (accounting drift both ways);
  - `pass == tests − skipped`; process exit 0.
- Any suite/platform absent from `PERMITTED_SKIPS` defaults to zero
  permitted skips (fail-closed). Linux semantics are NOT weakened: on
  Linux the security allowlist is empty → zero-skip enforced exactly as
  before; nothing is hardcoded as "anything on Darwin is acceptable" —
  the allowlist is name-exact.
- Runner output now reports `37/40 pass (exit 0) (3 platform-permitted
  skips)` for security on this host.

Observed on this host:

| Suite | Executed | Pass | Skipped | Result |
|---|---|---|---|---|
| reader | 68 | 68 | 0 | OK (was stale 62 expectation; now exact) |
| fff | 26 | 26 | 0 | OK |
| security | 40 | 37 | 3 (permitted, name-exact) | OK |
| git | 41 | 26 pass / 3 fail / 12 cancelled | 0 | pre-existing Linux-only `GIT_BIN` debt (`spawnSync /home/chef/.local/git-2.45.4/bin/git ENOENT`, MAC-2G §11 class 2) — **NOT owned by MAC-3B; unchanged** |

Accounting exactness is now **durable candidate regression evidence** —
committed-to-delta but NOT yet Git-committed (the local baseline commit
is pending MAC-3B closure):
`tests/unit/mac3b-accounting.test.ts` durably locks the positive and
negative behavior of the exported helpers (see Correction Addendum,
MAC3B-F1 closure) — no longer merely direct gate-time invocation.

---

## 3. The two approved completion-writer seams

Final names (as preferred by MAC-3A §11): `afterCreateConflict`,
`beforeWrite`. Added to `src/completion/writer.ts` only; exactly two NEW
members (the existing `afterRootOpen` is carried unchanged).

### `afterCreateConflict`

- **Boundary:** `createExclusiveFileWriter` returns
  `{ ok: false, code: 'exists' }` AND immediately before
  `readExistingForRecovery(...)`.
- Invoked only when present (`input.hooks?.afterCreateConflict?.()`);
- no created fd exists at this boundary (the failed create returned
  none); no recovery fd exists yet;
- hook throw → `{ ok: false, code: 'io-failure' }` via the existing
  closed writer vocabulary — NO recovery read, NO cleanup, NO unlink of
  the pre-existing target;
- parent/root ownership unchanged (the outer `finally` closes them
  exactly once as before).

### `beforeWrite`

- **Boundary:** exclusive create succeeded, created fd owned, immediately
  before the bounded write loop — INSIDE the existing created-path
  `try`/`catch`.
- Invoked only when present;
- hook throw is caught by the EXISTING created-path failure handling:
  single best-effort `cleanupCreated(parentFd, finalComponent)` (no
  parallel cleanup implementation), typed `io-failure`, inner `finally`
  closes the created fd exactly once;
- parent/root descriptors close exactly once (outer `finally`).

No third hook, no `afterRecoveryOpen`, no `afterWrite`, no arbitrary
generic callback injection, no native hooks.

---

## 4. Production non-exposure proof

New guard suite `tests/unit/mac3b-hook-exposure.test.ts` (7 guards, all
green):

1. the hook member names appear in EXACTLY the writer module plus the
   pre-existing executor seam files (`src/writing/executor.ts`,
   `src/writing/types.ts` — the accepted MAC-2B `beforeWrite`), nowhere
   else in `src/**`;
2. `schemas/**` JSON contains no hook fields;
3. production composition passes no hooks — the only production callers
   (`src/completion/index.ts`, `src/completion/run.ts`) contain no
   `hooks` reference at all (run.ts:386 calls `writeResultArtifact`
   without a hooks bag);
4. no serialization path / MCP / runtime / adapters / json / schema
   module mentions either member;
5. no test-harness vocabulary leaks into production (no `mac3b`, no
   `child-actor`, no `tests/` imports in `src/**`);
6. the native EXPORT source table in `native/src/gateway_fs.c` remains
   exactly the six accepted primitives;
7. runtime: JSON cannot carry callbacks (`JSON.parse` fields are
   data-only), and the behavioral fail-closed proof for hostile
   non-function hook values lives in the seam tests (see §6 — a
   non-callable `afterCreateConflict`/`beforeWrite` yields a typed
   `io-failure`; the pre-existing target survives / the created object is
   cleaned up respectively).

The fact that the hook TYPE lives in a production module is accepted
(MAC-3A §11). The required property — production behavior with hooks
absent is unchanged — is proven by the pre-existing completion suites
(§7: 30/30 pass, byte-identical expectations) and the absent-hook seam
tests. This gate does NOT claim "zero production source change".

---

## 5. Bounded child-actor harness

`tests/mac3b/child-actor.mjs` + `child-actor.ts`:

- separate Node child process (no worker threads; no shell anywhere —
  the parent passes data only: fixture root, budget, script name,
  optional bounded delay);
- fixture root: parent-created, must exist and be realpath-canonical
  (child refuses non-canonical spellings — mirrors the MAC-2C root rule);
- lexical containment: every script path is built from a FIXED built-in
  vocabulary and passed through a resolve + root-prefix guard; an escape
  attempt is a typed per-operation `escape-attempt-blocked`, never an
  outside write;
- fixed script set: `dir-rename-cycle`, `symlink-cycle`,
  `file-decoy-cycle`, `mixed-churn`, `escape-attempt` (containment
  probe), `pause` (timeout/kill self-test only — never evidence);
- bounded budget 1..100 000, exact iteration count, `DONE <n>` /
  `ERROR <msg>` completion protocol, `READY <pid>` startup protocol;
- bounded timeout (default 10 s) → SIGKILL → always awaited/reaped;
  `withChildActor` guarantees kill+reap in `finally` (zero orphans on
  assertion failure); bounded output capture (8 KiB, kill on overflow);
- no global HOME/workspace mutation.

## 6. Deterministic interleave helpers

`tests/mac3b/interleave.ts`:

- `makeInterleaveClock()` — records boundary names in invocation order,
  `assertExact([...])` fails on any ordering deviation, frozen `order()`;
- `once(fn)` — single-shot boundary action; first-call errors propagate
  predictably, later calls are no-ops (no retry-until-win).

Policy (MAC-3B §11): A/B evidence only; no sleeps, no race-until-success
loops, no retry windows, no statistical pass criteria. Timeouts exist
ONLY as lifecycle bounds in the child/pressure helpers and are never
synchronization evidence.

## 7. Isolated fd-pressure harness

`tests/mac3b/fd-pressure.mjs` + `fd-pressure.ts`:

- separate child process (parent fd table untouched — asserted by
  `/dev/fd` counts in the self-tests);
- deterministic phases: (1) open the parent-provided pad file until
  EMFILE (finite local limit + hard cap 100 000 → always terminates);
  (2) probe under held pressure (a further open must be EMFILE); (3)
  release every descriptor; (4) post-release sanity marker write proving
  the child remains usable;
- `RESULT preopened=N emfile=true probe=emfile sanity=ok` protocol; exit
  0 iff EMFILE reached AND sanity ok;
- bounded timeout (default 15 s), deterministic cleanup, no shell, no
  machine-wide exhaustion, no production fallback/behavior modification.
- MAC-3B proves the harness INDUCES controlled EMFILE (self-tests); it
  does not yet exercise every production consumer under pressure — that
  is MAC-3E.

## 8. Harness self-tests (11, all green)

| Proof | Test |
|---|---|
| ready handshake + exact budget protocol | `ready handshake and DONE protocol with the exact iteration count` |
| bounded mutation scripts, deterministic final states | `bounded mutation scripts leave the expected deterministic final state` |
| budget exhaustion terminates | `budget exhaustion terminates cleanly` |
| timeout kills and reaps | `timeout path kills and reaps (lifecycle bounding, not evidence)` |
| no orphan on parent assertion failure | `forced parent assertion failure leaves no orphan (finally kill+reap)` |
| fixture containment blocks escape | `fixture containment blocks escape (no outside write)` |
| fail-closed unknown script / invalid budget | `unknown script and invalid budget fail closed without a child` |
| exact interleave ordering, no timing | `interleave clock: exact deterministic ordering, no timing, no retry` |
| single-shot + predictable error propagation | `interleave once: single-shot action with predictable error propagation` |
| EMFILE induced, released, child usable, parent untouched | `fd pressure: EMFILE induced in the child, released, child usable, parent untouched` |
| reproducible isolated cycles | `fd pressure: bounded and reproducible across repeated isolated cycles` |

These are HARNESS tests, not RACE-Ixx closure evidence.

## 9. Writer seam-contract tests (10, all green)

`tests/unit/wp13b-completion-seams.test.ts`:

- `afterCreateConflict`: exact single invocation at the EEXIST boundary
  (recovery still adopts exact targets); absent hook → accepted behavior
  unchanged; throwing hook → typed `io-failure` with the pre-existing
  target byte-identical and never unlinked (exact AND conflicting
  variants); fd lifecycle clean.
- `beforeWrite`: exact single invocation after successful exclusive
  create; absent hook → accepted behavior unchanged; throwing hook →
  typed `io-failure` routed through the EXISTING single cleanup
  (created target removed, verified parent survives — truthful
  disposition, no second cleanup); fd lifecycle clean.
- hostile non-function hook values (the only shape JSON can produce)
  fail closed: `afterCreateConflict` → `io-failure`, target untouched;
  `beforeWrite` → `io-failure`, created object cleaned up.

MAC-3C's hostile name-swap/recovery matrices are NOT implemented here.

## 10. Surface preservation

| Surface | Proof | Result |
|---|---|---|
| native exactly six exports | `native/test/*.mjs` full suite + exposure guard #6 (EXPORT table scan) | 54/54 green |
| MCP exactly nine tools | `tests/runtime/static-guard.test.ts` (nine-tool guard) + `mac2f-e2e` (real session, nine tools, six exports) | green; e2e 3/3 |
| writing family (executor/controlled-write/adapter) | `executor.test.js` + `controlled-write.test.js` + `darwin-fs-adapter.test.js` | 55/55 green |
| completion family (pre-existing, hooks absent) | `wp13b-completion.test.js` + `wp13b-darwin-writer-adapter.test.js` | 30/30 green (no regression) |
| completion seams (new) | `wp13b-completion-seams.test.js` | 10/10 green |
| harness + exposure guards | `mac3b-harness.test.js` + `mac3b-hook-exposure.test.js` | 18/18 green |
| src typecheck (`npm run typecheck`) | — | exit 0 |
| tests compile (`tsc -p tsconfig.tests.json`) | — | exit 0 |
| `git diff --check` | — | clean |

Focused totals: completion 40/40 · writing family 55/55 · harness+guards
18/18 · native 54/54 · e2e 3/3 · static guards 14/14. The full 2398-test
default inventory was intentionally NOT rerun (no cross-cutting change:
no native, reader, executor-behavior, MCP, or schema modification).

## 11. Deterministic evidence policy — preserved

A/B-only remains the evidence rule. The harness enforces it by
construction: the interleave helper has no timing API; the child actor's
`pause` script exists solely to prove the lifecycle kill path; timeouts
are lifecycle bounds only. No sleep-based or retry-until-win test was
added anywhere.

## 12. Coverage matrix intentionally NOT advanced

Infrastructure availability != security evidence (MAC-3A §14 preserved):

- RACE-I15 = **UNPROVEN** (the interleave helper is ready; the ordering
  evidence and the final concurrent closure remain MAC-3C/MAC-3E work);
- W-C2 / W-C3 = **PARTIAL** (the `afterCreateConflict` seam now exists;
  the deterministic window tests are MAC-3C work);
- W-C7 = **UNPROVEN**;
- W-C8 = **UNPROVEN** (the `beforeWrite` seam now exists; the cleanup
  matrix tests are MAC-3C work);
- reader MAC-3D gaps unchanged;
- RACE-I14 final integrated pressure property NOT closed (the isolated
  pressure harness is proven; production-consumer-under-pressure evidence
  is MAC-3E work).

No RACE-Ixx/W-xx status in the MAC-3A report was modified by this gate.

## 13. Unrelated debt — preserved, not fixed

- Linux-only `GIT_BIN` git-suite debt (3 fail + 12 cancelled on this
  host; `spawnSync /home/chef/.local/git-2.45.4/bin/git ENOENT`) —
  unchanged, out of scope;
- `/var` vs `/private/var` fixture debt (82 durability failures class) —
  untouched;
- Pi 0.83.0 vs 0.84.1 environment mismatch — untouched.

## 13.1 Discovered working-tree anomaly (INFO — reported, not fabricated)

The intentionally-untracked preserved rollback report
`docs/reports/mac-2-aborted-gate-rollback.md` was **verified present at
freeze** (first `git status --porcelain` of this gate) and is **absent
at close**. Findings:

- the file was never tracked by git (no commit ever contained it), so it
  is not recoverable from the repository history;
- no command executed in this gate targets `docs/` (verified: build =
  `generate-bundle.mjs` + tsc, both docs-neutral; `clean-generated`
  removes only `dist`/`dist-test`; all test fixtures live under
  `os.tmpdir()`; `git diff --check`/`status` are read-only), and no
  script in `scripts/` or `tests/` references the file — the deletion
  cannot be attributed to any gate action;
- exactly ONE `.DS_Store` file appeared at the **repository root**,
  gate-dated (first observed in `git status --porcelain` during the
  gate; re-observed at the focused-correction freeze). The evidence is
  consistent with external GUI (Finder) activity but does not prove the
  exact actor responsible for the deletion — recorded as a
  **NON-BLOCKING ENVIRONMENTAL HYGIENE EVENT**, not a MAC-3B defect;
- its content is referenced by `mac-2g-integrated-mac-2-closure.md`
  §1/§14 and by the committed MAC-3A report §1, but is not duplicated
  anywhere in the repository.

Disposition: reported for senior disposition. If the historical report
is required again, it must be restored from the original MAC-2 gate
session source (the author's records), NOT reconstructed here —
fabricating its content would be worse than its absence. MAC-3B is
unaffected: zero production/test impact; the gate delta above is
complete and verified.

## 14. Apple Silicon boundary

All runtime evidence in this gate is Intel x86_64. The harness/seams are
architecture-independent test code, but no arm64 hostile-race or
pressure runtime acceptance is claimed. Per MAC-3A §18, MAC-5 must rerun
the architecture-relevant MAC-3 accepted suite on real arm64 hardware.

## 15. Exact claims and non-claims

**MAC-3B delivers:** exact WP-7 accounting restored (reader 68, security
40 with a name-exact per-platform skip allowlist; exactness enforced in
both directions); the two approved writer seams at the exact approved
boundaries with absent-hook behavior unchanged; a bounded, confined,
reaped child-actor harness; a deterministic interleave helper; an
isolated fd-pressure harness; self-tests proving all of the above;
non-exposure guards; surfaces unchanged (six native exports, nine MCP
tools).

**MAC-3B does NOT deliver:** any hostile attack-window test (MAC-3C),
reader/enumeration hostile tests (MAC-3D), MCP/concurrent-persist
closure (MAC-3E), any coverage-status change, any native/MCP/schema/
identity change, any dependency addition, any fix to unrelated debt.

No commit, no push, no tag, no release. Nothing was escalated: no
deterministic boundary required changing an accepted production
authority semantic; the seams are optional no-op-when-absent members on
the accepted hooks bag.

**Verdict: `MAC-3B — READY FOR SENIOR REVIEW`** (historical initial
implementation verdict)

---

## Correction Addendum — focused report correction (MAC3B-F1 / MAC3B-F2)

**Gate chronology:**

1. **initial:** `MAC-3B — READY FOR SENIOR REVIEW`;
2. **independent senior review:** `MAC-3B SENIOR REVIEW — CORRECTIONS
   REQUIRED`;
3. **focused correction** (this delta):
   - **MAC3B-F1 = CLOSED (MINOR, accounting/documentation):** the
     accounting negative behavior is now durable candidate regression
     evidence — committed-to-delta but NOT yet Git-committed (the local
     baseline commit is pending MAC-3B closure).
     New `tests/unit/mac3b-accounting.test.ts` (13 tests) locks, against
     the exported runner helpers (`evaluateSuite`, `parseSkippedNames`,
     `EXPECTED_COUNTS`, `PERMITTED_SKIPS`): manifest sanity (68/41/26/40;
     Darwin allowlist = exactly the three `/proc` tests; Linux/reader
     zero-skip); exact Darwin permitted-skip shape → PASS; unexpected
     skip → FAIL; permitted skip missing → FAIL; skip-count mismatch →
     FAIL; executed-count mismatch → FAIL; zero-skip suite → PASS;
     unexpected skip on a zero-skip suite → FAIL; and the adversarial
     TAP cases — indented/nested subtest skips still detected, duplicate
     skipped name FAILS (multiset), `#` inside a test name is not a skip
     marker, skip-without-name never masquerades as permitted,
     todo/not-ok lines never masquerade. To make the duplicate-name and
     name-less cases fail closed, the runner was strengthened (no
     weakening): `parseSkippedNames` now requires the exact ` # SKIP`
     marker after a non-empty name, and `evaluateSuite` reconciles the
     observed skip MULTISET against the permit list (a name observed
     twice can never pass as one permitted skip).
     Supporting: `scripts/run-wp7-tests.d.mts` (types for the TS
     import; inert at runtime).
   - **MAC3B-F2 = CLOSED (MINOR, documentation/hygiene):** §13.1
     corrected to the observed evidence — exactly ONE `.DS_Store` at the
     repository root, gate-dated; consistent with external GUI activity
     but not proof of the exact actor responsible for the deletion. The
     claim of two files / a `docs/reports/` location was removed.
     Disposition preserved and restated:
     **NON-BLOCKING ENVIRONMENTAL HYGIENE EVENT**; the missing rollback
     report is NOT reconstructed (restoration, if required, must come
     from the original MAC-2 session source).
4. **final terminology correction (this gate):** the standalone
   `COMMITTED` claims (delta table, §2, ledger, accounting-test file
   header) were replaced with precise wording — durable candidate
   regression evidence, committed-to-delta but NOT yet Git-committed;
   the local baseline commit is pending MAC-3B closure. Zero
   implementation change; zero test-behavior change; runner logic,
   seams, and harness untouched.
5. **final focused rereview:** `MAC-3B FINAL FOCUSED REREVIEW —
   ACCEPTED` — terminology defect CLOSED; no remaining focused defect;
   `MAC-3B — READY FOR LOCAL BASELINE CLOSURE`;
6. **closure (this gate):** **`MAC-3B — CLOSED / LOCALLY BASELINED`**
   — exactly one local baseline commit `test: establish MAC-3B
   deterministic harness foundation` (parent
   `21d0f22851ac3914d994324dffdf7faae16c6e0e`); SHA recorded in the
   closure gate summary (a commit cannot contain its own SHA). The
   candidate artifacts listed in the delta table above are committed
   to the repository by this closure commit.

**Closure record:** MAC3B-F1 = CLOSED; MAC3B-F2 = CLOSED; runner
strengthenings accepted; accounting regression suite = 13/13; harness =
11/11; exposure = 7/7; seams = 10/10; exactly two completion-writer
seams; native exports = six; MCP tools = nine; contract escalation =
NONE; MAC-3A coverage statuses unchanged; MAC-3C/D/E = NOT STARTED;
Intel runtime evidence only; rollback-report anomaly remains a
NON-BLOCKING ENVIRONMENTAL HYGIENE EVENT (not restored, not
reconstructed).

**Preserved unchanged (all accepted MAC-3B conclusions):** exactly two
completion-writer seams; production non-exposure; child-actor
containment/lifecycle; deterministic interleave policy (A/B only);
fd-pressure harness isolation; six native exports; nine MCP tools; MAC-3A
matrix statuses unchanged — RACE-I15/W-C7/W-C8 still UNPROVEN, W-C2/W-C3
still PARTIAL, RACE-I14 final closure not claimed; MAC-3C/D/E not started.

**Focused verification (this correction):** accounting 13/13 · harness
11/11 · exposure 7/7 · seams 10/10 (41/41 combined) · WP-7 runner
reader 68/68, fff 26/26, security 37/40 + 3 permitted (git = pre-existing
Linux-only debt, unchanged) · `tsc -p tsconfig.tests.json` exit 0 ·
`npm run typecheck` exit 0 · `git diff --check` clean. No broad
regression rerun performed (directly affected checks only).

**No commit; no push/tag/release. Production/native/schema/MCP changes
beyond prior MAC-3B scope: ZERO.**
