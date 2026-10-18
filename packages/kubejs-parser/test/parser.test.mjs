import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeKubeJs, classifyScriptPath } from '../dist/index.js';

test('replacement calls need runtime verification; literals and comments do not warn', () => {
  const issues = analyzeKubeJs(
    `ServerEvents.recipes(event => { event.replaceInput({}, '#c:ingots/iron', 'gtceu:wrought_iron_ingot') })`,
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'warning');
  assert.equal(issues[0].code, 'kubevs/verify-replaced-inputs');
  assert.deepEqual(analyzeKubeJs(`// replaceInput()\nconst example = 'replaceInput()';`), []);
});

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
  assert.deepEqual(
    issues.map(({ line, startCharacter }) => [line, startCharacter]),
    [
      [1, 1],
      [2, 0],
    ],
  );
});

test('ignores braces and eval in comments, strings, regexes, and template text', () => {
  const source = [
    "const quoted = 'eval( { }';",
    'const doubleQuoted = "} eval(";',
    'const regex = /eval\\(\\{|\\}/g;',
    '/* eval( {',
    '   } */',
    '// eval( }',
    '`plain } eval( ${(() => ({ ok: true }))()} )`;',
  ].join('\n');
  assert.deepEqual(analyzeKubeJs(source), []);
});

test('finds eval in template substitutions and tracks braces across multiline templates', () => {
  const source = 'const result = `raw { text\n${eval /* checked */ ("bad")}`;';
  const issues = analyzeKubeJs(source);
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ['kubevs/no-eval'],
  );
  assert.deepEqual([issues[0].line, issues[0].startCharacter, issues[0].endCharacter], [1, 2, 6]);
});

test('reports each extra closing brace at its source position', () => {
  const issues = analyzeKubeJs('const x = 1;\n}\n  }');
  assert.deepEqual(
    issues.map(({ code, line, startCharacter, endCharacter }) => [
      code,
      line,
      startCharacter,
      endCharacter,
    ]),
    [
      ['kubevs/unbalanced-brace', 1, 0, 1],
      ['kubevs/unbalanced-brace', 2, 2, 3],
    ],
  );
});

test('reports multiline block comments without treating their braces as code', () => {
  const source = '/* open {\n close } */\nServerEvents.recipes(event => {});';
  assert.deepEqual(analyzeKubeJs(source), []);
});

test('warns about event namespaces that do not match the script folder', () => {
  const issues = analyzeKubeJs('ServerEvents.recipes(event => {});', 'startup_scripts');
  assert.deepEqual(
    issues.map(({ code, line }) => [code, line]),
    [['kubevs/wrong-event-kind', 0]],
  );
  assert.deepEqual(
    analyzeKubeJs('StartupEvents.init(() => {});', 'server_scripts').map((issue) => issue.code),
    ['kubevs/wrong-event-kind'],
  );
  assert.deepEqual(analyzeKubeJs('ServerEvents.recipes(() => {});', 'server_scripts'), []);
});
