import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';

let temp;
let loadRecipeSchemas;
const stateKey = '__kubevsRecipeSchemasTest';

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'kubevs-recipe-schemas-'));
  const outfile = path.join(temp, 'recipeSchemas.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/recipeSchemas.ts', import.meta.url))],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'vscode-fs-mock',
        setup(builder) {
          builder.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock' }));
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
            loader: 'js',
            contents: `
            const s = () => globalThis.${stateKey};
            export class FileSystemError extends Error { constructor(code, message) { super(message); this.code = code; } }
            export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };
            export const Uri = { joinPath: (uri, ...parts) => ({ path: [uri.path, ...parts].join('/').replace(/\\/+/g, '/') }) };
            export class RelativePattern {}
            export const Disposable = { from: () => ({ dispose() {} }) };
            export const workspace = { workspaceFolders: [], fs: {}, getConfiguration: () => ({ get: (_key, value) => value }) };
          `,
          }));
        },
      },
    ],
  });
  ({ loadRecipeSchemas } = await import(pathToFileURL(outfile).href));
});

after(async () => {
  delete globalThis[stateKey];
  if (temp) await rm(temp, { recursive: true, force: true });
});

function setup(tree, fileBytes = new Map()) {
  const reads = [];
  const listed = [];
  let active = 0;
  let maxActive = 0;
  const fs = {
    async readDirectory(uri) {
      listed.push(uri.path);
      if (!(uri.path in tree)) throw Object.assign(new Error('missing'), { code: 'FileNotFound' });
      return tree[uri.path];
    },
    async readFile(uri) {
      reads.push(uri.path);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return fileBytes.get(uri.path) ?? new TextEncoder().encode(JSON.stringify(schema(uri.path)));
    },
  };
  return {
    fs,
    reads,
    listed,
    get maxActive() {
      return maxActive;
    },
  };
}

function schema(id) {
  return {
    version: 1,
    id: `test:${id}`,
    label: id,
    recipeType: 'test:machine',
    fields: [{ path: 'value', label: 'Value', kind: 'string' }],
  };
}

test('scans only the configured directory, skips symlinks, and reads files in bounded parallel batches', async () => {
  const io = setup({
    '/workspace/.kubevs/recipe-schemas': [
      ['nested', 2],
      ['linked', 66],
      ['z.recipe-schema.json', 1],
      ['ignored.json', 1],
    ],
    '/workspace/.kubevs/recipe-schemas/nested': [
      ['a.recipe-schema.json', 1],
      ['escape', 66],
    ],
  });
  const catalog = await loadRecipeSchemas({
    fs: io.fs,
    workspaceFolders: [{ uri: { path: '/workspace' } }],
    directory: '.kubevs/recipe-schemas',
  });
  assert.deepEqual(io.listed, [
    '/workspace/.kubevs/recipe-schemas',
    '/workspace/.kubevs/recipe-schemas/nested',
  ]);
  assert.deepEqual(io.reads, [
    '/workspace/.kubevs/recipe-schemas/nested/a.recipe-schema.json',
    '/workspace/.kubevs/recipe-schemas/z.recipe-schema.json',
  ]);
  assert.ok(io.maxActive <= 4);
  assert.equal(catalog.entries.length, 3);
  assert.deepEqual(
    catalog.entries.filter((entry) => !entry.builtIn).map((entry) => entry.schema.label),
    [
      '/workspace/.kubevs/recipe-schemas/nested/a.recipe-schema.json',
      '/workspace/.kubevs/recipe-schemas/z.recipe-schema.json',
    ],
  );
  assert.deepEqual(catalog.errors, []);
});

test('ignores a missing configured directory and surfaces other provider failures', async () => {
  const missing = setup({});
  const absent = await loadRecipeSchemas({
    fs: missing.fs,
    workspaceFolders: [{ uri: { path: '/workspace' } }],
    directory: 'custom/schemas',
  });
  assert.equal(absent.entries.length, 1);
  assert.deepEqual(absent.errors, []);

  const brokenFs = {
    readDirectory: async () => {
      throw new Error('provider offline');
    },
    readFile: async () => new Uint8Array(),
  };
  const broken = await loadRecipeSchemas({
    fs: brokenFs,
    workspaceFolders: [{ uri: { path: '/workspace' } }],
    directory: 'custom/schemas',
  });
  assert.match(broken.errors[0], /provider offline/);
});

test('keeps the first schema for a duplicate id in stable relative-path order', async () => {
  const root = '/workspace/schemas';
  const bytes = new TextEncoder().encode(JSON.stringify(schema('same')));
  const io = setup(
    {
      [root]: [
        ['b.recipe-schema.json', 1],
        ['a.recipe-schema.json', 1],
      ],
    },
    new Map([
      [`${root}/a.recipe-schema.json`, bytes],
      [`${root}/b.recipe-schema.json`, bytes],
    ]),
  );
  const catalog = await loadRecipeSchemas({
    fs: io.fs,
    workspaceFolders: [{ uri: { path: '/workspace' } }],
    directory: 'schemas',
  });
  assert.equal(catalog.entries.filter((entry) => !entry.builtIn).length, 1);
  assert.equal(
    catalog.entries.find((entry) => !entry.builtIn)?.source,
    'schemas/a.recipe-schema.json',
  );
  assert.match(catalog.errors[0], /schemas\/b\.recipe-schema\.json: duplicate schema id test:same/);
});

test('reports directory truncation and rejects files over 256 KiB', async () => {
  const root = '/workspace/schemas';
  const entries = Array.from({ length: 201 }, (_, i) => [
    `${String(i).padStart(3, '0')}.recipe-schema.json`,
    1,
  ]);
  const io = setup(
    { [root]: entries },
    new Map([[`${root}/000.recipe-schema.json`, new Uint8Array(256 * 1024 + 1)]]),
  );
  const catalog = await loadRecipeSchemas({
    fs: io.fs,
    workspaceFolders: [{ uri: { path: '/workspace' } }],
    directory: 'schemas',
  });
  assert.equal(io.reads.length, 200);
  assert.ok(catalog.errors.some((error) => /file limit \(200\).*truncated/.test(error)));
  assert.ok(catalog.errors.some((error) => /256 KiB size limit/.test(error)));
});
