# Operator CLI & Installer — Product / Implementation Specification

**Status:** Draft for human review (plan/spec only; no source changes).
**Scope:** make `Project_Gateway_MacOS` independently installable and operable
on macOS, without pi-shuttle.
**Represents the simplification of:** the pi-shuttle orchestration layer
(project registry, `runtime.json` generation, install/uninstall, `doctor`,
`start`) that previously lived outside this repository.

---

## 1. Product boundary

`Project_Gateway_MacOS` owns, and owns only:

1. installing its own runtime (via the standalone release installer);
2. exposing its own operator CLI (`pgw`);
3. maintaining a minimal project registry;
4. invoking the Gateway bootstrap already owned by Gateway;
5. launching the Gateway MCP runtime (stdio);
6. basic operational diagnostics (`doctor`);
7. uninstalling its own runtime while preserving user/project state by default.

`Project_Gateway_MacOS` does **not** own: pi-guard installation/lifecycle;
Pi package management; Pi compatibility matrices; pi-shuttle compatibility;
nested release authorities; generic package management; store-migration
frameworks; backward compatibility for pre-release state.

### Supported operator surface (closed set)

```text
pgw --version
pgw doctor
pgw add <path>
pgw list
pgw remove <path-or-id>
pgw start
pgw uninstall
```

Nothing else is added. `start` and the MCP runtime keep the existing nine-tool
surface unchanged.

---

## 2. Installation layout (fixed, per-user)

One fixed per-user root set. No env-var indirection, no multi-version tree.

| Path | Contents | Removed by `uninstall` |
|---|---|---|
| `~/.local/share/project-gateway-macos/current/` | installed runtime payload (`dist/`, `native/darwin-<arch>/gateway_fs.node`, `node_modules/`, `package.json`, `bin/pgw`, `bin/project-gateway-macos-mcp`) | **yes** (the whole `~/.local/share/project-gateway-macos/`) |
| `~/.local/bin/pgw` | symlink → `~/.local/share/project-gateway-macos/current/bin/pgw` | **yes** |
| `~/.config/project-gateway-macos/registry.json` | project registry (§5) | **no** (preserved) |
| `~/.local/state/project-gateway-macos/` | Gateway stores + Git lane dirs (§7, §9) | **no** (preserved) |

Rationale for the split: `uninstall` removes only application/runtime files and
CLI links; it preserves the registry and Gateway stores by default (§6). The
runtime root and the state root are therefore two distinct directories.

macOS-native `~/Library/Application Support` is acknowledged; the XDG-style
`~/.local/{share,state,bin}` + `~/.config` set is chosen because it is
terminal-oriented, stable, and already conventional for Node CLI tools. One
choice, no override.

---

## 3. Minimal installer

Distributed as one tarball per architecture:

```text
project-gateway-macos-<version>-darwin-<x64|arm64>.tar.gz
project-gateway-macos-<version>-darwin-<x64|arm64>.tar.gz.sha256   (one line: <hex>  <name>)
```

The tarball is the full self-contained runtime: compiled `dist/`, exactly one
`native/darwin-<arch>/gateway_fs.node`, `node_modules/`, `package.json`, and
two `bin/` entries: the operator `bin/pgw` and the internal MCP runtime
`bin/project-gateway-macos-mcp`. End users never compile, never run node-gyp, never need
Xcode/clang/Python.

Installer (`scripts/install.mjs`, standalone — there is **no** `install` CLI
command; installation is performed only by the release installer):

1. **Detect architecture** from `process.arch`:
   - `x64` → `darwin-x64`; `arm64` → `darwin-arm64`;
   - anything else → fail closed (exit 2).
2. **Select artifact** for that arch (local path given to the installer, or a
   base URL + version from which the arch-specific tarball name is derived).
3. **Verify one SHA-256 digest** for the tarball, against the sidecar
   `sha256` file (or a `--sha256 <hex>` operand). Mismatch → fail closed.
4. **Extract** the tarball to a staging dir
   `~/.local/share/project-gateway-macos/.staging-<pid>/`.
5. **Smoke-check the staging payload** (before replacing the active install):
   run `pgw --version` from the staged `bin/pgw` entry — must exit 0. A
   failing smoke check removes the staging dir and leaves the existing
   installation untouched.
6. **Replace and expose**: remove the old `current/`, rename staging →
   `current/`, then create/replace the `~/.local/bin/pgw` symlink to the
   stable target `~/.local/share/project-gateway-macos/current/bin/pgw` (the
   symlink target does not change across reinstalls; only the directory
   content is swapped).

Replacing a pre-release installation = the step-6 swap. No receipts, no
tombstones, no transactions, no keyrings, no signed channels, no updater.

### Explicitly NOT in the installer

Root key hierarchies; keyrings; signed channels; nested signed release
manifests; package-tree digests; authoritative install receipts; provenance
frameworks; updater daemons; transactional installer frameworks; multi-channel
release systems. **SHA-256 artifact verification is the entire integrity
mechanism.** Artifact signing is deferred — it is not required for the basic
installer.

---

## 4. Version reporting

`--version` prints two facts only:

- package version, read from the installed `package.json` `version` field;
- runtime platform/architecture, from `process.platform` / `process.arch`
  (e.g. `darwin x64` or `darwin arm64`).

There is no generated build-metadata subsystem and no compiled commit
descriptor. Source commit is optional diagnostic information, not a basic
capability, and is not reported.

---

## 5. Project registry

One persistent JSON file:

```text
~/.config/project-gateway-macos/registry.json
```

```json
{
  "projects": [
    { "id": "pgw:w:<32-hex>", "path": "/canonical/project/path" }
  ]
}
```

- `path` = canonical project root (`realpathSync` result).
- `id` = stable project identity derived deterministically from the canonical
  path: `"pgw:w:" + sha256(canonicalPath).slice(0,32)` (32 lowercase hex,
  matching the existing workspace-id grammar and `isValidWorkspaceId`
  semantics from `src/trusted/workspace-id.ts`).
- Written atomically (write temp + rename) and read with ordinary JSON
  parsing plus minimal structural validation. `registry.json` is locally
  generated application configuration, not hostile artifact input; the
  duplicate-key hostile JSON scanner is not reused here.

The registry persists **only** the facts needed to recover a registration.
It must not persist: release identities, digests, Git HOME identities, platform
lanes, duplicated runtime configuration, compatibility classifications, or
anything derivable from the path or Gateway store state. In particular:

- the store locator, `surfaceId`, `gitHome`/`gitTmpdir`, `gitPath`,
  `configurationIdentity`, `configurationVersion`, and `workspaceId` are all
  **derived at `start`** from `id`/`path` (§9), never persisted.

---

## 6. `add <path>`

1. Validate the path exists and is a directory; fail with a clear message
   otherwise.
2. Canonicalize it (`realpathSync`).
3. Derive `id` (§5).
4. Create the derived per-project state (all under the preserved state root):
   - store locator `~/.local/state/project-gateway-macos/<id>/store/`
     (`mkdir -m 0700`; the storage engine requires the parent to pre-exist),
   - `git-home/` and `git-tmp/` (empty, operator-owned, outside the workspace
     root — WP-7 lane contract).
5. Build a bootstrap config for this project (identity absent) and invoke the
   existing Gateway bootstrap action (`bootstrapStore` from
   `src/control-plane/storage-bootstrap-action.ts`) in-process. This provisions
   or replay-verifies the trusted store and derives `configurationIdentity`.
6. Append `{ id, path }` to the registry (idempotent: an existing `id` is a
   no-op / "already registered", not a second entry).
7. Report clear success/failure.

No new project-lifecycle model is introduced around the Gateway bootstrap.
`add` does not delete, migrate, or author anything beyond the store
initialization the Gateway already owns and the single registry entry.

---

## 7. `list`

Read the registry and print, per project: the `id` and the canonical `path`.
Nothing more.

---

## 8. `remove <path-or-id>`

Resolve `<path-or-id>` to an `id` (accept either the exact id or a canonical
path that matches a registered `path`), and remove that one registration from
the registry.

By default: **do not delete the Gateway store**, do not migrate it, and write
no revocation/tombstone metadata. The existing Gateway contract requires no
narrowly-scoped store action for correctness on removal — the store is simply
left in place (recoverable by re-`add`ing the same path, which replay-verifies
it). If a future Gateway contract changes this, the requirement is documented
at that point; nothing is invented now.

---

## 9. `start`

1. Read the registry; require ≥1 registered project (else a clear error).
2. Derive the trusted host lane once via
   `trustedHostLaneForPlatformArch(process.platform, process.arch)`; `null`
   fails closed with exit 2 before any composition.
3. For each registry entry, derive the runtime surface from `id`/`path`:
   - `surfaceId` = the 32-hex opaque of `id` (valid `SURFACE_ID_RE`),
   - `locator` = `~/.local/state/project-gateway-macos/<id>/store/`,
   - `workspaces[]` = one entry `{ workspaceId: id, root: path }`,
   - `gitPath` = `/usr/bin/git`, `gitHome`/`gitTmpdir` = the derived dirs,
   - `configurationVersion` = a fixed product constant: **version `'2'`**
     (see Version-2 operator contract below), with a deterministic
     per-workspace `artifactLocation` = `join(root, 'artifacts')` presented
     in `workspaces[]` as `{ workspaceId, root, artifactLocation }`.

**Version-2 operator contract.** The operator runtime emits a version-2
trusted workspace configuration (`CONFIGURATION_VERSION = '2'` in
`src/operator/surface.ts`) carrying a workspace-local `artifacts` artifact
location — the accepted version-2 persist convention used by
mac2f/mac3e/wp14b. This is required because
`evaluateProspectiveArtifactDestination` accepts only
`TRUSTED_CONFIGURATION_VERSION_2` (TAD-002) and `persist-artifact` requires a
configured artifact location (TAD-004). `add` provisions the `artifacts`
directory. Authority boundaries are unchanged: persistence remains
proposal-only, create-only, destination-derived, containment-bound, and
independently revalidated; the artifact directory creates no lifecycle fact.
TAD-002 is not weakened.
4. Invoke `bootstrapStore` per surface (idempotent replay — the store is
   already initialized by `add`; zero writes) to obtain the resolved
   runtime configuration including the derived `configurationIdentity`.
5. Build the runtime configuration **in memory** (never persisted as
   `runtime.json`), call `composeTrustedRegistry`, then
   `createMcpServer` + `serveStdio` exactly as
   `src/runtime/mcp/cli.ts` does today.
6. stdout is MCP protocol only; diagnostics go to bounded stderr.

**One persistent source of truth** for registered projects is the registry.
The runtime configuration is ephemeral and derived — there is no second
synchronized persistent representation. A persistent `runtime.json` would
merely duplicate the registry and is therefore not created.

---

## 10. `doctor`

Answers only: *"can this installed Gateway reasonably run now?"*

Checks (each yields PASS / WARN / FAIL):

| Check | Failure kind |
|---|---|
| installed runtime exists (executable present under install root) | FAIL |
| current macOS arch is a supported lane (`darwin-x64` / `darwin-arm64`) | FAIL |
| Node version satisfies `>=22.0.0` (Node remains a runtime dependency) | FAIL |
| Git binary present and `>=2.30.0` (reuse `initializeGitHostLane` / `satisfiesGitMinimum`) | FAIL |
| registry file readable (and parses) | FAIL |
| every registered `path` still resolves to a directory | FAIL (a missing root prevents `start`) |
| per-project store verifies read-only (`verifyStoreInstance`) | FAIL |

`doctor` is strictly read-only: it never bootstraps, initializes, repairs,
re-anchors, migrates, or mutates a store. Store readiness is probed only via
`verifyStoreInstance` (the existing read-only verification path);
`bootstrapStore` is never invoked by `doctor`.

Exit code: `0` = the current registered configuration can reasonably start;
`1` = any condition that would prevent `start` from succeeding. A registered
project root that no longer resolves is a FAIL, not a WARN, because it
immediately makes `start` fail. WARN is reserved for conditions that do not
block operation.

Explicitly **not** inspected: pi-guard internals, pi-shuttle layouts,
signed-chain state, package-tree digests, release receipts, compiled
source-commit descriptors, compatibility-promotion states, or unrelated
diagnostics.

---

## 11. pi-guard boundary

No pi-guard installer or package cache is added. pi-guard remains managed by
Pi's own package manager; at most, documentation states how a user installs
pi-guard separately. Gateway startup has no dependency on internal pi-guard
filesystem layout. The existing `./pi-adapter` library export is out of scope
for this work (it is not on the operator-flow critical path).

---

## 12. Git / environment ownership

No new Git isolation subsystem is created in the installer or operator CLI.
Git inspection and Git safety belong to Gateway (`src/git/*`, including the
empty-HOME/TMPDIR lane and fingerprint revalidation). `start` reuses the
existing Git host lane unchanged; it only supplies the derived `gitPath` /
`gitHome` / `gitTmpdir` operands the existing lane already requires.

---

## 13. APFS persistent-identity correction (storage invariant)

**Observed defect.** Persisted store metadata binds namespace/parent identity
as `{ dev, ino }` (`src/storage/metadata/store-metadata.ts`), and startup
re-verification (`verifyStoreInstance` → `verifyMetadataModel` in
`src/storage/read/read-record.ts`) re-derives live `dev`/`ino` from the
canonical path and compares them. On APFS, `st_dev` is renumbered across
reboot while `st_ino` and payload digests remain unchanged, so authentic stores
are rejected with `ERR-STO-INTEGRITY`.

**What `st_dev` was intended to protect.** Two distinct uses share the
`dev`/`ino` tuple:

1. **In-process TOCTOU / atomicity (real, load-bearing):** descriptor-bound
   pre/post read comparison (`comparePrePostStat`), publication temp-vs-final
   inode check (`publish-record.ts`), and hard-link detection. These never
   cross a reboot; `dev`/`ino` are stable for the life of an open descriptor
   and a mounted volume within one process. **These must stay.**
2. **Durable "same store object" anchor (the defective use):** the persisted
   metadata records which specific directory object was initialized, so a
   later re-open at the same path can be checked for replacement. This is the
   use that breaks on APFS because `st_dev` is not durable.

**Smallest safe correction (recommended).** A **semantic** change to durable
identity verification — no StoreMetadata schema/shape change:

- Keep serializing the existing `dev` field for now (no schema churn merely
  to delete a dormant field).
- `verifyMetadataModel` stops treating persisted `dev` as a durable
  cross-process/cross-reboot equality requirement: it drops the `dev`
  comparison while keeping the persisted `ino` comparison and every other
  containment/integrity check (canonical path, UID/mode, digests,
  `configurationIdentity`, lane, versions).
- Keep **all** in-process `dev` + `ino` descriptor checks (pre/post read,
  publication final-identity, hard-link detection, capability/lock binding)
  unchanged — they never cross a reboot and remain correct.

There is **no breaking store format, no migration, no re-anchor, no
fresh-bootstrap requirement caused by metadata shape, and no compatibility
layer**. The serialized `dev` field remains present but dormant; a later,
separate cleanup may physically remove it, outside this installer/operator
work.

**Property status after simplification:**

| Property | Before | After |
|---|---|---|
| In-process TOCTOU (read-vs-stat, publish atomicity, hard-link detection) | protected | **still fully protected** (unchanged) |
| Durable "same store object at canonical path" | protected via persisted `{dev,ino}` equality | protected via persisted `ino` equality + canonicalPath + metadata content digests + `configurationIdentity` + UID/mode (the dormant `dev` field is no longer an equality requirement) |
| Invalid cross-reboot `st_dev` equality requirement | present (causes `ERR-STO-INTEGRITY`) | **removed** |
| Store metadata format/schema | unchanged | **unchanged** (the serialized `dev` field stays; only its use as a durable equality check is dropped) |

The correction is **specified, not implemented** in this task.

---

## 14. Explicit non-goals

Rejected unless proven necessary for a basic capability above:

- signed root/keyring/channel hierarchies; nested Gateway release identities;
  package-tree digests; authoritative install receipts; release trust
  frameworks; compatibility matrices; compatibility-promotion states;
  backward compatibility for pre-release installations; store-migration
  frameworks; store re-anchor protocols; auto-repair frameworks; generic
  lifecycle engines; installer transaction frameworks; plugin systems;
  DI frameworks created solely for this work; generalized package managers;
  updater daemons; background services; multi-channel stable/beta/nightly
  infrastructure; pi-guard package shadowing; a persistent `runtime.json`;
  persistent duplicated runtime/project configuration; speculative
  abstractions.

Decision rule applied throughout: *"if this code disappeared, would a required
basic operation stop working correctly, or would a demonstrated security
property be lost?"* — if no, delete / avoid / out-of-scope it.
