# macOS Product Contract — Project Gateway for macOS

**Status:** Accepted (MAC-0 gate; fork baseline frozen).
**Source baseline:** `55f764290a4567a20557f1db19d2a6fb97572a97`
(`mfx-labs/project-gateway`, commit `PS-6I: add darwin-x86_64 (macOS Intel)
trusted host lane (ADR-043)`).
**Fork repository:** local `Project_Gateway_MacOS`; intended public
`mfx-labs/project-gateway-macos`.
**Related:** ADR-042 (darwin-arm64 lane), ADR-043 (darwin-x86_64 lane),
`docs/macos-port-work-packages.md`, `docs/reports/mac-0-fork-baseline-and-port-contract.md`.

This document is the durable contract for the macOS product line. It
freezes what the fork is, what it must preserve, and what it must refuse.
It supersedes the upstream Linux-first product framing for this
repository only; it does not alter the upstream Gateway contract.

---

## 1. Product decision

The macOS fork is an **independent product line**, not a
cross-platform-maintained branch of the Linux Gateway. Long-term
cross-platform maintenance and minimizing divergence from the Linux
Gateway are not priorities for this workstream. Priorities:

1. preserve the existing Gateway security and authority contract;
2. make the complete Gateway runtime functional on macOS;
3. support BOTH macOS x86_64 (Intel) and macOS arm64 (Apple Silicon);
4. keep unsupported platforms fail-closed;
5. reach a separately releasable macOS artifact.

## 2. Supported host lanes (closed set — exactly two)

The macOS product SHALL support exactly:

- `darwin-x86_64-posix-utf8-node22` — macOS, Intel/x86_64, POSIX
  filesystem semantics, UTF-8 locale, Node.js 22.x (inherited
  ADR-043 lane);
- `darwin-arm64-posix-utf8-node22` — macOS, Apple Silicon/arm64, POSIX
  filesystem semantics, UTF-8 locale, Node.js 22.x (inherited ADR-042
  lane).

The macOS product SHALL refuse:

- Linux;
- Windows;
- unsupported Darwin architectures (e.g. `darwin-ia32`, `darwin-ppc64`);
- all other hosts (unknown platform/arch, non-POSIX semantics).

**Scope enforcement:** the inherited source still contains the
`linux-x86_64-posix-utf8-node22` lane as a member of the accepted
lane set and of the platform/arch mapping
(`src/trusted/host-lane.ts`, `src/runtime/mcp/cli.ts`). That is an
inherited implementation fact, NOT a claimed macOS runtime lane. The
macOS product must eventually remove the Linux lane from the accepted
set and mapping so Linux fails closed (CLI exit 2) exactly like every
other unsupported host. This is deferred to MAC-2 (see
`docs/macos-port-work-packages.md`); it is a declared scope mutation,
not an open question. No new Linux support work is ever added.

## 3. Preserved external Gateway contract

The macOS fork initially preserves the upstream externally observable
Gateway contract unchanged:

- **artifact schemas** — schema documents, artifact-kind vocabulary,
  and schema identity (`schemas/`, WP-4 registry);
- **validation semantics** — structural/semantic validation, raw-JSON
  canonicalization, digest binding (WP-3/WP-4, ADR-018);
- **trusted lifecycle semantics** — trusted configuration,
  lane-bound configuration identity, trusted store bootstrap,
  cross-lane replay fails closed (WP-6, ADR-042 decisions 8–9);
- **registry semantics** — store layout `store-v1`, registry index,
  metadata, audit, locks, quarantine, retention (WP-8);
- **workspace containment** — existing-path containment, prospective
  destination containment, point-of-use revalidation (WP-6 Phase 2/3);
- **point-of-use revalidation** — descriptor identity binding at the
  moment of access (WP-7 S-07, WP-11);
- **Git read-only behavior** — controlled Git child process; status/
  diff/log inspection only; no Git mutation; EMPTY operator-owned
  HOME/TMPDIR (WP-7);
- **structured artifact writing semantics** — create-only, exact
  canonical bytes, fixed mode, deterministic destinations (WP-11,
  WP-13B);
- **completion semantics** — execution-result writing and recovery,
  `already-exact` adoption, typed conflicts (WP-13B);
- **error taxonomy** — closed typed error vocabularies per boundary
  (MCP error codes, executor codes, result-write codes, storage
  classification) unless a Darwin-specific internal mapping is
  unavoidable (a native errno → typed-code mapping change is allowed
  ONLY if the externally visible vocabulary is preserved);
- **MCP protocol behavior** — stdio MCP, modern 2026-07-28 protocol
  generation, closed request/response envelopes;
- **exactly nine public MCP tools:**

  `validate-artifact`, `inspect-stored-record`, `inspect-registry`,
  `inspect-audit-history`, `verify-record`, `enumerate-class`,
  `draft-artifact`, `persist-artifact`, `inspect-changes`.

The macOS fork SHALL NOT add: shell; exec; Git mutation/push; approval;
issuance; grant/activation; generic filesystem tools.

## 4. Frozen controlled-write security invariants

The controlled-write security invariants inherited from
`src/writing/executor.ts`, `src/completion/writer.ts`, and the accepted
WP-11/WP-13B controlled-write reports are preserved **without
weakening**. The macOS fork MUST NOT substitute a weaker path-based
security model. The invariant list is normative:

1. **descriptor-anchored mutation** — every create/unlink/read of
   security-relevant objects resolves relative to a retained directory
   descriptor, never to a caller lexical path;
2. **retained root descriptor** — the accepted artifact/workspace root
   is opened `O_RDONLY|O_DIRECTORY|O_NOFOLLOW` once and retained for
   the whole operation;
3. **descriptor-relative parent traversal** — each directory component
   is opened relative to the previously verified descriptor;
4. **no intermediate symlink following** — `O_NOFOLLOW` on every
   security-relevant open; a swapped intermediate component can never
   redirect the operation;
5. **descriptor-bound parent identity** — the opened parent's resolved
   path (`readlink(/proc/self/fd/N)` on Linux; `fcntl(F_GETPATH)` on
   Darwin) must equal the accepted canonical ancestor, else
   `parent-not-verified` / `containment-denied`;
6. **service-user ownership verification** — every retained object is
   fstat-verified: directory, service UID (and fixed mode where
   applicable);
7. **exactly one final create component** — the create/unlink path is
   EXACTLY ONE component below the verified parent; multi-component
   tails fail closed (`missing-parent`) before any filesystem
   operation; no directory-creation authority;
8. **`O_CREAT | O_EXCL`** — create-only; any existing target is a
   typed `exclusive-create-conflict`, never an overwrite;
9. **`O_NOFOLLOW`** — a symlink (dangling or not) at the final
   component is never followed;
10. **fixed implementation-owned mode** — `0o600`, fchmod-applied
    (umask-independent), fstat-verified;
11. **descriptor verification of created objects** — regular file,
    service UID, exact mode/size;
12. **bounded exact write** — bounded loop over the exact canonical
    bytes; short writes continue; zero/invalid results fail closed;
13. **cleanup of only the object created by the operation** — at most
    one best-effort unlink, through the SAME verified parent descriptor
    and the SAME single final component;
14. **cleanup through the same verified parent descriptor** — never a
    re-resolved arbitrary absolute path;
15. **no arbitrary caller absolute path becoming filesystem
    authority** — only accepted correlated decision evidence reaches
    the executor;
16. **typed fail-closed errors** — closed vocabularies; raw errno,
    paths, and stacks never cross the boundary.

## 5. Darwin native boundary decision (recorded, NOT implemented in MAC-0)

The approved intended implementation direction for MAC-1 is a **narrow
Darwin native Node-API boundary** using appropriate Darwin/POSIX
primitives:

- `openat` — descriptor-relative open (replaces
  `/proc/self/fd/<fd>/<relative>`);
- `unlinkat` — descriptor-relative unlink (replaces the cleanup path);
- `fstat` — descriptor verification (already available via Node, kept
  in the native seam where the seam owns the descriptor);
- `fcntl(F_GETPATH)` — descriptor → resolved canonical path
  (replaces `readlink(/proc/self/fd/<fd>)`).

Recorded facts:

- **Node's public filesystem API is insufficient for the accepted
  Darwin contract**: Node exposes no descriptor-relative open (`openat`)
  and no descriptor resolution (`F_GETPATH`), so the inherited
  descriptor-anchored model cannot be re-expressed in pure Node on
  macOS.
- **`/dev/fd` is not a replacement for Linux `/proc/self/fd`** (documentation erratum, MAC-1; decision unchanged — see the MAC-1 report §4): on the tested macOS host, `/dev/fd/<fd>/<child>` did not provide directory-fd-relative traversal (open of a child through the `/dev/fd` entry failed), and `readlink('/dev/fd/<fd>')` did not provide the required descriptor-path identity. `/dev/fd` therefore cannot replace Linux `/proc/self/fd` for this security boundary and must never be used for security-critical resolution on macOS.
- The native helper must remain **narrow and private** to the
  security-critical filesystem boundary: a minimal addon with a minimal
  closed export surface, no general filesystem authority, no path
  parsing beyond single-component/relative traversal, typed error
  mapping to the inherited closed vocabularies.

## 6. Native distribution direction (frozen)

The target distribution model is **prebuilt native binaries**. End
users must NOT require Xcode, clang, node-gyp, Python build tooling, or
compilation during installation.

Conceptual package layout (names not finalized):

```
native/darwin-x64/<addon>.node
native/darwin-arm64/<addon>.node
```

Runtime behavior:

- the runtime selects only the exact matching platform/architecture
  binary for the running interpreter;
- missing or wrong-architecture native binaries **fail closed** — the
  affected boundary returns its typed failure, never a fallback;
- binary names are not finalized in MAC-0; MAC-7 finalizes them.

## 7. Product identity (proposed, not applied in MAC-0)

Minimum identity changes to make the fork unambiguous on a development
machine that may also hold the Linux Gateway (proposed exact names;
applied in MAC-2 unless a gate overrides):

| Identity | Linux Gateway (inherited) | macOS fork (proposed) |
|---|---|---|
| Package name | `@project-gateway/artifact-core` | `@project-gateway/macos-core` |
| CLI bin | `project-gateway-mcp` | `project-gateway-macos-mcp` |
| MCP server identity (initialize) | package name + version | `@project-gateway/macos-core` + version (derived from package.json) |
| Bootstrap action identity | `project-gateway-mcp-bootstrap` | `project-gateway-macos-mcp-bootstrap` (verify no configuration-identity coupling before changing) |
| Product/documentation name | Project Gateway | **Project Gateway for macOS** |
| Repository | `mfx-labs/project-gateway` | `mfx-labs/project-gateway-macos` |
| Version | 0.1.0 | 0.1.0 until first macOS release; MAC-7 decides the first release version |

**NOT renamed:** schemas, `pgw:`-prefixed protocol-level artifact
identities, store layout, lane identifiers, error vocabularies. No
branding renames of protocol identities, ever.

## 8. Verification lanes

Two first-class verification lanes, both mandatory before any release:

- **MAC-X64** — real macOS x86_64; native x64 addon; real filesystem
  security tests; real MCP persist. Host available today (this
  machine).
- **MAC-ARM64** — real macOS arm64; native arm64 addon; real filesystem
  security tests; real MCP persist. **Hardware availability is an
  execution dependency for MAC-5**; mocked `process.arch` is never
  sufficient evidence for either lane, and cross-compilation alone is
  not release verification. If Apple Silicon hardware remains
  unavailable, MAC-5 records the blocker rather than weakening the
  contract.

## 9. Scope refusal summary

Anything not explicitly listed in §2–§6 is out of scope for this
workstream: no Linux lane claims, no Windows work, no new tools, no
tunnel/integration work, no expansion into unrelated Gateway roadmap
items.
