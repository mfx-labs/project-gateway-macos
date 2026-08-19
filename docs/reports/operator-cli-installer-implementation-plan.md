# Operator CLI & Installer — Implementation Plan

**Status:** Draft for human approval (plan only; no source changes).
**Spec:** `docs/specs/operator-cli-and-installer-spec.md`.
**Principle:** optimize for deletion and reuse; add only the operator surface.

---

## 0. Reuse vs. deletion summary

**Already owned by Gateway and reused unchanged (KEEP):**

- `src/runtime/mcp/cli.ts` — MCP stdio runtime + `bootstrap` verb dispatch +
  host-lane fail-closed derivation. Reused by `start` (its top half is the
  template) and by `add` (bootstrap).
- `src/bootstrap/run.ts` + `src/control-plane/storage-bootstrap-action.ts` —
  `bootstrapStore` (provision/replay store, derive `configurationIdentity`).
  Reused by `add` and `start`.
- `src/runtime/mcp/config.ts` (closed validator), `compose.ts`, `lanes.ts`,
  `server.ts` — reused by `start`.
- `src/trusted/host-lane.ts` — `trustedHostLaneForPlatformArch` (darwin-only).
- `src/trusted/workspace-id.ts` — `pgw:w:` grammar used for the registry `id`.
- `src/git/*` — Git isolation (Gateway-owned; §12 of spec).
- `src/storage/*` — storage engine (bootstrap/init/read/verify).
- `native/index.mjs` + prebuilt `native/darwin-{x64,arm64}/gateway_fs.node` —
  arch selection + fail-closed addon loading; the installer ships the
  matching `.node`.
- `package.json` `bin.project-gateway-macos-mcp`, `engines.node >=22`,
  `version`, and the existing build/test scripts.

**Not copied forward (pi-shuttle orchestration):** the pi-shuttle project
registry, `runtime.json` generation, install/uninstall/`doctor`/`start`
orchestration — it lived outside this repo and is **re-implemented minimally
here**, not ported. The Gateway-side PS-1/PS-6 changes already in this repo
(bootstrap verb, host-lane parameterization) are legitimate and retained.

**Changed by this work (semantic only):** the persisted `st_dev` field stops
being a durable equality requirement (§S1). The StoreMetadata schema/shape is
unchanged.

---

## Implementation slices (dependency order)

```
S1  Storage durable-identity verification simplification
S2  Operator CLI + registry + add/list/remove + --version
S3  start + read-only doctor
S4  installer/uninstall + regression/docs
```

`S1` is independent of `S2`/`S3` but must land before them (they exercise the
store via `add`/`start`/`doctor`). `S2` is the CLI skeleton and
precedes `S3`. `S4` depends on a runnable CLI (`S2`+`S3`) and is last.

---

## S1 — Storage durable-identity verification simplification

**Objective:** stop treating persisted `st_dev` as a durable
cross-process/cross-reboot equality requirement. Semantic change only; no
StoreMetadata schema/shape change, no migration, no re-anchor, no fresh
bootstrap caused by metadata shape.

**Files (CHANGE):**
- `src/storage/metadata/store-metadata.ts` — `verifyMetadataModel` drops the
  `dev` comparison (keeps the `ino` comparison and every other containment/
  integrity check). `buildStoreMetadata` is **unchanged** — it keeps
  serializing the existing `dev` field (now dormant).

**Files (explicitly NOT changed):**
- `src/storage/metadata/store-metadata.ts` `buildStoreMetadata` — unchanged
  (the serialized `dev` field stays).
- `src/storage/root/identity.ts` — `comparePrePostStat` (in-process TOCTOU),
  unchanged.
- `src/storage/publication/publish-record.ts` — temp-vs-final inode check,
  unchanged.
- `src/storage/locks/lock.ts` — lock `storeInstance` dev/ino is in-boot only
  (liveness is pid/start-time/bootIdentity); no cross-reboot use, no change.
- `src/storage/root/resolve.ts` — `revalidateParentIdentity` runs within one
  boot; unchanged.
- `src/storage/read/read-record.ts` — `verifyStoreInstance` keeps producing
  the live `dev`/`ino` expectation; `verifyMetadataModel` now ignores `dev`.
  No functional change expected.

**Tests (reuse `node:test`, no new framework):**
- Focused regression (new): recorded `dev` != current `dev`, recorded/current
  `ino` unchanged, and all other integrity/containment checks pass
  → durable store verification **succeeds** (previously `ERR-STO-INTEGRITY`).
- No metadata payload/fixture changes (schema unchanged).
- Existing in-process TOCTOU suites (`comparePrePostStat`, publication
  final-identity) and storage read/verify suites pass unchanged.

**Acceptance gate:** a store re-verifies with a drifted `dev` (same `ino`,
same canonical path, same digests, same UID/mode); the serialized `dev` field
is still present but no longer an equality requirement; no in-process identity
check is weakened.

---

## S2 — Operator CLI + registry + `add` / `list` / `remove` + `--version`

**Objective:** the dispatch surface, the project verbs, and version reporting.

**Files (ADD):**
- `src/operator/cli.ts` — `#!/usr/bin/env node` entry; strict arg dispatch for
  the closed set (`--version`, `doctor`, `add <path>`, `list`,
  `remove <path-or-id>`, `start`, `uninstall`). **No `install` verb**
  (installation is the standalone release installer only). Exit codes 0/1/2
  matching existing conventions; `list` is the only non-MCP stdout; `start`
  stdout is MCP-only.
- `src/operator/version.ts` — `--version` reads the installed `package.json`
  `version` + `process.platform` / `process.arch`. No generated build-metadata
  module, no commit descriptor.
- `src/operator/registry.ts` — load/save/upsert/remove for
  `~/.config/project-gateway-macos/registry.json`; atomic write (temp +
  rename); ordinary `JSON.parse` + minimal structural validation. The
  duplicate-key hostile JSON scanner is **not** reused here.
- `src/operator/project-id.ts` — `id = "pgw:w:" + sha256(canonicalPath).slice(0,32)`
  (reuse `WORKSPACE_ID_PREFIX`/`isValidWorkspaceId` from
  `src/trusted/workspace-id.ts`).
- `src/operator/add.ts`, `list.ts`, `remove.ts` — thin verbs over
  `registry.ts` + the Gateway bootstrap action.

**`add` flow** (spec §6): validate + canonicalize path → derive id →
create `store`/`git-home`/`git-tmp` under the state root → build bootstrap
config (identity absent) → call `bootstrapStore` in-process → append registry
entry (idempotent).

**Reuse:** `bootstrapStore` (`src/control-plane/storage-bootstrap-action.ts`),
`createRootPathResolver` (`src/runtime/mcp/lanes.ts`),
`src/trusted/workspace-id.ts`, `node:crypto`, `realpathSync`/`statSync`.

**Tests (reuse `node:test`, no new framework):**
- `--version` prints package version + platform/arch and exits 0 without any
  store or registry present.
- `add` on a valid dir creates registry entry + store; second add is
  idempotent.
- `add` on a missing/non-directory path fails with a clear message.
- `list` prints id + canonical path; empty registry prints nothing.
- `remove <path>` and `remove <id>` remove exactly one entry;
  the store is preserved (asserted).
- registry round-trips ordinary JSON; malformed registry fails closed.

**Acceptance gate:** built operator CLI → `pgw add <path>` → `pgw list`
round-trips; the store is initialized by the existing Gateway bootstrap (not
re-invented); no new lifecycle model; no `install` verb; no `project`
namespace.

---

## S3 — `start` + read-only `doctor`

**Objective:** launch the existing MCP runtime from the registry; answer
"can this installed Gateway run now?" without ever mutating state.

**Files (ADD):**
- `src/operator/start.ts` — derive host lane → for each registry entry derive
  surface (spec §9) → `bootstrapStore` (replay) → build in-memory
  `RuntimeConfig` → `composeTrustedRegistry` → `createMcpServer` → `serveStdio`.
- `src/operator/doctor.ts` — strictly read-only checks (spec §10); store
  readiness via `verifyStoreInstance` only; **never** `bootstrapStore`.

**Reuse:** `trustedHostLaneForPlatformArch`, `bootstrapStore`,
`composeTrustedRegistry`, `createMcpServer`, `serveStdio`, `writeDiagnostic`,
`verifyStoreInstance`, `initializeGitHostLane`/`satisfiesGitMinimum`
(Git version), `process.versions.node` (Node). `start` is structurally the top
half of `src/runtime/mcp/cli.ts` with surfaces sourced from the registry
instead of a `--config` file.

**Tests:**
- `start` with one registered project serves the nine-tool MCP surface over
  stdio (subprocess handshake/EOF test, mirroring `tests/runtime/stdio.test.js`).
- `start` with multiple registered projects composes one surface per project.
- `start` with an empty registry fails closed with a clear error, no MCP data.
- `start` on an unsupported host exits 2 (reuse existing host-lane coverage).
- No `runtime.json` file is created anywhere (asserted).
- `doctor` success path (healthy install + one healthy project) → exit 0.
- `doctor` meaningful failure: missing runtime / unsupported arch / missing
  Node / missing Git / unreadable registry → exit 1.
- `doctor` missing project root → FAIL, exit 1 (it prevents `start`).
- `doctor` never mutates the store (store snapshot unchanged before/after).

**Acceptance gate:** `pgw add` then `pgw start` serves the nine tools over
stdio; `pgw doctor` exit 0 ⟺ the current registered configuration can
reasonably start; `doctor` is read-only and never writes.

---

## S4 — Installer / `uninstall` + regression/docs

**Objective:** standalone release installer + operator `uninstall` verb;
align docs; no new ADR.

**Files:**
- ADD `scripts/build-distributable.mjs` — build + `tsc`, then assemble the
  per-arch tarball (`dist/` + `native/darwin-<arch>/gateway_fs.node` +
  `node_modules/` + `package.json` + `bin/*`) and emit the `.sha256` sidecar.
- ADD `scripts/install.mjs` — the standalone release installer (spec §3 steps
  1–6): arch detect → artifact select → SHA-256 verify → staging extract →
  `pgw --version` smoke from staging → swap `current/` → symlink
  `~/.local/bin/pgw`.
- ADD `src/operator/uninstall.ts` — remove
  `~/.local/share/project-gateway-macos/` and the
  `~/.local/bin/pgw` symlink; preserve the registry and the
  state root; print what was preserved; no tombstones/records.
- MODIFY `package.json` — add `bin.pgw` →
  `./dist/operator/cli.js`.
- MODIFY `docs/operations/project-gateway-operator-runbook.md` — replace the
  "pi-shuttle `project add`" references and the bootstrap-as-subprocess framing
  with the operator CLI; document install/uninstall/doctor/add/list/remove/start
  verbs and the layout.
- MODIFY `docs/macos-port-work-packages.md` — close MAC-7 against this plan
  (or add a pointer).

**No new ADR.** The accepted spec is the design decision record; the decision
is not duplicated into spec + plan + ADR.

**Reuse:** prebuilt native binaries (already tracked), existing build pipeline,
`node:crypto` sha256, `native/index.mjs` arch semantics (the installer detects
arch identically to `SUPPORTED_ADDON_LANES`).

**Tests:**
- installer produces a runnable installation (staging `pgw --version` smoke
  exits 0; `pgw start`/`pgw doctor` reachable).
- arch mismatch (wrong tarball) fails closed; digest mismatch fails closed.
- uninstall removes runtime files + CLI link; registry and store dirs survive.
- reinstall replaces an existing install (old `current/` gone, new one runs).

**Acceptance gate:** standalone installer → `pgw add <path>` → `pgw list` →
`pgw start` completes on a clean user account with only Node 22 + Git
preinstalled; `pgw uninstall` leaves registry + stores intact; the existing
nine-tool and storage static-guard suites pass unchanged.

---

## Verification lanes

- **x64:** physical runtime acceptance on the available macOS Intel x86_64
  host (required).
- **arm64:** the existing packaging/native-loader/cross-architecture evidence
  only — the tracked prebuilt `native/darwin-arm64/gateway_fs.node`, the
  `native/index.mjs` arm64 resolution, and the cross-build candidate. Physical
  arm64 acceptance is **not** required unless real arm64 hardware is actually
  available; no emulation or additional infrastructure is introduced to claim
  it.

---

## Simplification table

| Item | Classification | Justification (basic capability) |
|---|---|---|
| MCP runtime CLI (`src/runtime/mcp/cli.ts`) + `bootstrap` verb | KEEP | `start` launches the MCP runtime; `add` needs bootstrap. |
| `src/bootstrap/run.ts` + `src/control-plane/storage-bootstrap-action.ts` | KEEP | `add`/`start` provision/replay the store and derive identity. |
| `src/runtime/mcp/{config,compose,lanes,server}.ts` | KEEP | `start` composes the nine-tool server. |
| `src/trusted/host-lane.ts`, `workspace-id.ts` | KEEP | arch/lane detection; registry id grammar. |
| `src/git/*` | MOVE/LEAVE IN GATEWAY | Git isolation is Gateway-owned (spec §12); reused, not duplicated. |
| `src/storage/*` engine | KEEP | store bootstrap/read/verify required by add/start/doctor. |
| `native/*` + prebuilt `.node` | KEEP | runtime filesystem boundary; installer ships the matching arch. |
| In-process `dev`/`ino` checks (`comparePrePostStat`, publish final-identity, hard-link detection) | KEEP | real TOCTOU/atomicity security property. |
| Persisted `st_dev` as a durable equality requirement | DELETE | invalid across APFS reboot; causes `ERR-STO-INTEGRITY`; not a demonstrated security property. The serialized field stays (dormant). |
| Operator CLI `src/operator/*` (`--version`, doctor, add/list/remove, start, uninstall) | ADD | the product surface itself. No `install` verb; no `project` namespace. |
| Project registry (`~/.config/.../registry.json`) | ADD | one persistent source of truth for registrations. |
| Standalone release installer + `uninstall` | ADD | install/uninstall capability. |
| pi-shuttle orchestration (registry, runtime.json, install/uninstall/doctor/start) | DELETE (do not port) | external layer; re-implemented minimally here. |
| Persistent `runtime.json` | DELETE (never add) | would duplicate the registry (spec §9). |
| Generated build-metadata module / commit descriptor | DELETE (never add) | `--version` reads `package.json` + `process.platform`/`process.arch`. |
| New ADR for this change | DELETE (never add) | the spec is the decision record; no governance rule requires an ADR. |
| Linux lane as current-host lane | DEFER | already fails closed at the operator boundary; removing the protocol-recognized value is a storage/protocol change not required for basic operation. |
| pi-adapter (`src/adapters/pi/**`), completion/execution/receipt/pointofuse subsystems | DEFER | not on the operator-flow critical path; optional later cleanup, not required for installability. |
| Artifact signing / keyring / channels / receipts / updater / transactions | DEFER (rejected) | SHA-256 suffices for the basic installer; none required by a basic capability. |

---

## Final assessment

- **Estimated net architectural complexity:** **DECREASE**.
- **Principal sources of complexity removed:** the pi-shuttle orchestration
  layer collapses into one thin operator CLI over existing Gateway code; the
  persisted `st_dev` equality requirement is dropped semantically (no schema
  change, no migration, no re-anchor); the generated build-metadata subsystem
  and the new ADR are removed.
- **Remaining decisions that truly block implementation:** none. (Minor
  non-blocking choices: exact `configurationVersion` constant value; exact
  `surfaceId` token spelling — both specified with a default and trivially
  settled at implementation.)
- **Final verdict:** **READY FOR HUMAN APPROVAL.**
