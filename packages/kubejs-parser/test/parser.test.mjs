import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeKubeJs, classifyScriptPath } from '../dist/index.js';

test('classifies KubeJS folders on either platform', () => {
  assert.equal(classifyScriptPath('kubejs\\server_scripts\\main.js'), 'server_scripts');
  assert.equal(classifyScriptPath('/pack/kubejs/startup_scripts/items.js'), 'startup_scripts');
  assert.equal(classifyScriptPath('/pack/config/file.js'), undefined);
});

test('reports unsafe eval and unbalanced braces', () => {
  const issues = analyzeKubeJs("ServerEvents.recipes(event => {\n eval('bad')\n");
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ['kubevs/no-eval', 'kubevs/unbalanced-brace'],
  );
});
