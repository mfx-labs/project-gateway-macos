# Project Gateway — Operator Runbook (WP-15 Phase 3B-B)

**Status:** Current operator-facing documentation (WP-15 Phase 3B-B).
**Applies to:** operating the local Gateway stdio MCP runtime
(`project-gateway-mcp`), the trusted local lifecycle/authority control
plane, and the WP-15 receipt/publication correlation transition.
**Source of truth:** existing committed contracts and design documents are
normative; this runbook consolidates and links, it does not re-authorize.
Where a detail exists in a linked document, the linked document governs.

Normative/design sources referenced throughout:

- WP-15 contract: `docs/reports/wp-15-pre-implementation-contract-decision.md`
  (Architecture Amendment A1; Approved Decisions 1–4; §8/§10 authority
  domains; §11 correlation ordering and partial-state pinning; §12/§13
  PUB-005 consumer correctness and supersession semantics; §16 supported
  environment; §18 authoritative release regression; §19 operations/release
  readiness).
- WP-14B operator onboarding: `docs/design/wp-14b-operator-onboarding.md`
  (tunnel launch, ChatGPT connector, config shape).
- Trusted configuration contract:
  `docs/design/trusted-workspace-and-ceiling-configuration.md` (ADR-024).
- Storage/registry contract: `docs/specs/wp-8-local-storage-registry-contract.md`
  (WP-8); ADR-028 (bootstrap locator), ADR-029 (publication locking/audit),
  ADR-030 (quarantine), ADR-031 (`docs/decisions/ADR-031-wp-8h-registry-index-rebuild.md`), ADR-035
  (retention/legal hold/deletion).
- Lifecycle/protocol: `docs/design/trusted-lifecycle-protocol.md`,
  ADR-011, ADR-012, ADR-038, ADR-040.
- Pi integration: `docs/design/pi-adapter-host-compatibility.md`,
  `docs/design/pi-guard-compatibility-and-authority-projection.md`,
  ADR-022, ADR-026, ADR-037.
- WP-15 Phase 2 report: `docs/reports/wp-15-phase-2-implementation-report.md`
  (§13–§15 partial-state model, §22 evidence).

---

## 1. Prerequisites

The exact supported/tested release lane is pinned by the WP-15 contract
§16 and the committed lane constants:

| Component | Supported lane |
|---|---|
| OS/arch | Linux x86_64 (POSIX filesystem semantics); macOS arm64 / Apple Silicon (PS-6, ADR-042) |
| Node.js | **v22.23.2** — the tested/supported lane |
| Git | 2.45.4 (pinned binary; WP-14B §2) |
| Pi | 0.83.0 — `SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1'` (`src/adapters/pi/types.ts`) |
| pi-guard | v0.1.2 verified lane (commit `7a7580cc4cbd7926797564c72269394fc29a860a`, annotated tag `v0.1.2`) |
| Host lane | closed accepted set `TRUSTED_HOST_LANE = 'linux-x86_64-posix-utf8-node22'` + `DARWIN_ARM64_HOST_LANE = 'darwin-arm64-posix-utf8-node22'` + `DARWIN_X86_64_HOST_LANE = 'darwin-x86_64-posix-utf8-node22'` (`src/trusted/host-lane.ts`; ADR-042, ADR-043) |
| Locale | UTF-8 |

**Package floor vs supported lane.** `package.json` declares
`"engines": { "node": ">=22.0.0" }`. That is a **package floor**, not the
tested/supported release lane. The supported lane is Node **v22.23.2**
exactly (contract §16). Running on any other Node version, macOS Intel,
Windows, or non-UTF-8 locales is unverified and unsupported; unknown host
lanes fail compatibility eligibility closed. macOS arm64 is an accepted
host lane (ADR-042): default case-insensitive APFS is supported (fixed
lowercase store layout; the compatibility probe records the volume's case
profile as metadata evidence, and `caseSensitive:false` alone is not a
probe failure), and cross-lane store replay fails closed.

**Pi 0.84.x is NOT release-verified.** The current local harness may run
Pi 0.84.1; that mismatch MUST NOT be used as substitute evidence for the
Pi 0.83.0 lane, and MUST NOT silently expand support (contract §16; see
`docs/releases/wp-15-release-readiness.md`).

---

## 2. Startup

### 2.0 Operator flow (`pgw`)

The independent operator CLI is `pgw` (see
`docs/specs/operator-cli-and-installer-spec.md`). End-user flow:

```text
# one-time install (standalone release installer; there is no `pgw install`)
node scripts/install.mjs project-gateway-macos-<version>-darwin-<arch>.tar.gz <sha256-sidecar>

pgw --version
pgw add <path>          # register + bootstrap a project store
pgw list                # list registered projects
pgw doctor              # read-only readiness check
pgw start               # launch the MCP stdio runtime
pgw remove <path-or-id> # deregister (store preserved)
pgw uninstall           # remove runtime, preserve registry + stores
```

Layout: runtime at `~/.local/share/project-gateway-macos/current/`, CLI link
`~/.local/bin/pgw`, registry `~/.config/project-gateway-macos/registry.json`,
state `~/.local/state/project-gateway-macos/`. The bootstrap verb (§2.8) is
invoked internally by `pgw add`; end users do not hand-run it.

### 2.1 Dependency installation

From a clean checkout of the exact commit:

```text
npm ci
```

`npm ci` is the committed install path (deterministic from
`package-lock.json`). Do not use a mutated `node_modules` from another
checkout as evidence of a clean build.

### 2.2 Build

```text
npm run build
```

`build` runs the deterministic bundle generator (`npm run generate`) and
the TypeScript compiler (`tsc -p tsconfig.json`). Generated corpus and
schema bundles under `src/generated/` are build artifacts mirrored from
committed fixtures/manifest (see `scripts/generate-bundle.mjs`); do not
hand-edit generated output. Typecheck alone: `npm run typecheck`.

### 2.3 Local MCP CLI / startup path

The Gateway ships ONE local stdio MCP CLI (WP-14B §1):

```text
project-gateway-mcp --config <file>
```

(or `node dist/runtime/mcp/cli.js --config <file>` when invoked without the
installed bin). The binary is declared in `package.json`
(`bin.project-gateway-mcp` → `./dist/runtime/mcp/cli.js`).

- `--config` is the only CLI argument; `--help` prints usage.
- **stdout is MCP protocol only.** All diagnostics go to bounded stderr.
- Startup failures (missing/invalid config, store mismatch, lane
  misconfiguration) exit nonzero with a bounded stderr diagnostic and no
  stdout output — a clean child failure for any launching tunnel
  (WP-14B §3).
- The runtime serves a closed tool vocabulary: `validate-artifact`,
  `inspect-stored-record`, `inspect-registry`, `inspect-audit-history`,
  `verify-record`, `enumerate-class`, `draft-artifact`,
  `persist-artifact`, `inspect-changes` (WP-14B §4). No
  approve/issue/activate/execute/receipt tool exists.

### 2.4 Secure tunnel / ChatGPT connector

Use the existing WP-14B onboarding flow
(`docs/design/wp-14b-operator-onboarding.md`):

- The external Secure MCP Tunnel launches the Gateway CLI as its MCP
  command (`--mcp.command "project-gateway-mcp --config ..."`), bridges
  MCP over the stdio pair, and registers it with the ChatGPT connector.
- The Gateway contains no HTTP server, no TLS endpoint, no OAuth, no
  daemon, no scheduler, no service manager, no secret store (runtime
  static guards enforce this). Tunnel/auth credentials live with the
  external tunnel/platform only and never enter Gateway configuration.
- Transport authentication is distinct from Gateway authority:
  authenticating to the tunnel grants no Gateway authority (WP-14B §6).

### 2.5 Workspace configuration

- Operator-owned startup configuration JSON (closed fields) is defined in
  WP-14B §2: `surfaces[]` with `locator`, `configurationIdentity`,
  `configurationVersion`, `workspaces[]` (`workspaceId`, `root`,
  `artifactLocation`), `gitPath`, `gitHome`, `gitTmpdir`.
- `locator` must be the directory containing the initialized trusted store
  (`store-v1/`, `config-v1/`); `configurationIdentity`/
  `configurationVersion` must match the store metadata.
- `gitPath` must be the pinned Git 2.45.4 binary; a non-conforming binary
  fails startup closed.
- `gitHome`/`gitTmpdir` are empty, operator-owned directories OUTSIDE
  every workspace root (never the operator's real home).
- Authority ceilings (global and per-workspace capability ceilings,
  numeric action limits, workspace roots, containment rules) are
  trusted-local configuration per
  `docs/design/trusted-workspace-and-ceiling-configuration.md` (ADR-024).
  Unknown workspaces and out-of-root paths fail closed. Configuration is
  secret-free (ADR-040 Decision D (`docs/decisions/ADR-040-wp-14-zero-transfer-product-boundary.md`)); `--config` file should be `chmod 600`
  operator-owned.
- Store initialization is an explicit control-plane-authorized action
  (WP-8 SRX-012); the runtime reads stores initialized elsewhere
  (`src/runtime/mcp/compose.ts`). Initialization is reachable ONLY through
  the operator-only `bootstrap` verb (§2.8). Do not hand-create the layout.

### 2.6 Pi integration

- The Pi adapter targets `SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1'`
  (see `docs/design/pi-adapter-host-compatibility.md`, ADR-022).
- Compatibility discovery is environment-gated, read-only, deterministic,
  and fails closed; unsupported host/extension lanes are denied
  eligibility.
- Pi 0.84.x is not a supported lane and must not be presented as one.

### 2.7 pi-guard integration

- pi-guard v0.1.2 is the verified lane providing the trusted projection
  interface (ADR-037; `docs/design/pi-guard-compatibility-and-authority-projection.md`).
- Modes: OFF/INSPECT/EDIT/WRITE; Bash is blocked in every active mode.
- Any other pi-guard version is unverified and fails closed at the
  compatibility boundary. Verify the loaded pi-guard extension identity
  and manifest version before operation.

### 2.8 Operator bootstrap (PS-1)

Trusted-store initialization is reachable through ONE operator-only CLI
verb (ADR-041):

```text
project-gateway-mcp bootstrap --config <file> [--output <file>]
```

- **Operator-only.** The verb is a local operator command; it never starts
  the MCP server, is not an MCP tool, is not reachable through the tunnel
  or ChatGPT, and grants no model-accessible authority. Bootstrap mode
  emits no MCP protocol data (stdout carries the resolved runtime
  configuration only).
- **Configuration.** The same closed startup document as §2.5, except
  `configurationIdentity` may be ABSENT per surface: the verb derives it
  from the validated canonical trusted configuration (WP-6). A supplied
  identity is never trusted — it must equal the derived identity or the
  verb fails closed before any storage mutation. Normal `--config` startup
  still REQUIRES a concrete identity; the permissive profile exists only
  for the bootstrap verb.
- **Trusted parent.** The `locator` directory must ALREADY exist as an
  operator-owned `0700` directory (the storage engine never creates
  parents). The operator provisions it (e.g. `mkdir -p -m 0700
  <locator>`); `pgw add` does this automatically.
- **Semantics.** Each surface is initialized through the accepted
  `initializeTrustedStore()` orchestrator: an absent store is provisioned;
  an already-initialized store is replayed verification-only (exact
  idempotent replay, zero writes); partial/foreign/unsupported-version/
  drifted/wrong-identity/wrong-mode/forbidden-root states fail closed
  with typed `ERR-STO-*` / `ERR-BOOT-*` codes and are never repaired.
  After initialization the store is independently re-verified through the
  same store-instance pipeline the runtime uses at startup.
- **Output.** `--output <file>` writes the resolved runtime configuration
  (the exact document normal `--config` startup accepts, including the
  derived identity) atomically with mode `0600`; an existing file with
  identical bytes is an idempotent no-op, any other existing content is a
  typed conflict (`ERR-BOOT-OUTPUT-CONFLICT`) and is never overwritten.
  When `--output` is omitted, the resolved document is written to stdout
  as a single JSON document (for composition). No
  provenance, action identity, capability, or brand is ever serialized.
- **Exit codes.** `0` success; `1` operational failure (config, store
  state, output); `2` malformed operands. Malformed/unknown arguments
  always fail closed.

Typical flow (what `pgw add` invokes internally):

```text
mkdir -p -m 0700 <locator>
project-gateway-mcp bootstrap --config <bootstrap-config.json> --output <runtime-config.json>
project-gateway-mcp --config <runtime-config.json>
```

---

## 3. Trust boundary (operational)

- **What ChatGPT may read/write.** Through the tunnel connector, ChatGPT
  may invoke exactly the nine closed tools of §2.3: validation, read-only
  inspection/enumeration/audit/verification, drafting, controlled
  persistence (`persist-artifact`), and changed-context inspection. All
  writes revalidate under the committed authority model at the trusted
  boundary (WP-14A/Model B); there is no generic filesystem, shell, or Git
  execution surface (WP-7 controlled reader only).
- **ChatGPT cannot approve/issue/activate its own authority.** No tool
  exists for approval, issuance, activation, execution, receipt issuance,
  or publication (WP-14B §4; ADR-002 trust/approval boundary). Receipts
  create no prospective authority (WP-15 contract §14).
- **RuntimeGrant issuance** is owned by the trusted local control plane
  (`issueRuntimeGrant`, WP-12 Slice-3A): transport-free, lock-guarded,
  revalidated under the coordination lock, with exactly one grant per
  success and zero primary records on failure. Operators invoke this
  control-plane path; ChatGPT never does.
- **TrustedReceipt issuance** is owned by the
  `trusted-receipt-producer` authority domain (WP-15 Phase 1B; contract
  §8): event-type-aware verification, outcome coverage, replay/conflict
  checks, exact write allowlist of one record class. No other domain
  issues receipts.
- **A receipt alone does not grant privileged publication authority.**
  Privileged scopes (`completion-status`, `downstream-automation`,
  `authoritative-reporting`) require the exact correlation triangle
  (contract §11/§12; Phase 2): an exact
  `result-publication-correlation` `completed` TrustedReceipt attesting
  the exact predecessor publication, referenced by an exact correlated
  successor publication, AND the exact `SupersessionRecord` binding
  predecessor → successor. Partial states (receipt durable only; successor
  durable without supersession) keep privileged consumption blocked
  (PUB-005).
- **Correlation transition** is owned by the
  `receipt-publication-correlation-producer` domain (Phase 2; contract
  §10): write allowlist is exactly successor `ResultPublicationRecord` +
  `SupersessionRecord`; the predecessor stays ordinary-review and is never
  mutated.

---

## 4. Storage

- **Trusted storage location model.** The trusted parent root comes from
  the bootstrap locator only (ADR-028); the two namespaces are derived
  fixed layouts: `<trusted-parent>/store-v1/` (records) and
  `<trusted-parent>/config-v1/` (configuration) (WP-8 §4–§5).
  **Initialization creates exactly `metadata/` and `tmp/` per namespace**
  (WP-8-C bootstrap scope; ADR-028 decision E). `records/`, `audit/`,
  `locks/` are provisioned lazily (phase-3, capability-gated) as records
  are written; `index/` and `quarantine/` are contract-reserved (WP-8
  §5.2) and are **not** created by initialization — their presence is an
  unknown entry and fails closed. Records are partitioned deterministically by
  class and identifier-derived shard. Ownership/permissions are
  deterministic: directories `0700`, files `0600`, owned by the trusted
  service UID (SRX-006/SRX-007).
- **Immutable-record expectations.** `records/` holds immutable source
  records; `index/` holds derived, rebuildable views (LAY-009; registry
  index rebuild: ADR-031). Publication is atomic (write protocol WPR): no
  partial record appears under `records/` except through atomic
  publication; a failed write cleans its partial target or reports typed
  indeterminate state (WP-14B §7). Immutable lifecycle, audit, and
  evidence classes are indefinite-retention (RNT-002); deletion of
  immutable classes is prohibited (RNT-009).
- **Backup expectations.** The product ships no backup tool; backup is
  operator-owned. There is no transactional guarantee across the two
  namespaces (no global transaction; locking is per-event/per-publication,
  contract §11).
  - What to copy together: the whole trusted parent — both `store-v1/`
    and `config-v1/` — because records reference the configuration
    identity and cross-namespace references are by identity/digest only
    (LAY-013; `configurationIdentity` must match store metadata).
  - Copy at rest (no writer running). Exclude or discard `locks/` and
    `tmp/` state; they are ephemeral. `index/` may be copied but is
    rebuildable (ADR-031).
  - **Do not** copy into a live store, and do not treat a restored copy
    as a transparent hot-swap: root identity (device/inode) is captured
    at initialization and revalidated point-of-use; a replaced store fails
    closed (SRX-010) until the trusted control plane re-establishes it
    through the authorized initialization path.
  - Never restore partial namespaces (e.g., `store-v1` without
    `config-v1`).
- **What should NOT be copied/restored together:** repository/workspace
  content, `.pi` files, tunnel credentials, and any path outside the two
  namespaces. The store must not contain repository-controlled or
  workspace-visible files (LAY-012).

---

## 5. Crash / partial failure

Committed semantics (WP-15 contract §11; Phase 2 report §13–§15; WP-8
write protocol):

- **Immutable partial states are valid durable states.** The correlation
  transition is a sequence of durable writes; a crash between steps
  leaves an immutable partial state. No rollback is performed, and an
  already-durable `TrustedReceipt` is NEVER rolled back (contract §11).
- **State A — receipt durable, successor absent.** Privileged consumption
  remains blocked (the ordinary-review predecessor carries no receipt
  correlation; PUB-005). Retry is idempotent: the correlation producer
  re-verifies, mints/publishes the successor and the supersession, and
  reports success. (Intermediate-state pinning: contract §11; Phase 2
  report §14.)
- **State B — successor durable, supersession absent.** The consumer
  rejects privileged consumption (the successor is not yet the current
  publication; `pointofuse.privileged-not-current` /
  `privileged-supersession-divergent` family). Retry discovers the exact
  durable successor, validates it completely, allocates ZERO new successor
  ids, writes ZERO duplicate successor records, publishes the exact
  missing `SupersessionRecord`, and only then reports success
  (`recovered`). Privileged consumption remains blocked until the
  supersession is durable.
- **State C/D — divergent successor / divergent supersession.** Fail
  closed with typed conflicts; no overwrite, no new ids, no
  first/latest/timestamp/enumeration winner. State E — exact successor +
  exact supersession — replays idempotently (`replayed`, zero writes).
- **What the operator should do after a retryable failure:** re-invoke
  the same correlation request with the same workspace / predecessor
  publication / receipt identifiers. The operation is replay-safe. Do NOT
  hand-edit, copy over, or delete durable records (including the
  successor); do NOT fabricate a supersession. If a typed conflict
  persists (divergent successor/supersession already durable), do not
  force; resolve through the trusted control plane. Report the typed
  failure category; the consumer continues to fail closed in the
  meantime.

---

## 6. Revocation

- **What revocation affects.** A `RevocationRecord` (written by
  `trusted-revocation-authority`) with an applicable `effective_at`
  withdraws the active authority of its target: RuntimeGrant,
  ApprovalRecord, IssuanceRecord, and — for active-publication semantics —
  `ResultPublicationRecord` (PUB-004: a revoked publication is not an
  active competitor for current consumption). Point-of-use checks apply
  revocations only to related revocable records.
- **Currentness behavior.** A revoked publication does not compete for
  currentness; a revoked grant/issuance fails point-of-use closed;
  activation prerequisites that are revoked make the activation unusable.
- **Why historical records remain immutable.** Historical fact records —
  `ValidationRecord`, `ActivationRecord`, `ExecutionOccurrenceRecord`,
  `ExecutionAttemptRecord`, `TrustedReceipt`, `SupersessionRecord`,
  `ExecutionSummaryRecord`, `MigrationRecord`,
  `AuthoritativeAuditEvent` — are never revocable. Revocation is a new
  record that changes current effect, not a mutation of history
  (contract §10: "revoke/delete historical publication" is forbidden).
- **Revocation differs from deletion.** Deletion exists only through the
  authorized retention path (WP-8 §15; ADR-035): retention policy comes
  from trusted configuration, execution produces `retention-evidence` and
  deletion audit evidence, holds suppress deletion, and immutable classes
  are never deletable under any retention action (RNT-009). No operator
  action deletes records as a substitute for revocation.

---

## 7. Troubleshooting

| Symptom | Meaning / action |
|---|---|
| MCP startup failure (nonzero exit, no stdout) | Missing/invalid `--config`, store mismatch, or lane misconfiguration; bounded stderr diagnostic. Fix config per WP-14B §2; verify `locator`/`configurationIdentity` match store metadata; verify pinned `gitPath`; do not parse stdout (protocol-only). |
| Workspace/config rejection | Unknown workspace ID, out-of-root path, ceiling violation, or config/store identity mismatch. Per `docs/design/trusted-workspace-and-ceiling-configuration.md`: unknown workspaces and out-of-root paths fail closed; ceilings only narrow. Re-check the trusted config store; never widen by editing repository files (repository files cannot grant authority). |
| Capability/currentness rejection | Point-of-use findings (`RECEIPT-CORRELATION-FAILURE`: `privileged-without-receipt`, `privileged-not-current`, `privileged-superseded`, `privileged-supersession-divergent`) mean the exact correlation triangle is not durably complete. Check the receipt (event type `result-publication-correlation`, disposition `completed`, exact bindings), the successor, and the exact `SupersessionRecord`; re-run the correlation operation (idempotent) rather than hand-editing state. |
| Corrupted/conflicting durable state | Typed fail-closed conflicts (e.g., `CORRELATION-SUCCESSOR-CONFLICT`, `CORRELATION-SUPERSESSION-CONFLICT`, divergent/multiple claimants). The consumer fails closed. Do not delete or overwrite records; use authorized recovery/quarantine paths (WP-8 quarantine: ADR-030) only through the trusted control plane. |
| Partial-state recovery | State A/B are recoverable by re-invoking the same correlation request; expect `correlated`/`recovered`/`replayed` typed outcomes (Phase 2 report §14/§18). Zero new ids on recovery; verify no duplicate successor/supersession records appeared. |
| Test/discovery failure | Default regression runs `node scripts/wp7-discovery-guard.mjs` inside `npm test`; conformance pins manifest totals. Stale `dist-test/` output produces false failures: rebuild with `npm run build && tsc -p tsconfig.tests.json` before running suites. Recorded pre-existing baseline items (superseded WP-13D E2E; the pointofuse-v2 `m-2` exports pin, remediated by Phase 3B-A) are documented and dispositioned at the closure gate (Phase 2 report §22/§23). |
| Wrong Pi version | `SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1'`; unsupported lanes fail closed at the compatibility boundary. Local Pi 0.84.1 is NOT supported evidence (contract §16). Re-verify on the supported lane before any release claim. |
| Unexpected dirty working tree / WP-13D-style local debris | Authoritative evidence is evaluated on a clean clone of the committed tree; superseded untracked debris (e.g., `src/retrospective/`, `tests/unit/wp13d-*.test.ts`) is excluded by construction and is NOT product behavior (contract §18). Verify the committed tree (`git status` on a clean clone); do not add `.gitignore` entries merely to hide debris. |

---

## 8. Known limitations

- **Process-local coordination.** The event-subject correlation lock is
  process-local (committed coordinator contract FSCR-W12-001);
  multi-process composition relies on WP-8's per-record publication lock.
  One operator process per store is the supported operating posture.
- **Exact supported environment.** Linux x86_64 / macOS arm64 (ADR-042) /
  Node v22.23.2 / Git 2.45.4 / Pi 0.83.0 / pi-guard v0.1.2 / UTF-8 only
  (contract §16; macOS Intel and Windows remain unsupported).
- **Pi 0.84.x not release-verified.** The local Pi 0.84.1 mismatch must
  not silently expand support.
- **F-R1 is optional / not implemented** (Approved Decision 3; nonblocking,
  not in the closure gate).
- **No generic filesystem/shell/Git execution MCP.** The runtime serves
  the closed nine-tool vocabulary; Git access is the controlled WP-7
  reader only.
- **External publication/deployment is outside WP-15 closure.** WP-15
  closure means RELEASE READY, not released: no push, tag, GitHub
  Release, npm publish, install, or deploy under this envelope (Approved
  Decision 4; see `docs/releases/wp-15-release-readiness.md`).
