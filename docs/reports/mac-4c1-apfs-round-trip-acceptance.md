# MAC-4C1 — APFS proposal-persistence acceptance evidence

**Baseline:** `4e84b4cf0f38ba1ebf17ed47420bf80c9ae1390e` (exact expected HEAD)
**Date:** 2026-08-16
**Scope:** physical Intel host only. MAC-4A and MAC-4B are CLOSED. MAC-4C2,
MAC-5, human x64 sign-off, and MAC-4 closure were not started or claimed;
MAC-4 is not yet CLOSED.
**Reclassification:** the former `MAC-4C1 — BLOCKED` verdict was a historical
acceptance-plan mismatch, not a product failure. MAC-4C's corrected
proposal-persistence acceptance chain had not yet been executed at the time
of that historical classification.

## Physical host and lane

- macOS 12.7.6 (21H1320), Darwin 21.6.0, `x86_64`.
- `MacBookPro13,3`; Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz.
- Node `v22.23.1`, `darwin` / `x64`.
- `diskutil info /` reports File System Personality `APFS`; the disposable fresh workspace was created under the real temporary filesystem, canonicalized with `realpath`, and removed after the run.
- The built production lane resolver on this host returned `darwin-x86_64-posix-utf8-node22`. Bootstrap output intentionally does not serialize an operator-controlled `hostLane`; the production CLI derives it at its host boundary.
- `native/darwin-x64/gateway_fs.node` is a Mach-O 64-bit `x86_64` bundle. The live server loaded exactly these six exports: `createExclusiveFileAt`, `getPath`, `openDirectoryAt`, `openExistingFileAt`, `readDirectoryEntries`, and `unlinkAt`.

## Bounded execution

The watchdog behavior was checked first: an immediate command exited immediately, and a 2-second ceiling terminated a 30-second sleep with exit 124. No artificial waiting was used.

The historical physical scenario was then run once through the built
production CLI and real stdio MCP transport, with a 90-second watchdog. It
completed in about 2.4 seconds and exited 3 only because its then-invalid
same-proposal verify/audit criterion observed the expected typed outcomes
below; it did not time out.

An initial disposable-probe attempt exited 2 before persistence because the probe incorrectly expected `hostLane` in the resolved configuration. This was attributed to the probe, not the product: the existing bootstrap contract serializes no such field. The probe was corrected to use the built production lane resolver, then the one complete scenario above was run. The disposable probe and its fresh workspace were removed; no production or test source was retained.

## Bootstrap and persist evidence

Real operator bootstrap (`dist/runtime/mcp/cli.js bootstrap --config … --output …`) succeeded with empty stdout and an `INITIALIZED` diagnostic. It produced one configured surface and the one configured workspace `pgw:w:aaaaaaaaaaaaaaaa`, with no added workspace or authority.

- Resolved configuration identity: `sha-256:1a3dfaffbe548a0e502273ff51cc19c8a39e1ef6a16ce49249c6a309119a5f55`.
- Persisted metadata bound that same identity and included `project-gateway-operator-bootstrap`.
- The real server exposed exactly nine tools: `draft-artifact`, `enumerate-class`, `inspect-audit-history`, `inspect-changes`, `inspect-registry`, `inspect-stored-record`, `persist-artifact`, `validate-artifact`, and `verify-record`.

Via public `draft-artifact` followed by public `persist-artifact`, the server created one canonical proposal artifact:

- identity: `pgw:i:9e74f09cf0287d6787d69e8ebddb5157`
- revision: `pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f`
- digest: `sha-256:b6418a37095af165a87a38affb609f42b331d80b15f7d3ed2796bf780ae1868b`
- destination relative to the configured artifact root: `TaskSpec.pgw:i:9e74f09cf0287d6787d69e8ebddb5157.pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f.json`
- canonical bytes: 755; independently read back byte-for-byte equal to the public draft's canonical UTF-8.
- filesystem facts: regular file, service UID 501, mode `0600`, and exactly one artifact-root entry (no sibling or temporary artifact).

The mandatory second persist returned typed `write-denied`; the original bytes remained unchanged. The smallest authority-widening check—persist to unconfigured `pgw:w:ffffffffffffffff`—also returned typed `write-denied` and left the artifact root unchanged.

## Historical public verify and audit result

No direct filesystem route was substituted for these calls. After the exact public persist, the live server received:

- `verify-record(surfaceId=alpha, recordClass=validation-record, recordId=<persisted instance>)`
- `inspect-audit-history(surfaceId=alpha, recordClass=validation-record, recordId=<persisted instance>)`

Both returned the closed typed result:

```text
ok: false
error.code: not-found
error.message: the requested object is not present in the verified store
```

The public read-only `inspect-registry` cross-check returned an empty `recordsByClass`, `recordsByIdentity`, and `auditByPrimary`. Thus there is no stored identity/digest/reference chain for the public verify or audit surfaces to associate with the persisted proposal.

These are EXPECTED CONTRACT BEHAVIORS, not acceptance failures:
`persist-artifact` explicitly persists an untrusted proposal and does not
approve, issue, grant, activate, execute, issue receipts, or create lifecycle
records. The existing real-MCP acceptance suites require the store and
registry to remain untouched after a successful proposal persist.
`verify-record` and `inspect-audit-history` are read-only APIs for exact
verified store records. The former requested
`bootstrap → proposal persist → verify-record → audit` chain was therefore a
historical acceptance-plan mismatch.

The corrected MAC-4C chain is: `bootstrap` → optional public draft →
`persist-artifact` → independent APFS verification → public
`inspect-changes` proposal observation → public `inspect-registry`
non-mutation check → create-only conflict / unknown-workspace denial →
continuity / clean exit. Trusted-record `verify-record` /
`inspect-audit-history` sequencing belongs to MAC-6 or another separately
authorized trusted-lifecycle gate. MAC-4 MUST NOT create a trusted lifecycle
transition merely to satisfy acceptance. At the time of the historical run,
this corrected chain had not yet been executed.

## Accounting and process/protocol evidence

| Observation | Result | Classification |
| --- | --- | --- |
| Watchdog behavior checks | 2 pass / 0 timeout | VALID |
| Historical real APFS bootstrap/persist scenario | 1 pass / 0 timeout | VALID |
| `verify-record` against persisted proposal | typed `not-found` | EXPECTED CONTRACT BEHAVIOR |
| `inspect-audit-history` against persisted proposal | typed `not-found` | EXPECTED CONTRACT BEHAVIOR |
| Server/protocol lifecycle | 1 pass / 0 timeout | VALID |

- MCP stderr contained zero bytes; no unexpected protocol output was observed.
- The stdio server closed and reaped within the 10-second bound.
- Post-run `pgrep` found zero `project-gateway-macos-mcp` / `dist/runtime/mcp/cli.js` processes.
- No full `npm test`, no unrelated regression, no commit, push, tag, release, MAC-4C2 work, or MAC-5 work was performed.

## Reclassified conclusion

The executed physical Intel x86_64 evidence is VALID: bootstrap and
configuration identity, native = six, MCP = nine, APFS proposal persistence,
canonical `0600` file verification, no overwrite, no authority widening, and
clean process/protocol handling all behaved as expected. The two typed
`not-found` observations are EXPECTED CONTRACT BEHAVIORS because the accepted
proposal intentionally has no verified-store or audit identity. They must not
be represented as product failures.

The prior `MAC-4C1 — BLOCKED` verdict is retained only as the historical
acceptance-plan mismatch it diagnosed. The corrected MAC-4C acceptance chain
had not been executed in that historical run; the separate fresh execution
below is its one accepted replacement. MAC-4 remains open, MAC-5 is NOT
STARTED, and no human x64 sign-off is claimed.

MAC-4C1 — HISTORICAL ACCEPTANCE-PLAN MISMATCH (NOT A PRODUCT FAILURE)

## Corrected fresh execution — separate physical acceptance

**Run identity:** `RPS-MAC-4C-001`
**Baseline:** `4e84b4cf0f38ba1ebf17ed47420bf80c9ae1390e` (exact expected HEAD)
**Scenario accounting:** exactly **1** fresh real-host scenario; **36 pass /
0 fail / 0 skipped / 0 timeout**; 2.240 s under the corrected 90-second
process-group watchdog; the disposable fixture was removed. No full
regression was run.

The run used macOS 12.7.6 / Darwin 21.6.0 on Intel `x86_64`, Node `v22.23.1`,
service UID 501, and the production resolver's
`darwin-x86_64-posix-utf8-node22` lane. Read-only host inspection after the
run confirmed the host volume is APFS (`/dev/disk1s1s1`). The fresh workspace
was created beneath the real temporary filesystem, then canonicalized with
`realpath`; its initialized Git baseline was clean before persistence.

### TEST-MAC-4C positive chain

1. `TEST-MAC-4C-005` through `-009`: real operator bootstrap through
   `node dist/runtime/mcp/cli.js bootstrap --config … --output …` succeeded.
   It emitted zero stdout bytes and the expected `INITIALIZED` diagnostic,
   derived configuration identity
   `sha-256:6f96f59c1e4d5add8c7abe9d19ff53a465e77f16aa65087fe2d2fb0494a7d600`,
   and persisted only its expected bootstrap metadata.
2. `TEST-MAC-4C-003`: the real `native/darwin-x64/gateway_fs.node` exposed
   exactly six exports: `createExclusiveFileAt`, `getPath`,
   `openDirectoryAt`, `openExistingFileAt`, `readDirectoryEntries`, and
   `unlinkAt`.
3. `TEST-MAC-4C-010` and `-011`: the real packaged stdio server
   `node dist/runtime/mcp/cli.js --config …` identified as
   `@project-gateway/macos-core@0.1.0` and exposed exactly nine tools:
   `draft-artifact`, `enumerate-class`, `inspect-audit-history`,
   `inspect-changes`, `inspect-registry`, `inspect-stored-record`,
   `persist-artifact`, `validate-artifact`, and `verify-record`.
4. `TEST-MAC-4C-012` through `-021`: public `draft-artifact` followed by
   public `persist-artifact` created exactly one proposal with identity
   `pgw:i:9e74f09cf0287d6787d69e8ebddb5157`, revision
   `pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f`, digest
   `sha-256:b6418a37095af165a87a38affb609f42b331d80b15f7d3ed2796bf780ae1868b`,
   and root-relative destination
   `TaskSpec.pgw:i:9e74f09cf0287d6787d69e8ebddb5157.pgw:r:8d4203d7ec45e4f3c4bbba7a9c69042f.json`.
   Independent APFS checks proved that this destination canonicalizes below
   the configured artifact root, is a regular file owned by UID 501 at mode
   `0600`, and contains the exact 755 canonical UTF-8 bytes returned by the
   public draft. The artifact root had that one entry only: no temp or
   sibling artifact.

### Corrected proposal observation and non-mutation

`TEST-MAC-4C-022` and `-023` called public `inspect-changes` immediately
after persistence. Its exact fresh Git-status shape was:

```json
{
  "changedFileCount": 1,
  "changedFiles": [
    { "path": "artifacts/", "indexState": "?", "worktreeState": "?" }
  ]
}
```

This is the established clean-workspace behavior: Git reports the untracked
`artifacts/` directory as the unit, while independent filesystem evidence
proves the proposal is its sole member. No filename-level shape was required.

`TEST-MAC-4C-024` through `-026` then called public `inspect-registry` and
observed unchanged, empty verified state:

```json
{
  "recordsByClass": {},
  "recordsByIdentity": {},
  "auditByPrimary": {}
}
```

The store tree matched its post-bootstrap snapshot before and after the
proposal and negative requests. No trusted lifecycle state was created.
The public call sequence was exactly `draft-artifact` → `persist-artifact`
→ `inspect-changes` → `inspect-registry` → `persist-artifact` →
`persist-artifact` → `inspect-registry` → `inspect-changes`.
`verify-record` and `inspect-audit-history` were not called.

### Negative and continuity evidence

| TEST | Request | Observed closed outcome | Independent proof |
| --- | --- | --- | --- |
| `TEST-MAC-4C-027` / `-028` | same-destination second `persist-artifact` | `write-denied` | Original canonical bytes remained byte-identical; no overwrite or truncate. |
| `TEST-MAC-4C-029` / `-030A` / `-030B` | `pgw:w:ffffffffffffffff` unconfigured workspace | `write-denied` | No fallback or additional artifact, store state, or authority widening. |
| `TEST-MAC-4C-031` / `-032` | valid registry and changed-context follow-ups | both succeeded | Server continuity after both negative outcomes. |

`TEST-MAC-4C-030` and `-034` observed zero unexpected stderr bytes,
protocol-valid MCP responses throughout, clean client-EOF server exit/reap
within the 10-second bound (first poll), and zero matching MCP processes
after the run. The run neither performed human x64 sign-off nor closed
MAC-4, began MAC-5, created trusted lifecycle state, committed, pushed,
tagged, or released. No production/native/schema/MCP code changed; this
report is the only repository change for the gate.

MAC-4C — CORRECTED PHYSICAL ACCEPTANCE COMPLETE
MAC-4C — READY FOR SENIOR REVIEW
