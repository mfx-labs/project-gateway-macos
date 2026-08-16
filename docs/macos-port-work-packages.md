# macOS Port Work Packages — Project Gateway for macOS

**Status:** Accepted (MAC-0 gate).
**Contract:** `docs/macos-product-contract.md`.
**Report:** `docs/reports/mac-0-fork-baseline-and-port-contract.md`.

Dependency-ordered plan for the macOS port. Each package defines its
objective, allowed mutations, prerequisites, acceptance, focused tests,
and human/external gates. Nothing outside this plan is Gateway work;
nothing here expands into unrelated Gateway roadmap items.

```
MAC-0 → MAC-1 → MAC-2 → MAC-3 → MAC-4 ─┐
                        └─ MAC-5 ───────┴─→ MAC-6 → MAC-7
```

---

## MAC-0 — Fork baseline + contract (THIS GATE)

- **Objective:** establish the local macOS fork from the exact
  authorized source baseline `55f764290a4567a20557f1db19d2a6fb97572a97`;
  freeze the product contract and work-package plan; record the gate
  report.
- **Allowed mutations:** documentation only (`docs/macos-product-contract.md`,
  `docs/macos-port-work-packages.md`, `docs/reports/mac-0-*.md`);
  remote configuration (`upstream` → original repo, `origin` → future
  `mfx-labs/project-gateway-macos`, not created/pushed). No source
  changes.
- **Prerequisites:** source baseline verified (exact SHA, clean
  tracked state); upstream reachable; no prior fork state.
- **Acceptance:** fork repo exists locally at the exact baseline with
  full inherited history; remotes explicit; contract docs committed in
  one local commit `docs: establish macOS Gateway fork baseline`;
  nothing pushed, tagged, published, or deployed.
- **Focused tests:** repository/baseline checks only (status, identity,
  static source audit, `git diff --check`). No broad test rerun.
- **Gates:** human approval of the contract and work-package plan
  (this report).

## MAC-1 — Darwin native filesystem primitive

- **Objective:** build the narrow Darwin native Node-API boundary that
  preserves the inherited descriptor-anchored security contract:
  `openat`, `unlinkat`, `fstat`, `fcntl(F_GETPATH)` as required. The
  addon is narrow and private to the security-critical filesystem
  boundary: minimal closed export surface, no general filesystem
  authority, typed error mapping to the inherited closed vocabularies.
- **Allowed mutations:** new `native/` tree (addon source, build
  script, prebuilt output layout `native/darwin-x64/`,
  `native/darwin-arm64/`); package metadata needed to load the addon;
  tests for the addon. NO Gateway production source changes.
- **Prerequisites:** MAC-0 accepted; Node 22 toolchain; macOS SDK
  available on the build host (build-time only — never an end-user
  requirement).
- **Acceptance:** addon builds for darwin-x64 (host) and
  darwin-arm64 (cross-build candidate); addon implements
  descriptor-relative open/unlink, `F_GETPATH` resolution, and fstat
  verification; every primitive fails closed with typed codes; no
  `/proc`, no `/dev/fd` anywhere in the seam.
- **Focused tests:** native-level unit tests (openat relative to a
  retained fd; EEXIST/ENOENT/ELOOP mapping; F_GETPATH round-trip;
  unlinkat through parent fd); a fail-closed test for missing addon.
- **Gates:** human review of the addon API surface (must stay narrow).

## MAC-2 — Gateway controlled-write integration

- **Objective:** route the three production filesystem boundaries onto
  the native seam with zero contract change, and enforce the macOS
  product scope.
- **Allowed mutations:**
  - `src/writing/executor.ts` — replace `/proc/self/fd` opens and
    `readlink` resolution with native `openat`/`F_GETPATH`; every typed
    code, invariant, and cleanup path unchanged;
  - `src/completion/writer.ts` — same replacement;
  - `src/reader/fs.ts` — descriptor-relative opens and
    descriptor-bound `opendir` replacement (list-directory) via the
    seam;
  - product scope: `src/trusted/host-lane.ts` accepted set and
    `src/runtime/mcp/cli.ts` mapping become darwin-only
    (`darwin-x86_64-posix-utf8-node22`, `darwin-arm64-posix-utf8-node22`);
    Linux/Windows/unknown hosts fail closed (CLI exit 2);
  - product identity rename per contract §7 (package name, bin, server
    identity, bootstrap action identity after coupling check);
  - docs updates for changed behavior.
- **Prerequisites:** MAC-1 accepted (host x64 addon working).
- **Acceptance:** all existing executor/writer/reader unit + security
  tests pass on macOS x64 against the native seam; typed error
  vocabularies byte-identical; nine-tool MCP surface unchanged; Linux
  lane no longer accepted; package identity unambiguous.
- **Focused tests:** full `tests/writing/`, `tests/trusted/`
  containment suites, `tests/security/`, `tests/pointofuse-v2/`,
  `tests/runtime/` on the x64 host.
- **Gates:** human review of the executor/writer diffs (invariant
  checklist from contract §4 must be ticked one-for-one).

## MAC-3 — Security/race verification

- **Objective:** prove the native seam preserves the race and
  containment properties the Linux `/proc/self/fd` model provided.
- **Allowed mutations:** tests only (race/hostile coverage for the
  seam), plus fixes to the seam found by tests. No contract changes.
- **Prerequisites:** MAC-2 accepted.
- **Acceptance:** the inherited race coverage — intermediate-swap,
  root-replacement-after-anchor, symlink-at-parent, FIFO-at-destination,
  multi-component-tail rejection, cleanup-through-verified-parent —
  passes against the native seam on real hardware; hostile-symlink and
  swap tests green on x64; typed codes preserved.
- **Focused tests:** `tests/writing/executor.test.ts` race cases,
  `tests/security/`, completion writer adoption/conflict cases.
- **Gates:** human security review of race evidence; failures must be
  root-caused to the seam, never papered over.

## MAC-4 — Intel physical acceptance

- **Objective:** physical acceptance of the complete runtime on real
  macOS x86_64.
- **Allowed mutations:** test/ops evidence and documentation only;
  fixes only for defects found (no new features).
- **Prerequisites:** MAC-1, MAC-2, MAC-3 (x64 lane).
- **Acceptance:** real macOS x86_64 host; native x64 addon; real
  filesystem security tests green; real MCP persist over stdio
  (`persist-artifact` on a real workspace) green; nine-tool surface
  verified over a live MCP session.
- **Focused physical acceptance chain:** real operator `bootstrap` → optional
  public `draft-artifact` → `persist-artifact` → independent APFS
  verification → public `inspect-changes` proposal observation → public
  `inspect-registry` non-mutation check → create-only conflict /
  unknown-workspace denial → continuity / clean exit. The persisted proposal
  is an untrusted project-visible file; `inspect-changes` observes fresh
  workspace proposal state; `inspect-stored-record` and `verify-record` read
  verified store records only; `inspect-audit-history` reads audit history
  for a verified store record only. MAC-4 MUST NOT create a trusted lifecycle
  transition merely to satisfy acceptance.
- **Trusted-record sequencing:** a verified-record `verify-record` /
  `inspect-audit-history` sequence belongs to MAC-6 or another separately
  authorized trusted-lifecycle gate, not to the proposal-persist path above.
- **Focused tests:** full runtime suite + live MCP session evidence for the
  physical acceptance chain above on real APFS.
- **Gates:** human acceptance sign-off on the x64 evidence bundle.

## MAC-5 — Apple Silicon build/runtime acceptance

- **Objective:** build and physically accept the arm64 lane.
- **Allowed mutations:** arm64 build configuration, arm64-specific
  fixes, evidence documentation. No contract changes.
- **Prerequisites:** MAC-1, MAC-2, MAC-3 (arm64 addon candidate via
  cross-build); **real Apple Silicon hardware (execution dependency —
  recorded in MAC-0; if unavailable today, this package records the
  blocker and does not weaken the contract)**.
- **Acceptance:** real macOS arm64 host; native arm64 addon; real
  filesystem security tests green; real MCP persist green; store
  cross-lane replay between x64 and arm64 fails closed as designed
  (ADR-042 decision 9).
- **Focused tests:** same suites as MAC-4 on arm64 hardware; lane
  cross-replay test.
- **Gates:** human acceptance sign-off on the arm64 evidence bundle;
  blocker (hardware) acknowledged with the evidence gap recorded.

## MAC-6 — Complete macOS Gateway E2E

- **Objective:** end-to-end closure of the macOS product on both
  supported lanes.
- **Allowed mutations:** integration fixes, E2E harness, docs.
- **Prerequisites:** MAC-4 and MAC-5 accepted.
- **Acceptance:** full E2E on BOTH lanes: operator bootstrap → store
  provisioning → draft → persist → verify → audit → registry
  inspection → completion result → changed-context inspection; error
  taxonomy exercised end to end; contract §3 checklist verified
  item-by-item.
- **Focused tests:** `tests/runtime/` + scripted E2E scenario on both
  lanes; fail-closed matrix for all unsupported hosts.
- **Gates:** human acceptance of the E2E evidence bundle.

## MAC-7 — Distribution/release readiness

- **Objective:** make the macOS artifact separately releasable.
- **Allowed mutations:** packaging metadata (final binary names,
  `native/darwin-x64|arm64` layout, install-time arch selection),
  release/ops docs, version decision. No contract changes.
- **Prerequisites:** MAC-6 accepted.
- **Acceptance:** prebuilt binaries for both lanes ship in the package;
  runtime selects only the exact matching platform/architecture;
  missing/wrong-arch binaries fail closed; install requires no Xcode/
  clang/node-gyp/Python/compilation; a release candidate artifact is
  produced and verified on both lanes; release checklist (version,
  changelog, tag, publish) is documented — actual release remains a
  human decision outside this workstream's gates.
- **Focused tests:** install-from-clean on both lanes; arch-mismatch
  fail-closed test; release-candidate smoke.
- **Gates:** human release decision (this gate does NOT push, tag,
  publish, release, install, or deploy).
