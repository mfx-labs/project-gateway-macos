#!/usr/bin/env node
/**
 * Authoritative non-WP7 test inventory.
 *
 * Resource-pressure suites consume descriptors until per-process EMFILE.
 * Run them after the ordinary parallel inventory so concurrent test workers
 * cannot turn that intentional pressure into host-wide ENFILE.
 */
import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const PATTERNS = [
  'dist-test/tests/unit/*.test.js',
  'dist-test/tests/integration/*.test.js',
  'dist-test/tests/security/*.test.js',
  'dist-test/tests/pi-adapter/unit/*.test.js',
  'dist-test/tests/pi-adapter/integration/*.test.js',
  'dist-test/tests/pi-adapter/security/*.test.js',
  'dist-test/tests/pi-adapter/compatibility/*.test.js',
  'dist-test/tests/pi-adapter/enforcement/*.test.js',
  'dist-test/tests/mcp/unit/*.test.js',
  'dist-test/tests/runtime/*.test.js',
  'dist-test/tests/drafting/*.test.js',
  'dist-test/tests/writing/*.test.js',
  'dist-test/tests/trusted/*.test.js',
  'dist-test/tests/pointofuse-v2/*.test.js',
];
const PRESSURE_FILES = [
  'dist-test/tests/unit/mac3b-harness.test.js',
  'dist-test/tests/unit/mac3e-fd-pressure.test.js',
];

const files = PATTERNS.flatMap((pattern) => {
  const matches = globSync(pattern).sort();
  if (matches.length === 0) throw new Error(`no compiled tests match ${pattern}`);
  return matches;
});
const resolved = files.map((file) => resolve(file));
if (new Set(resolved).size !== files.length) throw new Error('compiled test inventory contains duplicate paths');

const pressure = PRESSURE_FILES.map((file) => resolve(file));
for (const file of pressure) {
  if (!resolved.includes(file)) throw new Error(`pressure test missing from compiled inventory: ${file}`);
}
const pressureSet = new Set(pressure);
const ordinary = files.filter((file) => !pressureSet.has(resolve(file)));

function run(args) {
  const child = spawnSync(process.execPath, args, { stdio: 'inherit' });
  return child.status === 0;
}

console.error(`[test-inventory] ${files.length} compiled test files: ${ordinary.length} ordinary parallel + ${pressure.length} pressure serialized`);
const ordinaryOk = run(['--test', ...ordinary]);
const pressureOk = run(['--test', '--test-concurrency=1', ...PRESSURE_FILES]);
process.exit(ordinaryOk && pressureOk ? 0 : 1);
