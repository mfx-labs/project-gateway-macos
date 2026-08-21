# WP-7 — Controlled Reader, Git Inspection, and Internal FFF Discovery — Normative Contract

**Status:** Authoritative WP-7-A contract consolidation for WP-7 (Controlled project reader, Git inspection, and internal discovery (FFF)). Prepared under the human-authorized WP-7-A foundation and contract-consolidation package. **Senior-review corrections applied (WP-7-A focused correction review).** WP-7-B (runtime implementation) and WP-7-C (integration, security verification, and closure) are **not** authorized. This contract defines normative requirements; it contains no runtime implementation. WP-6 is closed (`b07fea95d0a1ed20361dec441fc500766969536f`); the WP-6 trusted workspace and containment contract is consumed, never redefined.

**Authority order:** the committed WP-6 contracts (`trusted-workspace-and-ceiling-configuration.md`, ADR-024), the WP-0 scope and principles, ADR-023 (execution order), and the human-approved planning package take precedence over earlier review language; this contract is the normative WP-7 specification and takes precedence over earlier WP-7 planning prose where the planning prose is less precise.

**Normative cross-references:** `post-wp5a-roadmap.md` (WP-7 attribute block), `project-gateway-scope-and-principles.md` (FFF definition and MVP capability list), `trusted-workspace-and-ceiling-configuration.md` (containment contract, F-EL1/F-EL2), `src/trusted/containment-*.ts` (committed containment implementation), `post-wp5a-planning-status.md` (deferred-item dispositions).

**Normative language:** MUST / MUST NOT / SHOULD / MAY are used as defined by RFC 2119. Requirement IDs are grouped by contract area; the complete requirement inventory and acceptance matrix appear in Appendix A and Appendix B.

---

## 1. Scope and Non-Goals

**1.1 WP-7 official identity (preserved from the roadmap):** WP-7 — *Controlled project reader, Git inspection, and internal discovery (FFF)*. Objective: *bounded read-only project/Git inspection and internal discovery*. Inputs: the WP-6 workspace containment contract. Outputs: a read-only inspection surface and internal discovery (FFF) results. Owned: controlled reads, Git inspection, internal discovery. Prohibited: writes, policy authority, mutation. Closure gate: *read-only guarantees tested; no mutation capability*.

- **SCO-001.** WP-7 MUST provide bounded read-only inspection of files and directories within configured workspace roots.
- **SCO-002.** WP-7 MUST provide read-only Git inspection (status, diff, log, selected-commit inspection) for workspaces that are regular Git repositories.
- **SCO-003.** WP-7 MUST provide internal FFF discovery: fast, ranked discovery of likely files or content within already authorized scope.
- **SCO-004.** The WP-7 surface MUST be internal-only. It MUST NOT be a public MCP surface, a public package-root tool, an adapter, or a security boundary (WP-0 FFF and component-responsibility rules).
- **SCO-005.** Intended future internal consumers MUST be: WP-8 (local storage and registry — discovery inputs), WP-9 (MCP inspection surface — read and listing inputs), WP-10 (artifact drafting — workspace context inputs), WP-11 (controlled writing — point-of-use revalidation inputs), and WP-13 (end-to-end execution — task inputs). No consumer interface is defined in this contract beyond the internal interfaces of Area 10.

**1.2 Exclusions (normative).** WP-7 MUST NOT provide or perform:

- **SCO-006.** file creation, modification, deletion, or rename; directory creation; permission or ownership changes; truncation; or any other filesystem mutation;
- **SCO-007.** Git staging, commits, branch or tag mutation, checkout, reset, revert, cherry-pick, merge, rebase, fetch, pull, push, clean, or any Git write or network operation; repository configuration mutation (local, global, or system);
- **SCO-008.** arbitrary shell commands or arbitrary subprocess execution; user-controlled command execution;
- **SCO-009.** network access of any kind (no sockets, no HTTP, no Git transport beyond the explicitly prohibited set);
- **SCO-010.** policy evaluation, authority approval, capability decisions, or any point-of-use authority behavior;
- **SCO-011.** persistence, storage, or registry behavior (WP-8);
- **SCO-012.** package-root publication, MCP tools, adapter exposure, Pi or pi-guard behavior (WP-9/WP-5B).

**1.3 Fixed-executable clarification (normative).**

- **SCO-013.** Invoking a fixed, trusted Git executable through a constrained wrapper (Area 7) is an implementation mechanism, not user-controlled command-execution authority. The Git invocation model is fully constrained by this contract: fixed subcommands from an implementation-owned allowlist, fixed option sets, no shell, no user-supplied subcommand or option, sanitized environment, and bounded output. WP-7 MUST NOT expose any general subprocess-execution capability.

---

## 2. Trust Model

**2.1 Trusted inputs.**

- **TRU-001.** The runtime-genuine validated trusted workspace configuration (WP-6 brand, `isGenuineValidatedTrustedWorkspaceConfiguration`) MUST be the only source of workspace identity, roots, and containment configuration. A forged, cloned, or Proxy-wrapped configuration MUST fail closed before any workspace field is read.
- **TRU-002.** WP-6 containment configuration and decisions (committed `evaluateExistingPathContainment` and its decision type) MUST be consumed as-is. WP-7 MUST NOT define alternate containment semantics.
- **TRU-003.** Implementation-owned static operation definitions (fixed subcommands, option allowlists, limits, binary paths) are trusted inputs defined by this contract; they MUST NOT be supplied by request data.

**2.2 Hostile inputs (all untrusted, fail closed).**

- **TRU-004.** The following MUST be treated as hostile input: requested paths; repository filenames and directory names; symlink targets; filesystem metadata; file content; Git output; commit messages; refs; discovery queries; FFF results; and errors from filesystem or Git operations.
- **TRU-005.** Hostile input MUST NOT be evaluated as instructions, MUST NOT be interpolated into commands, MUST NOT be stringified into findings, and MUST NOT influence containment or authority decisions.
- **TRU-006.** All WP-7 operations MUST fail closed: any condition that cannot be positively proven safe MUST produce a deterministic failure, never a partial authorization.

**2.3 FFF trust rule.**

- **TRU-007.** FFF output MUST remain untrusted. Every path returned by FFF MUST undergo independent containment validation (Area 3) before any actual read or Git operation; FFF MUST NOT authorize a path, and FFF MUST NOT be evidence of completeness or verification (WP-0: "discovery is not verification").

---

## 3. Containment Reuse

- **CON-001.** WP-7 MUST consume the committed WP-6 containment contract: `parseWorkspaceRelativePath` for canonical workspace-relative path parsing and `evaluateExistingPathContainment` (purpose `'read'`) for containment decisions, with the runtime-genuine configuration supplied through the trusted options operand. `parseWorkspaceRelativePath` is currently not exported from `src/trusted/index.ts`; WP-7-B is authorized, once separately approved, to add exactly one re-export of the existing symbol to that barrel. The change is export-only; it MUST NOT modify parser behavior, types, or any other WP-6 source. Direct deep import from `src/trusted/containment-path.ts` is prohibited. See AREA 14 and DEC-002 for the authorized path scope.
- **CON-002.** WP-7 MUST resolve the workspace exclusively through the committed `lookupValidatedWorkspace` against the genuine configuration; an unknown workspace MUST fail closed (ERR-WS-UNKNOWN).
- **CON-003.** Only the matched workspace's configured roots MAY be used. No other workspace's roots, no parent directories, and no configuration-derived alternate roots MAY be used for a given request.
- **CON-004.** WP-7 MUST NOT duplicate, fork, or reimplement root-policy logic, root-overlap rules, workspace-identity rules, or containment decision logic. Containment is a single source of truth in `src/trusted/**`.
- **CON-005.** WP-7 MUST NOT introduce alternate containment semantics (for example first-match, longest-prefix, or lexical-only containment).
- **CON-006.** The WP-6 decision is prospective (F-EL2: "the WP-6 decision is prospective and does not eliminate TOCTOU risk"). WP-7 MUST perform descriptor-bound point-of-use verification at the actual read or Git operation (F-EL2 item 8), using the committed containment evaluation against the live filesystem resolver.
- **CON-007.** The normative operation sequence is: (1) capture and validate the request; (2) resolve the genuine workspace; (3) parse the workspace-relative path; (4) obtain a prospective WP-6 containment decision; (5) immediately before opening the target, perform a fresh point-of-use containment evaluation; (6) open the actual target using a supported-lane descriptor-bound strategy; (7) bind the opened descriptor or directory handle to the point-of-use evaluation result; (8) verify the opened object type and identity from the bound descriptor/handle; (9) perform the bounded operation through that descriptor/handle; (10) return the point-of-use containment decision identity. Steps 4 and 5 MUST use the same committed containment machinery.
- **CON-008.** When containment cannot be positively proven (resolution failure, escape, ambiguity, root replacement, missing target), the operation MUST fail closed with a containment denial or not-found failure; no fallback resolution MAY occur.
- **CON-009.** The point-of-use containment decision identity and the workspace configuration identity MUST be correlated into every operation result or failure where a containment decision occurred. The returned correlation identity is the point-of-use decision identity. The prospective decision is advisory evidence only.
- **CON-010.** WP-7 MUST NOT modify the WP-6 containment contract or its committed implementation. WP-7 MAY consume the containment decision's `canonicalWorkspaceRelativePath` and MUST treat `resolvedAbsolutePath` as trusted-process-internal (never disclosed).

---

## 4. Path Model

**4.1 Authoritative representation.**

- **PAT-001.** The single authoritative path representation for results is the **canonical workspace-relative path**: forward-slash separated, no leading slash, no trailing slash, no `.` or `..` segments, no repeated separators, no NUL, no backslash, UTF-8 encoded, case-sensitive (POSIX lane). The empty string `''` is the internal canonical representation of the workspace root after path combination, produced when the request root token `.` is parsed into zero components.
- **PAT-002.** Results MUST expose normalized workspace-relative paths only. Results MUST NOT expose absolute paths, configured roots, or the `resolvedAbsolutePath` from containment decisions.
- **PAT-003.** The opaque-resource-identifier alternative is rejected: workspace-relative paths are the sole authoritative representation. No opaque IDs are minted; correlation uses `workspaceId` + canonical workspace-relative path.
- **PAT-004.** Requests MUST carry `workspaceId` (exact configured identifier) and a workspace-relative path in request form. A request path MUST be parsed and rejected by `parseWorkspaceRelativePath` before any filesystem use. The maximum request-path UTF-8 length is **4096 bytes**; requests exceeding it MUST fail with ERR-REQ-INVALID.

**4.2 Accepted/rejected request forms (normative).**

- **PAT-005.** The request root token is exactly `.`. An empty request string `''` is invalid and MUST be rejected (ERR-REQ-INVALID). The committed parser accepts `.` and yields zero components; the internal combined canonical workspace-relative representation of the root is `''`.
- **PAT-006.** Request-path grammar: `.` (root token) is accepted; absolute, drive-absolute, UNC, backslash, NUL/control, repeated separators, trailing separators, and empty-component forms MUST be rejected (ERR-REQ-INVALID). Interior `.` components MUST be rejected. `..` components are carried by the parser; the committed `combineWorkspaceRootAndComponents` performs bounded popping against the workspace root, and an attempt to pop beyond the root fails closed as escape/traversal (ERR-PAT-TRAVERSAL). This two-phase model (parse: carry `..`; combine: bounded pop) is the committed behavioral authority; WP-7 MUST NOT reinterpret `..` as immediate parse-time rejection.
- **PAT-007.** Unicode: paths are UTF-8; NFC normalization MUST NOT be applied to path bytes (WP-3 canonical-input rule: validation never transforms). No normalization, case folding, or Unicode decomposition MAY be applied.
- **PAT-008.** Platform-specific forms (Windows drive letters, UNC, reserved device names) MUST be rejected on the supported POSIX lane (F-EL3: Linux x86_64, POSIX, UTF-8).
- **PAT-009.** The logical path (canonical workspace-relative) and the resolved filesystem target (from containment) are distinct concepts: logical paths are the only user-visible form; resolved targets are internal and never disclosed.
- **PAT-010.** Path presentation in results and errors: workspace-relative canonical paths MAY be disclosed; absolute roots MUST NOT be disclosed in any result, error, finding, identity, or log.

---

## 5. Symlink, Traversal, and TOCTOU Model

**5.1 Symlink resolution.**

- **SYM-001.** Symlink resolution MUST be performed by the committed WP-6 containment resolver (via `evaluateExistingPathContainment` with the injected live resolver). WP-7 MUST NOT implement an independent symlink policy.
- **SYM-002.** Symlink chains: containment MUST resolve the full chain; a chain whose final or intermediate target escapes the workspace root MUST fail closed (containment denial).
- **SYM-003.** Broken links MUST fail closed (not-found or containment denial per the containment result); a broken link MUST NOT be followed and MUST NOT be treated as a missing regular file.
- **SYM-004.** Symlink loops MUST fail closed (containment resolution failure); no loop detection logic may be duplicated in WP-7.
- **SYM-005.** Links crossing workspace boundaries (target inside another workspace's root) MUST fail closed; the matched workspace's root is the only permitted target space.
- **SYM-006.** Ancestor symlinks and final-component symlinks MUST be resolved by the same containment evaluation; no distinction MAY relax the rule.
- **SYM-007.** Directory traversal via lexical or resolved escape MUST fail closed (ERR-PAT-TRAVERSAL / containment denial).

**5.2 Point-of-use descriptor-bound verification.**

- **SYM-008.** The WP-6 decision is prospective. WP-7 MUST revalidate containment at the actual point-of-use operation (CON-006). The revalidation MUST occur before opening the target with the same resolver and configuration used for the prospective decision.
- **SYM-009.** Descriptor-bound model: after point-of-use containment succeeds, WP-7 opens the target using lane-appropriate primitives (e.g., `openat`-style relative to a retained workspace-root descriptor, with `O_NOFOLLOW` where applicable). After opening, WP-7 MUST verify the opened descriptor/handle is consistent with the point-of-use containment result (type, resolution path). A disagreement fails with ERR-CON-DENIED. Reads MUST be bound to the opened descriptor, not reopened by path after validation.
- **SYM-010.** The contract guarantees are descriptor-bound verification on the supported Linux lane, not universal race freedom. The lane permits retaining an opened descriptor for the workspace root, opening targets relative to that root, and performing `fstat`/type inspection on the opened descriptor. A WP-7-B implementation that cannot provide descriptor-bound verification MUST fail closed and MUST NOT fall back to path-only reading.
- **SYM-011.** Race behavior: a filesystem change between the point-of-use containment evaluation and the descriptor open cannot be guaranteed detected by path-based checks alone. The descriptor-bound sequence (evaluate → open → fstat → verify) provides the strongest available guarantee. Root-replacement detection is limited to what the lane permits through the bound descriptor; WP-7 MUST NOT overclaim detection of every possible root replacement. A stat/realpath-only strategy without descriptor binding is prohibited.
- **SYM-012.** Bounded retry: an operation whose revalidation fails MAY be retried once by the caller with a fresh request; WP-7 MUST NOT auto-retry internally beyond a single bounded attempt, and MUST NOT weaken containment on retry.
- **SYM-013.** Special files reached through resolution (devices, sockets, FIFOs) MUST be rejected by descriptor-based type inspection after open (SYM-009); containment does not replace type policy.
- **SYM-014.** WP-7 MUST NOT follow directory entries it has not independently contained; directory listing returns names and type hints only, and any later read revalidates independently.

---

## 6. Controlled Read Surface

**6.1 Operation set (normative, closed).**

- **RD-001.** WP-7 MUST provide exactly four controlled-read operations: **list-directory**, **inspect-metadata**, **read-text**, and **read-bytes**.
- **RD-002.** Justification (minimum sufficient for the roadmap consumers): list-directory serves WP-8/WP-9 discovery and inspection; inspect-metadata serves type/existence inspection and WP-11 point-of-use revalidation; read-text serves task/context/artifact inspection (WP-9/WP-10/WP-13); read-bytes serves bounded binary inspection. No additional operations MAY be added for convenience; any new operation requires a contract revision.
- **RD-003.** No recursive listing exists in the core surface (recursion depth is therefore NOT APPLICABLE; consumers compose repeated list operations).
- **RD-004.** No write, append, create, or delete variant exists.

**6.2 Per-operation definitions.**

*list-directory*
- **RD-005.** Input: `workspaceId`, canonical workspace-relative directory path (request token `.` for the root), optional `maxEntries` within the configured bound (Area 13).
- **RD-006.** Output: deterministic ordered entries — each `{ name, kindHint }` where `kindHint` is one of `file`, `directory`, `symlink`, `other` — plus `truncated: boolean` and the returned count. Entries MUST be sorted by UTF-8 byte order of `name`. The `kindHint` is non-authoritative: it is derived from the directory entry type when available on the lane; unknown entry type maps to `other`. No uncontrolled per-entry stat calls MAY be performed. Any later operation on a listed entry performs independent capture, containment, open, and descriptor verification.
- **RD-007.** The target MUST be a directory opened through the descriptor-bound strategy; a file target MUST fail (ERR-FTYPE-UNSUPPORTED). A missing target MUST fail (ERR-NOT-FOUND).
- **RD-008.** Entry limit: when the entry count exceeds the bound, WP-7 MUST return the first `maxEntries` entries (in sorted order) with `truncated: true`; silent clipping MUST NOT occur.

*inspect-metadata*
- **RD-009.** Input: `workspaceId`, canonical workspace-relative path.
- **RD-010.** This operation uses **logical-entry `lstat` semantics** after prospective containment of the complete logical path. It reports whether the logical entry itself is a symlink; it does NOT expose the symlink target. A symlink whose resolved target escapes the workspace fails containment before metadata is returned. Output: `{ kind: 'file' | 'directory' | 'symlink' | 'other', sizeBytes?: number, isRegularFile: boolean, isDirectory: boolean, isSymbolicLink: boolean, isSpecial: boolean }` plus the containment decision identity. No modification timestamp is exposed. No other metadata MAY be exposed.
- **RD-011.** Missing targets fail with ERR-NOT-FOUND; permission-denied with ERR-PERM-DENIED; special files are reported as `kind: 'other'`/`isSpecial: true` and MUST NOT be readable.

*read-text*
- **RD-012.** Input: `workspaceId`, canonical workspace-relative file path, optional `maxBytes` within the bound.
- **RD-013.** Output: `{ text, byteLength, truncated }`. The file MUST be read as bytes through the bound descriptor first, then decoded as strict UTF-8 (fatal on malformed sequences — WP-3 strict-decoding rule). `byteLength` means the number of raw file bytes returned in the read window before UTF-8 decoding. Malformed UTF-8 MUST fail with ERR-TEXT-MALFORMED; no replacement-character substitution MAY occur. Empty regular files succeed with empty text and `byteLength: 0`. File growth or shrink during read is handled through the already-opened descriptor; the result is bounded by the descriptor read at open time; no path reopen occurs.
- **RD-014.** A directory, symlink-to-directory, or special-file target MUST fail (ERR-FTYPE-UNSUPPORTED).
- **RD-015.** When the file exceeds `maxBytes`, WP-7 MUST read at most `maxBytes` bytes and return `truncated: true`. If the truncation boundary splits a multi-byte UTF-8 code point, the operation MUST fail with ERR-TEXT-MALFORMED. This is the single normative behavior; there is no "return valid prefix" alternative.
- **RD-016.** Binary content policy: if the read window contains any NUL byte, the operation MUST fail with ERR-FTYPE-UNSUPPORTED. This is the single normative behavior; there is no "succeed as text" alternative. Binary files must be read through read-bytes.

*read-bytes*
- **RD-017.** Input: `workspaceId`, canonical workspace-relative file path, optional `maxBytes` within the bound.
- **RD-018.** Output: `{ bytes, byteLength, truncated }` where `bytes` is a bounded `Uint8Array`. The implementation creates an internal buffer; the returned `Uint8Array` is a fresh copy. Mutation of the caller-visible `Uint8Array` MUST NOT affect service state, caches, correlations, or later results. The containing result object is frozen; the `Uint8Array` copy-on-return provides ownership isolation. Directory and special-file targets MUST fail.
- **RD-019.** read-bytes is the only binary path; it MUST NOT be used to bypass text policy (both are bounded by the same byte limit).

**6.3 Common read rules.**

- **RD-020.** Every read operation MUST perform descriptor-bound point-of-use verification (CON-006/CON-007, SYM-008/SYM-009) and MUST fail closed on divergence. Permission failures MUST map to ERR-PERM-DENIED; no raw OS error text MAY be exposed.

**6.4 Special-file handling (normative).**

- **RD-021.** Descriptor acquisition for pre-read type inspection MUST use `O_NONBLOCK` (or a supported-lane equivalent, e.g. `fs.constants.O_NONBLOCK` on Node.js 22.23.2). The nonblocking flag MUST be applied before the descriptor is obtained. After opening through the descriptor-bound strategy with `O_NONBLOCK`, WP-7 MUST perform `fstat` (or equivalent) on the opened descriptor. Only regular files are accepted by read-text/read-bytes. Directory handles are accepted only by list-directory. FIFO, socket, block device, character device, and other special files MUST fail with ERR-FTYPE-UNSUPPORTED; their descriptors MUST be closed after rejection. A pre-open `stat` call followed by a separate path-based `open` is NOT sufficient; the descriptor opened is the one validated. Failure to obtain a safe nonblocking descriptor MUST fail closed. No implementation may perform a blocking FIFO open merely to discover the object type.

---

## 7. Git Read-Only Inspection

**7.1 Supported operations (normative, closed).**

- **GIT-001.** WP-7 MUST provide exactly four Git inspection operations: **git-status**, **git-diff**, **git-log**, and **git-show** (selected-commit inspection). This set matches the WP-0 MVP scope ("inspect Git status, diffs, logs, and selected commits in read-only mode").
- **GIT-002.** No other Git operation MAY be added without a contract revision.

**7.2 Git host-lane contract (normative).**

- **GIT-003.** The trusted internal composition supplies a fixed, absolute Git executable path at initialization. The path MUST NOT come from request data, environment variables, or operation-time PATH lookup. The supported lane records the verified path (e.g. `/home/chef/.local/git-2.45.4/bin/git` for this lane) but portable source MUST NOT hard-code a user-home path as the universal value. The supported Git version for this lane is exactly **2.45.4**.
- **GIT-004.** Initialization MUST validate the Git binary: absolute canonical path; regular executable file; no symlink path component; owner is root or the trusted service user; not group-writable; not world-writable; executable mode present; version output equals the supported version. Initialization MUST record the initial device/inode/mode/size/mtime and SHA-256 fingerprint. Immediately before every launch, the fingerprint MUST be revalidated; replacement or drift fails with ERR-GIT-UNAVAILABLE. Initialization may fail rather than defer when the binary is unavailable.

**7.3 Repository preflight (normative).**

- **GIT-005.** Before any Git invocation, WP-7 MUST inspect the repository through contained, bounded reads. The workspace root MUST contain a real `.git` directory. The `.git` entry MUST NOT be a symlink. `.git` files used for preflight MUST be regular files. Worktree (`.git` file) and bare repositories MUST fail with ERR-GIT-STATE-UNSUPPORTED.
- **GIT-006.** WP-7 MUST reject repositories containing any of the following in `.git`: a `commondir` file; `objects/info/alternates` or any alternate object database reference. The child environment MUST set `GIT_ALTERNATE_OBJECT_DIRECTORIES` to empty and MUST unset `GIT_OBJECT_DIRECTORY` and `GIT_COMMON_DIR`.
- **GIT-007.** Submodule policy: submodule entries are data (gitlink entries in status/diff); WP-7 MUST NOT traverse into submodule repositories.
- **GIT-008.** Detached HEAD is supported; status/log/show behave normally; the result MAY report detached-HEAD state in metadata.
- **GIT-009.** Unborn repository (no commits): status MUST succeed with an empty or unborn marker; log MUST return zero records (not an error); show MUST fail with ERR-GIT-STATE-UNSUPPORTED. This is the single normative behavior.
- **GIT-010.** Malformed refs and hostile commit messages are data: messages MUST be returned bounded as text, never interpreted; hostile content MUST NOT reach the command line.

**7.4 Local Git configuration rejection (normative).**

- **GIT-011.** Before invoking Git, WP-7 MUST parse the repository's `.git/config` as hostile bounded data through contained read-text. WP-7 MUST reject the repository (ERR-GIT-STATE-UNSUPPORTED) when local config contains any of: `[include]` sections; `[includeIf …]` sections; `core.worktree`; `core.fsmonitor`; `core.hooksPath`; `diff.external`; any `diff.<driver>.command`; any `diff.<driver>.textconv`; any `pager.*`; any `credential.*`; `log.showSignature`; any `gpg.*`; or any other executable or external-helper configuration key. Config parsing MUST reject accessors, symlinks, external includes, malformed encoding, oversized config (>1 MiB), and duplicate security-sensitive keys. The preflight policy is a closed rejection policy, not an alternate Git-config authority engine. When a `.git/config` file that exists cannot be read (for example an OS open failure such as EPERM/EACCES/EIO or a transient ENOENT read race), WP-7 MUST represent the case as an internal `config-read-unavailable` reason under the existing ERR-GIT-STATE-UNSUPPORTED fail-closed code — it is never mistaken for `".git/config content changed"` (a genuine digest diff) or for config absence. No new public error code is introduced (ERR-002 is a closed 23-code set).

**7.5 Invocation model (normative).**

- **GIT-012.** Git MUST be invoked without a shell (execFile-style direct exec); no argument interpolation, no shell metacharacters, no user-supplied subcommand, and no user-supplied arbitrary option MAY reach the command line. The only executable the wrapper may launch is the fixed trusted Git binary.
- **GIT-013.** The subcommand MUST come from the implementation-owned allowlist (`status`, `diff`, `log`, `show`). Options are the fixed contract-approved sets in 7.6. The only request-derived arguments are validated data passed after the `--` separator (pathspecs for diff; a validated full commit ID for show).
- **GIT-014.** Write-capable Git operations MUST NOT be invocable through the wrapper; the fixed argv allowlist is the enforcement mechanism, proven by mutation-tripwire tests (Area 8).
- **GIT-015.** Output MUST be captured from stdout only with a byte bound (Area 13) and a per-operation timeout; stderr MUST be captured bounded and MUST NOT be disclosed (mapped to sanitized failures).
- **GIT-016.** A non-repository workspace, unsupported repository state, or Git failure MUST NOT fall back to filesystem reads or to another Git invocation mode.

**7.6 Fixed invocation argv (normative).**

Every Git invocation MUST use the exact global option prefix:

```
<absolute-git>
--no-pager
--no-optional-locks
--no-replace-objects
-c core.fsmonitor=
-c core.hooksPath=
-c core.pager=
-c pager.status=
-c pager.diff=
-c pager.log=
-c pager.show=
-c diff.external=
-c core.attributesfile=/dev/null
-c credential.helper=
-c log.showSignature=false
-c status.showUntrackedFiles=normal
```

followed by the allowlisted subcommand and its fixed subcommand options. `--no-optional-locks` is a Git-level option placed before the subcommand; the wrapper MUST order argv correctly.

- **GIT-017.** `git-status`: after the global prefix (which includes `-c status.showUntrackedFiles=normal`), `status --porcelain=v1 -z`. Parsed into structured records `{ path, indexState, worktreeState, originalPath? }` handling rename/copy records with NUL-terminated path fields. Records MUST be sorted by path (UTF-8 byte order). No `--untracked-files` expansion beyond the fixed default (`normal`). The local repository configuration cannot change this behavior. Malformed framing fails closed with ERR-GIT-SANITIZED-FAILURE.
- **GIT-018.** `git-diff`: after the global prefix, `diff --no-color --no-ext-diff --no-textconv` with optional validated canonical workspace-relative pathspecs after `--`. `--no-textconv` is the Git 2.45.4-compatible option: it disables text conversion (textconv), it is part of the fixed allowlisted diff argv, request data cannot alter it, and local Git configuration cannot override the no-textconv behavior (it works together with `--no-ext-diff`, `-c diff.external=`, and `-c core.attributesfile=/dev/null`; no external diff or textconv command may execute). Pathspecs MUST be canonical workspace-relative forms and MUST NOT contain `:(` pathspec-magic prefixes or `:`-prefixed forms. Filenames beginning with `-` are valid data when placed after `--`. Output is bounded raw diff text as hostile text; no structural parsing of the diff body is performed. The result includes `{ text, byteLength, truncated }`. No security decision depends on diff text. The operation remains read-only; no other Git option changes.
- **GIT-019.** `git-log`: after the global prefix, `log --no-color --date=iso-strict --format=%H%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%B%x00%x00` with a `maxRecords` bound. The parser consumes bytes with exact field-count expectations; malformed framing fails with ERR-GIT-SANITIZED-FAILURE. Output truncation MUST NOT return a partial record; only complete NUL-delimited records are returned. Records MUST be ordered by commit date descending with ties broken by full commit ID ascending (deterministic independent of Git's internal order).
- **GIT-020.** `git-show`: after the global prefix (which already includes `--no-replace-objects`), `show --no-color --date=iso-strict --format=%H%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%B%x00%x00`. Input MUST be a full 40-hex lowercase commit ID (`/^[0-9a-f]{40}$/`); refs, short SHAs, symbolic names, and user pathspecs MUST be rejected (ERR-REQ-INVALID). No user-supplied options are permitted. Metadata uses exact NUL framing as in git-log. Optional bounded stat/diff-summary text remains hostile text. Output: `{ commitId, subject, authorName, authorEmail, authorDate, commitDate, message, stat?, truncated }`. Malformed framing fails closed.
- **GIT-021.** Repository selection: the repository MUST be the workspace root itself when the preflight (7.3) confirms a valid `.git` directory; no parent-directory walk-up MAY occur. A workspace without a valid `.git` entry MUST fail with ERR-GIT-NOT-REPO.

**7.7 Sanitized child environment (normative).**

- **GIT-022.** The child environment MUST be constructed from scratch (not inherited) with exactly: `LC_ALL=C`; `LANG=C`; `PATH=` (empty); validated pre-provisioned `HOME` (see Area 8); validated pre-provisioned `TMPDIR` (see Area 8); `GIT_CONFIG_NOSYSTEM=1`; `GIT_CONFIG_GLOBAL=/dev/null`; `GIT_CONFIG_SYSTEM=/dev/null`; `GIT_TERMINAL_PROMPT=0`; `GIT_ALTERNATE_OBJECT_DIRECTORIES=` (empty). All other `GIT_*` environment variables MUST be unset.
- **GIT-023.** The environment MUST NOT set `GIT_PAGER`, `GIT_EDITOR`, `GIT_ASKPASS`, or `GIT_SSH_COMMAND` to any executable path (including `cat`, `true`, `/bin/false`). Pager and editor suppression is achieved through the fixed `-c` argv and `--no-pager`; credential/SSH helpers are blocked by `-c credential.helper=` and the empty `PATH`.

**7.8 Exit-status mapping (normative).**

- **GIT-024.** Exit-status mapping: 0 → success; 128 with sanitized category → ERR-GIT-SANITIZED-FAILURE or the specific state error; timeout → ERR-GIT-TIMEOUT; unavailable executable → ERR-GIT-UNAVAILABLE. Raw exit text MUST NOT be disclosed.
- **GIT-025.** Output limits and timeouts: per Area 13 (default 8 MiB output, 5 s per operation); exceeded output → truncated result with `truncated: true` where structured, or ERR-GIT-SANITIZED-FAILURE where truncation is not safely representable; exceeded timeout → ERR-GIT-TIMEOUT.

---

## 8. Read-Only Guarantee

**8.1 Mutation prohibition.**

- **RO-001.** WP-7 MUST NOT mutate workspace files, `.git`, the index, refs, `HEAD`, configuration, the object database, reflogs, or worktree metadata through any WP-7 operation.

**8.2 HOME and TMPDIR (host-preprovisioned model).**

- **RO-002.** WP-7 MUST NOT create HOME or TMPDIR. Trusted host initialization supplies two pre-existing empty directories. Directories MUST be outside the workspace, canonical, non-symlink, owned by root or the trusted service user, not group/world writable, and read-only to the Git child. No per-operation file creation is permitted within these directories.
- **RO-003.** Initialization fingerprints the HOME and TMPDIR path set, modes, ownership, and contents. The Git binary and its containing directory path are also fingerprinted at initialization for replacement detection.

**8.3 Fingerprint evidence model (test-time).**

- **RO-004.** Every Git and read operation in the test matrix MUST be surrounded by a before/after fingerprint covering: all workspace files, `.git` files, HOME contents, TMPDIR contents, and the Git binary/containing-path attributes. Fingerprint fields: sorted file list (paths), file sizes, modes (excluding atime), content SHA-256s, and the set of `.git` lock files (`*.lock`). The before and after fingerprints MUST be identical (content, size, mode, path set). The after-state MUST contain no `*.lock` files and no new files in HOME or TMPDIR.
- **RO-005.** Access-time limitation: atime updates by the OS are outside the guarantee unless the supported lane mounts disable them; the fingerprint comparison MUST ignore atime and MUST document the lane's atime behavior (noatime/relatime). The guarantee covers content, size, mode, and path set.
- **RO-006.** Mutation guarantee scope (normative): *no mutation of the workspace, repository internals, trusted HOME/TMPDIR directories, or any other path writable or reachable by the WP-7 child environment.* WP-7 MUST NOT claim an unobservable "no files anywhere" guarantee.

**8.4 Subprocess and failure-path guarantees.**

- **RO-007.** Subprocess side effects: the Git child MUST terminate within the timeout; the wrapper MUST wait for and reap the child; no orphaned process MAY remain (tested).
- **RO-008.** Failure-path behavior: a failed, timed-out, or killed Git invocation MUST leave the repository, HOME, and TMPDIR in the same fingerprint state; the failure fingerprint comparison applies to failure paths too.
- **RO-009.** The read-only guarantee MUST be asserted by mutation-tripwire tests for every supported operation, both success and failure paths, including: clean repository, modified tracked file, untracked file, staged state, detached HEAD, unborn repository, non-repository, and timeout.
- **RO-010.** The guarantee extends to `git status --porcelain -z` parse behavior: parsing MUST NOT invoke Git again and MUST NOT write.
- **RO-011.** WP-7 MUST NOT set, modify, or delete Git configuration files, environment, or index state as a side effect of inspection.
- **RO-012.** Documentation: the implementation report MUST state the lane's atime behavior and the exact fingerprint fields used.

---

## 9. Internal FFF Discovery

**9.1 Provider model (implementation-owned decision, resolved).**

- **FFF-001.** FFF is a replaceable internal discovery provider behind a defined interface (Area 10). The selected model is: **provider interface + deterministic internal provider as the WP-7-B default binding**; no external SDK is integrated in WP-7-B; no dependency is added. Evidence: no FFF SDK exists in the repository or dependencies; the WP-0 scope defers "FFF SDK integration" from planning; the roadmap owns "internal discovery (FFF)" as an internal capability. An external SDK binding would require a later reviewed change with version pinning and would not alter the security boundary (the security boundary never depends on the ranker).
- **FFF-002.** The normative security boundary MUST NOT depend on any third-party ranker; FFF is a presentation/discovery component only.

**9.2 Access substrate: controlled-reader capability model.**

- **FFF-003.** The FFF provider MUST NOT access `node:fs`, absolute roots, containment resolvers, or Git directly. It receives a bounded capability exposing only: `listDirectory`, `readText`, cancellation state, and scan-budget accounting. The provider recursively composes controlled-reader calls.
- **FFF-004.** Scan behavior (normative): deterministic breadth-first traversal; canonical path byte-order within each level; never follow symlink entries; maximum depth: **32**; maximum visited entries: **10,000**; maximum candidate regular files: **2,000**; maximum total content bytes read: **16 MiB**; per-file content window: **64 KiB**. Operation timeout and cancellation apply to the whole discovery operation. Workspace mutations during scanning may produce a mixed observational result, but every individual list/read is independently captured and contained. No claim of atomic workspace snapshot is made. Resource exhaustion returns explicit `truncated: true` metadata, not silent incompleteness.

**9.3 Discovery contract.**

- **FFF-005.** Discovery request: `{ workspaceId, query, maxResults }` — query is untrusted text; `maxResults` bounded by the configured result limit.
- **FFF-006.** Result shape: `{ items: [{ path (canonical workspace-relative), score, snippet? }], truncated }`, with `maxResults` bound and `truncated: true` when the bound is hit.
- **FFF-007.** Ranking representation: a numeric score; ranking is presentational. Ties MUST be broken deterministically by path (UTF-8 byte order).
- **FFF-008.** Query limits: maximum **256 UTF-8 bytes**; query MUST NOT be interpreted as instructions or regex. Non-empty literal UTF-8 byte sequence; no case folding; no Unicode normalization. An empty query is rejected (ERR-REQ-INVALID).
- **FFF-009.** Content-snippet policy: snippets MUST be bounded (default 512 UTF-8 bytes), MUST be marked as untrusted data, and MUST NOT be rendered as instructions; hostile filenames and snippets remain data.
- **FFF-010.** Path representation in results: canonical workspace-relative paths only (PAT-001); discovery output MUST NOT reveal configured roots.

**9.4 Ranking semantics (normative deterministic provider).**

- **FFF-011.** Candidates are canonical workspace-relative regular files only. Excluded: directories, symlinks, special files, and files whose read-text window contains NUL. Binary/NUL-containing files are not content-scanned (score may come from path/name matching only).
- **FFF-012.** Score computation (integer, zero-based):
  - `+1000` when the file basename contains the query string (literal byte sequence);
  - `+500` when the full canonical workspace-relative path contains the query;
  - `+1` per non-overlapping content occurrence within the per-file content window, capped at `100`;
  - candidates with total score `0` are omitted.
- **FFF-013.** Sort: score descending, then canonical path UTF-8 byte order ascending.
- **FFF-014.** Snippet: taken from the content around the first occurrence; snippet boundaries MUST be valid UTF-8.
- **FFF-015.** Duplicate results MUST be normalized deterministically: deduplicated by canonical path before scoring and tie-breaking.
- **FFF-016.** These weights are product-ranking behavior only and have no security effect.

**9.5 Non-authority and provider rules.**

- **FFF-017.** FFF MUST NOT authorize a path: every returned path MUST undergo independent containment validation (Area 3) before any actual read or Git operation (TRU-007).
- **FFF-018.** FFF completeness MUST NOT be assumed: discovery results are never evidence of exhaustive verification (WP-0).
- **FFF-019.** Rankings MUST NOT affect security decisions: authorization, containment, and ordering of reads are independent of FFF scores.
- **FFF-020.** The internal provider MUST be deterministic (same query, same workspace state → same ordered result set), enabling reproducible tests.
- **FFF-021.** Provider failure behavior: unavailable → ERR-FFF-UNAVAILABLE; timeout → ERR-FFF-TIMEOUT; malformed output → ERR-FFF-MALFORMED. Fail closed; no partial ranking MAY be presented as complete.
- **FFF-022.** Timeout and cancellation: discovery MUST respect the same per-operation timeout model (Area 13); cancellation propagates deterministically; scan-budget exhaustion is reported with truncation metadata.

---

## 10. Internal Interfaces

The following shapes are normative contracts for WP-7-B; they are type-level definitions in this document, not implementations. All are internal; none is exported from the package root (Area 14).

**10.1 Operation-name literals (closed).**

```
OperationName =
  | 'list-directory'
  | 'inspect-metadata'
  | 'read-text'
  | 'read-bytes'
  | 'git-status'
  | 'git-diff'
  | 'git-log'
  | 'git-show'
  | 'fff-discover'
```

**10.2 Request and result discriminated unions.**

**Hostile request data (`HostileOperationRequestData`):**
- exact `operation: OperationName`;
- `workspaceId: string`;
- operation-specific fields (path, maxBytes, maxEntries, query, commitId, pathspecs, maxRecords, maxResults);
- optional trusted-lower-bound `maxBytes`/`maxEntries`/`maxResults` request (MAY request less than the configured default, MUST NOT request more).

**Trusted operation control (`TrustedOperationControl`, separate operand):**
- `signal?: AbortSignal` — a genuine platform `AbortSignal` supplied by the internal caller;
- the control operand is trusted and MUST NOT undergo hostile-request snapshot capture;
- `AbortSignal` MUST NOT appear inside the hostile request-data discriminated union.

The internal call model is:
```
execute(
  requestData: HostileOperationRequestData,
  control: TrustedOperationControl
): Promise<OperationResult>
```

`requestData` is hostile and MUST undergo descriptor-safe snapshot capture.
`control` is a separate trusted internal operand. The service MUST validate that `control.signal`, when present, is a genuine platform `AbortSignal` (no caller-defined getters or conversion hooks MAY be invoked). Only `aborted` state and add/remove abort-event listener may be consumed; the platform abort reason MUST NOT be exposed in failures. The raw signal object MUST NOT be copied into the frozen request snapshot. Abort reasons, exception text, and caller values MUST NOT be included in structured failures. Any future trusted caller-supplied capability MUST use a separate trusted control/construction operand and MUST NOT be embedded in hostile request data.

Every result uses the discriminated union:
```
{ ok: true, value: <operation-specific>, correlation: OperationCorrelation }
  |
{ ok: false, failure: OperationFailure }
```

**10.3 Correlation.**

```
OperationCorrelation {
  workspaceId: string;
  operation: OperationName;
  canonicalWorkspaceRelativePath?: string;
  containmentDecisionIdentity?: string;  // the point-of-use decision identity
}
```

**10.4 Service contracts.**

- **INT-001.** `WorkspaceInspectionService` (owner WP-7; consumers WP-8/WP-9/WP-10/WP-13): exposes `listDirectory`, `inspectMetadata`, `readText`, `readBytes` with the shapes defined in Area 6 and the discriminated-union result wrapper. Internal only.
- **INT-002.** `GitInspectionService` (owner WP-7; consumers WP-9/WP-13): exposes `status`, `diff`, `log`, `show` with the shapes defined in Area 7 and the discriminated-union result wrapper. Internal only.
- **INT-003.** `FffDiscoveryProvider` (owner WP-7; consumer WP-7 discovery surface): `discover(request): FffDiscoveryResult` with the shapes defined in Area 9 and the discriminated-union result wrapper. Receives the bounded capability (FFF-003). Internal only; replaceable; the security boundary does not depend on it.

**10.5 Service lifecycle.**

- **INT-004.** Service factories receive as trusted construction options: the runtime-genuine validated trusted workspace configuration; the WP-6 containment primitives; the injected live filesystem resolver; the pinned resource limits; the trusted Git host-lane descriptor (executable path, verified fingerprint, HOME/TMPDIR paths); and the cancellation/concurrency controller.
- **INT-005.** Initialization returns a structured success/failure. On failure, no service methods may be invoked.
- **INT-006.** Services own and close descriptors and child processes. `dispose()` is idempotent; no operation may begin after disposal.
- **INT-007.** Services are internal singletons per trusted configuration instance. Concurrency is owned by the composed WP-7 service (maximum 4 active operations; exceeding this fails immediately with ERR-LIMIT-CONCURRENCY; no internal waiting queue exists).

**10.6 Additional interface rules.**

- **INT-008.** Containment consumption: WP-7 consumes the committed `evaluateExistingPathContainment(request, options)` from `src/trusted/**` and `parseWorkspaceRelativePath` (re-exported from the trusted barrel per CON-001). WP-7 MUST NOT wrap containment in a way that alters its semantics.
- **INT-009.** Runtime validation: request objects are captured through the established descriptor-safe snapshot pattern (see Area 2B — Hostile Request Capture) before any trusted operand is touched; hostile request fields fail with ERR-REQ-INVALID.
- **INT-010.** Trusted/hostile status: configuration and containment options are trusted operands supplied by the internal caller; everything else in requests is hostile until validated.
- **INT-011.** Mutation semantics: all interfaces are read-only; no interface exposes a mutation capability. Result objects are frozen. `Uint8Array` return values are fresh copies; mutation of the caller's copy does not affect service state.
- **INT-012.** Package visibility: all interfaces are internal; none is exported through `src/index.ts` or the package export map.
- **INT-013.** Versioning: interface shapes are versioned by the WP-7 contract revision; internal consumers compile against the internal barrel.

### 10B. Hostile Request Capture (normative)

- **HRC-001.** Every WP-7 request MUST be captured through descriptor-safe snapshot hardening before any ordinary property read. The mechanism follows the established `src/internal/snapshot.ts` pattern (used by WP-6 `snapshotTrustedWorkspaceConfigurationInput`).
- **HRC-002.** The snapshot MUST: inspect exact-own data-property descriptors; reject accessor properties without invocation; reject inherited-only required properties; reject unknown fields; reject symbol-keyed fields; catch structural Proxy traps and map them to ERR-REQ-INVALID; never invoke Proxy `get`; detach arrays, pathspecs, limits, and query strings into the snapshot; validate primitives before use; freeze the detached plain-object snapshot; ensure subsequent mutation of the caller object cannot affect the operation. Cancellation control (`AbortSignal`) is a separate trusted operand (see Area 10.2) and MUST NOT pass through the hostile-request snapshot path. The snapshot MUST NOT attempt to copy a `signal` property from the hostile request object.
- **HRC-003.** Cycles and unsupported prototypes MUST fail closed (ERR-REQ-INVALID).
- **HRC-004.** WP-7-B MAY add request-specific snapshot helpers in WP-7-owned internal modules. WP-7-B MUST NOT modify `src/internal/snapshot.ts`.

---

## 11. Error and Finding Model

- **ERR-001.** WP-7 MUST use a deterministic structured operational error model: stable error codes + safe message keys + operation-result unions (INT-006). WP-7 MUST NOT introduce semantic-rule catalog entries: read/discovery failures are operational, not artifact semantic violations (the eligibility basis expects no WP-3 catalog expansion).
- **ERR-002.** The error-code namespace is `ERR-<AREA>-<NAME>` with a closed enumeration of **23 codes**: ERR-REQ-INVALID, ERR-WS-UNKNOWN, ERR-CON-DENIED, ERR-SYM-ESCAPE, ERR-PAT-TRAVERSAL, ERR-FTYPE-UNSUPPORTED, ERR-NOT-FOUND, ERR-PERM-DENIED, ERR-LIMIT-SIZE, ERR-LIMIT-ENTRIES, ERR-LIMIT-RESULTS, ERR-LIMIT-CONCURRENCY, ERR-TEXT-MALFORMED, ERR-OP-CANCELLED, ERR-GIT-UNAVAILABLE, ERR-GIT-NOT-REPO, ERR-GIT-STATE-UNSUPPORTED, ERR-GIT-TIMEOUT, ERR-GIT-SANITIZED-FAILURE, ERR-FFF-UNAVAILABLE, ERR-FFF-TIMEOUT, ERR-FFF-MALFORMED, ERR-INTERNAL-INVARIANT.
- **ERR-003.** Every failure MUST carry: stable code; stage (request-validation | containment | filesystem | git | discovery | internal); safe message key (e.g., `wp7.<area>.<condition>`); disclosure policy; retry classification; and the correlation fields (INT-004).
- **ERR-004.** Disclosure policy (normative): failures MUST NOT expose absolute roots, the `resolvedAbsolutePath`, raw Git command lines, raw stderr, stack traces, environment values, or hostile path strings whose disclosure would escape the logical path policy. Workspace-relative canonical paths MAY be disclosed.
- **ERR-005.** Git failures MUST be sanitized: exit status mapped per GIT-024; stderr captured bounded and replaced by the safe message; no raw Git output in failures.
- **ERR-006.** Hostile Git/FFF/filesystem content MUST NOT be stringified into failure messages.
- **ERR-007.** Error precedence (deterministic): request validation → workspace resolution → containment → repository preflight → type policy → resource limits → I/O → Git/FFF specific.
- **ERR-008.** Internal invariant failures (including revalidation divergence) MUST map to ERR-INTERNAL-INVARIANT or the specific containment denial (ERR-CON-DENIED); they MUST NOT escape as raw exceptions.
- **ERR-009.** Retry: only ERR-GIT-TIMEOUT, ERR-GIT-UNAVAILABLE, ERR-FFF-TIMEOUT, and ERR-FFF-UNAVAILABLE are retryable. ERR-OP-CANCELLED is NOT retryable. Retries MUST NOT weaken any check.
- **ERR-010.** No exception MAY escape the WP-7 internal boundary; every path returns the structured failure union.

**11.1 Error-mapping table (normative).**

| Condition | Code | Retryable |
|---|---|---|
| Malformed UTF-8, including truncated byte window that splits a UTF-8 code point | ERR-TEXT-MALFORMED | No |
| Malformed request, invalid root token, unknown field, accessor/Proxy | ERR-REQ-INVALID | No |
| Unknown workspace | ERR-WS-UNKNOWN | No |
| Lexical or bounded-pop escape (.. traversal) | ERR-PAT-TRAVERSAL | No |
| Ordinary containment denial | ERR-CON-DENIED | No |
| Symlink target outside matched workspace | ERR-SYM-ESCAPE | No |
| Missing ordinary target | ERR-NOT-FOUND | No |
| Broken symlink | ERR-NOT-FOUND | No |
| Point-of-use divergence (descriptor vs. containment mismatch) | ERR-CON-DENIED | No |
| Unsupported opened type (FIFO, socket, device, directory-for-read, file-for-list) | ERR-FTYPE-UNSUPPORTED | No |
| Permission failure | ERR-PERM-DENIED | No |
| Byte overflow with supported truncation | successful truncated result | N/A |
| Byte overflow where result cannot be safely framed | ERR-LIMIT-SIZE | No |
| Entry limit with supported truncation | successful truncated result | N/A |
| Entry limit where a safe truncated result cannot be produced | ERR-LIMIT-ENTRIES | No |
| Result limit with supported truncation | successful truncated result | N/A |
| Result limit where a safe truncated result cannot be produced | ERR-LIMIT-RESULTS | No |
| Concurrency rejection (exceeds max active operations) | ERR-LIMIT-CONCURRENCY | No |
| Caller cancellation via trusted AbortSignal control operand | ERR-OP-CANCELLED | No |
| Request-path exceeds 4096 UTF-8 bytes | ERR-REQ-INVALID | No |
| Git timeout | ERR-GIT-TIMEOUT | Yes |
| Git executable unavailable or fingerprint mismatch | ERR-GIT-UNAVAILABLE | Yes |
| Unsupported Git repository state (bare, worktree, alternates, commondir, rejected config) | ERR-GIT-STATE-UNSUPPORTED | No |
| Unexpected nonzero Git exit after successful preflight | ERR-GIT-SANITIZED-FAILURE | No |
| Workspace root does not contain an accepted regular .git directory (not a Git repository) | ERR-GIT-NOT-REPO | No |
| FFF timeout | ERR-FFF-TIMEOUT | Yes |
| FFF provider cannot be initialized or is unavailable before discovery begins | ERR-FFF-UNAVAILABLE | Yes |
| Malformed provider output | ERR-FFF-MALFORMED | No |
| Unreachable internal invariant | ERR-INTERNAL-INVARIANT | No |

---

## 12. Determinism

- **DET-001.** Directory listings MUST be sorted by UTF-8 byte order of entry names (RD-006).
- **DET-002.** Git status records MUST be sorted by path (UTF-8 byte order) (GIT-017).
- **DET-003.** Git log records MUST be ordered by commit date descending with ties broken by full commit ID ascending (GIT-019), independent of Git's internal ordering.
- **DET-004.** FFF results MUST be ordered by score descending, ties broken by canonical path ascending (FFF-013), after deterministic duplicate normalization (FFF-015).
- **DET-005.** Path normalization is the canonical workspace-relative form only; no other normalization occurs (PAT-001…PAT-010).
- **DET-006.** Observational values (file size, Git dates) are reported as observed; determinism applies to ordering, selection, and truncation, not to observed metadata values. Repeated runs over an unchanged workspace MUST produce identical ordered results. No modification timestamp is exposed.
- **DET-007.** Error precedence is deterministic (ERR-007); identical requests over identical workspace state produce identical failures.
- **DET-008.** Truncation is deterministic: the same request/workspace produces the same truncation boundary.
- **DET-009.** Concurrent completion MUST NOT affect results: each operation is isolated; a bounded concurrency cap (Area 13) MUST NOT reorder or merge results.
- **DET-010.** Timeout classification is deterministic: elapsed-time budget is monotonic per operation; a timeout is reported as ERR-*-TIMEOUT, never as a partial result.

---

## 13. Resource Bounds

- **LIM-001.** Implementation-owned defaults (normative, pinned in WP-7-B; configurable only through a later reviewed trusted-configuration extension): read bytes and read-text window: **1 MiB**; directory entries: **10,000**; Git output bytes: **8 MiB**; Git log records: **1,000**; FFF results: **100**; FFF snippet bytes: **512** UTF-8 bytes; FFF query length: **256 UTF-8 bytes** (not JavaScript UTF-16 code-unit length); request-path maximum: **4096 UTF-8 bytes**; per-operation timeout: **5 s**; total operation budget: **30 s**; maximum concurrent operations: **4**; FFF maximum scan depth: **32**; FFF maximum visited entries: **10,000**; FFF maximum candidate files: **2,000**; FFF maximum total content bytes: **16 MiB**; FFF per-file window: **64 KiB**.
- **LIM-002.** Defaults MUST be implementation-owned constants or trusted-configuration-supplied values with the same defaults; request data MUST NOT lower or raise a limit beyond the trusted bounds (requests MAY request less, never more).
- **LIM-003.** Exceeding a byte/entry/record/result bound MUST produce either the bounded result with explicit `truncated: true` metadata or the corresponding ERR-LIMIT-* failure; silent clipping MUST NOT occur.
- **LIM-004.** A read exceeding the byte bound returns the bounded prefix with `truncated: true` (RD-015 policy applies to text); a listing exceeding the entry bound returns the sorted prefix with `truncated: true`; a log exceeding the record bound returns the sorted prefix with `truncated: true`; FFF exceeding the result bound returns the ranked prefix with `truncated: true`.
- **LIM-005.** The per-operation timeout and total budget MUST be enforced with cancellation; timeout failures are deterministic (DET-010).
- **LIM-006.** Concurrency: maximum 4 active operations. A fifth concurrent admission fails immediately with ERR-LIMIT-CONCURRENCY. No internal waiting queue exists. Callers retry at their discretion with fresh requests.
- **LIM-007.** Partial results are permitted ONLY with explicit truncation metadata; otherwise an operation MUST complete or fail atomically.
- **LIM-008.** Limits apply per operation, not per session; no cross-operation accumulation is required in WP-7-B.

---

## 14. Package and API Boundary

- **PKG-001.** All WP-7 modules are internal; none is exported from `src/index.ts`.
- **PKG-002.** The package export map MUST remain exactly `.` and `./pi-adapter`; no wildcard; no new subpath.
- **PKG-003.** No public MCP tool, no adapter exposure, and no FFF provider export exists.
- **PKG-004.** No concrete trusted-configuration API is exported publicly; WP-7 consumes `src/trusted/**` internally.
- **PKG-005.** Future consumers (WP-8/WP-9/WP-10/WP-11/WP-13) access WP-7 through internal composition (an internal barrel), not package-root publication.
- **PKG-006.** The WP-7 internal barrel MUST NOT re-export WP-6 trusted modules beyond what WP-7 owns. The one authorized exception is the `parseWorkspaceRelativePath` re-export added to `src/trusted/index.ts` during WP-7-B (see CON-001 and DEC-002); this remains an internal barrel export and does not alter `src/index.ts` or the package export map.
- **PKG-007.** Tests MUST assert the negative export surface (no WP-7 name in `src/index.ts`, no export-map change).
- **PKG-008.** No dependency may be added for WP-7-B (current dependencies: `ajv` only; Git invocation uses the system Git binary, not an npm package).

---

## 15. Compatibility

- **CMP-001.** WP-7 MUST NOT change any existing public v1 API (`evaluatePointOfUseEligibility` and related exports).
- **CMP-002.** WP-7 MUST NOT change PointOfUseInputs v2 behavior, WP-6 authority semantics, or the point-of-use identity domains.
- **CMP-003.** WP-7 MUST NOT change schemas (WP-3 catalog stays 51 resources), the semantic-rule catalog (stays 116 rules), conformance resources (stays 587 entries), digest vectors (stays 36), or the generated corpus (stays 358 inputs).
- **CMP-004.** WP-7 MUST NOT change package exports. The default test command keeps its current composition; WP-7-B adds separately runnable focused test scripts that are not integrated into the default `npm test` suite until WP-7-C.
- **CMP-005.** WP-7 consumes WP-6 containment decisions without becoming a second authority engine; no point-of-use or capability evaluation exists in WP-7.
- **CMP-006.** WP-7 MUST NOT modify `src/internal/snapshot.ts`, adapters, or any WP-6-owned module. WP-7-B is authorized to add exactly one re-export line for `parseWorkspaceRelativePath` to `src/trusted/index.ts`; this is the only permitted modification to `src/trusted/**`. The change is export-only and MUST NOT alter parser behavior, types, containment semantics, or any other source.
- **CMP-007.** The supported lane is unchanged: Linux x86_64, POSIX filesystem semantics, UTF-8, Node.js 22.x (verified 22.23.2).
- **CMP-008.** Existing test suites (default 1357, trusted 570, integration 100, PointOfUse-v2 232) MUST remain green and unchanged in count during WP-7-B. WP-7-B adds separately runnable focused test scripts (`test:wp7-reader`, `test:wp7-git`, `test:wp7-fff`, `test:wp7-security`). WP-7-C integrates these into the default test workflow exactly once, updating default test totals and documentation.

---

## 16. Security Properties

- **SEC-001.** No arbitrary execution: the only executable WP-7 may launch is the fixed trusted Git binary under the constrained Git-inspection contract (SCO-013, GIT-003, GIT-012). No shell is ever invoked. No child process other than the verified Git binary may be spawned.
- **SEC-002.** No writes: filesystem and Git mutation are prohibited (SCO-006/SCO-007); the read-only guarantee (Area 8) is test-enforced.
- **SEC-003.** No Git mutation: no index, ref, HEAD, config, object, reflog, or worktree metadata mutation (RO-001…RO-012).
- **SEC-004.** No network: no transport, no sockets, no Git network operations (SCO-009).
- **SEC-005.** No root disclosure: absolute roots and resolved targets never cross the internal boundary (PAT-010, ERR-004).
- **SEC-006.** No raw exception leakage: every failure is the structured safe failure (ERR-003/ERR-010).
- **SEC-007.** No hostile-value evaluation: content, filenames, Git output, commit messages, and FFF snippets are data, never instructions (TRU-005, FFF-009).
- **SEC-008.** No authorization through FFF: FFF never authorizes a path (TRU-007, FFF-017).
- **SEC-009.** No trust from filenames or Git content: repository-derived data establishes no policy or authority (WP-0 trust zones).
- **SEC-010.** Fail-closed containment: every operation is contained and verified through descriptor-bound point-of-use evaluation (CON-006…CON-008, SYM-008/SYM-009).
- **SEC-011.** Bounded resource use: limits and timeouts enforced (Area 13).
- **SEC-012.** Deterministic failures: the error model is closed and deterministic (Area 11/12).
- **SEC-013.** The bounded exception for the Git executable is exactly: launch of the fixed trusted Git binary with the fixed allowlisted argv and sanitized environment (GIT-003…GIT-025); nothing else.
- **SEC-014.** No ambient clock/randomness dependence for decisions: ordering and selection never depend on wall-clock or random values (observational timestamps are data only).

---

## 17. Test Matrix

The following categories are normative requirements for WP-7-B tests (focused unit/integration/security suites; final counts are implementation-owned and not predicted).

- **TST-001.** Controlled reads: valid in-root file; valid directory; empty directory; root path `.`; not found; permission denial; text with malformed UTF-8; NUL rejection; maximum size; truncation flag; truncated multi-byte failure; maximum entries; special-file rejection (device/socket/FIFO where the lane permits constructing them); deterministic ordering; empty-file success; read-bytes copy isolation; metadata logical-entry behavior.
- **TST-002.** Containment: absolute path request; empty-path rejection; traversal (`..`) bounded-pop escape; repeated separators; dot segments; symlink inside root; symlink outside root; ancestor symlink; final-component symlink; broken link; symlink loop; replacement race (target swap between prospective and point-of-use evaluation); descriptor mismatch failure; workspace mismatch; unknown workspace; root-disclosure checks (no absolute root in any result or failure); request-path length limit.
- **TST-003.** Git: clean repository; modified tracked file; untracked file; staged state inspected without mutation; status; diff; log; selected commit; detached HEAD; unborn branch; non-repository workspace; bare repository; worktree repository; submodule entry; repository with alternates/commondir rejection; hostile local config rejection; malformed ref; option injection attempts; pathspec injection attempts (`:(...` forms rejected; `-`-prefixed filenames safe after `--`); hostile commit messages; pager/editor/alias/helper suppression; timeout; output limit; log NUL-framing correctness; show metadata extraction; before/after repository+HOME+TMPDIR mutation proof (RO-004); Git binary fingerprint validation.
- **TST-004.** FFF: valid ranked results; empty results; duplicates; ties; zero-score omission; malformed provider output; out-of-root result (must be rejected at containment, never read); symlink result; provider timeout; provider failure; result limit; snippet limit; root-disclosure checks; scan-budget exhaustion; proof that discovery does not authorize a subsequent read (a discovered out-of-scope path fails the read); deterministic repeated runs.
- **TST-005.** Package boundary: no package-root exports; no dependency leakage; no public FFF surface; export map unchanged.
- **TST-006.** Regression: existing default suite (1357), trusted (570), integration (100), PointOfUse-v2 (232), conformance (587), and generation reproducibility remain green and unchanged during WP-7-B.
- **TST-007.** Mutation tripwires (RO-004): every Git and read operation, success and failure paths, surrounded by before/after fingerprints covering workspace, `.git`, HOME, TMPDIR, and Git binary; zero content/size/mode/path-set differences; zero leftover `*.lock` files; no orphaned processes.
- **TST-008.** Determinism: repeated runs over an unchanged workspace produce identical ordered results (DET-001…DET-010).

---

## 18. Verification and Acceptance

WP-7-B acceptance requires all of:

- **VER-001.** Production typecheck PASS; test typecheck PASS.
- **VER-002.** Focused controlled-reader tests PASS (TST-001/TST-002).
- **VER-003.** Focused Git tests PASS (TST-003).
- **VER-004.** Focused FFF tests PASS (TST-004).
- **VER-005.** Security tests PASS (read-only guarantees, no-execution, no-root-disclosure; TST-007).
- **VER-006.** Integration tests PASS.
- **VER-007.** Mutation-tripwire tests PASS for every supported operation including failure paths.
- **VER-008.** Package-boundary tests PASS (TST-005).
- **VER-009.** Complete existing regressions PASS unchanged during WP-7-B: default 1357/1357, trusted 570/570, integration 100/100, PointOfUse-v2 232/232, conformance 587/587, schemas 51, rules 116, RULE matrix 228, vectors 36, corpus 358. WP-7-C integrates the WP-7 focused suites into the default workflow, updating default totals. Before WP-7-C, the focused suites are run explicitly through separate scripts (`test:wp7-reader`, `test:wp7-git`, `test:wp7-fff`, `test:wp7-security`).
- **VER-010.** Deterministic repeated runs: each focused suite run twice with identical results; generation reproducible with zero diff.
- **VER-011.** Clean generated artifacts: no corpus/manifest/vector change from WP-7-B.
- **VER-012.** Evidence requirements: the WP-7-B report MUST document (a) bounded reads (limits enforced and tested), (b) containment (committed machinery consumed, descriptor-bound revalidation proven), (c) no mutation (fingerprint evidence covering workspace, .git, HOME, TMPDIR, Git binary), (d) no arbitrary execution (invocation model evidence, Git binary fingerprint verification), (e) FFF non-authority (discovery-never-authorizes proof), (f) package privacy (negative export evidence).

Final test counts are implementation-owned and MUST be recorded exactly, never predicted.

---

## 19. Decomposition and Gates

- **DEC-001.** WP-7-A — Foundation and Contract Consolidation (this package): objective — implementation-ready contract, authoritative sources established, current-state documentation corrected, readiness assessed. Prerequisites: WP-6 closed; human authorization. Owned path classes: `docs/specs/**`, `docs/design/**`, `docs/decisions/**` (only for required durable decisions), `docs/reports/**`, stale planning-status wording. Outputs: this contract, the WP-7-A report. Exclusions: any `src/**` change. Review gate: WP-7-A senior review and focused correction review. Correction gate: focused correction review. Commit gate: WP-7-A baseline commit. Closure authority: human.
- **DEC-002.** WP-7-B — Controlled Reader, Git Inspection, and Internal FFF Implementation: objective — implement the contract (Areas 1–18). Prerequisites: WP-7-A accepted and committed; human WP-7-B authorization. Owned path classes: new internal `src/**` modules (reader, git wrapper, FFF provider, internal barrel), new focused tests, internal documentation. Authorized `src/trusted/index.ts` change: exactly one re-export line for `parseWorkspaceRelativePath` (export-only; no behavior change). Exclusions: any other `src/trusted/**` change; package-root exports; dependency installation; schema/rule/corpus changes. Outputs: runtime implementation, tests, implementation report. Review gate: senior review; correction gate: focused correction review; commit gate: WP-7-B baseline commit. Closure authority: human.
- **DEC-003.** WP-7-C — Integration, Security Verification, and Closure: objective — full security verification, mutation-tripwire evidence, focused-test integration into default suite, closure report. Prerequisites: WP-7-B accepted and committed; human authorization. Owned path classes: reports, test-only additions, default-test integration, closure documentation. Exclusions: production behavior changes beyond WP-7-B scope. Outputs: WP-7-C closure report; WP-7 closure. Review gate: independent closure review; commit gate: WP-7 closure commit. Closure authority: human.
- **DEC-004.** WP-7-B and WP-7-C MUST NOT begin without separate human authorization; this contract does not authorize them.
- **DEC-005.** WP-7-A MUST NOT introduce implementation stubs, scaffolding, or empty modules in `src/**`.
- **DEC-006.** Any contract revision after WP-7-B begins MUST pass the same review gates.
- **DEC-007.** The WP-7 closure gate (roadmap): *read-only guarantees tested; no mutation capability* — evidence defined by VER-012.
- **DEC-008.** WP-7 MUST NOT affect WP-5B, WP-8…WP-15 sequencing; consumers are internal composition only.

---

## Appendix A — Requirement Inventory

Complete requirement inventory (counts):

- SCO-001…SCO-013 (13): scope, non-goals, fixed-executable clarification.
- TRU-001…TRU-007 (7): trust model.
- CON-001…CON-010 (10): containment reuse.
- PAT-001…PAT-010 (10): path model.
- SYM-001…SYM-014 (14): symlink/traversal/TOCTOU.
- RD-001…RD-021 (21): controlled read surface.
- GIT-001…GIT-025 (25): Git read-only inspection.
- RO-001…RO-012 (12): read-only guarantee.
- FFF-001…FFF-022 (22): internal FFF discovery.
- INT-001…INT-013 (13): internal interfaces.
- HRC-001…HRC-004 (4): hostile request capture.
- ERR-001…ERR-010 (10): error and finding model.
- DET-001…DET-010 (10): determinism.
- LIM-001…LIM-008 (8): resource bounds.
- PKG-001…PKG-008 (8): package and API boundary.
- CMP-001…CMP-008 (8): compatibility.
- SEC-001…SEC-014 (14): security properties.
- TST-001…TST-008 (8): test matrix.
- VER-001…VER-012 (12): verification and acceptance.
- DEC-001…DEC-008 (8): decomposition and gates.

**Total: 237 normative requirements.**

(Note: RD-021 was added for special-file handling; GIT was restructured from 30 to 25 compact requirements; FFF was restructured from 16 to 22 for access-substrate and ranking detail; INT was expanded from 12 to 13; HRC was added as a new area with 4 requirements. The original count of 221 excluded TRU-008 and had other misalignments; the corrected total is 237.)

## Appendix B — Acceptance Matrix

| Contract area | Requirement IDs | WP-7-B acceptance evidence |
|---|---|---|
| 1. Scope and non-goals | SCO-001…013 | Focused scope tests; no-mutation audits |
| 2. Trust model | TRU-001…007 | Brand/forgery tests; fail-closed tests |
| 3. Containment reuse | CON-001…010 | Reuse tests (committed machinery); descriptor-bound revalidation tests |
| 4. Path model | PAT-001…010 | Path parsing/rejection tests (including root token `.`); length-limit tests |
| 5. Symlink/TOCTOU | SYM-001…014 | Symlink/traversal/descriptor-binding matrices |
| 6. Read surface | RD-001…021 | Read operation matrices (TST-001); type-inspection tests |
| 7. Git inspection | GIT-001…025 | Git operation matrices (TST-003); preflight tests; local-config rejection |
| 8. Read-only guarantee | RO-001…012 | Mutation-tripwire fingerprints (TST-007); HOME/TMPDIR evidence |
| 9. FFF discovery | FFF-001…022 | FFF matrices (TST-004); access-substrate tests; ranking determinism |
| 10. Interfaces | INT-001…013 | Type-level contract; internal-barrel tests; lifecycle tests |
| 10B. Request capture | HRC-001…004 | Snapshot-hardening tests; getter/Proxy rejection tests |
| 11. Error model | ERR-001…010 | Failure-shape tests; error-mapping table coverage; disclosure tests |
| 12. Determinism | DET-001…010 | Repeated-run equality tests |
| 13. Resource bounds | LIM-001…008 | Limit/truncation/timeout/concurrency tests |
| 14. Package boundary | PKG-001…008 | Negative-export tests; barrel-export authorization tests |
| 15. Compatibility | CMP-001…008 | Regression totals unchanged during WP-7-B; focused-test isolation |
| 16. Security properties | SEC-001…014 | Security suite (TST-005/007) |
| 17. Test matrix | TST-001…008 | All matrix categories executed |
| 18. Verification | VER-001…012 | Acceptance evidence recorded |
| 19. Decomposition | DEC-001…008 | Phase gates honored |

## Implementation-Readiness Matrix (WP-7-A corrected)

| Area | Status |
|---|---|
| Inputs | COMPLETE (containment contract consumed; request shapes defined; path model compatible with committed parser; barrel-export authorization specified) |
| Outputs | COMPLETE (read/Git/FFF result shapes defined; Uint8Array copy-on-return ownership; metadata shape closed) |
| Path model | COMPLETE (root token `.`; internal `''` for root; `..` carry-and-pop; 4096-byte bound) |
| Containment | COMPLETE (committed machinery + descriptor-bound point-of-use verification; sequence ordered correctly) |
| Symlink/TOCTOU | COMPLETE (descriptor-bound model; fstat-after-open; lane limits stated; root-replacement detection scoped) |
| Read operations | COMPLETE (closed set of four; single normative NUL/truncation behaviors; lstat semantics for metadata; `kindHint` for listing) |
| Git operations | COMPLETE (closed set of four; exact global argv; host-lane contract; local-config rejection preflight; NUL-framed output) |
| FFF interface | COMPLETE (controlled-reader capability access substrate; pinned ranking semantics; scan limits) |
| Error model | COMPLETE (23 closed codes; complete 23/23 error-mapping table; ERR-OP-CANCELLED and ERR-LIMIT-CONCURRENCY added) |
| Limits | COMPLETE (immediate-fail concurrency; UTF-8 byte units; FFF scan limits; request-path bound) |
| Determinism | COMPLETE (ordering/tie-break/error precedence; FFF score computation pinned) |
| Security | COMPLETE (14 properties; Git executable fingerprint verification; local config closed rejection policy; no GIT_PAGER=cat-style executable launches) |
| Package boundary | COMPLETE (internal only; single authorized barrel re-export; no export change) |
| Compatibility | COMPLETE (no changes to existing surfaces; focused-test isolation lifecycle explicit) |
| Tests | COMPLETE (normative matrix categories; separately runnable scripts; WP-7-C integration) |
| Acceptance gates | COMPLETE (VER-001…012; focused-suite isolation explicit) |
