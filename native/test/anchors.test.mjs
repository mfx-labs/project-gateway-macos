/**
 * MAC-1 — race/anchor probes (real hardware).
 *
 * These are MINIMAL probes of the property that justifies the native
 * seam: an operation anchored on a retained directory fd stays bound to
 * that directory object even when the lexical pathname is renamed and
 * the old name is replaced (by another directory or a symlink). MAC-3
 * owns the complete hostile race suite; this proves the primitive
 * itself has the property on real Intel hardware.
 *
 * Probe shape (per §13): A. parent opened to fd; B. lexical parent
 * renamed; C. original name replaced; D. openat/create/unlink through
 * the retained fd. Expected: operations bind to the retained object.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGatewayFs } from '../index.mjs';

const addon = loadGatewayFs();
const O = fs.constants;

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac1-anchor-'));
  const rootFd = fs.openSync(root, O.O_RDONLY | O.O_DIRECTORY);
  return { root, rootFd, remove() { try { fs.closeSync(rootFd); } catch {} fs.rmSync(root, { recursive: true, force: true }); } };
}

test('anchor: create through retained fd is not redirected by rename + replacement', () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'parent'));
    const parentFd = addon.openDirectoryAt(ws.rootFd, 'parent').fd;

    // B. rename the lexical parent; C. plant a replacement directory
    // (with its own distinct marker file) at the old name.
    fs.renameSync(path.join(ws.root, 'parent'), path.join(ws.root, 'parent-moved'));
    fs.mkdirSync(path.join(ws.root, 'parent'));
    fs.writeFileSync(path.join(ws.root, 'parent', 'marker.txt'), 'replacement');

    // D. exclusive create through the RETAINED fd.
    const r = addon.createExclusiveFileAt(parentFd, 'probe.txt');
    assert.equal(r.ok, true);
    fs.closeSync(r.fd);

    // The create landed in the retained object (now parent-moved)…
    assert.equal(fs.existsSync(path.join(ws.root, 'parent-moved', 'probe.txt')), true);
    // …and NOT in the replacement directory at the old name.
    assert.equal(fs.existsSync(path.join(ws.root, 'parent', 'probe.txt')), false);
    // The fd still identifies the moved object.
    assert.equal(addon.getPath(parentFd).path, fs.realpathSync(path.join(ws.root, 'parent-moved')));
    fs.closeSync(parentFd);
  } finally { ws.remove(); }
});

test('anchor: directory open through retained fd is not redirected by rename + symlink replacement', () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'parent'));
    fs.mkdirSync(path.join(ws.root, 'elsewhere'));
    const parentFd = addon.openDirectoryAt(ws.rootFd, 'parent').fd;

    // B+C. rename parent; replace the old name with a symlink to a
    // different directory.
    fs.renameSync(path.join(ws.root, 'parent'), path.join(ws.root, 'parent-moved'));
    fs.symlinkSync(path.join(ws.root, 'elsewhere'), path.join(ws.root, 'parent'));

    // D. open the child THROUGH the retained fd — must resolve inside
    // the retained object, never follow the replacement symlink.
    fs.mkdirSync(path.join(ws.root, 'parent-moved', 'child'));
    const c = addon.openDirectoryAt(parentFd, 'child');
    assert.equal(c.ok, true);
    assert.equal(addon.getPath(c.fd).path, fs.realpathSync(path.join(ws.root, 'parent-moved', 'child')));
    fs.closeSync(c.fd);
    fs.closeSync(parentFd);
  } finally { ws.remove(); }
});

test('anchor: unlink through retained fd is not redirected by rename + symlink replacement', () => {
  const ws = makeRoot();
  try {
    fs.mkdirSync(path.join(ws.root, 'parent'));
    const parentFd = addon.openDirectoryAt(ws.rootFd, 'parent').fd;
    const created = addon.createExclusiveFileAt(parentFd, 'victim.txt');
    fs.closeSync(created.fd);

    // B+C. rename parent; replace the old name with a symlink pointing
    // at a directory that ALSO contains a same-named file.
    fs.renameSync(path.join(ws.root, 'parent'), path.join(ws.root, 'parent-moved'));
    fs.mkdirSync(path.join(ws.root, 'decoy'));
    fs.writeFileSync(path.join(ws.root, 'decoy', 'victim.txt'), 'decoy-content');
    fs.symlinkSync(path.join(ws.root, 'decoy'), path.join(ws.root, 'parent'));

    // D. unlink through the retained fd — removes the object in the
    // retained directory, not the decoy's file.
    assert.deepEqual(addon.unlinkAt(parentFd, 'victim.txt'), { ok: true });
    assert.equal(fs.existsSync(path.join(ws.root, 'parent-moved', 'victim.txt')), false);
    assert.equal(fs.readFileSync(path.join(ws.root, 'decoy', 'victim.txt'), 'utf8'), 'decoy-content');
    fs.closeSync(parentFd);
  } finally { ws.remove(); }
});
