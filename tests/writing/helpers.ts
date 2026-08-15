/**
 * Shared fixtures for WP-11 Slice 1 controlled-write tests.
 * Returns fresh objects per call so hostile-mutation tests are isolated.
 */
import { readFileSync, lstatSync, realpathSync, statSync, mkdtempSync, mkdirSync, chmodSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TRUSTED_HOST_LANE,
  validateTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';
import type {
  ProspectiveDestinationResolution,
  ProspectiveDestinationResolver,
  ProspectiveDestinationResolutionRequest,
  ProspectiveDestinationTargetState,
  ValidatedTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';
import { createDraftProposal } from '../../src/drafting/proposal.js';
import type { DraftProposalResult } from '../../src/drafting/proposal.js';
import type {
  DraftWriteExecutor,
  DraftWriteExecutorInput,
  DraftWriteExecutorResult,
} from '../../src/writing/types.js';

const REPO = join(import.meta.dirname, '..', '..', '..');

export const WS_A = 'pgw:w:aaaaaaaaaaaaaaaa';
export const WS_B = 'pgw:w:bbbbbbbbbbbbbbbb';

/** Valid fixture model for one of the four writeable kinds. */
export function validFixtureModel(kind: string): Record<string, unknown> {
  const names: Record<string, string> = {
    TaskSpec: 'task-minimal-genesis.json',
    AuthorityPolicy: 'policy-minimal-genesis.json',
    ContextManifest: 'context-minimal-genesis.json',
    CompletionContract: 'completion-minimal-genesis.json',
    ExecutionBundle: 'bundle-minimal-genesis.json',
  };
  const name = names[kind];
  if (name === undefined) throw new Error(`no fixture for kind ${kind}`);
  return JSON.parse(readFileSync(join(REPO, 'fixtures', 'artifacts', 'valid', name), 'utf8')) as Record<string, unknown>;
}

/** Draft content: the canonical envelope with the derived digest member removed. */
export function draftContent(model: Readonly<Record<string, unknown>>): string {
  const revision = { ...(model['revision'] as Readonly<Record<string, unknown>>) };
  delete revision['digest'];
  return JSON.stringify({ ...model, revision });
}

/** Accepted WP-10 draft proposal for the given kind (via the committed core). */
export function validDraft(kind: string): DraftProposalResult {
  const result = createDraftProposal({ kind: kind as never, content: draftContent(validFixtureModel(kind)) });
  if (result.ok !== true || result.valid !== true) {
    throw new Error(`fixture draft for ${kind} is not valid: ${JSON.stringify(result)}`);
  }
  return result;
}

/** Real filesystem workspace: `workspaceRoot/artifacts` (strict descendant). */
export interface FsWorkspace {
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly remove: () => void;
}

export function makeFsWorkspace(): FsWorkspace {
  // realpath-canonical root: production canonical roots are symlink-resolved
  // (canonicalizeRoot, src/trusted/roots.ts) and the native seam's
  // F_GETPATH identity returns vnode-canonical paths (e.g. /private/var/…
  // for /var/…) — MAC-2B. Tests must mirror the production canonical shape.
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wp11s1-')));
  chmodSync(workspaceRoot, 0o700);
  const artifactRoot = join(workspaceRoot, 'artifacts');
  mkdirSync(artifactRoot, { mode: 0o700 });
  chmodSync(artifactRoot, 0o700);
  return {
    workspaceRoot,
    artifactRoot,
    remove: () => rmSync(workspaceRoot, { recursive: true, force: true }),
  };
}

/** Version-2 configuration bound to a real workspace/artifact root (identity resolver). */
export function validatedConfigFor(ws: FsWorkspace): ValidatedTrustedWorkspaceConfiguration {
  const report = validateTrustedWorkspaceConfiguration(
    {
      configurationVersion: '2',
      capabilityVocabularyVersion: 'v1',
      provenance: { sourceKind: 'trusted-local-control-plane' },
      workspaces: [{ workspaceId: WS_A, root: ws.workspaceRoot, artifactLocation: ws.artifactRoot }],
    },
    {
      hostLane: TRUSTED_HOST_LANE,
      resolveRootPath: (p) => p,
      resolveArtifactLocation: (p) => ({ ok: true, canonicalPath: p, entryKind: 'directory' }),
    },
  );
  if (!report.ok) throw new Error(`fixture configuration invalid: ${report.findings.map((f) => `${f.code}:${f.messageKey}`).join(',')}`);
  return report.configuration!;
}

function componentsOf(request: Readonly<ProspectiveDestinationResolutionRequest>): readonly string[] {
  const root = request.canonicalArtifactRoot;
  const absolute = request.absoluteProspectiveDestination;
  if (!absolute.startsWith(`${root}/`)) throw new Error('internal resolver request mismatch');
  return absolute.slice(root.length + 1).split('/');
}

/**
 * Real-filesystem prospective-destination resolver: observes the actual
 * artifact root, the longest existing-directory lexical prefix (lstat,
 * no-follow), the canonical ancestor (realpath), and the final target state.
 * Host observation only — never a containment decision.
 */
export function realFsResolver(): ProspectiveDestinationResolver {
  return (request) => {
    const root = request.canonicalArtifactRoot;
    let rootStat;
    try {
      rootStat = lstatSync(root);
    } catch {
      return { ok: false, subject: 'artifact-root', code: 'not-found' };
    }
    if (!rootStat.isDirectory()) return { ok: false, subject: 'artifact-root', code: 'not-directory' };
    const components = componentsOf(request);
    const prefix: string[] = [];
    let prefixPath = root;
    for (const component of components) {
      const candidate = `${prefixPath}/${component}`;
      let st;
      try {
        st = lstatSync(candidate);
      } catch {
        break;
      }
      if (st.isDirectory()) {
        prefix.push(component);
        prefixPath = candidate;
      } else {
        break;
      }
    }
    const canonicalAncestor = prefix.length === 0 ? root : realpathSync(prefixPath);
    const full = `${root}/${components.join('/')}`;
    let targetState: ProspectiveDestinationTargetState;
    try {
      const st = lstatSync(full);
      if (st.isFile()) {
        targetState = 'existing-file';
      } else if (st.isDirectory()) {
        targetState = 'existing-directory';
      } else if (st.isSymbolicLink()) {
        try {
          statSync(full);
          targetState = 'existing-symlink';
        } catch {
          targetState = 'dangling-symlink';
        }
      } else {
        targetState = 'unsupported-kind';
      }
    } catch {
      targetState = 'missing';
    }
    const tail = components.slice(prefix.length);
    return {
      ok: true,
      currentCanonicalArtifactRoot: root,
      artifactRootEntryKind: 'directory',
      lexicalExistingDirectoryPrefixComponents: prefix,
      canonicalExistingDirectoryAncestor: canonicalAncestor,
      existingAncestorEntryKind: 'directory',
      destinationTailComponents: tail,
      targetState,
    };
  };
}

/** Evidence-based resolver: reports a fixed target state over the request components. */
export function fixedStateResolver(targetState: ProspectiveDestinationTargetState): ProspectiveDestinationResolver {
  return (request) => {
    const components = componentsOf(request);
    const prefix = targetState === 'missing' ? [] : targetState === 'existing-directory' ? components : components.slice(0, -1);
    const tail = targetState === 'missing' ? components : targetState === 'existing-directory' ? [] : [components[components.length - 1]!];
    return {
      ok: true,
      currentCanonicalArtifactRoot: request.canonicalArtifactRoot,
      artifactRootEntryKind: 'directory',
      lexicalExistingDirectoryPrefixComponents: prefix,
      canonicalExistingDirectoryAncestor: prefix.length === 0 ? request.canonicalArtifactRoot : `${request.canonicalArtifactRoot}/${prefix.join('/')}`,
      existingAncestorEntryKind: 'directory',
      destinationTailComponents: tail,
      targetState,
    };
  };
}

/** Counting wrapper for exact-invocation assertions. */
export function countingResolver(inner: ProspectiveDestinationResolver): { readonly resolver: ProspectiveDestinationResolver; readonly calls: () => number } {
  let count = 0;
  return {
    resolver: (request) => {
      count++;
      return inner(request);
    },
    calls: () => count,
  };
}

/** Recording fake executor: records every input; returns a scripted result. */
export function fakeExecutor(script: DraftWriteExecutorResult): { readonly executor: DraftWriteExecutor; readonly inputs: DraftWriteExecutorInput[]; readonly calls: () => number } {
  const inputs: DraftWriteExecutorInput[] = [];
  let count = 0;
  return {
    executor: (input) => {
      count++;
      inputs.push(input);
      return script;
    },
    inputs,
    calls: () => count,
  };
}

/** Recording real executor wrapper. */
export function recordingExecutor(inner: DraftWriteExecutor): { readonly executor: DraftWriteExecutor; readonly inputs: DraftWriteExecutorInput[] } {
  const inputs: DraftWriteExecutorInput[] = [];
  return {
    executor: (input) => {
      inputs.push(input);
      return inner(input);
    },
    inputs,
  };
}

/** Success result factory. */
export function createdResult(byteCount: number): DraftWriteExecutorResult {
  return { ok: true, outcome: 'created', persistedByteCount: byteCount };
}

/** Reference evidence for correlation assertions (descriptor-anchored input shape). */
export function evidenceOf(input: { readonly canonicalArtifactRoot: string; readonly canonicalExistingDirectoryAncestor: string; readonly canonicalAncestorRelativePath: string; readonly destinationTailComponents: readonly string[]; readonly artifactKind: string; readonly canonicalUtf8: string }): Readonly<Record<string, unknown>> {
  return {
    operationClass: 'artifact-draft-destination',
    purpose: 'persist-validated-artifact-draft',
    artifactKind: input.artifactKind,
    canonicalArtifactRoot: input.canonicalArtifactRoot,
    canonicalExistingDirectoryAncestor: input.canonicalExistingDirectoryAncestor,
    canonicalAncestorRelativePath: input.canonicalAncestorRelativePath,
    destinationTailComponents: input.destinationTailComponents,
    canonicalUtf8: input.canonicalUtf8,
  };
}

/** Assertion helper: exactly the four writeable kinds are accepted by the kind gate. */
export const WRITEABLE_KINDS: readonly string[] = ['TaskSpec', 'AuthorityPolicy', 'ContextManifest', 'CompletionContract'];

export function snapshotDir(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSorted(dir)) {
      const full = join(dir, name);
      const childRel = rel === '' ? name : `${rel}/${name}`;
      const st = lstatSync(full);
      entries.push(`${childRel}|${st.size}|${st.mode & 0o777}|${st.isDirectory() ? 'd' : st.isFile() ? 'f' : st.isSymbolicLink() ? 'l' : '?'}`);
      if (st.isDirectory()) walk(full, childRel);
    }
  };
  walk(root, '');
  return entries.sort().join('\n');
}

function readdirSorted(dir: string): string[] {
  return readdirSync(dir).sort();
}
