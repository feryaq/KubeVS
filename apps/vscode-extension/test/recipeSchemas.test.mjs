import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';

let temp;
let loadRecipeSchemas;
let parseRecipePack;
let serializeRecipePack;
let recipePackFileName;
let createRecipeSchemaWatcher;
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
            export class RelativePattern { constructor(base, pattern) { this.base = base; this.pattern = pattern; } }
            export const Disposable = { from: () => ({ dispose() {} }) };
            export const workspace = {
              get workspaceFolders() { return s()?.workspaceFolders ?? []; },
              fs: {},
              getConfiguration: () => ({ get: (_key, value) => value }),
              createFileSystemWatcher(pattern) {
                const watcher = {
                  pattern,
                  disposed: false,
                  dispose() { this.disposed = true; },
                  onDidCreate() { return { dispose() {} }; },
                  onDidChange() { return { dispose() {} }; },
                  onDidDelete() { return { dispose() {} }; },
                };
                s().watchers.push(watcher);
                return watcher;
              },
              onDidChangeWorkspaceFolders(callback) {
                s().folderListener = callback;
                return { dispose() {} };
              },
            };
          `,
          }));
        },
      },
    ],
  });
  ({ loadRecipeSchemas, createRecipeSchemaWatcher } = await import(pathToFileURL(outfile).href));
  const packOutfile = path.join(temp, 'recipePacks.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/recipePacks.ts', import.meta.url))],
    outfile: packOutfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  ({ parseRecipePack, serializeRecipePack, recipePackFileName } = await import(
    pathToFileURL(packOutfile).href
  ));
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
    '/workspace/.kubevs/recipe-packs',
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
  assert.ok(
    catalog.errors.some((error) => /file limit \(200\).*additional files ignored/.test(error)),
  );
  assert.ok(catalog.errors.some((error) => /256 KiB size limit/.test(error)));
});

function pack(id, schemas, name = 'Test Pack') {
  return { format: 'kubevs-recipe-pack', version: 1, id, name, schemas };
}

test('parses and serializes exact v1 data-only manifests and maps IDs to safe filenames', () => {
  const parsed = parseRecipePack(pack('test:machines/advanced', [schema('machine')]));
  const roundTrip = parseRecipePack(JSON.parse(serializeRecipePack(parsed)));
  assert.deepEqual(roundTrip, parsed);
  assert.equal(recipePackFileName(parsed.id), 'test%3Amachines%2Fadvanced.kubevs-pack.json');
  assert.throws(() => recipePackFileName('../outside'), /namespaced resource ID/);
  assert.throws(() => recipePackFileName(`test:${'x'.repeat(230)}`), /too long/);
  assert.throws(
    () => parseRecipePack(pack(`test:${'x'.repeat(230)}`, [schema('one')])),
    /too long/,
  );
  const longId = 'test:' + '/'.repeat(190);
  assert.ok(recipePackFileName(longId).length < 240);
  assert.equal(recipePackFileName(longId), recipePackFileName(longId));
  assert.notEqual(recipePackFileName(longId), recipePackFileName(longId + 'x'));
  assert.throws(
    () => parseRecipePack({ ...pack('test:ok', [schema('one')]), code: 'run()' }),
    /unknown pack property/,
  );
  assert.throws(
    () => parseRecipePack(pack('test:ok', [schema('same'), schema('same')])),
    /duplicate schema id test:same/,
  );
  assert.throws(
    () => parseRecipePack(pack('test:ok', [{ ...schema('bad'), fields: [] }])),
    /\$\.schemas\[0\].*fields/,
  );
  assert.throws(() => parseRecipePack(pack('test:ok', [])), /add at least one schema/);
  assert.throws(
    () =>
      parseRecipePack(
        pack(
          'test:ok',
          Array.from({ length: 101 }, (_, i) => schema(`n${i}`)),
        ),
      ),
    /at most 100/,
  );
  const largeSchemas = Array.from({ length: 70 }, (_, i) => ({
    ...schema(`large${i}`),
    fields: [{ path: 'value', label: 'Value', kind: 'string', default: 'x'.repeat(16_000) }],
  }));
  assert.throws(
    () => serializeRecipePack(pack('test:large', largeSchemas)),
    /exceeds the 1024 KiB size limit/,
  );
});

test('loads schemas from a valid pack into editor catalog with pack provenance and standalone precedence', async () => {
  const schemaRoot = '/workspace/.kubevs/recipe-schemas';
  const packRoot = '/workspace/.kubevs/recipe-packs';
  const standalone = schema('shared');
  standalone.label = 'Standalone wins';
  const bytes = new Map([
    [
      `${schemaRoot}/shared.recipe-schema.json`,
      new TextEncoder().encode(JSON.stringify(standalone)),
    ],
    [
      `${packRoot}/test%3Amachine.kubevs-pack.json`,
      new TextEncoder().encode(
        serializeRecipePack(pack('test:machine', [schema('shared'), schema('packed')], 'Machines')),
      ),
    ],
    [
      `${packRoot}/invalid.kubevs-pack.json`,
      new TextEncoder().encode(JSON.stringify(pack('test:invalid', [{ version: 99 }], 'Broken'))),
    ],
  ]);
  const io = setup(
    {
      [schemaRoot]: [['shared.recipe-schema.json', 1]],
      [packRoot]: [
        ['test%3Amachine.kubevs-pack.json', 1],
        ['invalid.kubevs-pack.json', 1],
        ['../escape.kubevs-pack.json', 1],
      ],
    },
    bytes,
  );
  const catalog = await loadRecipeSchemas({
    fs: io.fs,
    workspaceFolders: [{ uri: { path: '/workspace' } }],
    directory: '.kubevs/recipe-schemas',
  });
  const standaloneEntry = catalog.entries.find((entry) => entry.schema.id === 'test:shared');
  assert.equal(standaloneEntry?.schema.label, 'Standalone wins');
  assert.equal(standaloneEntry?.packId, undefined);
  const packedEntry = catalog.entries.find((entry) => entry.schema.id === 'test:packed');
  assert.equal(packedEntry?.packId, 'test:machine');
  assert.equal(packedEntry?.packName, 'Machines');
  assert.equal(packedEntry?.source, '.kubevs/recipe-packs/test%3Amachine.kubevs-pack.json');
  assert.equal(catalog.entries.filter((entry) => entry.schema.id === 'test:shared').length, 1);
  assert.ok(catalog.errors.some((error) => /duplicate schema id test:shared/.test(error)));
  assert.ok(
    catalog.errors.some((error) =>
      /invalid\.kubevs-pack\.json: .*\$\.version: expected 1/.test(error),
    ),
  );
  assert.ok(catalog.errors.some((error) => /ignored unsafe directory entry name/.test(error)));
  assert.ok(!io.reads.some((file) => file.includes('escape')));
});

test('rejects oversized packs and scans only bounded targeted pack directories', async () => {
  const root = '/workspace/.kubevs/recipe-packs';
  const entries = Array.from({ length: 201 }, (_, i) => [
    `${String(i).padStart(3, '0')}.kubevs-pack.json`,
    1,
  ]);
  const io = setup(
    { [root]: entries },
    new Map([[`${root}/000.kubevs-pack.json`, new Uint8Array(1024 * 1024 + 1)]]),
  );
  const catalog = await loadRecipeSchemas({
    fs: io.fs,
    workspaceFolders: [{ uri: { path: '/workspace' } }],
    directory: 'custom/schemas',
  });
  assert.equal(io.reads.length, 200);
  assert.ok(catalog.errors.some((error) => /pack file limit \(200\)/.test(error)));
  assert.ok(catalog.errors.some((error) => /pack exceeds the 1024 KiB size limit/.test(error)));
  assert.deepEqual(io.listed, ['/workspace/custom/schemas', root]);
});

test('watches schemas and packs and refreshes watchers when workspace folders change', () => {
  const state = {
    workspaceFolders: [{ uri: { path: '/first' } }],
    watchers: [],
    folderListener: undefined,
  };
  globalThis[stateKey] = state;
  let callbacks = 0;
  const watcher = createRecipeSchemaWatcher(() => callbacks++);
  assert.deepEqual(
    state.watchers.map((entry) => entry.pattern.pattern),
    [
      '.kubevs/recipe-schemas/**/*.recipe-schema.json',
      '.kubevs/recipe-packs/**/*.kubevs-pack.json',
    ],
  );
  const previousWatchers = [...state.watchers];
  state.workspaceFolders = [{ uri: { path: '/second' } }];
  state.folderListener();
  assert.ok(previousWatchers.every((entry) => entry.disposed));
  assert.deepEqual(
    state.watchers.slice(2).map((entry) => entry.pattern.base.uri.path),
    ['/second', '/second'],
  );
  assert.equal(callbacks, 1);
  watcher.dispose();
  assert.ok(state.watchers.slice(2).every((entry) => entry.disposed));
  delete globalThis[stateKey];
});
