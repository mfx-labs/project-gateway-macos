/**
 * PGM-DIST-2 — dual-architecture npm artifact packaging boundary.
 *
 * Proves the REAL packed artifact, not merely `npm pack --dry-run`:
 *   1. isolated writable temp dirs + an explicit temporary npm cache
 *      (the operator's npm cache is never used or polluted);
 *   2. a real `npm pack --json` into a temporary output location;
 *   3. extraction of that exact produced tarball into a fresh temp dir;
 *   4. content assertions — both exact native candidates present and no
 *      other native content packed;
 *   5. a FRESH Node child whose target is ONLY the extracted package
 *      imports the extracted `native/index.mjs` (absolute file URL;
 *      child cwd = extracted package root — no repository-local module
 *      or native fallback exists in this path);
 *   6. the x64 module still loads with exactly the six accepted primitives;
 *      arm64 verification stops at candidate bytes + loader path selection;
 *   7. package-name/bin identity pins preserved.
 *
 * Never writes into the repository; never touches runtime behavior.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SIX_PRIMITIVES = ['createExclusiveFileAt', 'getPath', 'openDirectoryAt', 'openExistingFileAt', 'readDirectoryEntries', 'unlinkAt'];
const X64_SHA256 = '0667af87eaf541a92fa299cd21cd2202dc825c6af9da650fd96cebf4553f6382';
const ARM64_SHA256 = 'f43705523b6859dc33283b75391e0ebf7cddf0779a877ee2edf7767152a946be';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function nativeFiles(root, dir = 'native') {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name);
    return entry.isDirectory() ? nativeFiles(root, rel) : [rel];
  }).sort();
}

function isolatedDirs() {
  const root = mkdtempSync(join(tmpdir(), 'pgm-dist2-'));
  // npm does not create the pack destination or the cache for us; both
  // must pre-exist for the real pack invocation (ENOENT otherwise).
  mkdirSync(join(root, 'npm-cache'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'pack-out'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'extract'), { recursive: true, mode: 0o700 });
  return {
    root,
    cache: join(root, 'npm-cache'),
    out: join(root, 'pack-out'),
    extract: join(root, 'extract'),
  };
}

function realPack(dirs) {
  const run = spawnSync('npm', ['pack', '--json', '--pack-destination', dirs.out, '--cache', dirs.cache], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_cache: dirs.cache, npm_config_loglevel: 'error' },
  });
  assert.equal(run.status, 0, `npm pack failed: ${run.stderr}`);
  const parsed = JSON.parse(run.stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  assert.ok(entry !== undefined && typeof entry.filename === 'string', 'npm pack --json must report a filename');
  return join(dirs.out, entry.filename);
}

function extractTarball(tarball, dirs) {
  const run = spawnSync('tar', ['-xzf', tarball, '-C', dirs.extract], { encoding: 'utf8' });
  assert.equal(run.status, 0, `tar extraction failed: ${run.stderr}`);
  return join(dirs.extract, 'package');
}

function packedNativeFiles(tarball) {
  const run = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
  assert.equal(run.status, 0, `tar listing failed: ${run.stderr}`);
  return run.stdout.split('\n').filter((entry) => entry.startsWith('package/native/') && !entry.endsWith('/')).sort();
}

test('real packed artifact: exact dual-architecture boundary and fail-closed loader selection', () => {
  const dirs = isolatedDirs();
  try {
    // 2. Real npm pack (isolated cache + output dir).
    const tarball = realPack(dirs);
    assert.deepEqual(packedNativeFiles(tarball), [
      'package/native/darwin-arm64/gateway_fs.node',
      'package/native/darwin-x64/gateway_fs.node',
      'package/native/index.mjs',
    ], 'tarball must contain each intended native file exactly once and no other native content');

    // 3. Extract the exact produced tarball.
    const pkgRoot = extractTarball(tarball, dirs);

    // 4. Content assertions on the EXTRACTED package.
    const entry = (rel) => join(pkgRoot, rel);
    const exists = (rel) => {
      try {
        readFileSync(entry(rel));
        return true;
      } catch {
        return false;
      }
    };
    assert.ok(exists('package.json'), 'extracted package.json must be present');
    assert.ok(exists('dist/runtime/mcp/cli.js'), 'extracted dist/ runtime (MCP CLI) must be present');
    assert.ok(exists('native/index.mjs'), 'extracted native loader must be present');
    assert.ok(exists('native/darwin-x64/gateway_fs.node'), 'extracted Intel x64 addon must be present');
    assert.ok(exists('native/darwin-arm64/gateway_fs.node'), 'extracted arm64 candidate addon must be present');
    assert.deepEqual(nativeFiles(pkgRoot), [
      'native/darwin-arm64/gateway_fs.node',
      'native/darwin-x64/gateway_fs.node',
      'native/index.mjs',
    ], 'package must contain exactly the loader and the two intended native addons');

    const x64Path = entry('native/darwin-x64/gateway_fs.node');
    const arm64Path = entry('native/darwin-arm64/gateway_fs.node');
    assert.ok(lstatSync(x64Path).isFile() && lstatSync(x64Path).size > 0, 'x64 addon must be a non-empty regular file');
    assert.ok(lstatSync(arm64Path).isFile() && lstatSync(arm64Path).size > 0, 'arm64 addon must be a non-empty regular file');
    assert.equal(sha256(x64Path), X64_SHA256, 'packed x64 bytes must remain exact');
    assert.equal(sha256(arm64Path), ARM64_SHA256, 'packed arm64 candidate bytes must remain exact');
    const arm64Header = readFileSync(arm64Path).subarray(0, 8);
    assert.equal(arm64Header.readUInt32LE(0), 0xfeedfacf, 'arm64 candidate must be a 64-bit Mach-O');
    assert.equal(arm64Header.readUInt32LE(4), 0x0100000c, 'arm64 candidate Mach-O CPU type must be arm64');

    // 5. Fresh Node child: target is ONLY the extracted package (absolute
    //    file URL; child cwd = extracted package root). The loader derives
    //    its addon baseDir from its OWN location inside the extracted
    //    package — the repository-local module/native tree is unreachable
    //    from this child.
    const childScript = [
      "const { pathToFileURL } = await import('node:url');",
      "const mod = await import(pathToFileURL(process.argv[1]).href);",
      "const x64Path = mod.resolveAddonPath('darwin', 'x64', process.argv[2]);",
      "const arm64Path = mod.resolveAddonPath('darwin', 'arm64', process.argv[2]);",
      "const unsupported = mod.resolveAddonPath('linux', 'x64', process.argv[2]);",
      "const addon = mod.loadGatewayFs({ platform: 'darwin', arch: 'x64', baseDir: process.argv[2] });",
      "console.log(JSON.stringify({ x64Path, arm64Path, unsupported, exports: Object.keys(addon).sort() }));",
    ].join('\n');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript, join(pkgRoot, 'native', 'index.mjs'), pkgRoot], {
      cwd: pkgRoot,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: dirs.cache },
    });
    assert.equal(child.status, 0, `extracted-package native load failed (exit ${child.status}): ${child.stderr}`);
    const loaded = JSON.parse(child.stdout.trim());

    // 6. Architecture selection remains host-targeted and fail-closed.
    assert.equal(loaded.x64Path, x64Path, 'x64 target must resolve to the packed x64 addon');
    assert.equal(loaded.arm64Path, arm64Path, 'arm64 target must resolve to the packed arm64 addon');
    assert.equal(loaded.unsupported, null, 'unsupported host target must have no addon path');
    assert.deepEqual(loaded.exports, SIX_PRIMITIVES, 'extracted x64 module must still expose exactly the six accepted primitives');
  } finally {
    rmSync(dirs.root, { recursive: true, force: true });
  }
});

test('packed identity preserves the macOS fork package/bin contract', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@project-gateway/macos-core', 'package identity preserved');
  assert.equal(pkg.version, '0.1.0', 'package version preserved');
  assert.equal(pkg.bin['project-gateway-macos-mcp'], './dist/runtime/mcp/cli.js', 'bin identity preserved');
  assert.deepEqual(pkg.files, [
    'dist',
    'native/index.mjs',
    'native/darwin-x64/gateway_fs.node',
    'native/darwin-arm64/gateway_fs.node',
  ], 'files boundary is exactly the dual-architecture candidate runtime set');
});
