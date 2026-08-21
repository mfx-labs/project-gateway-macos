/**
 * WP-7 — GitInspectionService.
 *
 * Exposes the four Git inspection operations:
 *   git-status, git-diff, git-log, git-show.
 *
 * Internal only. Consumes WP-6 containment, Git host-lane validation,
 * repository preflight, and the constrained Git wrapper.
 */
import { type OperationCorrelation, type OperationResult, type TrustedOperationControl, type HostileOperationRequestData, success, fail, WP7_LIMITS } from '../reader/types.js';
import { validateTrustedOperationControl } from '../reader/types.js';
import { validateAndCaptureRequest, type CapturedRequest } from '../reader/capture.js';
import {
  errReqInvalid, errWsUnknown, errGitUnavailable, errGitNotRepo,
  errGitStateUnsupported, errGitTimeout, errGitSanitizedFailure, errOpCancelled,
  errLimitConcurrency,
} from '../reader/errors.js';
import { ConcurrencyController } from '../reader/admission.js';
import {
  type ValidatedTrustedWorkspaceConfiguration,
  lookupValidatedWorkspace,
} from '../trusted/index.js';
import type { GitHostLaneDescriptor } from './host-lane.js';
import type { GitChildEnvironment } from './wrapper.js';
import { verifyGitRepository, isUnbornRepository, captureRepositoryPreflightFingerprint, revalidateRepositoryPreflightFingerprint, type RepositoryPreflightFingerprint } from './preflight.js';
import { validateHostDirectory, revalidateGitHostLane } from './host-lane.js';
import {
  executeGit,
  parseGitStatus,
  parseGitLog,
  parseGitShow,
} from './wrapper.js';

// ---------------------------------------------------------------------------
// Trusted service options
// ---------------------------------------------------------------------------

export interface GitInspectionServiceOptions {
  readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  readonly gitLane: GitHostLaneDescriptor;
  readonly envDirs: GitChildEnvironment;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const FULL_COMMIT_ID_RE = /^[0-9a-f]{40}$/;

export class GitInspectionService {
  private readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  private readonly gitLane: GitHostLaneDescriptor;
  private readonly envDirs: GitChildEnvironment;
  private readonly concurrency: ConcurrencyController;
  private _disposed = false;

  constructor(options: GitInspectionServiceOptions) {
    // The runtime genuineness of the configuration is enforced by the
    // committed WP-6 machinery (evaluateExistingPathContainment TCP-021 and
    // lookupValidatedWorkspace brand gate); WP-7 does not duplicate the brand
    // check (CON-004: containment is a single source of truth in src/trusted/**).
    const workspaceRoots = options.configuration.workspaces.map((w) => w.canonicalRoot);
    const homeErr = validateHostDirectory(options.envDirs.HOME, workspaceRoots);
    if (homeErr) throw new Error(`HOME validation failed: ${homeErr.message}`);
    const tmpdirErr = validateHostDirectory(options.envDirs.TMPDIR, workspaceRoots);
    if (tmpdirErr) throw new Error(`TMPDIR validation failed: ${tmpdirErr.message}`);
    if (options.envDirs.HOME === options.envDirs.TMPDIR) {
      throw new Error('HOME and TMPDIR must be distinct directories');
    }
    this.configuration = options.configuration;
    this.gitLane = options.gitLane;
    this.envDirs = options.envDirs;
    this.concurrency = new ConcurrencyController(WP7_LIMITS.MAX_CONCURRENT_OPERATIONS);
  }

  get disposed(): boolean {
    return this._disposed;
  }

  dispose(): void {
    this._disposed = true;
    this.concurrency.dispose();
  }

  // -----------------------------------------------------------------------
  // Public operations
  // -----------------------------------------------------------------------

  async status(raw: unknown, control: TrustedOperationControl): Promise<OperationResult> {
    return this.execute(raw, control, 'git-status', (req, corr, signal) =>
      this._status(req, corr, signal),
    );
  }

  async diff(raw: unknown, control: TrustedOperationControl): Promise<OperationResult> {
    return this.execute(raw, control, 'git-diff', (req, corr, signal) =>
      this._diff(req, corr, signal),
    );
  }

  async log(raw: unknown, control: TrustedOperationControl): Promise<OperationResult> {
    return this.execute(raw, control, 'git-log', (req, corr, signal) =>
      this._log(req, corr, signal),
    );
  }

  async show(raw: unknown, control: TrustedOperationControl): Promise<OperationResult> {
    return this.execute(raw, control, 'git-show', (req, corr, signal) =>
      this._show(req, corr, signal),
    );
  }

  // -----------------------------------------------------------------------
  // Execution framework
  // -----------------------------------------------------------------------

  private async execute(
    raw: unknown,
    control: TrustedOperationControl,
    operation: 'git-status' | 'git-diff' | 'git-log' | 'git-show',
    fn: (req: CapturedRequest, corr: OperationCorrelation, signal: AbortSignal) => Promise<OperationResult>,
  ): Promise<OperationResult> {
    if (this._disposed) return fail(errOpCancelled(this.makeCorrelation(operation)));

    const ctrlResult = validateTrustedOperationControl(control);
    if (!ctrlResult.ok) {
      return fail(errReqInvalid(ctrlResult.message, this.makeCorrelation(operation)));
    }
    const signal = ctrlResult.signal ?? new AbortController().signal;

    const corr = this.makeCorrelation(operation);
    if (signal.aborted) return fail(errOpCancelled(corr));

    const admissionRejection = this.concurrency.tryAdmit(corr);
    if (admissionRejection) return fail(admissionRejection);

    let released = false;
    const release = () => { if (!released) { released = true; this.concurrency.release(); } };

    try {
      if (signal.aborted) { release(); return fail(errOpCancelled(corr)); }
      let onAbort: (() => void) | null = null;
      const abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
      });
      // Listener cleanup on every settling path (success, failure, cancellation).
      const cleanup = () => { if (onAbort) { signal.removeEventListener('abort', onAbort); onAbort = null; } };

      const captured = validateAndCaptureRequest(raw, corr);
      if (!captured.ok) { cleanup(); release(); return fail(captured.failure); }
      const data = captured.data;

      if (data.operation !== operation) {
        cleanup();
        release();
        return fail(errReqInvalid('operation mismatch', corr));
      }

      const result = await Promise.race([fn(data, corr, signal), abortPromise]);
      cleanup();
      release();
      return result;
    } catch (err: unknown) {
      release();
      if (err instanceof DOMException && err.name === 'AbortError') {
        return fail(errOpCancelled(corr));
      }
      return fail(errOpCancelled(corr));
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private makeCorrelation(operation: OperationCorrelation['operation']): OperationCorrelation {
    return { workspaceId: '', operation };
  }

  private resolveWorkspace(workspaceId: string, corr: OperationCorrelation): string | OperationResult {
    const record = lookupValidatedWorkspace(this.configuration, workspaceId);
    if (!record) return fail(errWsUnknown(corr));
    return record.canonicalRoot;
  }

  // -----------------------------------------------------------------------
  // Preflight + prelaunch revalidation (S-04)
  // -----------------------------------------------------------------------

  private preflight(
    root: string,
    corr: OperationCorrelation,
  ): { ok: true; fingerprint: RepositoryPreflightFingerprint } | { ok: false; failure: OperationResult } {
    const preflightErr = verifyGitRepository(root);
    if (preflightErr) {
      if (preflightErr.code === 'no-git-dir') return { ok: false, failure: fail(errGitNotRepo(corr)) };
      return { ok: false, failure: fail(errGitStateUnsupported(corr)) };
    }
    const capResult = captureRepositoryPreflightFingerprint(root);
    // Capture read failure (e.g. config read-unavailable) fails closed to unsupported-state.
    if (!capResult.ok) {
      return { ok: false, failure: fail(errGitStateUnsupported(corr)) };
    }
    return { ok: true, fingerprint: capResult.fingerprint };
  }

  /**
   * Prelaunch revalidation: revalidate the Git binary fingerprint and the
   * repository preflight fingerprint; then confirm no cancellation occurred.
   * Returns a failure if any value changed or the operation was cancelled.
   */
  private revalidateBeforeLaunch(
    root: string,
    fingerprint: RepositoryPreflightFingerprint,
    corr: OperationCorrelation,
    signal: AbortSignal,
  ): OperationResult | null {
    // 1. Revalidate Git executable fingerprint.
    if (revalidateGitHostLane(this.gitLane)) {
      return fail(errGitUnavailable(corr));
    }
    // 2. Revalidate repository preflight fingerprint. Content drift and a config
    //    read-unavailable both fail closed to the contract-correct unsupported-state
    //    code; they remain internally distinct, so a read failure is never reported
    //    as content change.
    const revalidation = revalidateRepositoryPreflightFingerprint(root, fingerprint);
    if (!revalidation.ok) {
      return fail(errGitStateUnsupported(corr));
    }
    // 3. Confirm cancellation has not occurred.
    if (signal.aborted) return fail(errOpCancelled(corr));
    return null;
  }

  // -----------------------------------------------------------------------
  // git-status
  // -----------------------------------------------------------------------

  private async _status(
    req: CapturedRequest,
    corr: OperationCorrelation,
    signal: AbortSignal,
  ): Promise<OperationResult> {
    const corr1 = { ...corr, workspaceId: req.workspaceId };
    const root = this.resolveWorkspace(req.workspaceId, corr1);
    if (typeof root !== 'string') return root;

    const pf = this.preflight(root, corr1);
    if (!pf.ok) return pf.failure;

    if (signal.aborted) return fail(errOpCancelled(corr1));

    const revalidation = this.revalidateBeforeLaunch(root, pf.fingerprint, corr1, signal);
    if (revalidation) return revalidation;

    const result = await executeGit(
      this.gitLane, this.envDirs, root, 'status',
      ['--porcelain=v1', '-z'],
      signal,
    );

    if (!result.ok) {
      return fail(this.mapGitFailure(result, corr1));
    }

    const parsed = parseGitStatus(result.stdout);
    if ('error' in parsed) {
      return fail(errGitSanitizedFailure(corr1));
    }

    return success({ records: Object.freeze(parsed.records) }, corr1);
  }

  // -----------------------------------------------------------------------
  // git-diff
  // -----------------------------------------------------------------------

  private async _diff(
    req: CapturedRequest,
    corr: OperationCorrelation,
    signal: AbortSignal,
  ): Promise<OperationResult> {
    const corr1 = { ...corr, workspaceId: req.workspaceId };
    const root = this.resolveWorkspace(req.workspaceId, corr1);
    if (typeof root !== 'string') return root;

    const pf = this.preflight(root, corr1);
    if (!pf.ok) return pf.failure;

    if (signal.aborted) return fail(errOpCancelled(corr1));

    // Contract GIT-018 pins `--textconv=false`; Git 2.45.4 rejects that form
    // ("option textconv takes no value"). `--no-textconv` is the exact
    // semantic equivalent accepted by the supported Git version; documented
    // as a contract deviation in the implementation report.
    const args: string[] = ['--no-color', '--no-ext-diff', '--no-textconv'];
    if (req.pathspecs && req.pathspecs.length > 0) {
      args.push('--', ...req.pathspecs);
    }

    const revalidation = this.revalidateBeforeLaunch(root, pf.fingerprint, corr1, signal);
    if (revalidation) return revalidation;

    const result = await executeGit(this.gitLane, this.envDirs, root, 'diff', args, signal);
    if (!result.ok) return fail(this.mapGitFailure(result, corr1));

    const buf = Buffer.from(result.stdout, 'utf8');
    const truncated = buf.length >= WP7_LIMITS.GIT_MAX_OUTPUT_BYTES;
    return success(
      { text: result.stdout, byteLength: buf.length, truncated },
      corr1,
    );
  }

  // -----------------------------------------------------------------------
  // git-log
  // -----------------------------------------------------------------------

  private async _log(
    req: CapturedRequest,
    corr: OperationCorrelation,
    signal: AbortSignal,
  ): Promise<OperationResult> {
    const corr1 = { ...corr, workspaceId: req.workspaceId };
    const root = this.resolveWorkspace(req.workspaceId, corr1);
    if (typeof root !== 'string') return root;

    const pf = this.preflight(root, corr1);
    if (!pf.ok) return pf.failure;

    // Determine unborn-repository state through contained reads (preflight),
    // never through an alternate process launch. An unborn repo returns zero
    // records; show fails with ERR-GIT-STATE-UNSUPPORTED.
    if (isUnbornRepository(root)) {
      return success({ records: Object.freeze([]), truncated: false }, corr1);
    }

    if (signal.aborted) return fail(errOpCancelled(corr1));

    const maxRecords = req.maxRecords ?? WP7_LIMITS.GIT_MAX_LOG_RECORDS;
    const format = '--format=%H%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%B%x00%x00';

    const revalidation = this.revalidateBeforeLaunch(root, pf.fingerprint, corr1, signal);
    if (revalidation) return revalidation;

    const result = await executeGit(
      this.gitLane, this.envDirs, root, 'log',
      ['--no-color', '--date=iso-strict', format, `-n${maxRecords}`],
      signal,
    );

    if (!result.ok) return fail(this.mapGitFailure(result, corr1));

    const parsed = parseGitLog(result.stdout, maxRecords);
    if ('error' in parsed) return fail(errGitSanitizedFailure(corr1));

    return success(
      { records: Object.freeze(parsed.records), truncated: parsed.truncated },
      corr1,
    );
  }

  // -----------------------------------------------------------------------
  // git-show
  // -----------------------------------------------------------------------

  private async _show(
    req: CapturedRequest,
    corr: OperationCorrelation,
    signal: AbortSignal,
  ): Promise<OperationResult> {
    const corr1 = { ...corr, workspaceId: req.workspaceId };
    const root = this.resolveWorkspace(req.workspaceId, corr1);
    if (typeof root !== 'string') return root;

    const pf = this.preflight(root, corr1);
    if (!pf.ok) return pf.failure;

    if (!req.commitId || !FULL_COMMIT_ID_RE.test(req.commitId)) {
      return fail(errReqInvalid('invalid commitId', corr1));
    }

    if (signal.aborted) return fail(errOpCancelled(corr1));

    const format = '--format=%H%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%B%x00%x00';

    const revalidation = this.revalidateBeforeLaunch(root, pf.fingerprint, corr1, signal);
    if (revalidation) return revalidation;

    const result = await executeGit(
      this.gitLane, this.envDirs, root, 'show',
      ['--no-color', '--date=iso-strict', format, req.commitId],
      signal,
    );

    if (!result.ok) {
      // Show on non-existent commit → sanitized failure
      return fail(this.mapGitFailure(result, corr1));
    }

    const parsed = parseGitShow(result.stdout);
    if ('error' in parsed) return fail(errGitSanitizedFailure(corr1));

    return success(
      {
        ...parsed,
        truncated: false,
      },
      corr1,
    );
  }

  // -----------------------------------------------------------------------
  // Git failure mapping
  // -----------------------------------------------------------------------

  private mapGitFailure(
    result: { ok: false; code: string },
    corr: OperationCorrelation,
  ): ReturnType<typeof errGitTimeout> {
    switch (result.code) {
      case 'timeout': return errGitTimeout(corr);
      case 'unavailable': return errGitUnavailable(corr);
      case 'signal': return errOpCancelled(corr);
      default: return errGitSanitizedFailure(corr);
    }
  }
}
