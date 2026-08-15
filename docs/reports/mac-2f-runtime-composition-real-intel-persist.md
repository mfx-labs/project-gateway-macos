# MAC-2F — Runtime Composition + Real Intel MCP Persist (Gate Report)

**STATUS: `MAC-2F — ACCEPTED`** (independent senior review)
**CLOSURE: `MAC-2F — LOCALLY BASELINED`** (commit `test: prove real Intel MCP persist`, parent `65f1a31f08268b48080a5c1c211d54b3ed2beef2`)

**Verdict: `MAC-2F — READY FOR SENIOR REVIEW`** (historical; superseded by the closure status above)
**Claim: `REAL INTEL MCP PERSIST E2E — PASS`**
**Date:** host local time at gate execution
**Host:** macOS 12.6 (Darwin 21.6.0), x86_64 (Intel), Node v22.23.1.
**Starting SHA:** `65f1a31f08268b48080a5c1c211d54b3ed2beef2` (verified:
`feat: scope macOS Gateway product identity` — the accepted MAC-2E
baseline; tracked working tree clean; only
`docs/reports/mac-2-aborted-gate-rollback.md` untracked, the preserved
rollback record).

READ-ONLY gate with respect to production code: **zero production source
changes**. MAC-2F is an evidence/integration slice — the accepted
MAC-2B/C/D/E pieces already compose. No commit was created; nothing
pushed; MAC-2G not started.

---

## 1. Files changed (exact)

| File | Change | Class |
|---|---|---|
| `tests/runtime/mac2f-e2e.test.ts` | **NEW** — real-bootstrap real-stdio MCP persist E2E: two independent fresh-workspace runs, security-negative mini-matrix, server continuity, native-addon proof. | MAC-2F evidence |
| `tests/runtime/wp14b-e2e.test.ts` | Test-only Darwin portability port (see §2): host-resolvable Git binary; realpath-canonical fixture base. 9 insertions / 3 deletions; no assertion semantics changed. | Allowed portability (task §23) |

**No production file changed.** No `src/`, `native/`, `schemas/`, or
package-metadata diff.

## 2. wp14b port classification (task §3/§23)

The pre-existing wp14b E2E was inspected and ported only where actually
Darwin-incompatible:

1. `GIT_BIN = '/home/chef/.local/git-2.45.4/bin/git'` — Linux-only
   absolute path. Ported to a host-resolvable candidate list
   (`/usr/bin/git` → `/opt/homebrew/bin/git` → `/usr/local/bin/git` →
   `git`). Class: A (stale Linux fixture/harness assumption).
2. Fixture base `join(tmpdir(), …)` = `/var/folders/…`. On macOS `/var`
   is a symlink to `/private/var`; the WP-7 lane contract rejects
   symlink path components in HOME/TMPDIR
   (`HOME validation failed: path component is a symlink: var` —
   reproduced against the baseline). Ported to
   `realpathSync(mkdtempSync(…))` → `/private/var/folders/…`,
   production-equivalent root canonicalization. Class: A (realpath-
   canonical tmp roots — explicitly allowed).

No production check was weakened, no lexical alias accepted, no
descriptor verification bypassed, no failure converted into a skip.
wp14b now passes 4/4 on this host.

## 3. Production composition path (recovered and exercised as-is)

```
project-gateway-macos-mcp                      package.json bin →
  dist/runtime/mcp/cli.js                      src/runtime/mcp/cli.ts
├─ host gate: trustedHostLaneForPlatformArch(process.platform,
│    process.arch) → darwin-x86_64-posix-utf8-node22 (unsupported → exit 2)
├─ loadRuntimeConfig(config)                   src/runtime/mcp/config.ts
├─ composeTrustedRegistry(config, {}, hostLane)  src/runtime/mcp/compose.ts
│   per surface:
│   ├─ provenance actionIdentity = 'project-gateway-macos-mcp-bootstrap'
│   │    (in-process seeding/bootstrap provenance label)
│   ├─ createTrustedStorageBootstrapInput
│   ├─ verifyStoreInstance (store metadata/config identity re-check)
│   ├─ generation seeding (createInitializationCapability + dispose)
│   └─ inspection/drafting/persist/changes registries
│   └─ buildWorkspaceLanes                       src/runtime/mcp/lanes.ts
│       ├─ validateTrustedWorkspaceConfiguration (host lane operand)
│       ├─ initializeGitHostLane (isolated HOME/TMPDIR)
│       └─ persistLane = { configuration, resolveProspectiveDestination,
│            writeDraftFile: executeDraftFileWrite }
├─ createMcpServer(…, packageIdentity())       src/runtime/mcp/server.ts
│    identity = { name: '@project-gateway/macos-core', version: '0.1.0' }
│    nine tools registered
└─ serveStdio(() => server, …)                 SDK stdio transport
persist-artifact →
  server.ts runPersistTool → persistRegistry.persist (adapters/mcp)
  → persist lane → executeDraftFileWrite (src/writing/executor.ts)
  → src/internal/darwin-fs/adapter.ts (descentToParent, verifyParentIdentity,
    createExclusiveFile, unlinkCreated)
  → loadGatewayFs ('#gateway-native' → native/index.mjs)
  → native/darwin-x64/gateway_fs.node (F_GETPATH, openat-based seam)
  → actual APFS filesystem
```

## 4. Bootstrap/config/store construction (task §8/§9)

The E2E uses the **real operator bootstrap verb** — never hand-synthesized
digests, never internal store-init shortcuts:

`project-gateway-macos-mcp bootstrap --config <operator-profile> --output <resolved.json>`

- operator profile: `configurationIdentity` ABSENT → **derived** by the
  control-plane bootstrap action (verified: `sha-256:<64 hex>` per
  fixture; two runs derived two distinct, valid identities);
- store provisioned under the isolated locator (`store-v1`, `config-v1`);
- **persisted store metadata** (`store-v1/metadata/metadata.json`) is bound
  to `project-gateway-operator-bootstrap` (asserted in-test; the
  in-process `project-gateway-macos-mcp-bootstrap` label is NOT present
  in persisted metadata — asserted);
- the bootstrap-resolved document is the exact runtime startup config;
- runtime composition re-verifies the store instance against the derived
  identity (no bypass, no patch-after-creation, cross-lane checks active);
- the runtime binds the physical host to
  `darwin-x86_64-posix-utf8-node22`.

## 5. Real stdio session evidence (task §5/§6/§22)

Real production executable `dist/runtime/mcp/cli.js` (the `bin` target of
`project-gateway-macos-mcp`) spawned as a subprocess; real MCP session via
the official client SDK (pin 2026-07-28): initialize → tools/list →
tools/call.

- **initialize identity:** `{"name":"@project-gateway/macos-core","version":"0.1.0"}`
- **tools/list:** exactly nine:
  `validate-artifact, inspect-stored-record, inspect-registry, inspect-audit-history, verify-record, enumerate-class, draft-artifact, persist-artifact, inspect-changes`
  (asserted byte-exact in both runs; no hidden tenth tool).

## 6. Native loader proof (task §19/§20)

- The production adapter imports `#gateway-native` → `native/index.mjs`,
  whose `SUPPORTED_ADDON_LANES = ['darwin-x64','darwin-arm64']` and
  `resolveAddonPath` select `native/darwin-x64/gateway_fs.node` for this
  physical `darwin`/`x64` host (the arm64 candidate is never the active
  addon on Intel; arm64 remains MAC-5 build-only/runtime-pending);
- in-test proof: `loadGatewayFs()` returns exactly
  `createExclusiveFileAt, getPath, openDirectoryAt, openExistingFileAt,
  readDirectoryEntries, unlinkAt` — **six exports**;
- no Linux fallback anywhere in the active runtime: the writing static
  guard asserts the executor has no `/proc/self/fd/` and the adapter has
  no `/proc`, `/dev/fd`, or lexical fd-path reopen (green in this gate);
  the persist path is descriptor-bound (createExclusiveFile on the
  verified parent fd).

## 7. The persist request and verified result (task §10–§12)

Request (real public schema):

```
tools/call persist-artifact
  surfaceId: 'alpha'
  workspaceId: 'pgw:w:aaaaaaaaaaaaaaaa'
  kind: 'TaskSpec'
  content: <draft envelope — digest member removed from
           fixtures/artifacts/valid/task-minimal-genesis.json>
```

Sequence: `validate-artifact` (full envelope, valid) → `draft-artifact`
(valid; canonicalUtf8 captured) → `persist-artifact` (Model B
independent revalidation inside).

Response evidence: `transition: 'missing-to-file'`,
`artifactKind: 'TaskSpec'`,
`instanceId: pgw:i:9e74f09cf0287d6787d69e8ebddb5157`,
`revisionId: pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f`,
`digest: sha-256:b6418a37095af165a87a38affb609f42b331d80b15f7d3ed2796bf780ae1868b`
(matches `computeArtifactDigest` of the fixture).

Persisted destination (artifact-root relative):
`TaskSpec.pgw:i:9e74f09cf0287d6787d69e8ebddb5157.pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f.json`
under `<workspace>/artifacts/` (workspace root realpath-canonical).

Independent on-disk verification (never the MCP response alone):
- file exists; inside the configured workspace; correct relative destination;
- **regular file** (lstat); **mode exactly 0600**; **uid = expected
  service uid** (501 on this host);
- **bytes byte-for-byte equal** the trusted canonical bytes from the
  draft surface;
- artifact directory contains **exactly one entry** — no sibling, no
  temp/partial file leaked;
- store snapshot (`store-v1`) byte-for-byte unchanged across the whole
  session (no lifecycle/control-plane record; in-process-only
  provenance).

## 8. Security-negative mini-matrix (task §14–§17/§29)

Through the real MCP server (run-1):

1. **valid persist** → success (above).
2. **conflict** — second persist of the same revision:
   `ok:false`, `error.code: 'write-denied'` (create-only semantics; the
   persist path has no `already-exact` adoption — documented, not
   forced); pre-existing file present and byte-identical after.
3. **out-of-authority destination** — unknown workspace
   `pgw:w:ffffffffffffffff`: `ok:false`, `error.code: 'write-denied'`;
   artifact directory unchanged; no external/fallback file created.
   Unknown surface routing: `not-found`.
4. **server continuity** — after all rejections, `inspect-registry` and
   `enumerate-class` still succeed; session remains protocol-valid; the
   server exits cleanly on EOF (asserted), zero stderr bytes across the
   session.

## 9. Audit/inspection visibility (task §18)

- `inspect-registry` after persist: `recordsByClass` empty — the
  proposal is proposal data only, no lifecycle/control-plane record
  (contract-accurate);
- `inspect-changes` after persist: the persisted proposal is observable
  — git reports the untracked artifact directory
  (`changedFiles` contains `artifacts/`); asserted.
- No new inspection tool was added.

## 10. Two independent successful E2E runs (task §27)

The E2E test file executes the full positive flow twice, each from a
**fresh, independent** fixture (own realpath-canonical base, own store,
own git workspace, own derived identity — no shared state):

- `mac2f run-1` — full flow + negative matrix: **PASS**;
- `mac2f run-2` — full flow on a fresh workspace: **PASS**.

The file was additionally re-executed in full three times during the
gate (all green), giving six independent persist cycles total; every
cycle derived a distinct configuration identity and persisted to a
fresh workspace.

## 11. Cleanup evidence (task §28)

After every run: MCP child exited cleanly on EOF (asserted, 10 s bound);
stdio handles closed by the SDK; fixture base removed
(`existsSync(base) === false` asserted in-test); zero leftover
`mac2f-e2e-*` / `wp14b-e2e-*` directories under the tmp tree; zero
lingering `dist/runtime/mcp/cli.js` processes; `git status` shows no
unexpected repository artifacts (only the two intended test files +
preserved rollback report).

## 12. Unsupported-host behavior intact (task §21)

`tests/trusted/host-lane.test.ts` + `tests/runtime/identity.test.ts`
green in this gate: synthetic Linux/Windows/unknown/unsupported-arch
classification still `null` (CLI exit 2 before composition/server
startup); the two Darwin product lanes unchanged; three protocol lane
literals unchanged. No host-check redesign.

## 13. Focused verification totals (task §26)

| Suite | Result |
|---|---|
| `tests/runtime/mac2f-e2e.test.js` (new) | 3 pass / 0 fail |
| `tests/runtime/wp14b-e2e.test.js` (ported) | 4 pass / 0 fail |
| `tests/runtime/stdio.test.js` (real CLI stdio) | 10 pass / 0 fail |
| `tests/runtime/server.test.js` | 15 pass / 0 fail |
| `tests/runtime/static-guard.test.js` (nine-tool guard) | 6 pass / 0 fail |
| `tests/runtime/bootstrap.test.js` | 18 pass / 0 fail |
| `tests/runtime/identity.test.js` (MAC-2E guards) | 7 pass / 0 fail |
| `tests/trusted/host-lane.test.js` | 14 pass / 0 fail |
| **Total** | **77 pass / 0 fail** |
| `npm run build` + `tsc -p tsconfig.tests.json` | green |
| `git diff --check` | clean |

Not rerun (per gate): full reader/writing/completion suites (production
code byte-identical — zero diff), native race suites, full conformance
corpus, bootstrap-action failing tests, Pi compatibility environment
test.

## 14. Known unrelated baseline/environment issues (separated, task §24)

- `tests/unit/bootstrap-action.test.js` 19/21: pre-existing Darwin
  fixture issue (`/var` vs `/private/var` canonical spelling in
  unit-fixture tmpdirs — the same symlink-component class this gate
  ported only inside the directly-affected E2E harness). NOT fixed here;
  does not block the real E2E (which uses the production bootstrap verb
  with canonical roots).
- Real Pi compatibility test: pinned Pi 0.83.0 vs installed 0.84.1
  environment mismatch. NOT fixed; not touched; does not block MAC-2F.

No `MAC-2F — EXTERNAL/BASELINE BLOCKER` condition was reached.

## 15. Explicit statements

- **No native surface change** (six exports, byte-identical);
- **no MCP tool-surface change** (nine tools, byte-identical
  registration);
- **no production code change at all** in this slice;
- **MAC-2G not started**;
- this gate does NOT declare the entire macOS Gateway port/release
  closed — MAC-2G owns integrated MAC-2 closure.

**Claim: `REAL INTEL MCP PERSIST E2E — PASS`**
**Verdict: `MAC-2F — READY FOR SENIOR REVIEW`**
