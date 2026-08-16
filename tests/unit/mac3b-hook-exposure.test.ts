/**
 * MAC-3B — production non-exposure guards for the completion-writer
 * test seams (TEST-ONLY).
 *
 * Proves the MAC-3B requirement: the two new optional hook members
 * (`afterCreateConflict`, `beforeWrite`) cannot be controlled by product
 * input and production behavior with hooks absent is unchanged.
 *
 *   - MCP schemas contain no hook fields (schemas/** scan);
 *   - artifact/config JSON cannot carry callbacks (JSON is data-only;
 *     the writer fails closed against non-callable hook values — runtime
 *     proof in wp13b-completion-seams.test.ts);
 *   - production composition passes no hooks (the only production
 *     caller, src/completion/run.ts, never constructs a hooks bag);
 *   - no serialization path transports hooks (no src/ file outside the
 *     writer references the members);
 *   - no test-harness vocabulary leaks into production (no 'mac3b',
 *     'child-actor', or tests/ imports in src/**);
 *   - the native surface remains exactly six exports (source-level scan
 *     of the seam's EXPORT table; the real addon surface is asserted by
 *     native/test and mac2f-e2e);
 *   - the public MCP surface remains nine tools (committed runtime
 *     static guard; additionally no hook token may appear in the
 *     runtime/adapters production trees).
 *
 * The hook TYPE living in a production module is accepted (MAC-3A §11):
 * absent hooks are no-ops, and no serialization path can materialize a
 * function. This file does not claim "zero production source change" —
 * src/completion/writer.ts intentionally gained the two optional members.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const SRC = join(REPO, 'src');
const SCHEMAS = join(REPO, 'schemas');
const NATIVE_SRC = join(REPO, 'native', 'src');

const HOOK_NAMES = ['afterCreateConflict', 'beforeWrite'];

function collectFiles(dir: string, suffix: string): string[] {
  const files: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of names.sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...collectFiles(full, suffix));
    else if (name.endsWith(suffix)) files.push(full);
  }
  return files;
}

function rel(file: string): string {
  return file.slice(REPO.length + 1);
}

const srcFiles = collectFiles(SRC, '.ts');
const schemaFiles = collectFiles(SCHEMAS, '.json');
assert.ok(srcFiles.length > 50, 'the production source tree must exist');

test('hook exposure guard: the new members appear in exactly the writer module, nowhere else in production', () => {
  const holders = srcFiles.filter((f) => HOOK_NAMES.some((h) => readFileSync(f, 'utf8').includes(h)));
  assert.deepEqual(
    holders.map((f) => rel(f)).sort(),
    [
      'src/completion/writer.ts',
      // pre-existing MAC-2B executor seam (accepted before MAC-3B): the
      // executor's own beforeWrite/afterRootOpen/afterWrite hooks.
      'src/writing/executor.ts',
      'src/writing/types.ts',
    ],
    'hook member names must not appear in any other production module',
  );
});

test('hook exposure guard: MCP schemas contain no hook fields', () => {
  assert.ok(schemaFiles.length >= 4, 'the schema tree must exist');
  for (const file of schemaFiles) {
    const text = readFileSync(file, 'utf8');
    for (const hook of HOOK_NAMES) {
      assert.equal(text.includes(hook), false, `${rel(file)} must not mention ${hook}`);
    }
  }
});

test('hook exposure guard: production composition passes no hooks', () => {
  // The only production callers of the writer (index re-export + run.ts
  // composition) must never construct a hooks bag.
  for (const file of ['src/completion/index.ts', 'src/completion/run.ts']) {
    const text = readFileSync(join(REPO, file), 'utf8');
    assert.equal(text.includes('hooks'), false, `${file} must not reference hooks at all`);
  }
});

test('hook exposure guard: no serialization path and no MCP/runtime/adapters module transports hooks', () => {
  const forbidden = [
    'src/adapters',
    'src/runtime',
    'src/server',
    'src/json',
    'src/mcp',
    'src/schema',
  ];
  for (const dir of forbidden) {
    for (const file of collectFiles(join(SRC, dir.split('/')[1] ?? dir), '.ts')) {
      const text = readFileSync(file, 'utf8');
      for (const hook of HOOK_NAMES) {
        assert.equal(text.includes(hook), false, `${rel(file)} must not mention ${hook}`);
      }
    }
  }
});

test('hook exposure guard: no test-harness vocabulary or tests/ imports leak into production', () => {
  for (const file of srcFiles) {
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes('mac3b'), false, `${rel(file)} must not reference the MAC-3B harness`);
    assert.equal(text.includes('child-actor'), false, `${rel(file)} must not reference the child actor`);
    assert.equal(text.includes("from '../tests/"), false, `${rel(file)} must not import from tests/`);
    assert.equal(text.includes("from '../../tests/"), false, `${rel(file)} must not import from tests/`);
  }
});

test('hook exposure guard: the native surface source table remains exactly six exports', () => {
  const c = readFileSync(join(NATIVE_SRC, 'gateway_fs.c'), 'utf8');
  const rows = [...c.matchAll(/EXPORT\("([a-zA-Z0-9]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rows, [
    'openDirectoryAt',
    'createExclusiveFileAt',
    'openExistingFileAt',
    'unlinkAt',
    'getPath',
    'readDirectoryEntries',
  ], 'native EXPORT table must stay exactly the six accepted primitives');
});

test('hook exposure guard: JSON cannot carry callbacks (runtime)', () => {
  const parsed = JSON.parse('{"afterCreateConflict":"x","beforeWrite":42}') as Record<string, unknown>;
  assert.equal(typeof parsed.afterCreateConflict, 'string', 'JSON fields are data, never functions');
  assert.equal(typeof parsed.beforeWrite, 'number');
  assert.equal(typeof parsed.afterCreateConflict === 'function' || typeof parsed.beforeWrite === 'function', false);
});
