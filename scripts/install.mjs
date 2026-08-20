#!/usr/bin/env node
/**
 * S4 — standalone release installer.
 *
 *   node scripts/install.mjs <tarball> <sha256-sidecar-or-hex>
 *
 * There is NO `pgw install` command; installation is performed only by this
 * standalone installer. Small and procedural, local-artifact based.
 *
 * Flow (strict ordering):
 *
 *   detect host arch (macOS only)
 *   → require the artifact name to carry the host arch token (fail closed)
 *   → verify the tarball SHA-256
 *   → extract to a staging dir under the install root
 *   → smoke-test staged `bin/pgw --version`
 *   → preflight ~/.local/bin/pgw ownership (fail closed on an unrelated entry)
 *   → only if ownership is acceptable: replace `current/` + refresh the link
 *
 * The previous installation (and any unrelated `pgw` pathname) is untouched
 * if digest verification, extraction, the staging smoke test, or the
 * ownership preflight fails. No transaction framework, no rollback journal,
 * no receipts, no keyring/signing, no version history, no ownership database.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';

function fail(message) {
  console.error(`install: ${message}`);
  process.exit(1);
}

/**
 * Ownership decision for the operator bin link (`~/.local/bin/pgw`).
 *
 *   absent                    → 'absent'   (may proceed)
 *   symlink → canonical target → 'gateway'  (may refresh)
 *   anything else              → 'unrelated' (must preserve, fail closed)
 */
function inspectBinLink(linkPath, canonicalTarget) {
  let lst;
  try {
    lst = lstatSync(linkPath);
  } catch (err) {
    if (err.code === 'ENOENT') return 'absent';
    // unreadable for any other reason: never delete — preserve, fail closed.
    return 'unrelated';
  }
  if (!lst.isSymbolicLink()) return 'unrelated';
  const raw = readlinkSync(linkPath);
  const resolved = isAbsolute(raw) ? normalize(raw) : resolve(dirname(linkPath), raw);
  return resolved === normalize(canonicalTarget) ? 'gateway' : 'unrelated';
}

const [tarballArg, sidecarArg] = process.argv.slice(2);
if (tarballArg === undefined || sidecarArg === undefined) {
  console.error('usage: node scripts/install.mjs <tarball> <sha256-sidecar-or-hex>');
  process.exit(2);
}

// 1. host platform/architecture
if (process.platform !== 'darwin') fail(`unsupported platform ${process.platform} (macOS required)`);
const lane = process.arch === 'x64' ? 'darwin-x64' : process.arch === 'arm64' ? 'darwin-arm64' : null;
if (lane === null) fail(`unsupported architecture ${process.arch}`);

// 2. architecture match, before any extraction
const token = `darwin-${process.arch}`;
if (!basename(tarballArg).includes(token)) {
  fail(`artifact does not match this host architecture (expected ${token} in the artifact name)`);
}

// 3. expected digest (sidecar file, or a bare 64-hex operand)
let expected;
if (/^[0-9a-f]{64}$/.test(sidecarArg)) {
  expected = sidecarArg;
} else {
  const content = readFileSync(sidecarArg, 'utf8');
  const match = content.match(/[0-9a-f]{64}/);
  if (match === null) fail('sha256 sidecar contains no digest');
  expected = match[0];
}

// 4. verify tarball digest
const actual = createHash('sha256').update(readFileSync(tarballArg)).digest('hex');
if (actual !== expected) fail(`digest mismatch (expected ${expected}, got ${actual})`);

// 5. staging
const installRoot = join(homedir(), '.local', 'share', 'project-gateway-macos');
const staging = join(installRoot, `.staging-${process.pid}`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

// 6. extract into staging
const tar = spawnSync('/usr/bin/tar', ['-xzf', tarballArg, '-C', staging], { stdio: 'inherit' });
if (tar.status !== 0) {
  rmSync(staging, { recursive: true, force: true });
  fail('extraction failed');
}

// 7. required staged entries
const required = [
  'package.json',
  'bin/pgw',
  'bin/project-gateway-macos-mcp',
  'dist/operator/cli.js',
  `native/${lane}/gateway_fs.node`,
];
const missing = required.filter((p) => !existsSync(join(staging, p)));
if (missing.length > 0) {
  rmSync(staging, { recursive: true, force: true });
  fail(`staged payload is missing required entries: ${missing.join(', ')}`);
}

// 8. smoke-test the staged operator BEFORE replacing the active install
const smoke = spawnSync(join(staging, 'bin', 'pgw'), ['--version'], { stdio: 'pipe' });
if (smoke.status !== 0) {
  rmSync(staging, { recursive: true, force: true });
  fail('staging smoke test failed');
}

// 8.5 preflight: ownership of ~/.local/bin/pgw BEFORE any destructive step.
const current = join(installRoot, 'current');
const binDir = join(homedir(), '.local', 'bin');
const link = join(binDir, 'pgw');
const canonicalTarget = join(current, 'bin', 'pgw');
const ownership = inspectBinLink(link, canonicalTarget);
if (ownership === 'unrelated') {
  rmSync(staging, { recursive: true, force: true });
  fail(`~/.local/bin/pgw exists and is not the Gateway-owned symlink; refusing to overwrite`);
}

// 9. replace current/ (only after ownership preflight passed)
rmSync(current, { recursive: true, force: true });
try {
  renameSync(staging, current);
} catch (err) {
  rmSync(staging, { recursive: true, force: true });
  fail(`could not activate installation (${(err).code ?? 'unknown'})`);
}

// 10. expose/refresh the operator CLI link (absent or Gateway-owned at this point)
mkdirSync(binDir, { recursive: true });
try {
  lstatSync(link);
  unlinkSync(link);
} catch {
  // absent: create fresh below
}
symlinkSync(canonicalTarget, link);

console.log(`installed ${link} -> ${canonicalTarget}`);
