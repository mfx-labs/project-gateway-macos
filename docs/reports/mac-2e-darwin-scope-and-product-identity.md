# MAC-2E — Darwin-Only Scope + Product Identity (Gate Report)

**Verdict: `MAC-2E — READY FOR SENIOR REVIEW`** (historical implementation verdict — see Durable status below)
**Date:** host local time at gate execution
**Host:** macOS (Darwin), x86_64 (Intel), Node v22.23.1.
**Starting SHA:** `82096dcde6e3655cd667defbd6dccc6d78fe9c87` (verified:
`feat: integrate Darwin reader` — the accepted MAC-2D baseline; tracked
working tree clean; only `docs/reports/mac-2-aborted-gate-rollback.md`
untracked, the intentionally preserved rollback record, untouched).

## Durable status (MAC-2E FINDING-1 closure)

**Verdict: `MAC-2E — ACCEPTED`** · **Closure: `MAC-2E — LOCALLY
BASELINED`**

Full gate chain preserved:
1. implementation — `MAC-2E — READY FOR SENIOR REVIEW`;
2. senior review — `MAC-2E SENIOR REVIEW — CORRECTIONS REQUIRED`
   (FINDING-1, MODERATE, documentation: Node-lane enforcement
   overclaim);
3. FINDING-1 correction (this addendum) — `MAC-2E FINDING-1 —
   CLOSED`;
4. focused rereview — ACCEPTED;
5. local baseline closure — one commit `feat: scope macOS Gateway
   product identity` (parent `82096dcde6e3655cd667defbd6dccc6d78fe9c87`).

FINDING-1 was documentation/comment-only: report §4 and the
`src/trusted/host-lane.ts` docstring no longer claim that an
incompatible Node lane causes `trustedHostLaneForPlatformArch` → null
or startup exit 2. No Node runtime-version policy was added: the
current-host derivation consumes `process.platform` + `process.arch`
only; the `node22` suffix remains the inherited frozen opaque protocol
label (PS-6R). Executable code in `src/trusted/host-lane.ts` is
byte-identical to the reviewed state (zero executable diff introduced
by the correction; host-lane + identity tests 21/21 green, `git diff
--check` clean, build/typecheck green).

Recorded explicitly:
- product host acceptance remains exactly Darwin x64 + arm64 only;
- protocol lane vocabulary remains three lanes, unchanged;
- baseline `tests/unit/bootstrap-action.test.js` 19/21 issue (Darwin
  `/private/var` tmpdir canonicalization) remains pre-existing / out of
  scope;
- Pi test-environment mismatch (pinned 0.83.0 vs installed 0.84.1)
  remains pre-existing / out of scope;
- filesystem/native port unchanged; native surface remains six;
- MAC-2F not started;
- `persist-artifact` not product-E2E claimed fixed.

READ-ONLY gate with respect to the filesystem/native port: no native C,
no native exports, no reader, no writing executor, no completion writer,
no schemas, no store layout, no protocol vocabulary was modified. No
commit was created; nothing pushed; MAC-2F not started.

---

## 1. Files changed (exact)

### Production source
| File | Change |
|---|---|
| `src/trusted/host-lane.ts` | Product host acceptance narrowed: `trustedHostLaneForPlatformArch` no longer maps `linux + x64`; the two Darwin mappings byte-identical. Constants, `TrustedHostLane` type, `ACCEPTED_HOST_LANES`, `isSupportedHostLane` byte-identical (protocol vocabulary untouched). Docs updated to separate PROTOCOL-RECOGNIZED lanes (3) from PRODUCT-SUPPORTED current-host lanes (2). |
| `src/runtime/mcp/cli.ts` | Branding: header, `USAGE`, `packageIdentity()` fallbacks, unsupported-host diagnostic (`supported: darwin-arm64, darwin-x86_64`); exit-2 wiring unchanged in position (host check still precedes config load, composition, server startup). |
| `src/runtime/mcp/compose.ts` | ONLY `BOOTSTRAP_ACTION_IDENTITY` → `project-gateway-macos-mcp-bootstrap`. Nothing else (default lane operand, composition flow unchanged). |
| `src/runtime/mcp/diagnostics.ts` | stderr prefix → `project-gateway-macos-mcp:`. |
| `src/bootstrap/run.ts` | Bootstrap usage text + header doc references. |
| `src/control-plane/storage-bootstrap-action.ts` | One doc comment referencing the renamed CLI verb; `CONTROL_PLANE_BOOTSTRAP_ACTION_IDENTITY = 'project-gateway-operator-bootstrap'` byte-unchanged. |
| `src/index.ts`, `src/trusted/index.ts`, `src/loading/index.ts`, `src/adapters/mcp/index.ts`, `src/adapters/pi/index.ts` | One-line module-family header doc comments (`@project-gateway/macos-core/...`); zero code. |
| `package.json` | `name` → `@project-gateway/macos-core`; `bin` key → `project-gateway-macos-mcp` (single entry, no retained alias). All other metadata preserved. |
| `package-lock.json` | Only the three mechanically mirrored fields: root `name`, `packages[""].name`, `packages[""].bin` key. No dependency/version/normalization changes. |
| `scripts/clean-generated.mjs` | `EXPECTED_PACKAGE_NAME` anchor → `@project-gateway/macos-core` (mechanically required: `npm run clean:generated` verifies the package name before removing `dist/`). |

### Tests
| File | Change |
|---|---|
| `tests/trusted/host-lane.test.ts` | Product-scope mapping test rewritten (Linux/Windows/unknown/unsupported-arch → `null`; the two Darwin lanes accepted); real-host classification test added; protocol-level lane tests unchanged. |
| `tests/runtime/identity.test.ts` | **NEW** — static + behavioral identity guards and trusted-config digest regression (7 tests). |
| `tests/runtime/static-guard.test.ts` | Bin assertion → `project-gateway-macos-mcp` (nine-tool guard itself unchanged and green). |
| `tests/runtime/stdio.test.ts` | Server identity assertion → `@project-gateway/macos-core`; 4× diagnostic-prefix assertions → `project-gateway-macos-mcp:`. |
| `tests/runtime/bootstrap.test.ts`, `tests/runtime/wp14b-e2e.test.ts`, `tests/unit/bootstrap-static-guard.test.ts` | Header doc references to the CLI verb. |
| `tests/pi-adapter/compatibility/harness.test.ts` | F8 subpath-block guard literals → `@project-gateway/macos-core/...` (the assertion targets this package's exports map; the old name would have made the guard vacuous). |

### Documentation
| File | Change |
|---|---|
| `docs/reports/mac-2e-darwin-scope-and-product-identity.md` | **NEW** — this report. |

Not changed (zero diff): `native/**`, `schemas/**`, `src/storage/**`,
`src/writing/**`, `src/completion/**`, `src/reader/**`,
`src/internal/darwin-fs/**`, `src/runtime/mcp/server.ts`,
`src/runtime/mcp/lanes.ts`, `src/runtime/mcp/config.ts`, `src/trusted/identity.ts`,
`src/trusted/validate.ts`, `src/conformance/**`.

## 2. Product-vs-protocol identity classification (recovered from MAC-2A §7)

| Identity | Kind | MAC-2E disposition |
|---|---|---|
| `@project-gateway/artifact-core` (package) | **A. Product branding** | → `@project-gateway/macos-core` |
| `project-gateway-mcp` (bin) | **A. Product branding** | → `project-gateway-macos-mcp` |
| MCP server identity (initialize) | **A. Product branding** (package-derived, informational only) | Follows package → `@project-gateway/macos-core` |
| `project-gateway-mcp-bootstrap` (bootstrap provenance action label) | **A. Product branding** (recorded label; MAC-2A: does not feed digest/config/store identity; no fixtures) | → `project-gateway-macos-mcp-bootstrap` |
| `project-gateway-operator-bootstrap` | **C. Protocol-adjacent — DO NOT rename** | Byte-unchanged (proof §6) |
| `darwin-x86_64-posix-utf8-node22`, `darwin-arm64-posix-utf8-node22`, `linux-x86_64-posix-utf8-node22` | **C. Trusted protocol operands — NEVER rename** | Byte-unchanged (proof §7) |
| Schemas, `pgw:` ids, store layout, error vocabularies, digest domain separator, configuration projection | **C. Protocol** | Zero diff |
| `PI_CONSUMER_IDENTITY` / `GUARD_CONSUMER_IDENTITY` (`project-gateway.artifact-core`, pi adapter) | **Not classified by MAC-2A** → preserved untouched (no bulk replace; documented here) | Byte-unchanged |

No source contradiction with the MAC-2A classification was found.

## 3. Final supported product lanes

Supported **current-host** lanes (exactly two):

- `darwin-x86_64-posix-utf8-node22`
- `darwin-arm64-posix-utf8-node22`

The real Intel host classifies as `darwin-x86_64-posix-utf8-node22`
(verified by the pure mapping on `process.platform`/`process.arch` and
asserted in `tests/trusted/host-lane.test.ts`). Physical Apple Silicon
acceptance remains MAC-5's.

## 4. Unsupported-host fail-closed behavior

The CLI derives the lane exactly once at startup via
`trustedHostLaneForPlatformArch(process.platform, process.arch)`. The
current-host product derivation consumes ONLY `process.platform` and
`process.arch`; unsupported platform/architecture combinations (Linux,
Windows, unknown platform, unsupported Darwin architecture) fail closed.
A `null` result produces:

- bounded stderr diagnostic
  `project-gateway-macos-mcp: unsupported host lane (<platform> <arch>); supported: darwin-arm64, darwin-x86_64`;
- `process.exit(2)`;
- no config load, no composition, no store verification/provisioning, no
  server startup, no filesystem mutation (structurally proven: the host
  check precedes `loadRuntimeConfig`, `composeTrustedRegistry`, and
  `serveStdio` in `cli.ts`; asserted in `tests/runtime/identity.test.ts`).

Node-version scope (FINDING-1 correction):
`trustedHostLaneForPlatformArch` performs NO runtime Node-version
enforcement — there is no Node runtime-version probe or equality check
anywhere in the current-host derivation or CLI startup. The `node22`
suffix in the trusted lane identifiers remains the inherited frozen
opaque protocol label (PS-6R), never an exact Node runtime equality
requirement. MAC-2E introduces no new Node runtime-version policy.

Synthetic classification coverage (all green in
`tests/trusted/host-lane.test.ts`): Linux x86_64 → null; Linux arm64 →
null; Linux ia32 → null; Windows x64/arm64 → null; freebsd/openbsd/plan9
→ null; `darwin` + `''`/`ia32`/`arm` → null; `''`/`''` → null;
`DARWIN`/`X64` → null; Darwin x64 → `darwin-x86_64-posix-utf8-node22`;
Darwin arm64 → `darwin-arm64-posix-utf8-node22`; real current host →
`darwin-x86_64-posix-utf8-node22`.

## 5. Exact identity after the gate

- Package: `@project-gateway/macos-core` (version `0.1.0`, unchanged).
- Bin: `project-gateway-macos-mcp` → `./dist/runtime/mcp/cli.js` (single
  bin entry; no retained alias).
- MCP server identity: package-derived via `packageIdentity()` in
  `cli.ts` → `@project-gateway/macos-core` / `0.1.0`. No second
  hard-coded name/version source (`server.ts` contains none; asserted).
- Bootstrap provenance action label:
  `project-gateway-macos-mcp-bootstrap` — the in-process
  seeding/bootstrap provenance action label used by `compose.ts` when
  composing storage-bootstrap provenance records. Persisted store
  metadata continues to use `project-gateway-operator-bootstrap`.
- Usage text: `usage: project-gateway-macos-mcp --config <file>` /
  `project-gateway-macos-mcp bootstrap --config <file> [--output <file>]`.
- stderr diagnostic prefix: `project-gateway-macos-mcp:`.

## 6. Proof: `project-gateway-operator-bootstrap` unchanged

`src/control-plane/storage-bootstrap-action.ts` still declares
`CONTROL_PLANE_BOOTSTRAP_ACTION_IDENTITY = 'project-gateway-operator-bootstrap'`
(asserted byte-exact in `tests/runtime/identity.test.ts`; the only
control-plane diff is a doc comment naming the renamed CLI verb). The
only change to that file is a comment; no constant, no string.

## 7. Proof: trusted lane strings unchanged

The three lane literals
`darwin-x86_64-posix-utf8-node22`, `darwin-arm64-posix-utf8-node22`,
`linux-x86_64-posix-utf8-node22` are byte-identical (spelling,
separators, `node22` suffix, casing) in `src/trusted/host-lane.ts`
(asserted in `tests/runtime/identity.test.ts`; the host-lane diff shows
the constants as unchanged context). The Linux lane value remains an
exported protocol operand (`TRUSTED_HOST_LANE`), still feeding config
validation, digest identity, and cross-lane replay semantics.

## 8. Trusted-config digest regression evidence

1. `tests/runtime/identity.test.ts` — for identical trusted-config
   inputs under each Darwin lane: the canonical projection carries the
   exact lane string and NO product-branding string
   (`project-gateway`, `macos-core`, `artifact-core`, `mcp-bootstrap`,
   `bootstrap`, `project-gateway-macos-mcp` absent); digest format
   `sha-256:<64 hex>` unchanged; deterministic per lane; the only
   identity distinction between identical configs remains the host-lane
   operand (Darwin x64 ≠ Darwin arm64).
2. Integration conformance oracle recomputation (green):
   `fixture static identities are independently derivable from literal
   oracle projections (MODERATE-2)` — the committed
   `staticIdentityByLane` digests for `darwin-arm64-posix-utf8-node22`
   and `darwin-x86_64-posix-utf8-node22` recompute byte-for-byte from
   literals against the unchanged digest domain separator
   `PGAP-TRUSTED-CONFIG-v1\0`.
3. Full-corpus lane runs (green): the darwin-arm64 and darwin-intel
   lanes each pass the authoritative conformance corpus 648/648.

No digest fixture was rewritten. The digest computation
(`src/trusted/identity.ts`, `src/trusted/validate.ts`, config types) has
zero diff.

## 9. Existing-store compatibility

- Old recorded provenance label `project-gateway-mcp-bootstrap` on
  previously persisted records: nothing verifies it (MAC-2A §7 — it
  does not feed `TRUSTED_CONFIG_DIGEST`, config identity, namespace, or
  store-metadata identity); records carrying it remain
  replay-verifiable. New records minted by this product use the macOS
  label. No migration layer introduced (none required).
- Package/bin/server branding: not part of any stored identity; does not
  invalidate existing records.
- Protocol identifiers (lanes, schemas, `pgw:` ids, store layout, error
  vocabularies, digest domain separator): unchanged → existing stores
  verify/replay unchanged.
- No finding raised: existing records are NOT invalidated by the
  cosmetic branding.

## 10. Linux-lane disposition

A store/configuration bound to `linux-x86_64-posix-utf8-node22` remains
a syntactically known protocol object (the protocol can still represent
and validate it — conformance harness and protocol tests unchanged). It
is foreign to THIS macOS product:

- no current host ever derives the Linux lane (the product mapping has
  no Linux entry), so it can never be activated as the current-host
  configuration;
- a Linux-bound store on a Darwin host fails closed at composition via
  the existing cross-lane configuration-identity mismatch
  (`verifyStoreInstance`), the pre-existing ADR-042 decision-9 replay
  semantics;
- nothing is rewritten, aliased, or converted; the two Darwin lanes
  remain non-interchangeable (their identities differ, asserted).

## 11. Nine-tool surface unchanged

`tests/runtime/static-guard.test.ts` (six-tool + drafting + persist +
changes guard, exactly nine `registerTool` calls, no tenth tool) is
green, unmodified. `server.ts` has zero diff: tool names, input/output
schemas, and authorization behavior are untouched by branding.

## 12. Filesystem-port immutability

Zero semantic or textual changes to the completed port: native C seam,
six native exports (`openDirectoryAt`, `createExclusiveFileAt`,
`openExistingFileAt`, `unlinkAt`, `getPath`, `readDirectoryEntries` —
`napi_define_properties(..., 6, props)`), writing executor, completion
writer, reader, reader adapter, writer/executor adapters. Native tests
54/54 green (unchanged suite). No filesystem code was "cleaned up".

## 13. Focused verification totals

| Suite | Result |
|---|---|
| `tests/trusted/host-lane.test.js` | 14 pass / 0 fail |
| `tests/trusted/containment-host-lane.test.js` | 3 pass / 0 fail |
| `tests/runtime/identity.test.js` (new) | 7 pass / 0 fail |
| `tests/runtime/static-guard.test.js` (incl. nine-tool guard) | 6 pass / 0 fail |
| `tests/unit/bootstrap-static-guard.test.js` | 3 pass / 0 fail |
| `tests/unit/bootstrap-action.test.js` | 19 pass / 2 fail — **pre-existing on this host** (identical at baseline `82096dc…`: `/private/var` vs `/var` tmpdir canonical-path fixture mismatch on Darwin; unrelated to MAC-2E; out of scope) |
| `tests/runtime/stdio.test.js` (real CLI subprocess: modern MCP path, nine tools, diagnostics prefix, server identity, startup failures) | 10 pass / 0 fail |
| `tests/runtime/bootstrap.test.js` | 18 pass / 0 fail |
| `tests/runtime/server.test.js` | 15 pass / 0 fail |
| conformance oracle recomputation (MODERATE-2) + darwin-arm64 + darwin-intel full-corpus lane runs | 3 pass / 0 fail (648/648 per lane) |
| `git diff --check` | clean |
| Typecheck (`tsc -p tsconfig.tests.json`) + `npm run build` | green |

Not run (per gate): full reader regression, full writing regression,
native race suites, real MCP persist E2E (`tests/runtime/wp14b-e2e.test.js`),
full historical repository regression.

## 14. Static identity audit (MAC-2E delta)

Consistent product branding: `@project-gateway/macos-core`,
`project-gateway-macos-mcp`, `project-gateway-macos-mcp-bootstrap` (no
stale occurrences of the OLD PRODUCT BRANDING remain in `src/`,
`scripts/`, `tests/`, or package metadata; the intentionally preserved
consumer/protocol identities — `PI_CONSUMER_IDENTITY` /
`GUARD_CONSUMER_IDENTITY` = `project-gateway.artifact-core` and
`CONTROL_PLANE_BOOTSTRAP_ACTION_IDENTITY` =
`project-gateway-operator-bootstrap` — are explicitly excluded from
that statement; historical reports intentionally retain their original
text).

Forbidden-drift check: no rename of `project-gateway-operator-bootstrap`
(§6); no Darwin lane-string change (§7); no schema id change (zero diff
in `schemas/`); no `pgw:` id change (zero diff in sources carrying
them); no digest domain-separator change (§8); no error-vocabulary
change (zero diff in storage/writing/completion/reader/trusted
vocabularies); no MCP tool-name change (§11).

## 15. Explicit end-state statements

- Filesystem port unchanged (zero diff in native seam, adapters,
  executor, writer, reader).
- Native surface remains exactly six exports.
- MAC-2F not started.
- `persist-artifact` remains NOT product-E2E claimed fixed (MAC-2G
  owns that claim; `tests/runtime/wp14b-e2e.test.js` not run in this
  gate).

**Verdict: `MAC-2E — ACCEPTED`** · **Closure: `MAC-2E — LOCALLY
BASELINED`** (FINDING-1 closed — documentation-only correction; see
Durable status above).
