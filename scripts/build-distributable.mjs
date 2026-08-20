#!/usr/bin/env node
/**
 * S4 — distributable builder (developer/build-host tool; not production code).
 *
 *   node scripts/build-distributable.mjs <x64|arm64> [outDir]
 *
 * Builds CURRENT source first (`npm run build`) and then produces one
 * self-contained tarball per target macOS architecture into `artifacts/`:
 *
 *   project-gateway-macos-<version>-darwin-<arch>.tar.gz
 *   project-gateway-macos-<version>-darwin-<arch>.tar.gz.sha256
 *
 * The tarball contains only what the installed runtime requires: compiled
 * `dist/`, `package.json` (version + `#gateway-native` imports map), the
 * production `node_modules/` closure, `native/index.mjs`, exactly the selected
 * architecture's `gateway_fs.node`, and the two `bin/` entries (operator `pgw`
 * + internal MCP runtime `project-gateway-macos-mcp`, symlinks into `dist/`).
 *
 * End users never compile, never run node-gyp/tsc/Xcode/clang/Python, and
 * never run `npm install`; the artifact is already runnable with Node >= 22.
 * No bundler, no packaging framework, no new dependency.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARCH = process.argv[2];
if (ARCH !== 'x64' && ARCH !== 'arm64') {
  console.error('usage: node scripts/build-distributable.mjs <x64|arm64> [outDir]');
  process.exit(2);
}
// Optional output directory (default artifacts/); tests pass an isolated temp dir.
const outDir = process.argv[3] !== undefined ? resolve(process.argv[3]) : join(ROOT, 'artifacts');
mkdirSync(outDir, { recursive: true });

// S4-REV-003: build CURRENT source before assembling. `npm run build` is the
// normal non-recursive build command (`generate` + `tsc`); it never recurses
// into this script, so it is invoked directly. A failed build fails the
// builder — no artifact is reported.
const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
if (build.status !== 0) {
  console.error(`npm run build failed (exit ${build.status})`);
  process.exit(build.status ?? 1);
}

const LANE = `darwin-${ARCH}`;
const distCli = join(ROOT, 'dist', 'operator', 'cli.js');
if (!existsSync(distCli)) {
  console.error('dist/operator/cli.js is missing after build');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const name = `project-gateway-macos-${version}-${LANE}`;
const tarball = `${name}.tar.gz`;

/** Recursively collect the production runtime dependency closure (hoisted layout). */
function collectDeps(pkgName, seen) {
  if (seen.has(pkgName)) return;
  seen.add(pkgName);
  const dir = join(ROOT, 'node_modules', pkgName);
  if (!existsSync(join(dir, 'package.json'))) {
    throw new Error(`production dependency not found in node_modules: ${pkgName}`);
  }
  const depPkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const d of Object.keys(depPkg.dependencies ?? {})) collectDeps(d, seen);
}
const prodDeps = new Set();
for (const d of Object.keys(pkg.dependencies ?? {})) collectDeps(d, prodDeps);

const assembly = mkdtempSync(join(tmpdir(), 'pgw-dist-'));
try {
  // 1. compiled runtime
  cpSync(join(ROOT, 'dist'), join(assembly, 'dist'), { recursive: true });
  // 2. package.json (version + imports map)
  cpSync(join(ROOT, 'package.json'), join(assembly, 'package.json'));
  // 3. production node_modules closure only
  mkdirSync(join(assembly, 'node_modules'), { recursive: true });
  for (const d of [...prodDeps].sort()) {
    cpSync(join(ROOT, 'node_modules', d), join(assembly, 'node_modules', d), { recursive: true });
  }
  // 4. native loader + exactly the selected architecture addon
  mkdirSync(join(assembly, 'native', LANE), { recursive: true });
  cpSync(join(ROOT, 'native', 'index.mjs'), join(assembly, 'native', 'index.mjs'));
  cpSync(join(ROOT, 'native', LANE, 'gateway_fs.node'), join(assembly, 'native', LANE, 'gateway_fs.node'));
  // 5. bin entries (symlinks into dist)
  mkdirSync(join(assembly, 'bin'), { recursive: true });
  symlinkSync(join('..', 'dist', 'operator', 'cli.js'), join(assembly, 'bin', 'pgw'));
  symlinkSync(join('..', 'dist', 'runtime', 'mcp', 'cli.js'), join(assembly, 'bin', 'project-gateway-macos-mcp'));
  // 6. exec bit on the shebang entrypoints
  chmodSync(join(assembly, 'dist', 'operator', 'cli.js'), 0o755);
  chmodSync(join(assembly, 'dist', 'runtime', 'mcp', 'cli.js'), 0o755);

  // 7. tarball (system tar)
  const tar = spawnSync('/usr/bin/tar', ['-czf', join(outDir, tarball), '-C', assembly, '.'], { stdio: 'inherit' });
  if (tar.status !== 0) {
    console.error(`tar failed (exit ${tar.status})`);
    process.exit(tar.status ?? 1);
  }

  // 8. SHA-256 sidecar (the entire S4 artifact-integrity mechanism)
  const sha = createHash('sha256').update(readFileSync(join(outDir, tarball))).digest('hex');
  writeFileSync(join(outDir, `${tarball}.sha256`), `${sha}  ${tarball}\n`);
  console.log(`built ${join(outDir, tarball)}`);
  console.log(`sha256 ${sha}`);
} finally {
  rmSync(assembly, { recursive: true, force: true });
}
