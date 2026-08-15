/**
 * WP-7-B — Shared test fixtures.
 *
 * Builds a real temporary workspace tree, validates a trusted configuration
 * against it, and supplies a real existing-path resolver backed by
 * node:fs `realpathSync` (the host-boundary resolver WP-7 consumes).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  validateTrustedWorkspaceConfiguration,
  TRUSTED_HOST_LANE,
  type ExistingPathResolver,
  type ExistingPathResolution,
  type ValidatedTrustedWorkspaceConfiguration,
} from '../../src/trusted/index.js';

export const WORKSPACE_ALPHA = 'pgw:w:aaaaaaaaaaaaaaaa';

/**
 * WP-7-C — shared mutation-tripwire fingerprint model (test-only).
 *
 * Records, per tree, the exact path set (files, directories, symlinks),
 * regular-file content SHA-256 / size / mode, directory modes, and symlink
 * identity + link target (via lstat/readlink). Symlinks are recorded but
 * NEVER followed; targets outside the fingerprint root are not walked.
 * atime is excluded exactly as the contract accepts (RO-004/RO-005).
 * Lock files (*.lock) are tracked separately and must be absent after.
 */
export interface FingerprintEntry {
  readonly kind: 'file' | 'dir' | 'link' | 'other';
  readonly sha256?: string;
  readonly size?: number;
  readonly mode: number;
  readonly linkTarget?: string;
}

export type TreeFingerprint = {
  readonly entries: Map<string, FingerprintEntry>;
  readonly locks: string[];
};

/** Fingerprint a tree without following any symlink. Fail-closed (Z-05):
 * any fs failure (enumeration, lstat, readlink, hashing, permissions) throws
 * with a bounded RELATIVE-path diagnostic; nothing is silently omitted. */
export function fingerprintTree(dir: string): TreeFingerprint {
  const entries = new Map<string, FingerprintEntry>();
  const locks: string[] = [];
  const walk = (d: string, rel: string): void => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(d, { withFileTypes: true });
    } catch (err) {
      throw new Error(
        `fingerprint: cannot enumerate '${rel === '' ? '.' : rel}' (${(err as NodeJS.ErrnoException).code ?? 'error'})`,
      );
    }
    for (const e of dirents) {
      const p = path.join(d, e.name);
      const relPath = rel === '' ? e.name : `${rel}/${e.name}`;
      let st: fs.Stats;
      try {
        st = fs.lstatSync(p);
      } catch (err) {
        throw new Error(
          `fingerprint: cannot stat '${relPath}' (${(err as NodeJS.ErrnoException).code ?? 'error'})`,
        );
      }
      if (e.isDirectory() && st.isDirectory()) {
        entries.set(`${relPath}/`, { kind: 'dir', mode: st.mode & 0o777 });
        walk(p, relPath);
      } else if (e.isFile() && st.isFile()) {
        let data: Buffer;
        try {
          data = fs.readFileSync(p);
        } catch (err) {
          throw new Error(
            `fingerprint: cannot hash '${relPath}' (${(err as NodeJS.ErrnoException).code ?? 'error'})`,
          );
        }
        entries.set(relPath, {
          kind: 'file',
          sha256: createHash('sha256').update(data).digest('hex'),
          size: st.size,
          mode: st.mode & 0o777,
        });
        if (relPath.includes('.lock') || relPath.endsWith('.lock')) locks.push(relPath);
      } else if (e.isSymbolicLink() && st.isSymbolicLink()) {
        let target: string;
        try {
          target = fs.readlinkSync(p);
        } catch (err) {
          throw new Error(
            `fingerprint: cannot readlink '${relPath}' (${(err as NodeJS.ErrnoException).code ?? 'error'})`,
          );
        }
        entries.set(relPath, {
          kind: 'link',
          linkTarget: target,
          mode: st.mode & 0o777,
        });
      } else {
        // Other kinds (socket, fifo, device) — recorded by path set only.
        entries.set(relPath, { kind: 'other', mode: st.mode & 0o777 });
      }
    }
  };
  walk(dir, '');
  return { entries, locks };
}

/** Assert two tree fingerprints are identical (path set, content, size, mode, symlinks). */
export function assertTreesEqual(a: TreeFingerprint, b: TreeFingerprint, label: string): void {
  const aKeys = [...a.entries.keys()].sort();
  const bKeys = [...b.entries.keys()].sort();
  assert.deepEqual(bKeys, aKeys, `${label}: path set changed`);
  for (const key of aKeys) {
    const ea = a.entries.get(key)!;
    const eb = b.entries.get(key)!;
    assert.equal(eb.kind, ea.kind, `${label}: kind changed for ${key}`);
    if (ea.kind === 'file') {
      assert.equal(eb.sha256, ea.sha256, `${label}: content changed for ${key}`);
      assert.equal(eb.size, ea.size, `${label}: size changed for ${key}`);
    }
    if (ea.kind === 'link') {
      assert.equal(eb.linkTarget, ea.linkTarget, `${label}: symlink target changed for ${key}`);
    }
    assert.equal(eb.mode, ea.mode, `${label}: mode changed for ${key}`);
  }
  assert.deepEqual(b.locks, [], `${label}: leftover lock files`);
}

/** SHA-256 of a binary file (used for the Git executable tripwire). */
export function sha256File(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

export interface Wp7Fixture {
  readonly root: string;
  readonly configuration: ValidatedTrustedWorkspaceConfiguration;
  readonly resolveExistingPath: ExistingPathResolver;
  readonly home: string;
  readonly tmpdir: string;
  cleanup(): void;
}

function makeTree(base: string, relative: string): string {
  const dir = path.join(base, relative);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(base: string, relative: string, content: string | Buffer): void {
  const p = path.join(base, relative);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function realResolver(): ExistingPathResolver {
  return (p: string): ExistingPathResolution => {
    try {
      return { ok: true, canonical: fs.realpathSync(p) };
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT' || e.code === 'ELOOP' || e.code === 'ENOTDIR') {
        return { ok: false, code: 'not-found' };
      }
      return { ok: false, code: 'error' };
    }
  };
}

/**
 * Create a fixture: temp workspace with a conventional tree, validated
 * trusted configuration, and a real-path resolver. The workspace is
 * created under os.tmpdir(), which satisfies the "outside workspace roots"
 * constraint for HOME/TMPDIR validation.
 */
export function createWp7Fixture(): Wp7Fixture {
  // realpath-canonical base (MAC-2D): production canonical roots are
  // symlink-resolved (src/trusted/roots.ts) and the reader's S-07 /
  // containment evidence is realpath-canonical; tmpdir() is /var/… whose
  // vnode-canonical form is /private/var/….
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-test-')));
  const root = makeTree(base, 'workspace');
  // Conventional tree
  makeTree(root, 'docs');
  makeTree(root, 'src');
  makeTree(root, 'empty');
  writeFile(root, 'docs/notes.md', 'hello world\n');
  writeFile(root, 'src/main.ts', 'export const x = 1;\n');
  writeFile(root, 'src/alpha.txt', 'alpha content\n');
  writeFile(root, 'README.md', '# Project\n');
  // UTF-8 content with multi-byte chars
  writeFile(root, 'docs/unicode.md', 'café résumé — 日本語\n');

  const report = validateTrustedWorkspaceConfiguration(
    {
      configurationVersion: '1',
      capabilityVocabularyVersion: 'v1',
      provenance: { sourceKind: 'trusted-local-control-plane' },
      workspaces: [{ workspaceId: WORKSPACE_ALPHA, root }],
    },
    { hostLane: TRUSTED_HOST_LANE, resolveRootPath: (p: string) => p },
  );
  if (!report.ok) {
    fs.rmSync(base, { recursive: true, force: true });
    throw new Error(`fixture configuration invalid: ${report.findings.map((f) => f.code).join(',')}`);
  }

  // HOME and TMPDIR: separate empty dirs, outside the workspace
  const home = makeTree(base, 'home');
  const tmpdir = makeTree(base, 'tmpdir');
  // Make them non-group/world-writable and owned by the current user
  fs.chmodSync(home, 0o700);
  fs.chmodSync(tmpdir, 0o700);

  const fixture: Wp7Fixture = {
    root,
    configuration: report.configuration!,
    resolveExistingPath: realResolver(),
    home,
    tmpdir,
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
  return fixture;
}

/**
 * Create a temporary git repository fixture with configurable hostile
 * configuration content.
 */
export function createGitFixture(
  configContent?: string,
  extraSetup?: (root: string) => void,
): { root: string; cleanup(): void } {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-git-test-')));
  const root = makeTree(base, 'repo');
  // init a git repo with the host git binary
  execFileSync(process.env.WP7_GIT_BINARY ?? '/usr/bin/git', ['init', '-q', root], { stdio: 'ignore' });
  // Set user identity to allow commits
  execFileSync(process.env.WP7_GIT_BINARY ?? '/usr/bin/git', ['-C', root, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
  execFileSync(process.env.WP7_GIT_BINARY ?? '/usr/bin/git', ['-C', root, 'config', 'user.name', 't'], { stdio: 'ignore' });
  writeFile(root, 'file.txt', 'content\n');
  execFileSync(process.env.WP7_GIT_BINARY ?? '/usr/bin/git', ['-C', root, 'add', 'file.txt'], { stdio: 'ignore' });
  execFileSync(process.env.WP7_GIT_BINARY ?? '/usr/bin/git', ['-C', root, 'commit', '-q', '-m', 'init'], { stdio: 'ignore' });

  if (configContent !== undefined) {
    fs.writeFileSync(path.join(root, '.git', 'config'), configContent);
  }
  if (extraSetup) extraSetup(root);
  return {
    root,
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}
