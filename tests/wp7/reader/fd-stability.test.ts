/**
 * MAC-2D F-1 — descent failure-path fd-stability regression (real Intel).
 *
 * The senior review found that `descentAndOpen` returned typed failures
 * from two paths WITHOUT closing the successfully opened intermediate
 * directory fds recorded in `opened`:
 *
 *   A. intermediate descent failure (a component below an opened parent
 *      is missing);
 *   B. final-open failure (the final target is missing below an opened
 *      parent).
 *
 * This test repeats both failure shapes enough times to reveal a leak
 * (each iteration leaked one intermediate fd pre-correction) and asserts
 * process fd-count stability plus the inherited fail-closed codes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bindWorkspaceRoot, openForRead } from '../../../src/reader/fs.js';

const ITERATIONS = 80; // enough to reveal a leak; safely under the default fd limit

function makeRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac2df1-')));
  return {
    root,
    remove() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

function fdCount(): number {
  return fs.readdirSync('/dev/fd').length;
}

test('F-1 regression: repeated descent failures do not leak intermediate fds and keep fail-closed codes', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'a'));
    fs.writeFileSync(path.join(ws.root, 'ok.txt'), 'usable');
    const bound = await bindWorkspaceRoot(ws.root);
    const before = fdCount();

    // A. intermediate descent failure: 'a' opens, 'b' is missing.
    for (let i = 0; i < ITERATIONS; i++) {
      const r = await openForRead(bound, 'a/b/file.txt', 'a/b/file.txt');
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, 'not-found', 'inherited fail-closed code (intermediate)');
    }

    // B. final-open failure: 'a' opens, the final target is missing.
    for (let i = 0; i < ITERATIONS; i++) {
      const r = await openForRead(bound, 'a/nope.txt', 'a/nope.txt');
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, 'not-found', 'inherited fail-closed code (final)');
    }

    const after = fdCount();
    // Pre-correction each of the 160 failures leaked one intermediate fd.
    assert.ok(after <= before + 2, `fd count grew: ${before} -> ${after} (descent failure paths leak)`);

    // The process remains fully usable after the loop.
    const ok = await openForRead(bound, 'ok.txt', 'ok.txt');
    assert.equal(ok.ok, true);
    if (ok.ok) {
      const { readFileBytes } = await import('../../../src/reader/fs.js');
      const { bytes } = await readFileBytes(ok.target, 16);
      assert.equal(bytes.toString(), 'usable');
      ok.target.close();
    }
    await bound.close();
  } finally { ws.remove(); }
});
