# MAC-3E3 — Cross-Root Churn + MCP Integration (Gate Report)

**Verdict: `MAC-3E3 — CLOSED / LOCALLY BASELINED`** (final durable
state; historical verdicts `MAC-3E3 — READY FOR SENIOR REVIEW` →
`MAC-3E3 SENIOR REVIEW — ACCEPTED` preserved — see the Closure Record
at the end of this report)
**Baseline SHA:** `98a66de7be7e2c04402fecd77f12c16b54a0bd4a` (resolved
from `98a66de`, verified by `git rev-parse HEAD` — exact match;
`test: establish MAC-3E2 fd-pressure verification`).
**Recovery state:** `MAC-3E — EXECUTION PAUSED FOR DECOMPOSITION`
(accepted pause report); this gate continues ONLY the cross-root/churn +
MCP integration decomposition slice (E3) and does not restart broad
MAC-3E work.
**Starting matrix:** `41 PROVEN / 1 PARTIAL / 0 UNPROVEN` (post-E2).
**Date:** host local time at gate execution
**Host:** macOS 12.6 (Darwin 21.6.0, xnu-8020.240.18.709.2), x86_64
(Intel), Node v22.23.1, Git 2.37.1 (Apple Git-137.1). Runtime evidence
is **Intel x86_64 only**.

---

## 1. Paused-execution provenance

Prior recorded evidence (pause report §5):
- `mac3e-churn.test.js — 3/3 pass × 3 runs`;
- `mac3e-mcp-two-session.test.js — 2/2 pass × 3 runs`.

The artifacts inspected in this gate are byte-identical to those that
produced that evidence: sources `tests/unit/mac3e-churn.test.ts` and
`tests/runtime/mac3e-mcp-two-session.test.ts` both mtime 09:48,
unchanged since the pause; compiled artifacts (mtime 12:58) current
against the unchanged sources. No recompile was required.

## 2. Owned artifacts (this gate owns ONLY these)

| Artifact | Role |
|---|---|
| `tests/unit/mac3e-churn.test.ts` | integrated cross-root churn: bounded hostile churn actor (the accepted MAC-3B child-process harness) mutating pathname-visible state in a SEPARATE process WHILE a real production operation runs — completion writer, writing executor (ancestor churn), reader (decoy churn) |
| `tests/runtime/mac3e-mcp-two-session.test.ts` | real MCP integration: real operator bootstrap, TWO independent stdio server sessions on the real nine-tool surface, same-destination concurrent persist, conflict/no-overwrite under active churn, unknown-workspace denial under churn, server continuity, zero stderr |
| `docs/reports/mac-3e3-cross-root-churn-mcp-integration.md` | this report |

Out of scope, present but untouched: E1/E2 committed artifacts, the
MAC-3B harness, `.DS_Store`, the auxiliary baseline verification
worktree. No fd-pressure work and no full regression was run here.

## 3. Test → RACE-I16 mapping

| Test | Mechanism | RACE-I16 evidence |
|---|---|---|
| churn-1: completion under concurrent mixed churn on sibling names | `withChildActor(mixed-churn, budget 400)` runs in a separate process WHILE `writeResultArtifact` executes | exact `created` + canonical bytes at the destination; every churn mutation confined to the fixture; the fixture base holds exactly the racer tree — authority never escapes the retained verified root |
| churn-2: executor under concurrent ancestor rename/replacement churn | `withChildActor(dir-rename-cycle, budget 400)` on the executor's descent component while `executeDraftFileWrite` runs | every outcome inside the frozen typed vocabulary (`created` / `parent-not-verified` / `missing-parent` / `parent-not-directory` / `io-failure`, truthful `cleanup`); an OUTSIDE decoy directory (separate tree) remains empty — no mutation outside the retained verified authority; fixture confined |
| churn-3: reader under concurrent file-decoy churn | `withChildActor(file-decoy-cycle, budget 400)` on the read target while `openForRead`/`readFileBytes` run | every successful read returns exactly one of the churn actor's own payloads (never bytes from anywhere else); failures are the exact typed `not-found`; fixture confined |
| mcp-1: two sessions racing one destination | two independent MCP server processes, simultaneous same-destination `persist-artifact` | exactly one created; loser inside the accepted closed vocabulary (`write-conflict` / `write-denied` — the MAC-3A §16 canonical codes); no overwrite; canonical 0600 bytes on disk; both sessions healthy afterwards |
| mcp-2: conflict/no-overwrite + unknown-workspace denial under concurrent churn | `withChildActor(mixed-churn, budget 300)` on the workspace while conflict persist and unknown-workspace persist run | conflict persist → `write-denied`, pre-existing object byte-identical; unknown workspace → `write-denied`; NO fallback/external file anywhere; server continuity + zero stderr after denial |

## 4. Cross-root/churn evidence (confirmation run this gate)

`node --test dist-test/tests/unit/mac3e-churn.test.js` →
**3/3 pass, 0 fail, 0 cancelled**. Combined with the pause-recorded
3/3 × 3, the recorded evidence is **4 clean runs, 12/12 scenario
executions, all green**. Every outcome remains inside the frozen typed
vocabulary; outside/decoy roots remain unmodified where required (the
outside decoy directory assertion in churn-2, the fixture-base
confinement walk in every scenario).

## 5. Two-session MCP evidence (confirmation run this gate)

`node --test dist-test/tests/runtime/mac3e-mcp-two-session.test.js` →
**2/2 pass, 0 fail, 0 cancelled**. Combined with the pause-recorded
2/2 × 3, the recorded evidence is **4 clean runs, 8/8 scenario
executions, all green**. Verified through the real nine-tool surface:
exactly one creation/accepted winner per race; loser inside the accepted
`write-conflict`/`write-denied` vocabulary; no overwrite; canonical 0600
bytes on disk; conflict/no-overwrite while churn is active; unknown
workspace remains denied under churn; both sessions/server remain
healthy after denial/conflict; zero stderr on both transports (session
close asserts empty stderr — no transport corruption).

**Orphan/server-process check (this gate):** after both confirmation
runs, `pgrep` finds zero leftover churn-actor children and zero MCP
server processes — every child actor and every MCP session was
awaited/reaped/closed cleanly.

## 6. Coverage decision — RACE-I16 only

The combined churn + MCP evidence directly proves the frozen
cross-root/churn property (MAC-3A §5 RACE-I16, §12/§13/§17): under
bounded hostile lexical churn across the integrated service path,
authority never escapes the configured retained root/parent; lexical
replacement cannot redirect mutation/read authority; every outcome maps
to an exact closed error/result; no cleanup occurs outside the retained
parent; and the public MCP surface carries the same confinement with
typed denial and zero side effects.

| Row | Before | After | Basis |
|---|---|---|---|
| RACE-I16 | PARTIALLY PROVEN | **PROVEN** | §3 churn-1/2/3 + mcp-1/2 (4 clean runs each suite) |

**Provisional matrix after E3:** **42 PROVEN / 0 PARTIAL / 0 UNPROVEN**
(42 rows). No other row changed; the post-E1/E2 statuses (RACE-I15,
W-C7, RACE-I14 = PROVEN) are preserved.

## 7. Explicit non-claims

- **`42/0/0` is PROVISIONAL MAC-3 evidence completeness only.** Full
  MAC-3 closure is NOT claimed: **E4 still owns the authoritative
  integrated regression + final closure** and is **NOT STARTED** in this
  gate.
- No fd-pressure work, no full regression, no neighbor rerun was
  performed here (the delta is reuse of unchanged paused artifacts).
- Production/native/schema/MCP delta = **ZERO** (working tree shows no
  tracked modification; all deltas are the two new untracked test files
  plus this report).
- Native surface = **six** exports (`native/test/surface.test.mjs`
  green, 9/9 combined with the nine-tool guard this gate); MCP surface =
  **nine** tools (`tests/runtime/static-guard.test.js` green).
- Intel x86_64 acceptance only; arm64 runtime remains deferred to MAC-5.
- No commit, no push, no tag, no release through the senior review (the
  closure commit below is this gate's single baseline commit).

---

## 8. Closure Record — accepted senior review + local baseline commit

**Gate chronology:**

1. **initial:** `MAC-3E3 — READY FOR SENIOR REVIEW`;
2. **independent senior review:** `MAC-3E3 SENIOR REVIEW — ACCEPTED` —
   zero findings; churn suite 3/3, MCP two-session suite 2/2, surface
   guards 9/9, orphan checks clean, `git diff --check` clean;
   `MAC-3E3 — READY FOR LOCAL BASELINE CLOSURE`;
3. **closure (this gate):** **`MAC-3E3 — CLOSED / LOCALLY BASELINED`**
   — exactly one local baseline commit
   `test: establish MAC-3E3 cross-root MCP verification` (parent
   `98a66de7be7e2c04402fecd77f12c16b54a0bd4a`); SHA recorded in the
   closure gate summary (a commit cannot contain its own SHA). The
   three authorized E3 artifacts entered the repository by this
   closure commit: `tests/unit/mac3e-churn.test.ts`,
   `tests/runtime/mac3e-mcp-two-session.test.ts`, and this report.

**Closure record:** senior review = ACCEPTED; RACE-I16 = PROVEN;
provisional matrix = 42 PROVEN / 0 PARTIAL / 0 UNPROVEN — provisional
MAC-3 evidence completeness only; full MAC-3 closure NOT claimed (E4
owns the authoritative integrated regression + final closure); E4 NOT
STARTED; production/native/schema/MCP delta = ZERO; native surface =
six; MCP surface = nine; Intel-only runtime evidence; nothing pushed,
tagged, or released. `.DS_Store` remains outside the repository.

**MAC-3E3 — CLOSED / LOCALLY BASELINED**
