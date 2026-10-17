/** Headless QA of HTML rendered by the real extension. Connector messages below are fixtures. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import Module from 'node:module';
const directory = path.resolve(process.argv[2] ?? 'artifacts/redesign/after');
const out = path.resolve(process.argv[3] ?? path.join(directory, 'screenshots'));
const runtime =
  process.env.KUBEVS_PLAYWRIGHT_RUNTIME ??
  (() => {
    try {
      return createRequire(import.meta.url).resolve('playwright/package.json');
    } catch {
      return path.join(
        os.homedir(),
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json',
      );
    }
  })();
const { chromium } = createRequire(runtime)('playwright');
await fs.mkdir(out, { recursive: true });
let backend, schema;
if (
  await fs.access(path.join(directory, 'preview-backend.cjs')).then(
    () => true,
    () => false,
  )
) {
  const originalLoad = Module._load;
  try {
    Module._load = function (name, ...args) {
      if (name === 'vscode')
        return { workspace: { workspaceFolders: [] }, Uri: {}, ExtensionMode: { Test: 3 } };
      return originalLoad.call(this, name, ...args);
    };
    backend = createRequire(import.meta.url)(path.join(directory, 'preview-backend.cjs'));
    schema = JSON.parse(await fs.readFile(path.join(directory, 'schema-fixture.json'), 'utf8'));
  } finally {
    Module._load = originalLoad;
  }
}
async function renderPreview(page, name) {
  if (!backend) return;
  const request = await page.evaluate(() =>
    window.messages.filter((m) => m.type === 'preview').at(-1),
  );
  if (!request) return;
  try {
    const code =
      name === 'vanilla'
        ? backend.vanillaRecipeCode(request)
        : name === 'addon'
          ? backend.generateAddonRecipe(request.draft)
          : name === 'item' || name === 'block'
            ? backend.generateContentScript(request.draft)
            : name === 'loot'
              ? backend.generateLootRule(request.draft)
              : name === 'schema'
                ? backend.generateSchemaRecipe(schema, request)
                : undefined;
    if (code) await dispatch(page, { type: 'preview', revision: request.revision, code });
  } catch (error) {
    await dispatch(page, {
      type: 'previewError',
      revision: request.revision,
      message: error.message,
    });
  }
}
const browser = await chromium.launch({ headless: true });
const failures = [],
  results = [],
  checks = [];
const themes = {
  dark: {
    bg: '#181a1f',
    fg: '#e3e6ed',
    surface: '#232730',
    input: '#262b34',
    border: '#424956',
    muted: '#a4adbd',
    accent: '#a997ed',
    button: '#8069cb',
    error: '#ff9292',
  },
  light: {
    bg: '#fafafa',
    fg: '#242730',
    surface: '#f0f1f4',
    input: '#ffffff',
    border: '#c9ced8',
    muted: '#626977',
    accent: '#7052c0',
    button: '#7052c0',
    error: '#b32626',
  },
};
function themeCss(t) {
  return `:root{color-scheme:${t === themes.dark ? 'dark' : 'light'};--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-editor-font-family:monospace;--vscode-editor-background:${t.bg};--vscode-editor-foreground:${t.fg};--vscode-sideBar-background:${t.surface};--vscode-editorWidget-background:${t.surface};--vscode-titleBar-activeBackground:${t.surface};--vscode-panel-border:${t.border};--vscode-descriptionForeground:${t.muted};--vscode-input-background:${t.input};--vscode-input-foreground:${t.fg};--vscode-input-border:${t.border};--vscode-focusBorder:${t.accent};--vscode-button-background:${t.button};--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:${t.accent};--vscode-button-secondaryBackground:${t.surface};--vscode-button-secondaryForeground:${t.fg};--vscode-button-secondaryHoverBackground:${t.border};--vscode-textCodeBlock-background:${t.bg};--vscode-errorForeground:${t.error};--vscode-badge-background:${t.surface};--vscode-badge-foreground:${t.fg};--vscode-charts-green:#459c74}`;
}
const connected = {
  type: 'snapshot',
  state: 'connected',
  scripts: 12,
  problems: 2,
  workspace: 'My modpack',
  player: 'Alex',
  role: 'operator',
  minecraft: '1.21.1',
  kubejsMissing: false,
  canReload: true,
  stats: { items: 3241, tags: 520, recipes: 4521, mods: 103 },
  latency: 18,
  recent: [
    {
      label: 'precision_mechanisms.js',
      path: 'kubejs/server_scripts/recipes/precision_mechanisms.js',
      uri: 'file:///fixture/precision_mechanisms.js',
    },
    { label: 'ores.js', path: 'kubejs/server_scripts/ores.js', uri: 'file:///fixture/ores.js' },
  ],
};
const graphRecipes = [
  {
    id: 'minecraft:diamond_pickaxe',
    recipeType: 'minecraft:crafting_shaped',
    json: {
      pattern: ['DDD', ' S ', ' S '],
      key: { D: { item: 'minecraft:diamond' }, S: { item: 'minecraft:stick' } },
      result: { id: 'minecraft:diamond_pickaxe', count: 1 },
    },
  },
  {
    id: 'minecraft:stick',
    recipeType: 'minecraft:crafting_shaped',
    json: {
      pattern: ['P', 'P'],
      key: { P: { tag: 'minecraft:planks' } },
      result: { id: 'minecraft:stick', count: 4 },
    },
  },
  {
    id: 'fixture:compressed_diamond',
    recipeType: 'create:pressing',
    json: {
      ingredients: [{ item: 'minecraft:coal_block' }, { fluid: 'minecraft:water', amount: 250 }],
      results: [{ id: 'minecraft:diamond', count: 1 }],
      processingTime: 100,
    },
  },
  {
    id: 'fixture:ore_diamond',
    recipeType: 'minecraft:smelting',
    json: {
      ingredient: { item: 'minecraft:diamond_ore' },
      result: { id: 'minecraft:diamond', count: 1 },
      cookingtime: 200,
    },
  },
];
async function renderGraph(page) {
  if (!backend) return;
  const recipes = graphRecipes.map(backend.normalizeRecipe).filter(Boolean),
    tree = backend.buildCraftTree(recipes, 'minecraft:diamond_pickaxe', 1);
  await dispatch(page, { type: 'catalog', recipes: recipes.length, source: 'offline' });
  await dispatch(page, {
    type: 'tree',
    tree,
    totals: backend.calculateCraftTotals(tree),
    tagMembers: { 'minecraft:planks': ['minecraft:oak_planks', 'minecraft:birch_planks'] },
  });
}
const registryEntries = [
  { id: 'minecraft:diamond', name: 'Diamond', registry: 'minecraft:item' },
  { id: '#c:ingots/iron', name: 'Iron ingots', registry: 'minecraft:item' },
  { id: 'create:precision_mechanism', name: 'Precision Mechanism', registry: 'minecraft:item' },
  ...Array.from({ length: 12 }, (_, index) => ({
    id: 'fixture:item_' + index,
    name: 'Sample ' + (index + 1),
    registry: 'minecraft:item',
  })),
];
const registryPage = {
  type: 'page',
  entries: registryEntries,
  offset: 0,
  total: 121,
  hasMore: true,
  source: 'live',
};
async function dispatch(page, message) {
  await page.evaluate(
    (data) => window.dispatchEvent(new MessageEvent('message', { data })),
    message,
  );
}
async function runCheck(name, fn) {
  try {
    await fn();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
    failures.push(name + ': ' + error.message);
  }
}
try {
  const files = (await fs.readdir(directory)).filter((x) => x.endsWith('.html')).sort();
  assert.ok(files.length, 'No generated HTML files');
  for (const file of files)
    for (const [theme, t] of Object.entries(themes))
      for (const viewport of path.basename(file, '.html') === 'dashboard-sidebar'
        ? [
            { width: 260, height: 760 },
            { width: 320, height: 820 },
            { width: 420, height: 900 },
          ]
        : [
            { width: 1440, height: 900 },
            { width: 800, height: 700 },
            { width: 390, height: 844 },
          ]) {
        const name = path.basename(file, '.html'),
          key = `${name}-${theme}-${viewport.width}`;
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        // The fixture API stays in this detached headless browser and cannot reach user state.
        await page.addInitScript(() => {
          window.messages = [];
          window.savedState = {};
          window.acquireVsCodeApi = () => ({
            getState: () => window.savedState,
            setState: (s) => (window.savedState = s),
            postMessage: (m) => window.messages.push(m),
          });
        });
        await page.goto('file://' + path.join(directory, file));
        await page.addStyleTag({ content: themeCss(t) });
        if (name === 'dashboard' || name === 'dashboard-sidebar') await dispatch(page, connected);
        if (name === 'graph') await renderGraph(page);
        if (name === 'registry') {
          await dispatch(page, {
            type: 'choices',
            entries: [
              { id: 'minecraft:item', label: 'Items' },
              { id: 'minecraft:block', label: 'Blocks' },
            ],
          });
          await dispatch(page, registryPage);
        }
        await page.waitForTimeout(220);
        if (name === 'schema') {
          await page.locator('[data-path="type"]').fill('fixture:custom_recipe');
          await page.waitForTimeout(220);
        }
        await renderPreview(page, name);
        await page.screenshot({ path: path.join(out, key + '.png'), fullPage: true });
        if (name === 'dashboard' && theme === 'dark' && viewport.width === 1440) {
          await runCheck('dashboard ready handshake', async () =>
            assert.ok(await page.evaluate(() => window.messages.some((m) => m.type === 'ready'))),
          );
          await runCheck('dashboard connected snapshot', async () => {
            assert.match(await page.locator('#state').innerText(), /1\.21\.1/);
            assert.match(await page.locator('#metrics').innerText(), /3,241/);
            assert.equal(await page.locator('#reload').isVisible(), true);
          });
          await runCheck('dashboard search and Enter routes tool', async () => {
            await page.locator('#search').fill('Loot');
            assert.equal(await page.locator('#create button').count(), 1);
            await page.locator('#search').press('Enter');
            assert.ok(
              await page.evaluate(() =>
                window.messages.some(
                  (m) => m.type === 'command' && m.command === 'kubevs.createLootRule',
                ),
              ),
            );
            await page.locator('#search').press('Escape');
            assert.equal(await page.locator('#create button').count(), 6);
          });
          await runCheck('dashboard recent routes current index', async () => {
            await page.locator('#files button').first().click();
            assert.ok(
              await page.evaluate(() =>
                window.messages.some((m) => m.type === 'openRecent' && m.index === 0),
              ),
            );
          });
          await runCheck('dashboard missing KubeJS disables creation', async () => {
            await dispatch(page, { ...connected, kubejsMissing: true });
            assert.equal(await page.locator('#create button:disabled').count(), 6);
            assert.equal(await page.locator('#runtimeNotice').isVisible(), true);
            assert.match(await page.locator('#runtimeMessage').innerText(), /1\.21\.1.*NeoForge/);
            assert.match(await page.locator('#runtimeMessage').innerText(), /restart.*reconnect/);
            assert.equal(
              await page.locator('[data-command="kubevs.openRegistryBrowser"]').isEnabled(),
              true,
            );
            await page.locator('[data-command="kubevs.openKubeJsSetup"]').click();
            assert.ok(
              await page.evaluate(() =>
                window.messages.some((m) => m.command === 'kubevs.openKubeJsSetup'),
              ),
            );
            await page.screenshot({
              path: path.join(out, 'dashboard-missing-kubejs.png'),
              fullPage: true,
            });
            await dispatch(page, connected);
            assert.equal(await page.locator('#runtimeNotice').isVisible(), false);
            assert.equal(await page.locator('#create button:disabled').count(), 0);
            await page.locator('[data-command="kubevs.createRecipe"]').click();
            await page.locator('[data-command="kubevs.createAddonRecipe"]').click();
            assert.ok(
              await page.evaluate(() =>
                ['kubevs.createRecipe', 'kubevs.createAddonRecipe'].every((command) =>
                  window.messages.some((m) => m.command === command),
                ),
              ),
            );
            await dispatch(page, { ...connected, state: 'offline', kubejsMissing: true });
            assert.equal(await page.locator('#runtimeNotice').isVisible(), false);
            assert.equal(await page.locator('#create button:disabled').count(), 0);
          });
          await runCheck('dashboard offline updates actions and empty state', async () => {
            await dispatch(page, {
              ...connected,
              state: 'offline',
              stats: connected.stats,
              kubejsMissing: false,
              recent: [],
              scripts: 0,
            });
            assert.equal(await page.locator('#reload').isVisible(), false);
            assert.equal(await page.locator('#metrics').innerText(), '');
            assert.match(await page.locator('#files').innerText(), /first recipe/);
            await page.screenshot({
              path: path.join(out, 'dashboard-offline.png'),
              fullPage: true,
            });
          });
          await runCheck('dashboard connecting and error states', async () => {
            await dispatch(page, { ...connected, state: 'connecting' });
            assert.equal(await page.locator('#connect').isDisabled(), true);
            await dispatch(page, {
              ...connected,
              state: 'error',
              error: 'Fixture: connection refused',
            });
            assert.match(await page.locator('#error').innerText(), /refused/);
            assert.equal(await page.locator('#metrics').innerText(), '');
            await page.screenshot({ path: path.join(out, 'dashboard-error.png'), fullPage: true });
          });
          await runCheck('editor connection code is transient and cancellable', async () => {
            await dispatch(page, { ...connected, state: 'offline' });
            await page.locator('#connect').click();
            assert.equal(await page.locator('#join').isVisible(), true);
            await page.screenshot({
              path: path.join(out, 'dashboard-connection-form.png'),
              fullPage: true,
            });
            await page.locator('#joinCode').fill('FIXTURE-CONNECTION-CODE');
            await page.locator('#cancelJoin').click();
            assert.equal(await page.locator('#join').isVisible(), false);
            assert.equal(await page.locator('#joinCode').inputValue(), '');
            await page.locator('#connect').click();
            await page.locator('#localConnect').click();
            assert.ok(
              await page.evaluate(() =>
                window.messages.some((m) => m.type === 'command' && m.command === 'kubevs.connect'),
              ),
            );
            await page.locator('#joinCode').fill('FIXTURE-CONNECTION-CODE');
            await page.locator('#joinSubmit').click();
            assert.equal(await page.locator('#joinCode').inputValue(), '');
            assert.ok(
              await page.evaluate(() =>
                window.messages.some(
                  (m) => m.type === 'connectCode' && m.code === 'FIXTURE-CONNECTION-CODE',
                ),
              ),
            );
            assert.equal(
              await page.evaluate(() =>
                JSON.stringify(window.savedState).includes('FIXTURE-CONNECTION-CODE'),
              ),
              false,
              'Connection code is never persisted in webview state',
            );
            await dispatch(page, { ...connected, state: 'offline' });
          });
          await dispatch(page, connected);
        }
        if (name === 'dashboard-sidebar') {
          await runCheck(
            'sidebar dashboard shell and primary actions ' + viewport.width,
            async () => {
              assert.match(await page.title(), /KubeVS/);
              assert.equal(await page.locator('#search').count(), 1);
              assert.ok((await page.locator('#create button').count()) > 0);
              assert.equal(await page.locator('#connect').isVisible(), true);
              assert.ok((await page.locator('#files').count()) === 1);
              assert.equal(await page.locator('#openFull').isVisible(), true);
              assert.equal(
                await page.locator('#openFull').getAttribute('aria-label'),
                'Open full workspace',
              );
              assert.equal(
                await page
                  .locator('[data-command="kubevs.openSettings"]')
                  .getAttribute('aria-label'),
                'KubeVS settings',
              );
              assert.equal(await page.locator('[data-command="kubevs.openSettings"]').count(), 1);
            },
          );
          if (theme === 'dark' && viewport.width === 320) {
            await runCheck(
              'sidebar explains missing KubeJS and recovers after reconnect',
              async () => {
                await dispatch(page, { ...connected, kubejsMissing: true, role: 'admin' });
                assert.equal(await page.locator('#runtimeNotice').isVisible(), true);
                assert.equal(await page.locator('#create button:disabled').count(), 6);
                assert.ok(
                  await page
                    .locator('#runtimeMessage')
                    .evaluate((el) => el.scrollWidth <= el.clientWidth),
                );
                await page.screenshot({
                  path: path.join(out, 'dashboard-sidebar-missing-kubejs-320.png'),
                  fullPage: true,
                });
                await dispatch(page, connected);
                assert.equal(await page.locator('#runtimeNotice').isVisible(), false);
                assert.equal(await page.locator('#create button:disabled').count(), 0);
              },
            );
            await runCheck('sidebar dashboard tool search and editor/settings routes', async () => {
              await page.locator('#search').fill('Loot');
              assert.equal(await page.locator('#create button').count(), 1);
              await page.locator('#search').press('Enter');
              assert.ok(
                await page.evaluate(() =>
                  window.messages.some(
                    (m) => m.type === 'command' && m.command === 'kubevs.createLootRule',
                  ),
                ),
              );
              await page.locator('#openFull').click();
              await page.locator('[data-command="kubevs.openSettings"]').click();
              assert.ok(
                await page.evaluate(
                  () =>
                    window.messages.some(
                      (m) => m.type === 'command' && m.command === 'kubevs.openDashboard',
                    ) &&
                    window.messages.some(
                      (m) => m.type === 'command' && m.command === 'kubevs.openSettings',
                    ),
                ),
              );
            });
            await runCheck('sidebar connection code is transient and cancellable', async () => {
              await dispatch(page, { ...connected, state: 'offline' });
              assert.equal(await page.locator('#metrics').innerText(), '');
              await page.locator('#connect').click();
              assert.equal(await page.locator('#join').isVisible(), true);
              await page.screenshot({
                path: path.join(out, 'dashboard-sidebar-connection-form-320.png'),
                fullPage: true,
              });
              await page.locator('#joinCode').fill('FIXTURE-CONNECTION-CODE');
              await page.locator('#cancelJoin').click();
              assert.equal(await page.locator('#join').isVisible(), false);
              assert.equal(await page.locator('#joinCode').inputValue(), '');
              await page.locator('#connect').click();
              await page.locator('#localConnect').click();
              assert.ok(
                await page.evaluate(() =>
                  window.messages.some(
                    (m) => m.type === 'command' && m.command === 'kubevs.connect',
                  ),
                ),
              );
              await page.locator('#joinCode').fill('FIXTURE-CONNECTION-CODE');
              await page.locator('#joinSubmit').click();
              assert.equal(await page.locator('#joinCode').inputValue(), '');
              assert.ok(
                await page.evaluate(() =>
                  window.messages.some(
                    (m) => m.type === 'connectCode' && m.code === 'FIXTURE-CONNECTION-CODE',
                  ),
                ),
              );
              assert.equal(
                await page.evaluate(() =>
                  JSON.stringify(window.savedState).includes('FIXTURE-CONNECTION-CODE'),
                ),
                false,
                'Connection code is never persisted in webview state',
              );
            });
            await runCheck('sidebar open-folder action', async () => {
              await dispatch(page, {
                ...connected,
                state: 'offline',
                workspace: 'No folder open',
                recent: [],
              });
              assert.equal(await page.locator('#openFolder').isVisible(), true);
              await page.screenshot({
                path: path.join(out, 'dashboard-sidebar-no-folder-320.png'),
                fullPage: true,
              });
              await page.locator('#openFolder').click();
              assert.ok(
                await page.evaluate(() =>
                  window.messages.some(
                    (m) =>
                      m.type === 'command' && m.command === 'workbench.action.files.openFolder',
                  ),
                ),
              );
              await dispatch(page, { ...connected, state: 'offline' });
            });
          }
        }
        if (name === 'graph' && theme === 'dark') {
          await runCheck('graph nodes render ' + viewport.width, async () => {
            assert.ok((await page.locator('.craft-node').count()) >= 5);
            assert.match(await page.locator('#status').innerText(), /nodes/);
            const overlap = await page.evaluate(() => {
              const nodes = [...document.querySelectorAll('.craft-node')].map((n) =>
                n.getBoundingClientRect(),
              );
              return nodes.some((a, i) =>
                nodes
                  .slice(i + 1)
                  .some(
                    (b) =>
                      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
                      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2,
                  ),
              );
            });
            assert.equal(overlap, false, 'Automatically packed graph nodes do not overlap');
          });
          if (viewport.width === 1440) {
            await runCheck('graph alternatives route recipe cycle', async () => {
              await page.locator('button[aria-label="Next alternative recipe"]').first().click();
              assert.ok(
                await page.evaluate(() =>
                  window.messages.some(
                    (m) =>
                      m.type === 'cycle' && m.item === 'minecraft:diamond' && m.direction === 1,
                  ),
                ),
              );
            });
            await runCheck('graph build routes current amount', async () => {
              await page.locator('#amount').fill('5');
              await page.locator('#build').click();
              assert.ok(
                await page.evaluate(() =>
                  window.messages.some((m) => m.type === 'build' && m.amount === 5),
                ),
              );
              await page.locator('#amount').fill('1');
            });
            await runCheck('graph copy resources current totals', async () => {
              await page.locator('#copyResources').click();
              const copied = await page.evaluate(
                () => window.messages.filter((m) => m.type === 'copyCode').at(-1)?.code,
              );
              assert.match(copied, /3 × minecraft:coal_block/);
              assert.match(copied, /750 mB minecraft:water/);
              assert.match(await page.locator('.ledger').innerText(), /750 mB/);
            });
          }
          if (viewport.width <= 800) {
            await runCheck('graph responsive inspector toggle ' + viewport.width, async () => {
              await page.locator('#inspectorToggle').click();
              assert.equal(
                await page.locator('#inspectorToggle').getAttribute('aria-expanded'),
                'true',
              );
              assert.equal(await page.locator('.inspector').isVisible(), true);
              await page.screenshot({
                path: path.join(out, 'graph-inspector-' + viewport.width + '.png'),
                fullPage: true,
              });
              await page.locator('#inspectorToggle').click();
            });
          }
          if (viewport.width === 390) {
            await runCheck('graph responsive resource ledger', async () => {
              await page.locator('#resourcesToggle').click();
              assert.equal(await page.locator('.ledger').isVisible(), true);
              await page.screenshot({
                path: path.join(out, 'graph-resources-390.png'),
                fullPage: true,
              });
              await page.locator('#resourcesToggle').click();
            });
          }
        }
        if (name === 'registry' && theme === 'dark' && viewport.width === 1440) {
          await runCheck('registry choices trigger browse', async () =>
            assert.ok(
              await page.evaluate(() =>
                window.messages.some(
                  (m) => m.type === 'browse' && m.registry === 'minecraft:item' && m.offset === 0,
                ),
              ),
            ),
          );
          await runCheck('registry current page count and pagination', async () => {
            assert.match(await page.locator('#count').innerText(), /1–15 \/ 121/);
            await page.locator('#next').click();
            assert.equal(
              await page.evaluate(
                () => window.messages.filter((m) => m.type === 'browse').at(-1).offset,
              ),
              60,
            );
            await dispatch(page, { ...registryPage, offset: 60 });
            await page.locator('#previous').click();
            assert.equal(
              await page.evaluate(
                () => window.messages.filter((m) => m.type === 'browse').at(-1).offset,
              ),
              0,
            );
            await dispatch(page, registryPage);
          });
          await runCheck('registry keyboard selection and tag inspector', async () => {
            await page.locator('[role=option]').nth(1).focus();
            await page.keyboard.press('Enter');
            assert.equal(await page.locator('#id').innerText(), '#c:ingots/iron');
            assert.ok(
              await page.evaluate(() =>
                window.messages.some((m) => m.type === 'inspect' && m.id === '#c:ingots/iron'),
              ),
            );
            await dispatch(page, {
              type: 'detail',
              entry: registryEntries[1],
              members: ['minecraft:iron_ingot', 'create:iron_sheet'],
              total: 130,
            });
            assert.match(await page.locator('#meta').innerText(), /130/);
            assert.match(await page.locator('#members').innerText(), /128 more/);
            await dispatch(page, {
              type: 'detail',
              entry: registryEntries[0],
              members: ['wrong'],
              total: 1,
            });
            assert.match(await page.locator('#members').innerText(), /iron_ingot/);
            await page.screenshot({
              path: path.join(out, 'registry-tag-inspector.png'),
              fullPage: true,
            });
          });
          await runCheck('registry copy routes current ID', async () => {
            await page.locator('#copy').click();
            assert.ok(
              await page.evaluate(() =>
                window.messages.some((m) => m.type === 'copy' && m.id === '#c:ingots/iron'),
              ),
            );
            await dispatch(page, { type: 'copied', id: '#c:ingots/iron' });
            assert.match(await page.locator('#status').innerText(), /Copied/);
          });
          await runCheck('registry search tags and registry reset offset', async () => {
            await page.locator('#query').fill('iron');
            await page.locator('#query').press('Enter');
            await page.locator('#tags').check();
            await page.locator('#registry').selectOption('minecraft:block');
            const m = await page.evaluate(() =>
              window.messages.filter((m) => m.type === 'browse').at(-1),
            );
            assert.deepEqual(
              [m.query, m.registry, m.tagsOnly, m.offset],
              ['iron', 'minecraft:block', true, 0],
            );
            await page.locator('#query').fill('');
            await page.locator('#tags').uncheck();
            await page.locator('#registry').selectOption('minecraft:item');
            await dispatch(page, { ...registryPage, entries: [], total: 0, hasMore: false });
            assert.match(await page.locator('#entries').innerText(), /No matching entries/);
            assert.equal(await page.locator('#copy').isDisabled(), true);
            await page.screenshot({ path: path.join(out, 'registry-empty.png'), fullPage: true });
            await dispatch(page, { type: 'error', message: 'Fixture: disconnected' });
            assert.match(await page.locator('#status').innerText(), /disconnected/);
            await page.screenshot({ path: path.join(out, 'registry-error.png'), fullPage: true });
            await dispatch(page, registryPage);
          });
        }
        if ((name === 'item' || name === 'block') && theme === 'dark' && viewport.width === 1440) {
          await runCheck(name + ' initial properties match selected kind', async () => {
            assert.equal(await page.locator('#itemOptions').isVisible(), name === 'item');
            assert.equal(await page.locator('#blockOptions').isVisible(), name === 'block');
            assert.equal(
              await page.locator('[data-kind="' + name + '"]').getAttribute('aria-pressed'),
              'true',
            );
          });
          await runCheck(
            name + ' switching kind renders matching properties and draft',
            async () => {
              const other = name === 'item' ? 'block' : 'item';
              await page.locator('[data-kind="' + other + '"]').click();
              assert.equal(await page.locator('#itemOptions').isVisible(), other === 'item');
              assert.equal(await page.locator('#blockOptions').isVisible(), other === 'block');
              assert.equal(
                await page.evaluate(
                  () => window.messages.filter((m) => m.type === 'preview').at(-1).draft.kind,
                ),
                other,
              );
              await page.locator('[data-kind="' + name + '"]').click();
              await renderPreview(page, name);
            },
          );
        }
        if (
          theme === 'dark' &&
          viewport.width === 1440 &&
          (await page.locator('.preview-tools button').count())
        ) {
          await runCheck(name + ' copy current preview', async () => {
            const preview = await page.evaluate(() =>
              window.messages.filter((m) => m.type === 'preview').at(-1),
            );
            assert.ok(preview, 'Initial preview request');
            const currentCode = await page.locator('#code').textContent();
            assert.ok(currentCode.trim(), 'Current production-generated preview');
            if (await page.locator('details.preview').count())
              await page.locator('details.preview').evaluate((el) => (el.open = true));
            await page.locator('.preview-tools button').click();
            assert.equal(
              await page.evaluate(
                () => window.messages.filter((m) => m.type === 'copyCode').at(-1)?.code,
              ),
              currentCode,
            );
            await dispatch(page, { type: 'copied' });
            assert.equal(await page.locator('.preview-tools button').innerText(), 'Copied');
          });
          if (!(await page.locator('#save').isDisabled()))
            await runCheck(name + ' Ctrl+S uses existing save action', async () => {
              const before = await page.evaluate(
                () => window.messages.filter((m) => m.type === 'save').length,
              );
              await page.keyboard.press('Control+s');
              assert.equal(
                await page.evaluate(() => window.messages.filter((m) => m.type === 'save').length),
                before + 1,
              );
              await dispatch(page, { type: 'cancelled' });
            });
        }
        if (name === 'addon') {
          await runCheck(
            'mechanical crafting grid, preset and maximum size ' + theme + ' ' + viewport.width,
            async () => {
              await page.locator('[data-type="create:mechanical_crafting"]').click();
              assert.equal(await page.locator('#mechanicalSection').isVisible(), true);
              assert.equal(await page.locator('#itemIngredientsSection').isVisible(), false);
              assert.equal(await page.locator('#optionsSection').isVisible(), false);
              assert.equal(await page.locator('#mechanicalGrid input').count(), 25);
              await page.locator('#crushingWheelPreset').click();
              await renderPreview(page, name);
              const currentCode = await page.locator('#code').innerText();
              assert.match(currentCode, /"type": "create:mechanical_crafting"/);
              assert.match(currentCode, /"id": "create:crushing_wheel"/);
              assert.match(currentCode, /"count": 2/);
              await page.screenshot({
                path: path.join(out, 'addon-mechanical-' + theme + '-' + viewport.width + '.png'),
                fullPage: true,
              });
              await page.locator('#mechanicalGrid input').first().fill('X');
              await renderPreview(page, name);
              assert.match(await page.locator('#status').innerText(), /symbol X/);
              await page.locator('#mechanicalGrid input').first().fill('');
              await page.locator('#acceptMirrored').check();
              await page.locator('#mechanicalWidth').fill('9');
              await page.locator('#mechanicalWidth').press('Tab');
              await page.locator('#mechanicalHeight').fill('9');
              await page.locator('#mechanicalHeight').press('Tab');
              assert.equal(await page.locator('#mechanicalGrid input').count(), 81);
              await page.locator('#mechanicalWidth').fill('10');
              await page.locator('#mechanicalWidth').press('Tab');
              assert.equal(await page.locator('#mechanicalWidth').inputValue(), '9');
              assert.equal(await page.locator('#mechanicalGrid input').count(), 81);
              await renderPreview(page, name);
              assert.match(await page.locator('#code').innerText(), /"accept_mirrored": true/);
              const draft = await page.evaluate(
                () => window.messages.filter((m) => m.type === 'preview').at(-1).draft,
              );
              assert.equal(draft.mechanical.pattern.length, 9);
              assert.equal(draft.mechanical.pattern[0].length, 9);
              await page.locator('#save').click();
              assert.deepEqual(
                await page.evaluate(
                  () => window.messages.filter((m) => m.type === 'save').at(-1).draft,
                ),
                draft,
              );
              await dispatch(page, {
                type: 'saved',
                path: 'server_scripts/kubevs/crafts/create/crushing_wheel.js',
              });
              await page.locator('[data-type="create:pressing"]').click();
              assert.equal(await page.locator('#mechanicalSection').isVisible(), false);
              assert.equal(
                await page.locator('#outputs [data-field="item"]').first().inputValue(),
                'minecraft:iron_plate',
              );
              await page.locator('[data-type="create:mechanical_crafting"]').click();
              assert.equal(
                await page.locator('#outputs [data-field="item"]').first().inputValue(),
                'create:crushing_wheel',
              );
            },
          );
        }
        await renderPreview(page, name);
        if (await page.locator('details.preview').count())
          await page.locator('details.preview').evaluate((el) => (el.open = false));
        const layout = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          overflow: [...document.querySelectorAll('body *')]
            .filter((el) => {
              const r = el.getBoundingClientRect(),
                s = getComputedStyle(el);
              return (
                r.width > 0 &&
                r.height > 0 &&
                s.position !== 'fixed' &&
                (r.right > innerWidth + 1 || r.left < -1)
              );
            })
            .slice(0, 20)
            .map((el) => ({
              tag: el.tagName,
              id: el.id,
              class: el.className,
              text: el.textContent.slice(0, 80),
            })),
          inputWidths: [
            ...document.querySelectorAll('#output,#textureItem,[data-path="type"]'),
          ].map((el) => ({
            id: el.id,
            width: el.getBoundingClientRect().width,
          })),
          title: document.title,
        }));
        for (const input of layout.inputWidths)
          if (input.width > 0 && input.width < 60)
            failures.push(key + ': ' + input.id + ' field too narrow ' + input.width);
        if (errors.length) failures.push(key + ': ' + errors.join('; '));
        if (layout.documentWidth > viewport.width + 1)
          failures.push(key + ': horizontal document overflow ' + layout.documentWidth);
        results.push({ key, viewport, theme, errors, ...layout });
        await page.close();
      }
} finally {
  await browser.close();
}
await fs.writeFile(
  path.join(out, 'report.json'),
  JSON.stringify(
    {
      fixture: 'Headless actual extension HTML; mocked webview messages, no real Minecraft',
      checks,
      results,
      failures,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      screenshots: results.length,
      checks: checks.filter((c) => c.passed).length + '/' + checks.length,
      failures,
      out,
    },
    null,
    2,
  ),
);
if (process.argv.includes('--strict') && failures.length) process.exitCode = 1;
