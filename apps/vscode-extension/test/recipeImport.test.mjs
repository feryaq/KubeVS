import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';

let temporaryDirectory;
let importRecipeFile;
const stateKey = '__kubevsRecipeImportRegression';
const context = { subscriptions: [] };
const source = { path: '/recipes/Iron Plate.json' };
const target = { path: '/generated/crafts/vanilla/iron_plate.js' };

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'kubevs-recipe-import-'));
  const outfile = path.join(temporaryDirectory, 'import.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/recipeImport.ts', import.meta.url))],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'import-boundaries',
        setup(builder) {
          builder.onResolve(
            { filter: /^(vscode|\.\/generatedTarget\.js|\.\/safeWrite\.js)$/ },
            (args) => ({ path: args.path, namespace: 'boundary' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'boundary' }, (args) => {
            const state = `globalThis.${stateKey}`;
            const contents =
              args.path === 'vscode'
                ? `
            export const window = {
              showOpenDialog: async options => { ${state}.dialogOptions = options; return ${state}.selection; },
              showInputBox: async options => { ${state}.inputOptions = options; return ${state}.id; },
              showTextDocument: async (...args) => { ${state}.editors.push(args); }
            };
            export const workspace = {
              fs: {
                stat: async uri => { ${state}.stats.push(uri); return { size: ${state}.size }; },
                readFile: async uri => { ${state}.reads.push(uri); return new TextEncoder().encode(${state}.text); }
              },
              asRelativePath: uri => uri.path,
              openTextDocument: async uri => { ${state}.documents.push(uri); return { uri }; }
            };`
                : args.path.includes('generatedTarget')
                  ? `
            export async function generatedCraftTarget(...args) { ${state}.targets.push(args); return ${state}.target; }`
                  : `
            export async function writeFileWithDiff(...args) { ${state}.writes.push(args); return ${state}.acceptWrite; }`;
            return { contents, loader: 'js' };
          });
        },
      },
    ],
  });
  ({ importRecipeFile } = await import(pathToFileURL(outfile).href));
});

after(async () => {
  delete globalThis[stateKey];
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

function reset(overrides = {}) {
  return (globalThis[stateKey] = {
    selection: [source],
    id: 'pack:iron_plate',
    size: 200,
    text: JSON.stringify({
      type: 'minecraft:crafting_shaped',
      pattern: ['I'],
      key: { I: { item: 'minecraft:iron_ingot' } },
      result: { id: 'minecraft:iron_block', count: 2 },
    }),
    target,
    acceptWrite: true,
    stats: [],
    reads: [],
    targets: [],
    writes: [],
    documents: [],
    editors: [],
    ...overrides,
  });
}
function evaluate(code, method) {
  const calls = [];
  runInNewContext(code, {
    Item: {
      of(id, count) {
        return { id, count };
      },
    },
    ServerEvents: {
      recipes(callback) {
        callback({
          [method](...args) {
            calls.push({ args });
            return {
              id(id) {
                calls.at(-1).id = id;
              },
            };
          },
        });
      },
    },
  });
  // Normalize cross-realm objects before assertions.
  return JSON.parse(JSON.stringify(calls));
}

test('imports vanilla JSON into executable readable wrapper with exact recipe ID and target', async () => {
  const state = reset();
  await importRecipeFile(context);
  assert.deepEqual(state.targets, [['pack:iron_plate', 'minecraft:crafting', 'recipe']]);
  assert.equal(state.inputOptions.value, 'kubevs:iron_plate');
  assert.equal(state.inputOptions.validateInput('pack:iron_plate'), undefined);
  assert.equal(typeof state.inputOptions.validateInput('../bad'), 'string');
  assert.equal(state.writes.length, 1);
  const [writtenContext, writtenTarget, code, options] = state.writes[0];
  assert.equal(writtenContext, context);
  assert.equal(writtenTarget, target);
  assert.match(
    code,
    /^\/\/ Imported by KubeVS\nServerEvents\.recipes\(event => \{\n  event\.shaped/u,
  );
  assert.match(code, /\.id\("pack:iron_plate"\)\n\}\);\n$/u);
  assert.deepEqual(evaluate(code, 'shaped'), [
    {
      args: [{ id: 'minecraft:iron_block', count: 2 }, ['I'], { I: 'minecraft:iron_ingot' }],
      id: 'pack:iron_plate',
    },
  ]);
  assert.match(options.confirmation, /iron_plate\.js/u);
  assert.deepEqual(state.documents, [target]);
  assert.equal(state.editors.length, 1);
  assert.deepEqual(state.editors[0][1], { preview: false });
});

test('preserves generic custom recipe JSON and attaches its chosen ID', async () => {
  const json = {
    type: 'example:crusher',
    ingredient: { tag: 'c:ores/iron' },
    energy: 240,
    results: [{ id: 'example:dust', chance: 0.7 }],
  };
  const state = reset({ id: 'pack:crusher/iron', text: JSON.stringify(json) });
  await importRecipeFile(context);
  assert.deepEqual(evaluate(state.writes[0][2], 'custom'), [
    { args: [json], id: 'pack:crusher/iron' },
  ]);
  assert.equal(state.targets[0][0], 'pack:crusher/iron');
});

test('rejects malformed JSON, missing recipe type, and unmapped shaped ingredients without writing', async () => {
  for (const text of [
    '{',
    '{}',
    JSON.stringify({
      type: 'minecraft:crafting_shaped',
      pattern: ['X'],
      key: {},
      result: { id: 'minecraft:stone' },
    }),
  ]) {
    const state = reset({ text });
    await assert.rejects(importRecipeFile(context));
    assert.equal(state.writes.length, 0);
    assert.equal(state.targets.length, 0);
    assert.equal(state.editors.length, 0);
  }
});

test('rejects oversized files before reading content or prompting for an ID', async () => {
  const state = reset({ size: 1_048_577 });
  await assert.rejects(importRecipeFile(context), /1 MiB/u);
  assert.equal(state.reads.length, 0);
  assert.equal(state.inputOptions, undefined);
  assert.equal(state.writes.length, 0);
  assert.equal(state.editors.length, 0);
});

test('file-dialog and ID cancellation produce no write or editor', async () => {
  for (const overrides of [{ selection: undefined }, { id: undefined }]) {
    const state = reset(overrides);
    await importRecipeFile(context);
    assert.equal(state.writes.length, 0);
    assert.equal(state.targets.length, 0);
    assert.equal(state.documents.length, 0);
    assert.equal(state.editors.length, 0);
  }
});

test('declining overwrite never opens the generated file', async () => {
  const state = reset({ acceptWrite: false });
  await importRecipeFile(context);
  assert.equal(state.writes.length, 1);
  assert.equal(state.documents.length, 0);
  assert.equal(state.editors.length, 0);
});
