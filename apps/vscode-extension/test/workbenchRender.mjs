import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(root + '/apps/vscode-extension/package.json');
const { build } = require('esbuild');
const out = path.resolve(process.argv[2] || root + '/artifacts/redesign/after');
await fs.mkdir(out, { recursive: true });
const expose = {
  recipeEditor: 'recipeEditorHtml',
  contentBuilder: 'contentBuilderHtml',
  genericRecipeEditor: 'genericRecipeEditorHtml',
  lootRuleEditor: 'lootRuleEditorHtml',
};
const hasRegistry = await fs.access(root + '/apps/vscode-extension/src/registryBrowser.ts').then(
  () => true,
  () => false,
);
const entry =
  Object.entries({
    ...expose,
    addonRecipeEditor: 'addonRecipeEditorHtml',
    craftGraph: 'craftGraphHtml',
    dashboard: 'dashboardHtml',
    ...(hasRegistry ? { registryBrowser: 'registryBrowserHtml' } : {}),
  })
    .map(([file, fn]) => `export {${fn}} from '${root}/apps/vscode-extension/src/${file}.ts';`)
    .join('\n') +
  `\nexport { vanillaRecipeCode } from '${root}/apps/vscode-extension/src/recipeEditor.ts';\nexport { generateSchemaRecipe } from '${root}/apps/vscode-extension/src/genericRecipeEditor.ts';\nexport { generateContentScript } from '${root}/apps/vscode-extension/src/contentBuilderCore.ts';\nexport { generateAddonRecipe } from '${root}/apps/vscode-extension/src/addonRecipeCore.ts';\nexport { generateLootRule } from '${root}/apps/vscode-extension/src/lootRuleCore.ts';\nexport { normalizeRecipe, buildCraftTree, calculateCraftTotals } from '${root}/apps/vscode-extension/src/craftGraphCore.ts';`;
await build({
  stdin: { contents: entry, resolveDir: root },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  outfile: out + '/preview-backend.cjs',
  plugins: [
    {
      name: 'expose-views',
      setup(b) {
        b.onLoad({ filter: /\.ts$/ }, async (args) => {
          let contents = await fs.readFile(args.path, 'utf8');
          const name = path.basename(args.path, '.ts'),
            fn = expose[name];
          if (name === 'recipeEditor') contents += '\nexport { vanillaRecipeCode };';
          if (name === 'genericRecipeEditor') contents += '\nexport { generateSchemaRecipe };';
          if (fn && !contents.includes('export function ' + fn)) contents += `\nexport {${fn}};`;
          return { contents, loader: 'ts' };
        });
      },
    },
  ],
});
const old = Module._load;
Module._load = function (name, ...args) {
  if (name === 'vscode')
    return { workspace: { workspaceFolders: [] }, Uri: {}, ExtensionMode: { Test: 3 } };
  return old.call(this, name, ...args);
};
const views = require(out + '/preview-backend.cjs');
Module._load = old;

const w = { cspSource: 'https://kubevs.invalid' };
const schema = {
  version: 1,
  id: 'kubevs:raw_custom',
  label: 'Raw custom recipe',
  description: '',
  fields: [
    {
      path: 'type',
      label: 'Recipe type',
      kind: 'resource_id',
      required: true,
      placeholder: 'modid:recipe_type',
    },
    { path: '$', label: 'Recipe body', kind: 'json', required: true, default: '{}' },
  ],
};
const renders = {
  vanilla: () => views.recipeEditorHtml(w, 'preview'),
  addon: () => views.addonRecipeEditorHtml(w, 'preview'),
  item: () => views.contentBuilderHtml(w, 'preview', 'item'),
  block: () => views.contentBuilderHtml(w, 'preview', 'block'),
  schema: () =>
    views.genericRecipeEditorHtml(w, 'preview', {
      entries: [{ schema, source: 'Built in', builtIn: true }],
      errors: [],
      directory: '.kubevs/recipe-schemas',
    }),
  loot: () => views.lootRuleEditorHtml(w, 'preview'),
  graph: () => views.craftGraphHtml(w, 'preview', false),
  calculator: () => views.craftGraphHtml(w, 'preview', true),
  dashboard: () => views.dashboardHtml(w, 'preview'),
  'dashboard-sidebar': () => views.dashboardHtml(w, 'preview', 'sidebar'),
  ...(hasRegistry ? { registry: () => views.registryBrowserHtml(w, 'preview') } : {}),
};
const theme = `<style>:root{--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-editor-font-family:monospace;--vscode-editor-background:#181a1f;--vscode-editor-foreground:#e3e6ed;--vscode-sideBar-background:#20232a;--vscode-editorWidget-background:#232730;--vscode-titleBar-activeBackground:#20232a;--vscode-panel-border:#353b47;--vscode-descriptionForeground:#a4adbd;--vscode-input-background:#262b34;--vscode-input-foreground:#e3e6ed;--vscode-input-border:#424956;--vscode-focusBorder:#a997ed;--vscode-button-background:#8069cb;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#967edd;--vscode-button-secondaryBackground:#323845;--vscode-button-secondaryForeground:#e3e6ed;--vscode-button-secondaryHoverBackground:#414958;--vscode-textCodeBlock-background:#15171c;--vscode-errorForeground:#ff9292;--vscode-badge-background:#393245;--vscode-badge-foreground:#e0d6ff;--vscode-charts-green:#65c89a}</style>`;
const api = `<script>window.messages=[];window.savedState={};window.acquireVsCodeApi=()=>({getState:()=>window.savedState,setState:s=>window.savedState=s,postMessage:m=>window.messages.push(m)});</script>`;
for (const [name, render] of Object.entries(renders)) {
  let html = render().replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  html = html.replace('</head>', theme + api + '</head>');
  await fs.writeFile(out + '/' + name + '.html', html);
}
await fs.writeFile(out + '/schema-fixture.json', JSON.stringify(schema));
console.log(out);
