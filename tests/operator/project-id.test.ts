/**
 * S2 — project id derivation tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectIdFromPath } from '../../src/operator/project-id.js';
import { isValidWorkspaceId } from '../../src/trusted/workspace-id.js';

test('project-id: deterministic and satisfies the workspace-id grammar', () => {
  const a = projectIdFromPath('/Users/x/project');
  const b = projectIdFromPath('/Users/x/project');
  const c = projectIdFromPath('/Users/x/other');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(isValidWorkspaceId(a), true);
  assert.match(a, /^pgw:w:[0-9a-f]{32}$/);
});
