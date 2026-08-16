/**
 * PGM-DIST-1 — Intel npm artifact packaging boundary (focused regression).
 *
 * Proves the REAL packed artifact, not merely `npm pack --dry-run`:
 *   1. isolated writable temp dirs + an explicit temporary npm cache
 *      (the operator's npm cache is never used or polluted);
 *   2. a real `npm pack --json` into a temporary output location;
 *   3. extraction of that exact produced tarball into a fresh temp dir;
 *   4. content assertions — required boundaries present, forbidden
 *      boundaries absent;
 *   5. a FRESH Node child whose target is ONLY the extracted package
 *      imports the extracted `native/index.mjs` (absolute file URL;
 *      child cwd = extracted package root — no repository-local module
 *      or native fallback exists in this path);
 *   6. the loaded module exposes exactly the six accepted primitives;
 *   7. package-name/bin identity pins preserved.
 *
 * Never writes into the repository; never touches runtime behavior.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SIX_PRIMITIVES = ['createExclusiveFileAt', 'getPath', 'openDirectoryAt', 'openExistingFileAt', 'readDirectoryEntries', 'unlinkAt'];

function isolatedDirs() {
  const root = mkdtempSync(join(tmpdir(), 'pgm-dist1-'));
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

test('real packed artifact: required boundaries present, forbidden boundaries absent, extracted loader loads with exactly six exports', () => {
  const dirs = isolatedDirs();
  try {
    // 2. Real npm pack (isolated cache + output dir).
    const tarball = realPack(dirs);

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

    assert.ok(!exists('native/darwin-arm64/gateway_fs.node'), 'arm64 cross-build candidate must NOT be packed (MAC-5 blocked; not runtime evidence)');
    assert.ok(!exists('native/src/gateway_fs.c'), 'native source tree must NOT be packed');
    assert.ok(!exists('native/build/Release/gateway_fs.node'), 'native build tree must NOT be packed');
    assert.ok(!exists('native/test/loader.test.mjs'), 'native tests must NOT be packed');

    // 5. Fresh Node child: target is ONLY the extracted package (absolute
    //    file URL; child cwd = extracted package root). The loader derives
    //    its addon baseDir from its OWN location inside the extracted
    //    package — the repository-local module/native tree is unreachable
    //    from this child.
    const childScript = [
      "const { pathToFileURL } = await import('node:url');",
      "const mod = await import(pathToFileURL(process.argv[1]).href);",
      "const addon = mod.loadGatewayFs();",
      "console.log(JSON.stringify(Object.keys(addon).sort()));",
    ].join('\n');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript, join(pkgRoot, 'native', 'index.mjs')], {
      cwd: pkgRoot,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: dirs.cache },
    });
    assert.equal(child.status, 0, `extracted-package native load failed (exit ${child.status}): ${child.stderr}`);
    const loaded = JSON.parse(child.stdout.trim());

    // 6. Exactly the six accepted JS-visible primitives.
    assert.deepEqual(loaded, SIX_PRIMITIVES, 'extracted native module must expose exactly the six accepted primitives');
  } finally {
    rmSync(dirs.root, { recursive: true, force: true });
  }
});

test('packed identity preserves the macOS fork package/bin contract', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@project-gateway/macos-core', 'package identity preserved');
  assert.equal(pkg.bin['project-gateway-macos-mcp'], './dist/runtime/mcp/cli.js', 'bin identity preserved');
  assert.deepEqual(pkg.files, ['dist', 'native/index.mjs', 'native/darwin-x64/gateway_fs.node'], 'files boundary is exactly the accepted Intel runtime set');
});
