# MAC-4B — Live MCP Acceptance

**Verdict:** `MAC-4B — READY FOR SENIOR REVIEW`

## Freeze and scope

- **Exact baseline SHA:** `8d317545f188e2ec08958ed628161f8112a20885`
- **Production/native/schema/MCP changes:** none. This gate adds this report
  only.
- **Starting tracked state:** clean; the pre-existing untracked `.DS_Store`
  remains outside this gate.
- **Not started:** MAC-4C APFS bootstrap→persist→verify→audit round-trip,
  MAC-5, commit, push, tag, release, or publication.

## Physical host and entrypoints

| Probe | Observed value |
|---|---|
| Host | macOS 12.7.6 (21H1320), Darwin 21.6.0 x86_64 |
| Node | v22.23.1; `process.platform=darwin`; `process.arch=x64` |
| Supported lane | `darwin-x86_64-posix-utf8-node22` |
| Native binary | `native/darwin-x64/gateway_fs.node`: Mach-O 64-bit bundle x86_64 |
| Packaged entrypoint | package bin `project-gateway-macos-mcp` → `dist/runtime/mcp/cli.js` |

The selected compiled acceptance test and built CLI were newer than their
sources before execution; the x64 addon binary was newer than its native
source.

The exercised production path was exactly:

```text
node dist/runtime/mcp/cli.js bootstrap --config <operator-profile> --output <resolved-config>
node dist/runtime/mcp/cli.js --config <resolved-config>
```

The first command used a real canonical temporary workspace and real Git
baseline, derived the configuration identity, persisted bootstrap metadata,
emitted no stdout payload, and emitted the expected `INITIALIZED` operator
diagnostic. The second command was the real stdio MCP server process.

## Bounds and exact test accounting

The corrected process-group watchdog was rechecked before acceptance:

| Check | Observed result |
|---|---|
| `/tmp/watchdog.sh 5 /usr/bin/true` | exit 0 in 0.120 s; no artificial wait |
| `/tmp/watchdog.sh 2 /bin/sleep 30` | exit 124 in 3.014 s; process group terminated |

One live scenario and one native-surface preservation check were selected from
`dist-test/tests/runtime/mac2f-e2e.test.js`; its duplicate fresh scenario was
not run. Under a 90-second outer ceiling, the selected command completed in
3.432 s:

| Selected check | PASS | FAIL | CANCELLED | SKIPPED | TIMEOUT |
|---|---:|---:|---:|---:|---:|
| real Intel stdio MCP persist flow + negative matrix | 1 | 0 | 0 | 0 | 0 |
| production x64 addon has exactly six exports | 1 | 0 | 0 | 0 | 0 |
| **Total** | **2** | **0** | **0** | **0** | **0** |

## Live server evidence

The real `StdioClientTransport` connected to the spawned production CLI and
`tools/list` returned exactly these nine tools:

`validate-artifact`, `inspect-stored-record`, `inspect-registry`,
`inspect-audit-history`, `verify-record`, `enumerate-class`, `draft-artifact`,
`persist-artifact`, and `inspect-changes`.

The single configured workspace (`pgw:w:aaaaaaaaaaaaaaaa`) accepted one
`persist-artifact` request. Independent filesystem checks established that
the returned relative destination was a regular file below the configured
artifact root, had mode `0600`, was owned by the service UID, and contained
the exact canonical UTF-8 bytes produced by the public draft flow. There was
exactly one artifact entry and no temporary or sibling leak.

The same live session then exercised the required negative cases:

| Scenario | Observed closed result | Independent evidence |
|---|---|---|
| Same destination, second persist | `write-denied` | Existing exact bytes remained byte-identical; no truncate or overwrite. |
| Unknown/unconfigured workspace | `write-denied` | No external, fallback, or extra artifact file appeared. |
| Unknown surface | `not-found` | No authority was widened. |

Each denied/conflict response was followed by another request: conflict →
unknown-workspace response; unknown-workspace denial → unknown-surface
response; unknown-surface denial → successful `inspect-registry` and
`enumerate-class` responses. The server therefore remained transport-healthy
after every negative outcome. All public outcomes used the closed result/error
vocabulary; no native errno or raw filesystem detail crossed the MCP boundary.

The production addon preservation check loaded the actual x64 Mach-O and
confirmed the exact six exports:

`createExclusiveFileAt`, `getPath`, `openDirectoryAt`,
`openExistingFileAt`, `readDirectoryEntries`, `unlinkAt`.

## Process and protocol accounting

- Server-session stderr was exactly empty: no diagnostic or protocol
  corruption during the stdio session.
- Client EOF closed the server; the harness required clean reaping within its
  10-second process-exit ceiling.
- Post-run process check found zero `dist/runtime/mcp/cli.js` or
  `project-gateway-macos-mcp` processes.
- **Observed acceptance failures:** none.

This gate did not call `verify-record` or `inspect-audit-history`, and makes
no MAC-4C verification or audit claim. It is Intel x86_64 evidence only;
MAC-5 remains unstarted.

MAC-4B — READY FOR SENIOR REVIEW
