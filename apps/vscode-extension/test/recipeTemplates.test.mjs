import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';

let directory, editor;
const key = '__kubevsTemplateTest';
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'kubevs-template-test-'));
  const outfile = path.join(directory, 'editor.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/recipeTemplateEditor.ts', import.meta.url))],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'vscode-template-host',
        setup(builder) {
          builder.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock' }));
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
            loader: 'js',
            contents: `
        const state = () => globalThis.${key};
        export class FileSystemError extends Error { constructor(code) { super(code); this.code = code; } }
        export const ViewColumn = { One: 1 };
        export const Uri = { joinPath: (base, ...parts) => ({path: [base.path, ...parts].join('/')}) };
        export const workspace = {
          get workspaceFolders() { return [{ uri: {scheme: 'file',path: '/project'}, name: 'Project', index: 0 }]; },
          asRelativePath: uri => uri.path.replace('/project/', ''),
          fs: {
            async createDirectory() {},
            async readFile(uri) { const bytes=state().files.get(uri.path); if(!bytes)throw new FileSystemError('FileNotFound');return bytes; },
            async writeFile(uri, bytes) {state().files.set(uri.path,bytes)},
            async delete(uri) {state().files.delete(uri.path)},
          },
        };
        export const env = {clipboard:{async writeText(){}}};
        export const commands = { async executeCommand() {state().diffs++} };
        export const window = {
          createWebviewPanel() { return { onDidDispose() {}, webview: { cspSource:'test:', onDidReceiveMessage(callback) {state().receive=callback}, async postMessage(value) {state().messages.push(value)} } }; },
          async showWarningMessage() { return state().confirm ? 'Replace' : undefined; },
          async showOpenDialog() { return state().importPath ? [{path:state().importPath}] : undefined; },
          async showSaveDialog() { return state().exportPath ? {path:state().exportPath} : undefined; },
        };
      `,
          }));
        },
      },
    ],
  });
  editor = await import(pathToFileURL(outfile).href);
});
after(async () => {
  delete globalThis[key];
  await rm(directory, { recursive: true, force: true });
});
async function start() {
  const state = { files: new Map(), messages: [], diffs: 0, confirm: true };
  globalThis[key] = state;
  await editor.openRecipeTemplateEditor({
    subscriptions: [],
    globalStorageUri: { path: '/storage' },
  });
  state.call = async (type, data = {}) => {
    await state.receive({ type, revision: state.messages.length + 1, ...data });
    return state.messages.at(-1);
  };
  return state;
}
const json = {
  type: 'example:machine',
  ingredients: [{ tag: 'c:ingots/iron' }],
  result: { id: 'example:plate' },
  pressure: 2,
  conditions: [{ type: 'example:temperature', value: 300 }],
};
test('author, save, import and export packs without dropping unexposed conditions or sibling templates', async () => {
  const s = await start();
  const inferred = await s.call('infer', {
    id: 'test:machine',
    label: 'Machine',
    source: JSON.stringify(json),
  });
  assert.equal(inferred.type, 'inferred');
  const fields = inferred.schema.fields.filter((field) => field.path !== 'conditions');
  fields.find((field) => field.path === 'pressure').default = 5;
  const draft = { id: 'test:machine', label: 'Machine', fields };
  const preview = await s.call('previewTemplate', draft);
  assert.equal(preview.recipe.pressure, 5);
  assert.deepEqual(preview.recipe.conditions, json.conditions);
  assert.equal((await s.call('saveTemplate', draft)).type, 'templateSaved');
  const installed = '/project/.kubevs/recipe-packs/test%3Amachine.kubevs-pack.json';
  const pack = JSON.parse(new TextDecoder().decode(s.files.get(installed)));
  assert.equal(pack.schemas[0].base.pressure, 2);
  s.importPath = '/shared/example.kubevs-pack.json';
  pack.schemas.push({ ...pack.schemas[0], id: 'test:sibling', label: 'Sibling' });
  s.files.set(s.importPath, new TextEncoder().encode(JSON.stringify(pack)));
  assert.equal((await s.call('import')).type, 'imported');
  s.exportPath = '/shared/exported.kubevs-pack.json';
  assert.equal((await s.call('exportPack', draft)).type, 'exported');
  const exported = JSON.parse(new TextDecoder().decode(s.files.get(s.exportPath)));
  assert.deepEqual(exported.schemas.map((schema) => schema.id).sort(), [
    'test:machine',
    'test:sibling',
  ]);
  assert.ok(s.diffs >= 1, 'Replacing an installed pack must use the native diff');
  assert.equal(
    (await s.call('saveTemplate', { ...draft, id: 'test:renamed' })).type,
    'templateSaved',
  );
  const renamed = JSON.parse(new TextDecoder().decode(s.files.get(installed)));
  assert.deepEqual(renamed.schemas.map((schema) => schema.id).sort(), [
    'test:renamed',
    'test:sibling',
  ]);
});
test('required fields without defaults are valid templates, even when preview needs a value', async () => {
  const s = await start();
  const inferred = await s.call('infer', {
    id: 'test:required',
    label: 'Required',
    source: JSON.stringify(json),
  });
  const fields = [
    { ...inferred.schema.fields.find((field) => field.path === 'pressure'), required: true },
  ];
  delete fields[0].default;
  const draft = { id: 'test:required', label: 'Required', fields };
  const preview = await s.call('previewTemplate', draft);
  assert.equal(preview.type, 'templatePreview');
  assert.match(preview.previewError, /required/);
  assert.equal((await s.call('saveTemplate', draft)).type, 'templateSaved');
});
test('invalid JSON, cancelled imports and invalid field defaults never write a pack', async () => {
  const s = await start();
  assert.equal(
    (await s.call('infer', { id: 'test:invalid', label: 'Invalid', source: '{' })).type,
    'templateError',
  );
  assert.equal((await s.call('import')).type, 'cancelled');
  const inferred = await s.call('infer', {
    id: 'test:invalid',
    label: 'Invalid',
    source: JSON.stringify(json),
  });
  const fields = [
    { ...inferred.schema.fields.find((field) => field.path === 'pressure'), default: 'invalid' },
  ];
  assert.equal(
    (await s.call('saveTemplate', { id: 'test:invalid', label: 'Invalid', fields })).type,
    'templateError',
  );
  assert.equal(s.files.size, 0);
});
