/**
 * WP-7 — WorkspaceInspectionService.
 *
 * Exposes the four controlled-read operations:
 *   list-directory, inspect-metadata, read-text, read-bytes.
 *
 * Internal only. Consumes WP-6 containment and the descriptor-bound
 * filesystem layer.
 */
import { type OperationCorrelation, type OperationResult, type TrustedOperationControl, success, fail, WP7_LIMITS } from './types.js';
import { validateTrustedOperationControl } from './types.js';
import { validateAndCaptureRequest } from './capture.js';
import { errReqInvalid, errWsUnknown, errConDenied, errNotFound, errPermDenied, errFtypeUnsupported, errTextMalformed, errOpCancelled, errPatTraversal, errSymEscape } from './errors.js';
import { ConcurrencyController } from './admission.js';
import { fstatSync } from 'node:fs';
import {
  type BoundWorkspaceRoot,
  bindWorkspaceRoot,
  openForRead,
  openForListDirectory,
  inspectLogicalEntry,
  listDirectoryEntries,
  readFileBytes,
  statResolvedTarget,
  statIdentity,
  verifyDescriptorIdentity,
  type OpenedTarget,
} from './fs.js';
import {
  type ValidatedTrustedWorkspaceConfiguration,
  lookupValidatedWorkspace,
  evaluateExistingPathContainment,
  type ExistingPathResolver,
  type ContainmentPurpose,
  CONTAINMENT_PROTOCOL_VERSION,
  CONTAINMENT_PURPOSES,
  parseWorkspaceRelativePath,
} from '../trusted/index.js';

// ---------------------------------------------------------------------------
// Trusted service options
// ---------------------------------------------------------------------------

export interface WorkspaceInspectionServiceOptions {
  readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  readonly resolveExistingPath: ExistingPathResolver;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WorkspaceInspectionService {
  private readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  private readonly resolveExistingPath: ExistingPathResolver;
  private readonly concurrency: ConcurrencyController;
  private readonly roots: Map<string, BoundWorkspaceRoot> = new Map();
  private _disposed = false;

  constructor(options: WorkspaceInspectionServiceOptions) {
    // Runtime genuineness of the configuration is enforced by the committed
    // WP-6 machinery (evaluateExistingPathContainment TCP-021 and
    // lookupValidatedWorkspace brand gate); WP-7 does not duplicate the brand
    // check (CON-004: containment is a single source of truth in src/trusted/**).
    if (typeof options.resolveExistingPath !== 'function') {
      throw new Error('resolveExistingPath must be a function');
    }
    this.configuration = options.configuration;
    this.resolveExistingPath = options.resolveExistingPath;
    this.concurrency = new ConcurrencyController(WP7_LIMITS.MAX_CONCURRENT_OPERATIONS);
  }

  get disposed(): boolean {
    return this._disposed;
  }

  async dispose(): Promise<void> {
    this._disposed = true;
    this.concurrency.dispose();
    for (const root of this.roots.values()) {
      await root.close().catch(() => {});
    }
    this.roots.clear();
  }

  // -----------------------------------------------------------------------
  // Public operations
  // -----------------------------------------------------------------------

  async listDirectory(
    raw: unknown,
    control: TrustedOperationControl,
  ): Promise<OperationResult> {
    return this.execute(raw, control, 'list-directory', (req, corr, signal) =>
      this._listDirectory(req, corr, signal),
    );
  }

  async inspectMetadata(
    raw: unknown,
    control: TrustedOperationControl,
  ): Promise<OperationResult> {
    return this.execute(raw, control, 'inspect-metadata', (req, corr, signal) =>
      this._inspectMetadata(req, corr, signal),
    );
  }

  async readText(
    raw: unknown,
    control: TrustedOperationControl,
  ): Promise<OperationResult> {
    return this.execute(raw, control, 'read-text', (req, corr, signal) =>
      this._readText(req, corr, signal),
    );
  }

  async readBytes(
    raw: unknown,
    control: TrustedOperationControl,
  ): Promise<OperationResult> {
    return this.execute(raw, control, 'read-bytes', (req, corr, signal) =>
      this._readBytes(req, corr, signal),
    );
  }

  // -----------------------------------------------------------------------
  // Execution framework
  // -----------------------------------------------------------------------

  private async execute(
    raw: unknown,
    control: TrustedOperationControl,
    operation: 'list-directory' | 'inspect-metadata' | 'read-text' | 'read-bytes',
    fn: (req: { workspaceId: string; path: string; maxBytes?: number; maxEntries?: number }, corr: OperationCorrelation, signal: AbortSignal) => Promise<OperationResult>,
  ): Promise<OperationResult> {
    if (this._disposed) return fail(errOpCancelled(this.makeCorrelation(operation)));

    // Validate trusted control operand
    const ctrlResult = validateTrustedOperationControl(control);
    if (!ctrlResult.ok) {
      return fail(errReqInvalid(ctrlResult.message, this.makeCorrelation(operation)));
    }
    const signal = ctrlResult.signal ?? new AbortController().signal;

    const corr = this.makeCorrelation(operation);

    // Check cancellation before admission
    if (signal.aborted) return fail(errOpCancelled(corr));

    // Concurrency admission
    const admissionRejection = this.concurrency.tryAdmit(corr);
    if (admissionRejection) return fail(admissionRejection);

    let released = false;
    const release = () => { if (!released) { released = true; this.concurrency.release(); } };

    try {
      // Setup cancellation
      if (signal.aborted) { release(); return fail(errOpCancelled(corr)); }
      let onAbort: (() => void) | null = null;
      const abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
      });
      // Ensure the listener is always removed after the operation settles
      // (success, failure, cancellation, timeout, or disposal).
      const cleanup = () => { if (onAbort) { signal.removeEventListener('abort', onAbort); onAbort = null; } };

      // 1. Capture and validate request
      const captured = validateAndCaptureRequest(raw, corr);
      if (!captured.ok) { cleanup(); release(); return fail(captured.failure); }
      const data = captured.data;

      if (data.operation !== operation) {
        cleanup();
        release();
        return fail(errReqInvalid('operation mismatch', corr));
      }

      if (!data.path) {
        cleanup();
        release();
        return fail(errReqInvalid('path is required', corr));
      }

      const req = {
        workspaceId: data.workspaceId,
        path: data.path,
        maxBytes: data.maxBytes,
        maxEntries: data.maxEntries,
      };

      // Race operation against cancellation
      const result = await Promise.race([
        fn(req, corr, signal),
        abortPromise,
      ]);
      cleanup();
      release();
      return result;
    } catch (err: unknown) {
      release();
      if (err instanceof DOMException && err.name === 'AbortError') {
        return fail(errOpCancelled(corr));
      }
      // Unexpected internal error
      return fail(errOpCancelled(corr));
    }
  }

  // -----------------------------------------------------------------------
  // Correlation helper
  // -----------------------------------------------------------------------

  private makeCorrelation(
    operation: OperationCorrelation['operation'],
    path?: string,
    containmentDecisionIdentity?: string,
  ): OperationCorrelation {
    return {
      workspaceId: '',
      operation,
      canonicalWorkspaceRelativePath: path,
      containmentDecisionIdentity,
    };
  }

  // -----------------------------------------------------------------------
  // Root caching
  // -----------------------------------------------------------------------

  private async getRoot(workspaceId: string, corr: OperationCorrelation): Promise<{ ok: true; root: BoundWorkspaceRoot } | { ok: false; failure: OperationResult }> {
    const existing = this.roots.get(workspaceId);
    if (existing) return { ok: true, root: existing };

    const record = lookupValidatedWorkspace(this.configuration, workspaceId);
    if (!record) {
      return { ok: false, failure: fail(errWsUnknown(corr)) };
    }

    try {
      const root = await bindWorkspaceRoot(record.canonicalRoot);
      this.roots.set(workspaceId, root);
      return { ok: true, root };
    } catch {
      return { ok: false, failure: fail(errNotFound(corr)) };
    }
  }

  // -----------------------------------------------------------------------
  // Containment evaluation
  // -----------------------------------------------------------------------

  private evaluateContainment(
    workspaceId: string,
    path: string,
    corr: OperationCorrelation,
  ): { ok: true; decision: { canonicalWorkspaceRelativePath: string; resolvedAbsolutePath: string; decisionIdentity: string } } | { ok: false; failure: OperationResult } {
    const report = evaluateExistingPathContainment(
      {
        containmentProtocolVersion: CONTAINMENT_PROTOCOL_VERSION,
        workspaceId,
        path,
        purpose: 'read' as ContainmentPurpose,
        expectedConfigurationIdentity: this.configuration.identity,
      },
      {
        configuration: this.configuration,
        resolveExistingPath: this.resolveExistingPath,
      },
    );

    if (!report.ok) {
      // Map containment finding codes to the contract error model.
      const codes = report.findings.map((f) => f.code);
      if (codes.includes('TCP-014')) {
        // Broken or unresolved existing path (covers missing target and broken symlink).
        return { ok: false, failure: fail(errNotFound(corr)) };
      }
      if (codes.includes('TCP-007')) {
        // Traversal escape (bounded .. pop beyond the workspace root).
        return { ok: false, failure: fail(errPatTraversal(corr)) };
      }
      if (codes.includes('TCP-017')) {
        // Resolved target outside the workspace (covers symlink escape).
        return { ok: false, failure: fail(errSymEscape(corr)) };
      }
      return { ok: false, failure: fail(errConDenied(corr)) };
    }

    const d = report.decision!;
    return {
      ok: true,
      decision: {
        canonicalWorkspaceRelativePath: d.canonicalWorkspaceRelativePath,
        resolvedAbsolutePath: d.resolvedAbsolutePath,
        decisionIdentity: d.decisionIdentity,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Descriptor identity binding (S-07)
  // -----------------------------------------------------------------------

  /**
   * Verify that an opened descriptor is the same object accepted by the
   * point-of-use containment decision: compare device + inode + object type
   * of the opened descriptor against a trusted internal stat of the
   * containment-resolved absolute target taken immediately around
   * descriptor acquisition. Fails closed on mismatch.
   */
  private bindDescriptor(
    target: OpenedTarget,
    resolvedAbsolutePath: string,
    corr: OperationCorrelation,
  ): OperationResult | null {
    const accepted = statResolvedTarget(resolvedAbsolutePath);
    if (accepted === null) {
      // The accepted resolved target no longer resolves: fail closed.
      return fail(errConDenied(corr));
    }
    const opened = statIdentity(fstatSync(target.fd));
    if (!verifyDescriptorIdentity(opened, accepted)) {
      // The opened descriptor is not the object the containment decision
      // accepted (final-file replacement, ancestor replacement, or symlink
      // swap): fail closed without reopening through the user path.
      return fail(errConDenied(corr));
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // list-directory
  // -----------------------------------------------------------------------

  private async _listDirectory(
    req: { workspaceId: string; path: string; maxEntries?: number },
    corr: OperationCorrelation,
    signal: AbortSignal,
  ): Promise<OperationResult> {
    const corr1 = { ...corr, workspaceId: req.workspaceId };
    const rootResult = await this.getRoot(req.workspaceId, corr1);
    if (!rootResult.ok) return rootResult.failure;

    // Point-of-use containment evaluation
    const containment = this.evaluateContainment(req.workspaceId, req.path, corr1);
    if (!containment.ok) return containment.failure;

    const relative = containment.decision.canonicalWorkspaceRelativePath;
    // MAC-2D: the descent base is the containment-RESOLVED canonical
    // relative (realpath-canonical, symlink-free — SYM-006 resolves
    // in-workspace symlinks in containment), derived from the decision's
    // resolvedAbsolutePath; the lexical relative stays the correlation
    // path.
    const resolvedRelative = containment.decision.resolvedAbsolutePath === rootResult.root.rootPath
      ? ''
      : containment.decision.resolvedAbsolutePath.slice(rootResult.root.rootPath.length + 1);
    const corrWithPath = { ...corr1, canonicalWorkspaceRelativePath: relative, containmentDecisionIdentity: containment.decision.decisionIdentity };

    if (signal.aborted) return fail(errOpCancelled(corrWithPath));

    const openResult = await openForListDirectory(rootResult.root, relative, resolvedRelative);
    if (!openResult.ok) {
      return fail(this.mapFsCode(openResult.code, corrWithPath));
    }

    // S-07: prove the opened directory handle is the containment-accepted object.
    const binding = this.bindDescriptor(openResult.target, containment.decision.resolvedAbsolutePath, corrWithPath);
    if (binding) {
      openResult.target.close();
      return binding;
    }

    const maxEntries = req.maxEntries ?? WP7_LIMITS.MAX_DIRECTORY_ENTRIES;
    try {
      const { entries, truncated } = listDirectoryEntries(openResult.target, maxEntries);
      return success(
        { entries: Object.freeze(entries), truncated, count: entries.length },
        corrWithPath,
      );
    } finally {
      openResult.target.close();
    }
  }

  // -----------------------------------------------------------------------
  // inspect-metadata
  // -----------------------------------------------------------------------

  private async _inspectMetadata(
    req: { workspaceId: string; path: string },
    corr: OperationCorrelation,
    signal: AbortSignal,
  ): Promise<OperationResult> {
    const corr1 = { ...corr, workspaceId: req.workspaceId };
    const rootResult = await this.getRoot(req.workspaceId, corr1);
    if (!rootResult.ok) return rootResult.failure;

    // Point-of-use containment evaluation
    const containment = this.evaluateContainment(req.workspaceId, req.path, corr1);
    if (!containment.ok) return containment.failure;

    const relative = containment.decision.canonicalWorkspaceRelativePath;
    const corrWithPath = { ...corr1, canonicalWorkspaceRelativePath: relative, containmentDecisionIdentity: containment.decision.decisionIdentity };

    if (signal.aborted) return fail(errOpCancelled(corrWithPath));

    const result = inspectLogicalEntry(rootResult.root, relative);
    if (!result.ok) {
      return fail(this.mapFsCode(result.code, corrWithPath));
    }

    return success(result.metadata, corrWithPath);
  }

  // -----------------------------------------------------------------------
  // read-text
  // -----------------------------------------------------------------------

  private async _readText(
    req: { workspaceId: string; path: string; maxBytes?: number },
    corr: OperationCorrelation,
    signal: AbortSignal,
  ): Promise<OperationResult> {
    const corr1 = { ...corr, workspaceId: req.workspaceId };
    const rootResult = await this.getRoot(req.workspaceId, corr1);
    if (!rootResult.ok) return rootResult.failure;

    // Point-of-use containment evaluation
    const containment = this.evaluateContainment(req.workspaceId, req.path, corr1);
    if (!containment.ok) return containment.failure;

    const relative = containment.decision.canonicalWorkspaceRelativePath;
    // MAC-2D: the descent base is the containment-RESOLVED canonical
    // relative (realpath-canonical, symlink-free — SYM-006 resolves
    // in-workspace symlinks in containment), derived from the decision's
    // resolvedAbsolutePath; the lexical relative stays the correlation
    // path.
    const resolvedRelative = containment.decision.resolvedAbsolutePath === rootResult.root.rootPath
      ? ''
      : containment.decision.resolvedAbsolutePath.slice(rootResult.root.rootPath.length + 1);
    const corrWithPath = { ...corr1, canonicalWorkspaceRelativePath: relative, containmentDecisionIdentity: containment.decision.decisionIdentity };

    if (signal.aborted) return fail(errOpCancelled(corrWithPath));

    const openResult = await openForRead(rootResult.root, relative, resolvedRelative);
    if (!openResult.ok) {
      return fail(this.mapFsCode(openResult.code, corrWithPath));
    }

    // S-07: prove the opened descriptor is the containment-accepted object.
    const binding = this.bindDescriptor(openResult.target, containment.decision.resolvedAbsolutePath, corrWithPath);
    if (binding) {
      openResult.target.close();
      return binding;
    }

    const maxBytes = req.maxBytes ?? WP7_LIMITS.READ_MAX_BYTES;
    try {
      const { bytes, truncated } = await readFileBytes(openResult.target, maxBytes);

      // Check for NUL bytes
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) {
          return fail(errFtypeUnsupported(corrWithPath));
        }
      }

      // Strict UTF-8 decoding
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return fail(errTextMalformed(corrWithPath));
      }

      // Check for truncation-split code point
      if (truncated && bytes.length > 0) {
        // Verify the last bytes don't form a partial code point
        const lastByte = bytes[bytes.length - 1]!;
        if ((lastByte & 0x80) !== 0) {
          // Multi-byte sequence possibly truncated — TextDecoder with fatal:true
          // would have thrown if it was truly malformed, so we're safe here.
          // But if the full file had more bytes, the last character might be
          // incomplete. The TextDecoder already handled this.
        }
      }

      return success(
        { text, byteLength: bytes.length, truncated },
        corrWithPath,
      );
    } finally {
      openResult.target.close();
    }
  }

  // -----------------------------------------------------------------------
  // read-bytes
  // -----------------------------------------------------------------------

  private async _readBytes(
    req: { workspaceId: string; path: string; maxBytes?: number },
    corr: OperationCorrelation,
    signal: AbortSignal,
  ): Promise<OperationResult> {
    const corr1 = { ...corr, workspaceId: req.workspaceId };
    const rootResult = await this.getRoot(req.workspaceId, corr1);
    if (!rootResult.ok) return rootResult.failure;

    const containment = this.evaluateContainment(req.workspaceId, req.path, corr1);
    if (!containment.ok) return containment.failure;

    const relative = containment.decision.canonicalWorkspaceRelativePath;
    // MAC-2D: the descent base is the containment-RESOLVED canonical
    // relative (realpath-canonical, symlink-free — SYM-006 resolves
    // in-workspace symlinks in containment), derived from the decision's
    // resolvedAbsolutePath; the lexical relative stays the correlation
    // path.
    const resolvedRelative = containment.decision.resolvedAbsolutePath === rootResult.root.rootPath
      ? ''
      : containment.decision.resolvedAbsolutePath.slice(rootResult.root.rootPath.length + 1);
    const corrWithPath = { ...corr1, canonicalWorkspaceRelativePath: relative, containmentDecisionIdentity: containment.decision.decisionIdentity };

    if (signal.aborted) return fail(errOpCancelled(corrWithPath));

    const openResult = await openForRead(rootResult.root, relative, resolvedRelative);
    if (!openResult.ok) {
      return fail(this.mapFsCode(openResult.code, corrWithPath));
    }

    // S-07: prove the opened descriptor is the containment-accepted object.
    const binding = this.bindDescriptor(openResult.target, containment.decision.resolvedAbsolutePath, corrWithPath);
    if (binding) {
      openResult.target.close();
      return binding;
    }

    const maxBytes = req.maxBytes ?? WP7_LIMITS.READ_MAX_BYTES;
    try {
      const { bytes, truncated } = await readFileBytes(openResult.target, maxBytes);
      // Return a fresh copy — the Buffer is already a copy from read
      const frozen = new Uint8Array(bytes);
      return success(
        { bytes: frozen, byteLength: frozen.length, truncated },
        corrWithPath,
      );
    } finally {
      openResult.target.close();
    }
  }

  // -----------------------------------------------------------------------
  // Filesystem code mapping
  // -----------------------------------------------------------------------

  private mapFsCode(code: string, corr: OperationCorrelation): ReturnType<typeof errNotFound> {
    switch (code) {
      case 'not-found': return errNotFound(corr);
      case 'permission-denied': return errPermDenied(corr);
      case 'unsupported-type': return errFtypeUnsupported(corr);
      default: return errNotFound(corr);
    }
  }
}
