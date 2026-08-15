/**
 * MAC-2D — integrated reader anchor sanity (real Intel filesystem).
 *
 * Proves the retained-descriptor property through the INTEGRATED reader
 * path (openForRead / openForListDirectory / readFileBytes /
 * listDirectoryEntries over the native seam): once the target descriptor
 * is obtained, renaming the lexical parent and replacing the old pathname
 * with a decoy (directory or symlink) cannot redirect the read or the
 * enumeration — bytes/entries always come from the retained original, or
 * the operation fails closed. MAC-3 owns the complete hostile race suite;
 * these are focused integration sanity probes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bindWorkspaceRoot,
  openForRead,
  openForListDirectory,
  readFileBytes,
  listDirectoryEntries,
} from '../../../src/reader/fs.js';

function makeRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac2d-anchor-')));
  return {
    root,
    remove() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test('file-read anchor: rename + decoy-directory replacement after open cannot redirect the read', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'ORIGINAL-BYTES');
    const bound = await bindWorkspaceRoot(ws.root);
    const opened = await openForRead(bound, 'sub/file.txt', 'sub/file.txt');
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    // Retain the opened descriptor; rename the lexical parent away and
    // plant a decoy holding DIFFERENT bytes at the old name.
    const moved = path.join(ws.root, 'sub-moved');
    fs.renameSync(path.join(ws.root, 'sub'), moved);
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'DECOY-BYTES');

    const { bytes } = await readFileBytes(opened.target, 64);
    assert.equal(bytes.toString(), 'ORIGINAL-BYTES', 'read stays bound to the retained original');
    assert.notEqual(bytes.toString(), 'DECOY-BYTES', 'decoy bytes are never returned');
    opened.target.close();
    await bound.close();
  } finally { ws.remove(); }
});

test('file-read anchor: symlink replacement after open cannot redirect the read (fd is the authority)', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'ORIGINAL-BYTES');
    const bound = await bindWorkspaceRoot(ws.root);
    const opened = await openForRead(bound, 'sub/file.txt', 'sub/file.txt');
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    const moved = path.join(ws.root, 'sub-moved');
    fs.renameSync(path.join(ws.root, 'sub'), moved);
    const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2d-decoy-'));
    fs.writeFileSync(path.join(decoy, 'file.txt'), 'DECOY-BYTES');
    fs.symlinkSync(decoy, path.join(ws.root, 'sub'));

    const { bytes } = await readFileBytes(opened.target, 64);
    assert.equal(bytes.toString(), 'ORIGINAL-BYTES', 'read stays bound to the retained original');
    opened.target.close();
    fs.rmSync(decoy, { recursive: true, force: true });
    await bound.close();
  } finally { ws.remove(); }
});

test('directory-list anchor: rename + decoy-directory replacement after open cannot redirect enumeration', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(ws.root, 'sub', `orig${i}`), 'x');
    const bound = await bindWorkspaceRoot(ws.root);
    const opened = await openForListDirectory(bound, 'sub', 'sub');
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    const moved = path.join(ws.root, 'sub-moved');
    fs.renameSync(path.join(ws.root, 'sub'), moved);
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'decoy-only'), 'x');

    const { entries, truncated } = listDirectoryEntries(opened.target, 100);
    assert.equal(truncated, false);
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['orig0', 'orig1', 'orig2', 'orig3'], 'entries come from the retained original');
    assert.ok(!names.includes('decoy-only'), 'no decoy entry appears');
    opened.target.close();
    await bound.close();
  } finally { ws.remove(); }
});

test('directory-list anchor: symlink replacement after open cannot redirect enumeration', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(ws.root, 'sub', `orig${i}`), 'x');
    const bound = await bindWorkspaceRoot(ws.root);
    const opened = await openForListDirectory(bound, 'sub', 'sub');
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    const moved = path.join(ws.root, 'sub-moved');
    fs.renameSync(path.join(ws.root, 'sub'), moved);
    const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2d-decoy2-'));
    fs.writeFileSync(path.join(decoy, 'decoy-only'), 'x');
    fs.symlinkSync(decoy, path.join(ws.root, 'sub'));

    const { entries } = listDirectoryEntries(opened.target, 100);
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['orig0', 'orig1', 'orig2'], 'enumeration stays in the retained original');
    assert.ok(!names.includes('decoy-only'), 'symlink decoy never followed');
    opened.target.close();
    fs.rmSync(decoy, { recursive: true, force: true });
    await bound.close();
  } finally { ws.remove(); }
});

test('pre-open symlink swap fails closed at the descriptor-relative open (decoy never read)', async () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'sub'));
    fs.writeFileSync(path.join(ws.root, 'sub', 'file.txt'), 'ORIGINAL');
    const bound = await bindWorkspaceRoot(ws.root);
    // Swap BEFORE the open: the lexical component becomes a symlink to a
    // decoy. The seam's per-component O_NOFOLLOW refuses it at open time —
    // earlier fail-closed than Linux (which would open then reject via
    // S-07) — the decoy is never read either way.
    const moved = path.join(ws.root, 'sub-moved');
    fs.renameSync(path.join(ws.root, 'sub'), moved);
    const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'mac2d-decoy3-'));
    fs.writeFileSync(path.join(decoy, 'file.txt'), 'DECOY-BYTES');
    fs.symlinkSync(decoy, path.join(ws.root, 'sub'));

    const opened = await openForRead(bound, 'sub/file.txt', 'sub/file.txt');
    assert.equal(opened.ok, false);
    if (!opened.ok) assert.equal(opened.code, 'not-found', 'symlink swap fails closed as not-found');
    fs.rmSync(decoy, { recursive: true, force: true });
    await bound.close();
  } finally { ws.remove(); }
});
