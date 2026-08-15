/**
 * MAC-1 — static API-surface checks (security invariant, §10).
 *
 * The exported symbol list is a closed set. Nothing resembling general
 * filesystem authority, shell, exec, or subprocess capability may exist
 * on the module object; the native source may not reference the
 * corresponding syscalls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGatewayFs } from '../index.mjs';

const addon = loadGatewayFs();

test('exported API is exactly the closed five-primitive set', () => {
  assert.deepEqual(Object.keys(addon).sort(), [
    'createExclusiveFileAt',
    'getPath',
    'openDirectoryAt',
    'openExistingFileAt',
    'unlinkAt',
  ]);
  for (const name of Object.keys(addon)) {
    assert.equal(typeof addon[name], 'function', `${name} must be a function`);
  }
});

test('no general filesystem authority is exported', () => {
  const forbidden = [
    'open', 'openSync', 'close', 'closeSync', 'read', 'write', 'unlink', 'mkdir', 'rmdir',
    'rename', 'chmod', 'chown', 'stat', 'fstat', 'readdir', 'opendir', 'truncate',
    'symlink', 'link', 'copyFile', 'rm', 'readFile', 'writeFile',
    'exec', 'execFile', 'spawn', 'fork', 'shell', 'system', 'popen',
  ];
  for (const name of forbidden) {
    assert.equal(name in addon, false, `forbidden export: ${name}`);
  }
});

test('native source has no general-authority syscalls and no procfs/fdescfs references in code', () => {
  const src = stripComments(fs.readFileSync(new URL('../src/gateway_fs.c', import.meta.url), 'utf8'));
  for (const token of ['/proc', '/dev/fd', 'rename(', 'mkdir(', 'rmdir(', 'chmod(', 'chown(', 'readdir(', 'opendir(', 'symlink(', 'system(', 'popen(', 'execv', 'execve']) {
    assert.equal(src.includes(token), false, `forbidden token in native source: ${token}`);
  }
  // The only allowed syscalls: openat, unlinkat, fcntl(F_GETPATH), close.
  for (const token of ['openat(', 'unlinkat(', 'F_GETPATH', 'close(']) {
    assert.equal(src.includes(token), true, `expected syscall missing: ${token}`);
  }
  // Absolute-path opens cannot exist: no plain open(2) call in the source.
  assert.equal(/\bopen\(/.test(src), false);
});

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}
