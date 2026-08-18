/**
 * WP-7 — Git repository preflight.
 *
 * Before any Git invocation, inspects the repository through contained
 * controlled reads and rejects repositories with dangerous configuration,
 * alternates, commondir, etc.
 */
import { statSync, lstatSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WP7_LIMITS } from '../reader/types.js';
export interface PreflightError {
  readonly code: string;
  readonly message: string;
}

const DANGEROUS_CONFIG_PATTERNS: ReadonlyArray<{ section: string; keyPattern: RegExp }> = [
  { section: 'include', keyPattern: /^path$/ },
  { section: 'includeif', keyPattern: /.*/ },
  { section: 'core', keyPattern: /^worktree$/ },
  { section: 'core', keyPattern: /^fsmonitor$/ },
  { section: 'core', keyPattern: /^hookspath$/ },
  { section: 'diff', keyPattern: /^external$/ },
  { section: 'diff', keyPattern: /^command$/ },
  { section: 'diff', keyPattern: /^textconv$/ },
  { section: 'pager', keyPattern: /.*/ },
  { section: 'credential', keyPattern: /.*/ },
  { section: 'log', keyPattern: /^showsignature$/ },
  { section: 'gpg', keyPattern: /.*/ },
];

interface ParsedGitConfigSection {
  readonly base: string;
  readonly subsection?: string;
  readonly keys: Map<string, string>;
}

/** Parse one section header into its semantic base/subsection identity. */
function parseGitConfigSection(raw: string, line: number): Omit<ParsedGitConfigSection, 'keys'> | PreflightError {
  const quotedPrefix = raw.match(/^([A-Za-z0-9][A-Za-z0-9-]*)[ \t]+"/);
  if (quotedPrefix !== null) {
    let subsection = '';
    for (let i = quotedPrefix[0].length; i < raw.length; i++) {
      const char = raw[i]!;
      if (char === '"') {
        if (raw.slice(i + 1).length !== 0) break;
        return { base: quotedPrefix[1]!.toLowerCase(), subsection };
      }
      if (char === '\\') {
        const escaped = raw[++i];
        if (escaped !== '"' && escaped !== '\\') break;
        subsection += escaped;
        continue;
      }
      if (char === '\0') break;
      subsection += char;
    }
    return { code: 'malformed-config', message: `Malformed quoted subsection at line ${line}` };
  }

  const unquoted = raw.match(/^([A-Za-z0-9][A-Za-z0-9-]*)(?:\.([A-Za-z0-9][A-Za-z0-9-]*))?$/);
  if (unquoted === null) {
    return { code: 'malformed-config', message: `Malformed section at line ${line}` };
  }
  return {
    base: unquoted[1]!.toLowerCase(),
    ...(unquoted[2] !== undefined ? { subsection: unquoted[2].toLowerCase() } : {}),
  };
}

/**
 * Parse a simple Git INI-style config (hostile data, fail on any anomaly).
 * Modern `[section "subsection"]` syntax is represented as separate base and
 * subsection fields. Quoted subsections decode only Git's `\"` and `\\`
 * escapes; every other escape or malformed header fails closed.
 */
function parseGitConfigStrict(content: string): Map<string, ParsedGitConfigSection> | PreflightError {
  const sections = new Map<string, ParsedGitConfigSection>();
  let currentSection: ParsedGitConfigSection | null = null;
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;

    // Section header
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const parsed = parseGitConfigSection(sectionMatch[1]!, i + 1);
      if ('code' in parsed) return parsed;
      const identity = JSON.stringify([parsed.base, parsed.subsection ?? null]);
      if (sections.has(identity)) {
        return { code: 'duplicate-section', message: `Duplicate section [${parsed.base}] at line ${i + 1}` };
      }
      currentSection = { ...parsed, keys: new Map() };
      sections.set(identity, currentSection);
      continue;
    }

    // Key-value
    const kvMatch = line.match(/^([^=]+)=\s*(.*)$/);
    if (kvMatch) {
      if (!currentSection) {
        return { code: 'malformed-config', message: `Key outside section at line ${i + 1}` };
      }
      const rawKey = kvMatch[1]!.trim();
      if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(rawKey)) {
        return { code: 'malformed-config', message: `Malformed key at line ${i + 1}` };
      }
      const key = rawKey.toLowerCase();
      const value = kvMatch[2]!.split(/[;#]/)[0]!.trim();
      if (currentSection.keys.has(key)) {
        return { code: 'duplicate-key', message: `Duplicate key ${currentSection.base}.${key} at line ${i + 1}` };
      }
      currentSection.keys.set(key, value);
      continue;
    }

    return { code: 'malformed-config', message: `Unrecognized line at ${i + 1}` };
  }
  return sections;
}

/** Check a semantic section base and key against the dangerous policy. */
function isDangerousConfig(section: ParsedGitConfigSection, key: string): boolean {
  return DANGEROUS_CONFIG_PATTERNS.some((pattern) => pattern.section === section.base && pattern.keyPattern.test(key));
}

/**
 * Preflight a repository workspace root.
 * Returns null on success, or a PreflightError on rejection.
 */
export function preflightGitRepository(
  workspaceRoot: string,
): PreflightError | null {
  const dotGit = join(workspaceRoot, '.git');

  // 1. .git must exist and be a directory (not symlink, not file)
  let gitStat: ReturnType<typeof lstatSync>;
  try {
    gitStat = lstatSync(dotGit);
  } catch {
    return { code: 'no-git-dir', message: 'No .git entry at workspace root' };
  }

  // .git must NOT be a symlink
  if (gitStat.isSymbolicLink()) {
    return { code: 'git-is-symlink', message: '.git is a symlink' };
  }

  // .git must be a directory
  if (!gitStat.isDirectory()) {
    if (gitStat.isFile()) {
      return { code: 'worktree-not-supported', message: '.git is a file (worktree not supported)' };
    }
    return { code: 'git-not-directory', message: '.git is not a directory' };
  }

  // 2. Reject bare repos
  const headPath = join(dotGit, 'HEAD');
  if (!existsSync(headPath)) {
    return { code: 'bare-repo', message: 'Bare repository not supported' };
  }

  // 3. Reject commondir
  const commonDirPath = join(dotGit, 'commondir');
  if (existsSync(commonDirPath)) {
    return { code: 'commondir-present', message: '.git/commondir present — linked worktrees not supported' };
  }

  // 4. Reject alternates
  const alternatesPath = join(dotGit, 'objects', 'info', 'alternates');
  if (existsSync(alternatesPath)) {
    return { code: 'alternates-present', message: 'objects/info/alternates present — external object database not supported' };
  }

  // 5. Parse local config
  const configPath = join(dotGit, 'config');
  let configContent: string;
  try {
    const st = statSync(configPath);
    if (st.size > WP7_LIMITS.GIT_CONFIG_MAX_BYTES) {
      return { code: 'config-oversized', message: '.git/config exceeds maximum size' };
    }
    configContent = readFileSync(configPath, 'utf-8');
  } catch {
    // No config file — that's fine
    return null;
  }

  // Check for malformed UTF-8 by re-encoding
  if (Buffer.from(configContent, 'utf8').toString('utf8') !== configContent) {
    // Contains lone surrogates or invalid sequences
    return { code: 'config-malformed-utf8', message: '.git/config contains malformed UTF-8' };
  }

  const sections = parseGitConfigStrict(configContent);
  if ('code' in sections) return sections;

  // Check every section+key against dangerous patterns
  for (const section of sections.values()) {
    for (const key of section.keys.keys()) {
      if (isDangerousConfig(section, key)) {
        return { code: 'dangerous-config', message: `Dangerous config: [${section.base}] ${key}` };
      }
    }
  }

  return null;
}

/**
 * Determine whether the repository at the workspace root is unborn
 * (no commits yet on the current branch).
 *
 * Uses contained reads only: HEAD must exist (verified by preflight) and
 * must be a symbolic ref whose target ref file does not exist and is not
 * present in packed-refs. Detached HEAD is never "unborn" for this
 * purpose (a detached HEAD cannot exist in a commit-less repository).
 */
export function isUnbornRepository(workspaceRoot: string): boolean {
  const dotGit = join(workspaceRoot, '.git');
  const headPath = join(dotGit, 'HEAD');
  let head: string;
  try {
    head = readFileSync(headPath, 'utf8');
  } catch {
    return false; // cannot determine; preflight will have rejected the repo
  }
  const trimmed = head.trim();
  if (!trimmed.startsWith('ref: ')) return false;
  const refPath = trimmed.slice('ref: '.length).trim();
  if (refPath.length === 0) return false;
  const fullRefPath = join(dotGit, refPath);
  if (existsSync(fullRefPath)) return false;
  const packedRefsPath = join(dotGit, 'packed-refs');
  try {
    const packed = readFileSync(packedRefsPath, 'utf8');
    if (packed.includes(refPath)) return false;
  } catch {
    // no packed-refs: fine
  }
  return true;
}

/**
 * Verify that a workspace is a regular git repository suitable for inspection.
 */
export function verifyGitRepository(workspaceRoot: string): PreflightError | null {
  return preflightGitRepository(workspaceRoot);
}

// ---------------------------------------------------------------------------
// S-04: preflight fingerprint and prelaunch revalidation
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

/** Security-relevant repository state captured at preflight time. */
export interface RepositoryPreflightFingerprint {
  readonly dotGit: {
    readonly exists: boolean;
    readonly dev: number;
    readonly ino: number;
    readonly mode: number;
  };
  readonly config: {
    readonly exists: boolean;
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mode: number;
    readonly mtimeMs: number;
    readonly sha256: string;
  } | null;
  readonly commondirPresent: boolean;
  readonly alternatesPresent: boolean;
  readonly classification: 'regular' | 'not-a-repo';
}

function fileDigest(p: string): string | null {
  try {
    const data = readFileSync(p);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Capture a fingerprint of the security-relevant repository state.
 * Must be called after a successful preflight; returns the state used
 * for prelaunch revalidation.
 */
export function captureRepositoryPreflightFingerprint(
  workspaceRoot: string,
): RepositoryPreflightFingerprint | null {
  const dotGit = join(workspaceRoot, '.git');
  try {
    const gitStat = statSync(dotGit);
    const configPath = join(dotGit, 'config');
    let config: RepositoryPreflightFingerprint['config'] = null;
    try {
      const st = statSync(configPath);
      config = {
        exists: true,
        dev: st.dev,
        ino: st.ino,
        size: st.size,
        mode: st.mode,
        mtimeMs: st.mtimeMs,
        sha256: fileDigest(configPath) ?? '',
      };
    } catch {
      config = null; // no config file
    }
    return {
      dotGit: { exists: true, dev: gitStat.dev, ino: gitStat.ino, mode: gitStat.mode },
      config,
      commondirPresent: existsSync(join(dotGit, 'commondir')),
      alternatesPresent: existsSync(join(dotGit, 'objects', 'info', 'alternates')),
      classification: 'regular',
    };
  } catch {
    return null;
  }
}

/**
 * Revalidate the repository preflight fingerprint immediately before launch.
 * Returns an error message on drift; null when unchanged.
 */
export function revalidateRepositoryPreflightFingerprint(
  workspaceRoot: string,
  expected: RepositoryPreflightFingerprint,
): string | null {
  const dotGit = join(workspaceRoot, '.git');
  let gitStat;
  try {
    gitStat = statSync(dotGit);
  } catch {
    return 'repository .git disappeared before launch';
  }
  if (gitStat.dev !== expected.dotGit.dev || gitStat.ino !== expected.dotGit.ino || gitStat.mode !== expected.dotGit.mode) {
    return '.git identity changed before launch';
  }
  const commondirPresent = existsSync(join(dotGit, 'commondir'));
  if (commondirPresent !== expected.commondirPresent) {
    return 'commondir state changed before launch';
  }
  const alternatesPresent = existsSync(join(dotGit, 'objects', 'info', 'alternates'));
  if (alternatesPresent !== expected.alternatesPresent) {
    return 'alternates state changed before launch';
  }
  const configPath = join(dotGit, 'config');
  const configExists = existsSync(configPath);
  if (expected.config === null) {
    if (configExists) return '.git/config appeared before launch';
    return null;
  }
  if (!configExists) return '.git/config disappeared before launch';
  let st;
  try {
    st = statSync(configPath);
  } catch {
    return '.git/config unreadable before launch';
  }
  if (st.dev !== expected.config.dev || st.ino !== expected.config.ino || st.size !== expected.config.size || st.mode !== expected.config.mode || st.mtimeMs !== expected.config.mtimeMs) {
    return '.git/config changed before launch';
  }
  const digest = fileDigest(configPath);
  if (digest !== expected.config.sha256) {
    return '.git/config content changed before launch';
  }
  return null;
}
