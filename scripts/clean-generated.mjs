#!/usr/bin/env node
/**
 * WP-7-C — automatic generated-output cleanup (development/test tooling).
 *
 * Removes the gitignored compiled-output directories (dist/, dist-test/)
 * before the official test workflow rebuilds them, so stale compiled tests
 * and deleted-source residues can never affect test discovery.
 *
 * Repository anchoring (Z-02): the repository root is derived from this
 * script's own location (import.meta.url -> dirname -> parent), NEVER from
 * process.cwd(). Before deletion the script verifies:
 *   - the derived root contains package.json whose name is the expected
 *     repository marker (@project-gateway/macos-core);
 *   - each target is exactly a direct child of the derived root;
 *   - the target basename is exactly `dist` or `dist-test`;
 *   - neither target resolves to the repository root itself;
 *   - neither target escapes the repository root.
 * Only `<repo-root>/dist` and `<repo-root>/dist-test` are ever removed.
 * Symlinked entries are unlinked (fs.rmSync never follows symlinks), so
 * external symlink targets remain intact.
 *
 * Failure semantics: any validation or removal failure throws and the
 * process exits nonzero (visible failure). Only an absent target is
 * tolerated.
 */
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PACKAGE_NAME = '@project-gateway/macos-core';
const TARGETS = ['dist', 'dist-test'];

// Repository root derived from this script: <repo>/scripts/clean-generated.mjs
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`[clean-generated] FATAL: ${message}`);
  process.exit(1);
}

// 1. Verify the repository marker.
const pkgPath = join(REPO_ROOT, 'package.json');
if (!existsSync(pkgPath)) {
  fail(`no package.json at derived repository root: ${REPO_ROOT}`);
}
let pkg;
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
} catch (err) {
  fail(`package.json at derived repository root is unreadable or invalid: ${String(err)}`);
}
if (pkg.name !== EXPECTED_PACKAGE_NAME) {
  fail(`package name mismatch at derived repository root (expected ${EXPECTED_PACKAGE_NAME}, got ${pkg.name ?? '(missing)'})`);
}

// 2. Remove each target after path-safety validation.
for (const target of TARGETS) {
  const resolved = resolve(REPO_ROOT, target);
  // Direct child: basename exact and parent is the repository root.
  if (resolved === REPO_ROOT) fail(`refusing to remove the repository root itself (${target})`);
  if (resolved.split(sep).pop() !== target) fail(`target ${target} is not a direct child of the repository root`);
  if (dirname(resolved) !== REPO_ROOT) fail(`target ${target} escapes the repository root`);
  if (!resolved.startsWith(REPO_ROOT + sep) && resolved !== REPO_ROOT) {
    fail(`target ${target} is outside the repository root`);
  }
  // lstat: detect dangling symlinks too (existsSync follows links).
  let present = false;
  try {
    lstatSync(resolved);
    present = true;
  } catch (err) {
    if (err?.code === 'ENOENT') present = false;
    else fail(`cannot stat ${target}: ${String(err)}`);
  }
  if (!present) {
    console.log(`[clean-generated] ${target} absent; nothing to clean`);
    continue;
  }
  // rmSync on a symlink unlinks the link; recursive removal never follows
  // symlinks, so external targets and nested symlink targets stay intact.
  rmSync(resolved, { recursive: true, force: true });
  console.log(`[clean-generated] removed ${target}`);
}
