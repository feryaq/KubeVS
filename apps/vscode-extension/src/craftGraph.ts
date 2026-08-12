import * as vscode from 'vscode';
import type { ConnectorClient } from './connectorClient.js';
import {
  buildCraftTree,
  calculateCraftTotals,
  normalizeRecipe,
  type CraftRecipe,
  type RecipeSnapshotEntry,
} from './craftGraphCore.js';
import type { RegistryCatalog } from './registryCatalog.js';
import { handleRegistryPickMessage } from './registryWebview.js';
import { t } from './localization.js';

type GraphMessage =
  | {
      readonly type: 'build';
      readonly target: string;
      readonly amount: number;
      readonly depth: number;
    }
  | { readonly type: 'cycle'; readonly item: string; readonly direction: number }
  | { readonly type: 'reload' }
  | { readonly type: 'icons'; readonly ids: readonly string[] };

interface PagedRecipeSnapshots {
  readonly entries: readonly RecipeSnapshotEntry[];
  readonly offset: number;
  readonly total: number;
  readonly hasMore: boolean;
}

export function openCraftGraph(
  context: vscode.ExtensionContext,
  connector: ConnectorClient,
  registryCatalog: RegistryCatalog,
  calculatorMode = false,
): void {
  const panel = vscode.window.createWebviewPanel(
    'kubevs.craftGraph',
    calculatorMode ? t('KubeVS — Resource Calculator') : t('KubeVS — Craft Graph'),
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = createNonce();
  panel.webview.html = craftGraphHtml(panel.webview, nonce, calculatorMode);
  let recipes: readonly CraftRecipe[] = [];
  let currentTarget = '';
  let currentAmount = 1;
  let currentDepth = Math.min(
    12,
    vscode.workspace.getConfiguration('kubevs.graph').get('maxDepth', 32),
  );
  let selections: Record<string, string> = {};

  const sendTree = async (): Promise<void> => {
    if (!currentTarget) return;
    const maxNodes = vscode.workspace.getConfiguration('kubevs.graph').get('maxNodes', 5000);
    const tree = buildCraftTree(
      recipes,
      currentTarget,
      currentAmount,
      selections,
      currentDepth,
      maxNodes,
    );
    const tags = new Set<string>();
    const collectTags = (node: typeof tree): void => {
      if (node.item.kind === 'tag') tags.add(node.item.id);
      node.children.forEach(collectTags);
    };
    collectTags(tree);
    const tagMembers = Object.fromEntries(
      await Promise.all(
        [...tags].map(async (tag) => [tag, await registryCatalog.tagEntries(tag)] as const),
      ),
    );
    await panel.webview.postMessage({
      type: 'tree',
      tree,
      totals: calculateCraftTotals(tree),
      tagMembers,
    });
  };

  const reload = async (): Promise<void> => {
    await panel.webview.postMessage({ type: 'loading' });
    try {
      const loaded = await loadRecipes(context, connector);
      const snapshotRecipes = loaded.entries
        .map(normalizeRecipe)
        .filter((value) => value !== undefined);
      recipes = snapshotRecipes;
      selections = {};
      await panel.webview.postMessage({
        type: 'catalog',
        recipes: recipes.length,
        rawRecipes: loaded.entries.length,
        source: loaded.source,
      });
      if (currentTarget) await sendTree();
    } catch (error) {
      await panel.webview.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  panel.webview.onDidReceiveMessage(
    async (value: unknown) => {
      if (await handleRegistryPickMessage(value, panel.webview, registryCatalog)) return;
      if (!isGraphMessage(value)) return;
      if (value.type === 'reload') {
        await reload();
        return;
      }
      if (value.type === 'icons') {
        const icons = await registryCatalog.iconDataUris(value.ids);
        await panel.webview.postMessage({ type: 'icons', icons });
        return;
      }
      if (value.type === 'build') {
        currentTarget = value.target;
        currentAmount = value.amount;
        currentDepth = value.depth;
        selections = {};
        await sendTree();
        return;
      }
      const alternatives = recipes
        .filter((recipe) => recipe.outputs.some((output) => output.id === value.item))
        .sort((left, right) => left.id.localeCompare(right.id, 'en'));
      if (alternatives.length < 2) return;
      const current = selections[value.item];
      const currentIndex = Math.max(
        0,
        current ? alternatives.findIndex((recipe) => recipe.id === current) : 0,
      );
      const nextIndex =
        (currentIndex + Math.sign(value.direction) + alternatives.length) % alternatives.length;
      const next = alternatives[nextIndex] ?? alternatives[0];
      if (next) selections[value.item] = next.id;
      await sendTree();
    },
    undefined,
    context.subscriptions,
  );
  void reload();
}

export async function loadRecipes(
  context: vscode.ExtensionContext,
  connector: ConnectorClient,
): Promise<{
  readonly entries: readonly RecipeSnapshotEntry[];
  readonly source: 'live' | 'cache';
}> {
  if (connector.capabilities) {
    try {
      const entries = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'KubeVS: Fetching Recipe Tree from Minecraft',
          cancellable: true,
        },
        async (progress, token) => {
          const result: RecipeSnapshotEntry[] = [];
          let offset = 0;
          let total = 0;
          do {
            if (token.isCancellationRequested) throw new vscode.CancellationError();
            const page = await connector.request<PagedRecipeSnapshots>('recipes.snapshot', {
              offset,
              limit: 500,
            });
            result.push(...page.entries);
            total = page.total;
            progress.report({
              message: `${result.length.toLocaleString('en-US')} / ${total.toLocaleString('en-US')}`,
              increment: total > 0 ? (page.entries.length / total) * 100 : 0,
            });
            if (!page.hasMore) break;
            const nextOffset = page.offset + page.entries.length;
            if (page.entries.length === 0 || nextOffset <= offset) {
              throw new Error('Connector returned a non-advancing recipe page');
            }
            if (result.length >= 100_000) {
              throw new Error('Recipe snapshot exceeds the safe 100000-entry limit');
            }
            offset = nextOffset;
          } while (result.length < 100_000);
          return result;
        },
      );
      await writeRecipeCache(context, entries).catch(() => undefined);
      return { entries, source: 'live' };
    } catch (error) {
      if (error instanceof vscode.CancellationError) throw error;
      const cached = await readRecipeCache(context);
      if (cached) return { entries: cached, source: 'cache' };
      throw error;
    }
  }
  const cached = await readRecipeCache(context);
  if (!cached) {
    throw new Error(
      'Minecraft is disconnected and no snapshot is available. Connect the Connector and refresh the tree.',
    );
  }
  return { entries: cached, source: 'cache' };
}

async function writeRecipeCache(
  context: vscode.ExtensionContext,
  entries: readonly RecipeSnapshotEntry[],
): Promise<void> {
  const directory = context.storageUri ?? context.globalStorageUri;
  await vscode.workspace.fs.createDirectory(directory);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(directory, 'recipe-snapshot.json'),
    new TextEncoder().encode(
      JSON.stringify({ version: 1, createdAt: new Date().toISOString(), entries }),
    ),
  );
}

async function readRecipeCache(
  context: vscode.ExtensionContext,
): Promise<readonly RecipeSnapshotEntry[] | undefined> {
  const directory = context.storageUri ?? context.globalStorageUri;
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(directory, 'recipe-snapshot.json'),
    );
    const value = JSON.parse(new TextDecoder().decode(bytes)) as {
      readonly version?: unknown;
      readonly entries?: unknown;
    };
    if (value.version !== 1 || !Array.isArray(value.entries)) return undefined;
    return value.entries.filter(isRecipeSnapshotEntry);
  } catch {
    return undefined;
  }
}

function isRecipeSnapshotEntry(value: unknown): value is RecipeSnapshotEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<RecipeSnapshotEntry>;
  if (
    typeof entry.id !== 'string' ||
    entry.id.length > 300 ||
    typeof entry.recipeType !== 'string' ||
    entry.recipeType.length > 300
  ) {
    return false;
  }
  try {
    const serialized = JSON.stringify(entry.json);
    return typeof serialized === 'string' && serialized.length <= 256 * 1024;
  } catch {
    return false;
  }
}

function isGraphMessage(value: unknown): value is GraphMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<GraphMessage>;
  if (message.type === 'reload') return true;
  if (message.type === 'cycle') {
    return (
      typeof message.item === 'string' &&
      /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(message.item) &&
      (message.direction === 1 || message.direction === -1)
    );
  }
  if (message.type === 'icons') {
    return (
      Array.isArray(message.ids) &&
      message.ids.length <= 128 &&
      message.ids.every((id) => typeof id === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(id))
    );
  }
  return (
    message.type === 'build' &&
    typeof message.target === 'string' &&
    /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(message.target) &&
    typeof message.amount === 'number' &&
    Number.isSafeInteger(message.amount) &&
    message.amount >= 1 &&
    message.amount <= 1_000_000_000 &&
    typeof message.depth === 'number' &&
    Number.isSafeInteger(message.depth) &&
    message.depth >= 1 &&
    message.depth <= 32
  );
}

function legacyCraftGraphHtml(
  webview: vscode.Webview,
  nonce: string,
  calculatorMode: boolean,
): string {
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    'img-src data:',
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>KubeVS — Recipe Tree</title>
  <style>
    * { box-sizing: border-box; }
    :root { --copper: #b87333; --copper-soft: color-mix(in srgb, var(--vscode-editor-background) 82%, #b87333 18%); }
    body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.45 var(--vscode-font-family); }
    button, input, select { font: inherit; }
    button:focus-visible, input:focus-visible, select:focus-visible, [tabindex]:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    header { min-height: 66px; display: flex; align-items: center; gap: 16px; padding: 10px 18px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-titleBar-activeBackground); }
    .identity { min-width: 190px; }
    h1 { margin: 0; font-size: 17px; letter-spacing: -.02em; }
    .muted, .status, .meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .target { flex: 1; display: grid; grid-template-columns: minmax(180px, 1fr) 34px 92px 76px auto; gap: 7px; align-items: end; }
    label { display: grid; gap: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    input, select { width: 100%; min-height: 31px; padding: 4px 7px; border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); background: var(--vscode-input-background); }
    button { min-height: 31px; padding: 4px 10px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary { border-color: transparent; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: .55; cursor: default; }
    main { min-height: calc(100vh - 66px); display: grid; grid-template-columns: minmax(210px, 260px) minmax(430px, 1fr) minmax(220px, 280px); }
    aside, .graph { min-width: 0; padding: 18px; }
    aside { background: var(--vscode-sideBar-background); }
    .ledger { border-right: 1px solid var(--vscode-panel-border); }
    .inspector { border-left: 1px solid var(--vscode-panel-border); }
    h2 { margin: 0 0 10px; font-size: 13px; }
    .summary { display: grid; grid-template-columns: 1fr 1fr; margin: 0 0 18px; border-block: 1px solid var(--vscode-panel-border); }
    .summary div { padding: 9px 6px; }
    .summary strong { display: block; font-size: 15px; }
    .resource-list { margin: 0; padding: 0; list-style: none; }
    .resource { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 8px; align-items: center; min-height: 38px; border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 65%, transparent); }
    .resource img, .node-icon { width: 28px; height: 28px; object-fit: contain; image-rendering: pixelated; }
    .resource img:not([src]), .node-icon:not([src]) { visibility: hidden; }
    .resource-id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family); font-size: 11px; }
    .resource-count { font-variant-numeric: tabular-nums; font-weight: 600; }
    .graph { overflow: auto; background: color-mix(in srgb, var(--vscode-editor-background) 96%, #b87333 4%); }
    .graph-head { position: sticky; z-index: 3; top: -18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -18px -18px 14px; padding: 12px 18px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
    .tree, .tree ul { margin: 0; padding: 0; list-style: none; }
    .tree ul { position: relative; margin-left: 19px; padding-left: 23px; }
    .tree ul::before { content: ""; position: absolute; top: 0; bottom: 18px; left: 8px; width: 1px; background: color-mix(in srgb, var(--vscode-panel-border) 60%, var(--copper) 40%); }
    .tree li { position: relative; padding: 4px 0; }
    .tree li::before { content: ""; position: absolute; top: 25px; left: -15px; width: 15px; height: 1px; background: color-mix(in srgb, var(--vscode-panel-border) 55%, var(--copper) 45%); }
    .tree > li::before { display: none; }
    .node { min-width: 390px; display: grid; grid-template-columns: 26px 32px minmax(150px, 1fr) auto; gap: 8px; align-items: center; min-height: 48px; padding: 6px 8px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); box-shadow: 0 3px 10px rgba(0,0,0,.12); cursor: default; }
    .node:hover { background: var(--vscode-list-hoverBackground); }
    .node[data-state="base"] { background: var(--copper-soft); }
    .toggle { width: 24px; min-width: 24px; min-height: 24px; padding: 0; border: 0; background: transparent; }
    .toggle:disabled { visibility: hidden; }
    .node-title { min-width: 0; }
    .node-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .node-id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font: 10px/1.4 var(--vscode-editor-font-family); }
    .node-amount { min-width: 72px; text-align: right; font-variant-numeric: tabular-nums; }
    .recipe-line { grid-column: 3 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .machine { padding: 2px 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-weight: 600; }
    .viewer { color: var(--vscode-descriptionForeground); }
    .stations { grid-column: 3 / -1; display: flex; flex-wrap: wrap; gap: 4px; padding-top: 3px; }
    .station { display: inline-grid; grid-template-columns: 20px minmax(0, auto); align-items: center; gap: 4px; min-height: 24px; padding: 1px 6px 1px 3px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); color: var(--vscode-editorWidget-foreground); font-size: 10px; }
    .station img { width: 20px; height: 20px; object-fit: contain; image-rendering: pixelated; }
    .station img:not([src]) { visibility: hidden; }
    .station.catalyst::after { content: "catalyst"; color: var(--vscode-descriptionForeground); }
    .alternative { min-height: 22px; padding: 1px 6px; font-size: 10px; }
    .byproduct { color: var(--vscode-charts-green); }
    .tree.reveal > li { animation: feed-in 180ms cubic-bezier(.2,.8,.2,1); }
    .empty { padding: 28px; border: 1px dashed var(--vscode-panel-border); color: var(--vscode-descriptionForeground); text-align: center; }
    .detail { margin: 0; }
    .detail dt { margin-top: 14px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .detail dd { margin: 3px 0 0; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family); font-size: 11px; }
    .status.error { color: var(--vscode-errorForeground); }
    @keyframes feed-in { from { opacity: .4; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .tree.reveal > li { animation: none; } }
    @media (max-width: 1000px) { main { grid-template-columns: 220px 1fr; } .inspector { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--vscode-panel-border); } }
    @media (max-width: 720px) { header { align-items: stretch; flex-direction: column; } .target { grid-template-columns: 1fr 34px 80px; } .target label:first-child { grid-column: 1; } .target .depth { display: none; } .target .primary { grid-column: 1 / -1; } main { display: block; } .ledger { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } .node { min-width: 330px; } }
    @media (forced-colors: active) { .node, input, select, button, .empty { border: 1px solid CanvasText; } }
  </style>
</head>
<body>
  <header>
    <div class="identity"><h1>${calculatorMode ? 'Resource Calculator' : 'Recipe Tree'}</h1><div class="muted">Live recipes · alternatives · base resources</div></div>
    <div class="target">
      <label>Result<input id="target" value="minecraft:diamond_pickaxe" spellcheck="false"></label>
      <button id="pick" title="Find an item by name or ID" aria-label="Find item">⌕</button>
      <label>Amount<input id="amount" type="number" min="1" max="1000000000" value="1"></label>
      <label class="depth">Depth<select id="depth">${[4, 6, 8, 12, 16, 24, 32].map((depth) => `<option${depth === 8 ? ' selected' : ''}>${depth}</option>`).join('')}</select></label>
      <button class="primary" id="build">Calculate</button>
    </div>
    <button id="reload" title="Refresh snapshot from Minecraft">↻</button>
  </header>
  <main>
    <aside class="ledger">
      <h2>Base resources</h2>
      <div class="summary"><div><strong id="baseCount">—</strong><span class="muted">entries</span></div><div><strong id="recipeCount">—</strong><span class="muted">recipes</span></div><div><strong id="time">—</strong><span class="muted">ticks</span></div><div><strong id="energy">—</strong><span class="muted">energy</span></div></div>
      <ul class="resource-list" id="resources"></ul>
    </aside>
    <section class="graph">
      <div class="graph-head"><div><h2>Production Chain</h2><div class="status" id="status">Loading recipes…</div></div><button id="collapse">Collapse All</button></div>
      <ul class="tree" id="tree"><li class="empty">Connecting to the recipe catalog.</li></ul>
    </section>
    <aside class="inspector">
      <h2>Node Inspector</h2>
      <p class="muted" id="inspectHint">Select a tree row to inspect its recipe, operation count, and byproducts.</p>
      <dl class="detail" id="detail"></dl>
    </aside>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const treeEl = document.getElementById('tree');
    const statusEl = document.getElementById('status');
    const target = document.getElementById('target');
    const amount = document.getElementById('amount');
    const depth = document.getElementById('depth');
    const resources = document.getElementById('resources');
    const detail = document.getElementById('detail');
    const collapsed = new Set();
    const iconQueue = new Set();
    const requestedIcons = new Set();
    const iconSources = new Map();
    let iconFlush;
    let pickRequest = 0;
    let catalogReady = false;
    let latestTree;
    function humanize(id) { return id.split(':').pop().replaceAll('/', ' › ').replaceAll('_', ' ').replace(/\\b\\p{L}/gu, c => c.toUpperCase()); }
    function format(value) { return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', {maximumFractionDigits: 2}); }
    function flushIcons() {
      const ids = [...iconQueue].slice(0, 128);
      ids.forEach(id => { iconQueue.delete(id); requestedIcons.add(id); });
      if (ids.length) vscode.postMessage({type:'icons', ids});
      if (iconQueue.size) iconFlush = setTimeout(flushIcons, 30);
    }
    function queueIcon(id) {
      if (!id || requestedIcons.has(id)) return;
      iconQueue.add(id);
      clearTimeout(iconFlush);
      iconFlush = setTimeout(flushIcons, 20);
    }
    const iconObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        queueIcon(entry.target.dataset.iconId);
        iconObserver.unobserve(entry.target);
      }
    }, { rootMargin: '180px' });
    function observeIcons(root = document) {
      root.querySelectorAll('[data-icon-id]:not([data-icon-observed])').forEach(element => {
        const cached = iconSources.get(element.dataset.iconId);
        if (cached) { element.src = cached; element.dataset.iconObserved = 'true'; return; }
        element.dataset.iconObserved = 'true'; iconObserver.observe(element);
      });
    }
    function stationElement(stack, catalyst) {
      const chip = document.createElement('span'); chip.className = 'station' + (catalyst ? ' catalyst' : '');
      chip.title = (catalyst ? 'Catalyst: ' : 'Workstation: ') + stack.id;
      const img = document.createElement('img'); img.alt = ''; img.dataset.iconId = stack.id;
      const name = document.createElement('span'); name.textContent = humanize(stack.id);
      chip.append(img, name); return chip;
    }
    function requestBuild() {
      const value = target.value.trim();
      const count = Number(amount.value);
      const maxDepth = Number(depth.value);
      if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value) || !Number.isSafeInteger(count) || count < 1) {
        statusEl.className = 'status error'; statusEl.textContent = 'Check the output ID and quantity.'; return;
      }
      vscode.postMessage({type:'build', target:value, amount:count, depth:maxDepth});
    }
    function nodeElement(node) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'node'; row.dataset.state = node.state; row.tabIndex = 0;
      const toggle = document.createElement('button');
      toggle.className = 'toggle'; toggle.textContent = collapsed.has(node.item.id) ? '▸' : '▾'; toggle.disabled = node.children.length === 0;
      const icon = document.createElement('img'); icon.className = 'node-icon'; icon.alt = ''; icon.dataset.iconId = node.item.id;
      const title = document.createElement('div'); title.className = 'node-title';
      title.innerHTML = '<div class="node-name"></div><div class="node-id"></div>';
      title.querySelector('.node-name').textContent = humanize(node.item.id);
      title.querySelector('.node-id').textContent = (node.item.kind === 'tag' ? '#' : '') + node.item.id;
      const qty = document.createElement('strong'); qty.className = 'node-amount'; qty.textContent = '× ' + format(node.required);
      row.append(toggle, icon, title, qty);
      const recipe = document.createElement('div'); recipe.className = 'recipe-line';
      if (node.state === 'crafted') {
        const machine = document.createElement('span'); machine.className = 'machine'; machine.textContent = node.recipeLabel || humanize(node.recipeType);
        recipe.append(machine, document.createTextNode(node.batches + ' operations'));
        if (node.duration) recipe.append(document.createTextNode(' · ' + format(node.duration) + ' ticks'));
        if (node.energy) recipe.append(document.createTextNode(' · ' + format(node.energy) + ' FE'));
        if (node.alternatives > 1) {
          const alternative = document.createElement('button'); alternative.className = 'alternative';
          alternative.textContent = (node.selectedAlternative + 1) + ' / ' + node.alternatives + ' recipes';
          alternative.title = 'Switch alternative recipe';
          alternative.addEventListener('click', event => { event.stopPropagation(); vscode.postMessage({type:'cycle', item:node.item.id, direction:1}); });
          recipe.append(alternative);
        }
        for (const item of node.byproducts) {
          const extra = document.createElement('span'); extra.className = 'byproduct'; extra.textContent = '+ ' + format(item.count) + ' ' + humanize(item.id); recipe.append(extra);
        }
      } else {
        recipe.textContent = node.state === 'base' ? 'Base resource' : node.state === 'cycle' ? 'Cycle detected' : 'Depth limit reached';
      }
      row.append(recipe);
      if (node.state === 'crafted' && (node.workstations.length || node.catalysts.length)) {
        const stations = document.createElement('div'); stations.className = 'stations';
        node.workstations.forEach(stack => stations.append(stationElement(stack, false)));
        node.catalysts.forEach(stack => stations.append(stationElement(stack, true)));
        row.append(stations);
      }
      const inspect = () => inspectNode(node);
      row.addEventListener('click', inspect); row.addEventListener('keydown', event => { if (event.key === 'Enter') inspect(); });
      toggle.addEventListener('click', event => { event.stopPropagation(); collapsed.has(node.item.id) ? collapsed.delete(node.item.id) : collapsed.add(node.item.id); renderTree(latestTree); });
      li.append(row);
      if (node.children.length && !collapsed.has(node.item.id)) {
        const group = document.createElement('ul');
        node.children.forEach(child => group.append(nodeElement(child)));
        li.append(group);
      }
      return li;
    }
    function renderTree(tree) {
      latestTree = tree; treeEl.replaceChildren(nodeElement(tree)); treeEl.classList.remove('reveal'); void treeEl.offsetWidth; treeEl.classList.add('reveal');
      observeIcons(treeEl);
    }
    function renderTotals(totals) {
      const entries = [...Object.entries(totals.items), ...Object.entries(totals.fluids)];
      document.getElementById('baseCount').textContent = entries.length.toLocaleString('en-US');
      document.getElementById('time').textContent = format(totals.duration);
      document.getElementById('energy').textContent = format(totals.energy);
      resources.replaceChildren(...entries.sort((a,b)=>b[1]-a[1]).map(([id,count]) => {
        const li=document.createElement('li'); li.className='resource';
        const img=document.createElement('img'); img.alt=''; img.dataset.iconId=id.replace(/^#/,'');
        const name=document.createElement('span'); name.className='resource-id'; name.textContent=id;
        const amount=document.createElement('span'); amount.className='resource-count'; amount.textContent='× '+format(count);
        li.append(img,name,amount); return li;
      }));
      observeIcons(resources);
    }
    function inspectNode(node) {
      document.getElementById('inspectHint').hidden = true; detail.replaceChildren();
      const values = [
        ['Item', (node.item.kind==='tag'?'#':'')+node.item.id],
        ['Required', format(node.required)],
        ['State', node.state],
        ['Recipe', node.recipeId || '—'],
        ['Operation', node.recipeLabel || node.recipeType || '—'],
        ['Category', node.categoryId || '—'],
        ['Source', 'standard snapshot'],
        ['Workstations', node.workstations.length ? node.workstations.map(value => value.id).join(', ') : '—'],
        ['Catalysts', node.catalysts.length ? node.catalysts.map(value => value.id).join(', ') : '—'],
        ['Operations', format(node.batches)],
        ['By-products', node.byproducts.length ? node.byproducts.map(value => format(value.count)+' '+value.id).join(', ') : '—']
      ];
      for (const [name,value] of values) { const dt=document.createElement('dt'); dt.textContent=name; const dd=document.createElement('dd'); dd.textContent=value; detail.append(dt,dd); }
    }
    document.getElementById('build').addEventListener('click', requestBuild);
    document.getElementById('pick').addEventListener('click', () => vscode.postMessage({type:'pickRegistry',requestId:++pickRequest,registry:'minecraft:item',current:target.value,title:'KubeVS — select a chain output'}));
    document.getElementById('reload').addEventListener('click', () => vscode.postMessage({type:'reload'}));
    document.getElementById('collapse').addEventListener('click', () => {
      if (!latestTree) return; const visit=node=>{if(node.children.length)collapsed.add(node.item.id);node.children.forEach(visit)}; visit(latestTree); renderTree(latestTree);
    });
    target.addEventListener('keydown', event => { if (event.key === 'Enter') requestBuild(); });
    window.addEventListener('message', event => {
      const message=event.data;
      if(message.type==='loading'){catalogReady=false;statusEl.className='status';statusEl.textContent='Loading recipe snapshot…';}
      else if(message.type==='catalog'){catalogReady=true;document.getElementById('recipeCount').textContent=message.recipes.toLocaleString('en-US');statusEl.className='status';statusEl.textContent=message.recipes.toLocaleString('en-US')+' chains · '+(message.source==='live'?'Minecraft data':'Offline snapshot');requestBuild();}
      else if(message.type==='tree'){renderTree(message.tree);renderTotals(message.totals);statusEl.className='status';statusEl.textContent='Chain calculated. Select a recipe with alternatives to switch paths.';}
      else if(message.type==='icons'){for(const [id,src] of Object.entries(message.icons)){iconSources.set(id,src);document.querySelectorAll('[data-icon-id="'+CSS.escape(id)+'"]').forEach(img=>img.src=src);}}
      else if(message.type==='registryPicked'&&message.requestId===pickRequest&&message.value){target.value=message.value;requestBuild();}
      else if(message.type==='error'){catalogReady=false;statusEl.className='status error';statusEl.textContent=message.message;treeEl.innerHTML='<li class="empty">The tree is unavailable. Connect Minecraft or refresh the snapshot.</li>';}
    });
  </script>
</body>
</html>`;
}

void legacyCraftGraphHtml;

export function craftGraphHtml(
  webview: vscode.Webview,
  nonce: string,
  calculatorMode: boolean,
): string {
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    'img-src data:',
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}"><title>KubeVS — Craft Graph</title>
<style>
*{box-sizing:border-box} :root{--wire:#c57a37;--node:var(--vscode-editorWidget-background);--panel:var(--vscode-sideBar-background)}
body{margin:0;overflow:hidden;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size)/1.4 var(--vscode-font-family)}
button,input,select{font:inherit} button{min-height:30px;padding:4px 9px;border:1px solid var(--vscode-button-border,var(--vscode-panel-border));color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);cursor:pointer}button:hover{background:var(--vscode-button-secondaryHoverBackground)}button.primary{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border-color:transparent}button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
header{height:64px;display:flex;align-items:center;gap:14px;padding:9px 14px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-titleBar-activeBackground)}h1,h2{margin:0}h1{font-size:16px}.identity{min-width:180px}.muted,.status{color:var(--vscode-descriptionForeground);font-size:11px}.target{flex:1;display:grid;grid-template-columns:minmax(190px,1fr) 32px 84px 70px auto;gap:6px;align-items:end}label{display:grid;gap:3px;color:var(--vscode-descriptionForeground);font-size:10px}input,select{height:30px;padding:4px 7px;border:1px solid var(--vscode-input-border,transparent);color:var(--vscode-input-foreground);background:var(--vscode-input-background)}
main{height:calc(100vh - 64px);display:grid;grid-template-columns:230px minmax(420px,1fr) 250px}.side{min-width:0;overflow:auto;padding:14px;background:var(--panel)}.ledger{border-right:1px solid var(--vscode-panel-border)}.inspector{border-left:1px solid var(--vscode-panel-border)}h2{font-size:12px;margin-bottom:10px}.summary{display:grid;grid-template-columns:1fr 1fr;margin-bottom:12px;border-block:1px solid var(--vscode-panel-border)}.summary div{padding:8px 4px}.summary strong{display:block;font-size:14px}.resource-list{margin:0;padding:0;list-style:none}.resource{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:7px;align-items:center;min-height:34px;border-bottom:1px solid var(--vscode-panel-border)}.resource img,.item-icon{width:24px;height:24px;object-fit:contain;image-rendering:pixelated}.resource img:not([src]),.item-icon:not([src]){visibility:hidden}.resource-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:10px var(--vscode-editor-font-family)}
/* impeccable-disable-next-line codex-grid-background: functional coordinate grid for the draggable node canvas */
.workspace{position:relative;min-width:0;overflow:hidden;background-color:var(--vscode-editor-background);background-image:radial-gradient(color-mix(in srgb,var(--vscode-descriptionForeground) 28%,transparent) 1px,transparent 1px);background-size:20px 20px;touch-action:none}.toolbar{position:absolute;z-index:20;top:10px;left:10px;right:10px;display:flex;align-items:center;gap:6px;pointer-events:none}.toolbar>*{pointer-events:auto}.status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 9px;border:1px solid var(--vscode-panel-border);background:color-mix(in srgb,var(--vscode-editor-background) 92%,transparent)}.status.error{color:var(--vscode-errorForeground)}.toolbar-spacer{flex:1}.zoom{min-width:46px;text-align:center;font-variant-numeric:tabular-nums}
.world{position:absolute;left:0;top:0;width:4000px;height:3000px;transform-origin:0 0}.world img{pointer-events:none;-webkit-user-drag:none;user-select:none}.wires{position:absolute;inset:0;width:4000px;height:3000px;overflow:visible;pointer-events:none}.wire{fill:none;stroke:color-mix(in srgb,var(--wire) 78%,var(--vscode-panel-border));stroke-width:2}.wire-dot{fill:var(--wire)}
.craft-node{position:absolute;width:286px;will-change:auto;border:1px solid var(--vscode-panel-border);border-radius:4px;background:var(--node);box-shadow:0 8px 22px rgba(0,0,0,.24);overflow:hidden;user-select:none}.craft-node.dragging{will-change:transform}.craft-node.selected{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px var(--vscode-focusBorder),0 8px 22px rgba(0,0,0,.28)}.node-head{height:34px;display:grid;grid-template-columns:27px minmax(0,1fr) auto;gap:7px;align-items:center;padding:4px 7px;background:color-mix(in srgb,var(--wire) 20%,var(--node));cursor:grab}.node-head:active{cursor:grabbing}.node-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.node-id{font:9px var(--vscode-editor-font-family);color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis}.node-qty{padding-left:5px;font-variant-numeric:tabular-nums}.node-body{padding:7px}.recipe-visual{display:block;max-width:100%;max-height:190px;margin:0 auto 7px;image-rendering:pixelated}.recipe-placeholder{min-height:52px;display:flex;align-items:center;justify-content:center;gap:7px;margin-bottom:7px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);color:var(--vscode-descriptionForeground);font-size:10px}.recipe-placeholder img{width:28px;height:28px;object-fit:contain;image-rendering:pixelated}.recipe-meta{display:flex;flex-wrap:wrap;align-items:center;gap:5px;color:var(--vscode-descriptionForeground);font-size:10px}.badge{padding:2px 5px;color:var(--vscode-badge-foreground);background:var(--vscode-badge-background)}.provider{margin-left:auto}.alt{min-height:22px;padding:1px 5px;font-size:10px}.ports{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.chip{display:inline-flex;align-items:center;gap:3px;padding:2px 5px;border:1px solid var(--vscode-panel-border);font-size:9px}.chip img{width:17px;height:17px;object-fit:contain;image-rendering:pixelated}.base .node-head{background:color-mix(in srgb,var(--vscode-charts-green) 18%,var(--node))}.socket{position:absolute;width:10px;height:10px;border-radius:50%;background:var(--wire);top:17px}.socket.in{left:-6px}.socket.out{right:-6px}
.craft-node{width:304px;border-radius:6px;transition:border-color 100ms ease,box-shadow 100ms ease}.craft-node:hover{border-color:color-mix(in srgb,var(--vscode-focusBorder) 60%,var(--vscode-panel-border))}.craft-node.dragging{box-shadow:0 12px 30px rgba(0,0,0,.34)}.node-head{min-height:42px;height:auto;grid-template-columns:30px minmax(0,1fr) auto;gap:8px;padding:5px 9px}.node-body{padding:9px}.item-icon{width:28px;height:28px}.item-visual{position:relative;display:inline-grid;place-items:center;flex:0 0 auto;width:28px;height:28px}.item-visual img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}.item-visual:not(.has-icon) img{visibility:hidden}.tag-mark{position:absolute;inset:1px;display:grid;place-items:center;border:1px solid color-mix(in srgb,var(--vscode-focusBorder) 70%,var(--vscode-panel-border));border-radius:4px;color:var(--vscode-focusBorder);background:color-mix(in srgb,var(--vscode-focusBorder) 12%,var(--vscode-editor-background));font:700 15px/1 var(--vscode-editor-font-family)}.item-visual.has-icon .tag-mark{display:none}.recipe-placeholder>.item-visual{width:28px;height:28px}.alt-switcher{display:inline-flex;margin-left:auto}.alt-switcher button{min-width:25px;min-height:24px;padding:1px 5px;font-size:10px}.alt-count{display:inline-grid;place-items:center;min-width:38px;padding:0 4px;border-block:1px solid var(--vscode-panel-border);font-variant-numeric:tabular-nums}.tag-summary{display:flex;align-items:center;justify-content:space-between;gap:8px}.tag-count{padding:2px 5px;border-radius:3px;color:var(--vscode-badge-foreground);background:var(--vscode-badge-background);font-size:9px}
.empty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:360px;padding:20px;border:1px dashed var(--vscode-panel-border);color:var(--vscode-descriptionForeground);text-align:center;background:var(--vscode-editor-background)}.detail{margin:0}.detail dt{margin-top:12px;color:var(--vscode-descriptionForeground);font-size:10px}.detail dd{margin:2px 0 0;overflow-wrap:anywhere;font:10px var(--vscode-editor-font-family)}
@media(max-width:900px){main{grid-template-columns:190px 1fr}.inspector{display:none}.identity{display:none}}@media(max-width:650px){header{height:104px;align-items:stretch;flex-direction:column}.target{grid-template-columns:1fr 32px 74px}.depth{display:none}main{height:calc(100vh - 104px);grid-template-columns:1fr}.ledger{display:none}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style></head><body>
<header><div class="identity"><h1>${calculatorMode ? 'Resource Calculator' : 'Craft Graph'}</h1><div class="muted">Nodes · alternatives · lazy-loaded icons</div></div><div class="target"><label>Result<input id="target" value="minecraft:diamond_pickaxe" spellcheck="false"></label><button id="pick" title="Find by name or ID">⌕</button><label>Amount<input id="amount" type="number" min="1" max="1000000000" value="1"></label><label class="depth">Depth<select id="depth">${[4, 6, 8, 12, 16, 24, 32].map((n) => `<option${n === 8 ? ' selected' : ''}>${n}</option>`).join('')}</select></label><button class="primary" id="build">Build</button></div><button id="reload" title="Refresh Minecraft data">↻</button></header>
<main><aside class="side ledger"><h2>Base resources</h2><div class="summary"><div><strong id="baseCount">—</strong><span class="muted">entries</span></div><div><strong id="recipeCount">—</strong><span class="muted">recipes</span></div><div><strong id="time">—</strong><span class="muted">ticks</span></div><div><strong id="energy">—</strong><span class="muted">energy</span></div></div><ul class="resource-list" id="resources"></ul></aside>
<section class="workspace" id="viewport"><div class="toolbar"><div class="status" id="status">Loading recipes…</div><span class="toolbar-spacer"></span><button id="fit">Fit all</button><button id="reset">Reset positions</button><button class="zoom" id="zoom">100%</button></div><div class="world" id="world"><svg class="wires" id="wires" aria-hidden="true"></svg><div id="nodes"></div></div><div class="empty" id="empty">Connecting to the Minecraft recipe catalog.</div></section>
<aside class="side inspector"><h2>Inspector</h2><p class="muted" id="inspectHint">Select a node to inspect its recipe ID, machine, energy, and byproducts.</p><dl class="detail" id="detail"></dl></aside></main>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(),viewport=document.getElementById('viewport'),world=document.getElementById('world'),nodesEl=document.getElementById('nodes'),wires=document.getElementById('wires'),statusEl=document.getElementById('status'),target=document.getElementById('target'),amount=document.getElementById('amount'),depth=document.getElementById('depth'),resources=document.getElementById('resources'),detail=document.getElementById('detail'),empty=document.getElementById('empty');
const iconQueue=new Set(),requestedIcons=new Set(),iconSources=new Map(),positions=new Map(),tagMembers=new Map();let iconTimer,pickRequest=0,latestTree,flat=[],edges=[],panX=30,panY=70,scale=1,drag=null,pan=null,wireFrame=0;
function humanize(id){return id.split(':').pop().replaceAll('/',' › ').replaceAll('_',' ').replace(/\\b\\p{L}/gu,function(c){return c.toUpperCase()})}function format(v){return Number.isInteger(v)?v.toLocaleString('en-US'):v.toLocaleString('en-US',{maximumFractionDigits:2})}
function flushIcons(){const ids=Array.from(iconQueue).slice(0,128);ids.forEach(function(id){iconQueue.delete(id);requestedIcons.add(id)});if(ids.length)vscode.postMessage({type:'icons',ids:ids});if(iconQueue.size)iconTimer=setTimeout(flushIcons,30)}function queueIcon(id){if(!id||requestedIcons.has(id))return;iconQueue.add(id);clearTimeout(iconTimer);iconTimer=setTimeout(flushIcons,20)}
const observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(!entry.isIntersecting)return;entry.target.querySelectorAll('[data-icon-id]').forEach(function(img){const id=img.dataset.iconId,cached=iconSources.get(id);if(cached)img.src=cached;else queueIcon(id)});observer.unobserve(entry.target)})},{root:viewport,rootMargin:'220px'});
function applyTransform(){world.style.transform='translate('+panX+'px,'+panY+'px) scale('+scale+')';document.getElementById('zoom').textContent=Math.round(scale*100)+'%'}
function flatten(tree){flat=[];edges=[];let order=0,maxDepth=0;function walk(node,d,path,parent){const item={node:node,depth:d,path:path,key:path+'|'+(node.recipeId||node.item.id),order:order++};flat.push(item);maxDepth=Math.max(maxDepth,d);if(parent)edges.push([parent.key,item.key]);node.children.forEach(function(child,i){walk(child,d+1,path+'.'+i,item)})}walk(tree,0,'0',null);const rows=new Map();flat.forEach(function(item){const y=(rows.get(item.depth)||0)*220+60;rows.set(item.depth,(rows.get(item.depth)||0)+1);if(!positions.has(item.key))positions.set(item.key,{x:(maxDepth-item.depth)*360+60,y:y})})}
function setIcon(img,src){img.src=src;const visual=img.closest('.item-visual');if(visual)visual.classList.add('has-icon')}function icon(id,cls){const img=document.createElement('img');img.alt='';img.draggable=false;img.className=cls||'';img.dataset.iconId=id;const src=iconSources.get(id);if(src)setIcon(img,src);return img}function itemIcon(item,cls){if(item.kind!=='tag')return icon(item.id,cls);const members=tagMembers.get(item.id)||[],id=members[0],visual=document.createElement('span'),img=icon(id||'',cls),mark=document.createElement('span');visual.className='item-visual';visual.title='#'+item.id+(members.length?' · '+members.length+' matching items':' · no matching items reported');img.dataset.tagId=item.id;mark.className='tag-mark';mark.textContent='#';mark.setAttribute('aria-hidden','true');visual.append(img,mark);if(id&&iconSources.has(id))visual.classList.add('has-icon');return visual}
function chip(stack){const el=document.createElement('span');el.className='chip';el.append(icon(stack.id),document.createTextNode(humanize(stack.id)));return el}
function makeNode(item){const n=item.node,pos=positions.get(item.key),el=document.createElement('article');el.className='craft-node '+n.state;el.dataset.key=item.key;el.dataset.recipeId=n.recipeId||'';el.style.left=pos.x+'px';el.style.top=pos.y+'px';el.tabIndex=0;el.setAttribute('aria-label',humanize(n.item.id)+', '+format(n.required)+' required');
 const head=document.createElement('div');head.className='node-head';head.title='Drag to move';const mainIcon=itemIcon(n.item,'item-icon'),title=document.createElement('div');title.innerHTML='<div class="node-name"></div><div class="node-id"></div>';title.querySelector('.node-name').textContent=humanize(n.item.id);title.querySelector('.node-id').textContent=(n.item.kind==='tag'?'#':'')+n.item.id;title.title=(n.item.kind==='tag'?'#':'')+n.item.id;const qty=document.createElement('strong');qty.className='node-qty';qty.textContent='× '+format(n.required);head.append(mainIcon,title,qty);el.append(head);
 const body=document.createElement('div');body.className='node-body';if(n.state==='crafted'){const placeholder=document.createElement('div');placeholder.className='recipe-placeholder';n.children.slice(0,5).forEach(function(c){placeholder.append(itemIcon(c.item))});placeholder.append(document.createTextNode('→'),itemIcon(n.item));body.append(placeholder);const meta=document.createElement('div');meta.className='recipe-meta';const badge=document.createElement('span');badge.className='badge';badge.textContent=n.recipeLabel||humanize(n.recipeType);meta.append(badge,document.createTextNode(format(n.batches)+' ops'));if(n.duration)meta.append(document.createTextNode(format(n.duration)+' ticks'));if(n.energy)meta.append(document.createTextNode(format(n.energy)+' FE'));if(n.alternatives>1){const switcher=document.createElement('span'),previous=document.createElement('button'),count=document.createElement('span'),next=document.createElement('button');switcher.className='alt-switcher';previous.textContent='‹';previous.title='Previous alternative recipe';previous.setAttribute('aria-label','Previous alternative recipe');count.className='alt-count';count.textContent=(n.selectedAlternative+1)+' / '+n.alternatives;next.textContent='›';next.title='Next alternative recipe';next.setAttribute('aria-label','Next alternative recipe');previous.onclick=function(e){e.stopPropagation();vscode.postMessage({type:'cycle',item:n.item.id,direction:-1})};next.onclick=function(e){e.stopPropagation();vscode.postMessage({type:'cycle',item:n.item.id,direction:1})};switcher.append(previous,count,next);meta.append(switcher)}body.append(meta);if(n.workstations.length||n.catalysts.length){const ports=document.createElement('div');ports.className='ports';n.workstations.forEach(function(s){ports.append(chip(s))});n.catalysts.forEach(function(s){ports.append(chip(s))});body.append(ports)}}else{const p=document.createElement('div');p.className=n.item.kind==='tag'?'muted tag-summary':'muted';p.append(document.createTextNode(n.state==='base'?'Base resource':n.state==='cycle'?'Cyclic dependency':'Depth limit'));if(n.item.kind==='tag'){const count=document.createElement('span'),members=tagMembers.get(n.item.id)||[];count.className='tag-count';count.textContent=members.length?members.length+' items':'Tag';p.append(count)}body.append(p)}el.append(body);
 const input=document.createElement('i');input.className='socket in';const output=document.createElement('i');output.className='socket out';el.append(input,output);el.onclick=function(){selectNode(el,n)};el.onkeydown=function(e){if(e.target!==el)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();selectNode(el,n);return}const delta=e.shiftKey?1:8,move={ArrowLeft:[-delta,0],ArrowRight:[delta,0],ArrowUp:[0,-delta],ArrowDown:[0,delta]}[e.key];if(!move)return;e.preventDefault();const current=positions.get(item.key);current.x+=move[0];current.y+=move[1];el.style.left=current.x+'px';el.style.top=current.y+'px';savePositions();scheduleWires()};head.onpointerdown=function(e){if(e.button!==0)return;e.stopPropagation();drag={el:el,key:item.key,startX:e.clientX,startY:e.clientY,x:pos.x,y:pos.y};el.classList.add('dragging');head.setPointerCapture(e.pointerId)};head.onpointermove=moveDrag;head.onpointerup=endDrag;head.onpointercancel=endDrag;return el}
function scheduleWires(){if(wireFrame)return;wireFrame=requestAnimationFrame(function(){wireFrame=0;drawWires()})}
function moveDrag(e){if(!drag)return;const p=positions.get(drag.key),dx=(e.clientX-drag.startX)/scale,dy=(e.clientY-drag.startY)/scale;p.x=drag.x+dx;p.y=drag.y+dy;drag.el.style.transform='translate3d('+dx+'px,'+dy+'px,0)';if(flat.length<=300)scheduleWires()}
function endDrag(){if(!drag)return;const active=drag,p=positions.get(active.key);active.el.style.left=p.x+'px';active.el.style.top=p.y+'px';active.el.style.transform='';active.el.classList.remove('dragging');drag=null;updateWorldBounds();savePositions();scheduleWires()}
function updateWorldBounds(){const elements=Array.from(nodesEl.children),right=Math.max(4000,...elements.map(function(el){const p=positions.get(el.dataset.key);return p?p.x+el.offsetWidth+500:0})),bottom=Math.max(3000,...elements.map(function(el){const p=positions.get(el.dataset.key);return p?p.y+el.offsetHeight+500:0}));world.style.width=Math.ceil(right)+'px';world.style.height=Math.ceil(bottom)+'px';wires.setAttribute('width',Math.ceil(right));wires.setAttribute('height',Math.ceil(bottom));wires.style.width=Math.ceil(right)+'px';wires.style.height=Math.ceil(bottom)+'px'}function drawWires(){const fragment=document.createDocumentFragment(),byKey=new Map(Array.from(nodesEl.children).map(function(el){return[el.dataset.key,el]}));edges.forEach(function(pair){const a=byKey.get(pair[0]),b=byKey.get(pair[1]),pa=positions.get(pair[0]),pb=positions.get(pair[1]);if(!a||!b||!pa||!pb)return;const x1=pa.x,x2=pb.x+b.offsetWidth,y1=pa.y+a.offsetHeight/2,y2=pb.y+b.offsetHeight/2,c=Math.max(70,Math.abs(x1-x2)*.45),path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('class','wire');path.setAttribute('d','M '+x2+' '+y2+' C '+(x2+c)+' '+y2+', '+(x1-c)+' '+y1+', '+x1+' '+y1);fragment.append(path)});wires.replaceChildren(fragment)}
function renderTree(tree){latestTree=tree;empty.hidden=true;flatten(tree);const fragment=document.createDocumentFragment();flat.forEach(function(item){fragment.append(makeNode(item))});nodesEl.replaceChildren(fragment);Array.from(nodesEl.children).forEach(function(el){observer.observe(el)});requestAnimationFrame(function(){updateWorldBounds();drawWires();fitGraph(false)})}
function fitGraph(force){if(!flat.length)return;const elements=Array.from(nodesEl.children),bounds=elements.map(function(el){const p=positions.get(el.dataset.key);return{x:p.x,y:p.y,right:p.x+el.offsetWidth,bottom:p.y+el.offsetHeight}}),minX=Math.min(...bounds.map(function(b){return b.x})),minY=Math.min(...bounds.map(function(b){return b.y})),maxX=Math.max(...bounds.map(function(b){return b.right})),maxY=Math.max(...bounds.map(function(b){return b.bottom})),w=viewport.clientWidth,h=viewport.clientHeight,next=Math.min(1.15,Math.max(.08,Math.min((w-70)/(maxX-minX),(h-100)/(maxY-minY))));if(force||!localStorage.getItem('kubevs.graph.view')){scale=next;panX=(w-(maxX-minX)*scale)/2-minX*scale;panY=(h-(maxY-minY)*scale)/2-minY*scale;applyTransform();localStorage.setItem('kubevs.graph.view','1')}}
function savePositions(){const out={};positions.forEach(function(v,k){out[k]=v});localStorage.setItem('kubevs.graph.positions',JSON.stringify(out))}function restorePositions(){try{const raw=JSON.parse(localStorage.getItem('kubevs.graph.positions')||'{}');Object.entries(raw).forEach(function(e){if(Number.isFinite(e[1].x)&&Number.isFinite(e[1].y))positions.set(e[0],e[1])})}catch{}}
function selectNode(el,n){document.querySelectorAll('.craft-node.selected').forEach(function(x){x.classList.remove('selected')});el.classList.add('selected');document.getElementById('inspectHint').hidden=true;detail.replaceChildren();[['Item',(n.item.kind==='tag'?'#':'')+n.item.id],['Required',format(n.required)],['Recipe',n.recipeId||'—'],['Operation',n.recipeLabel||n.recipeType||'—'],['Source','Minecraft snapshot'],['Workstations',n.workstations.length?n.workstations.map(function(x){return x.id}).join(', '):'—'],['By-products',n.byproducts.length?n.byproducts.map(function(x){return format(x.count)+' '+x.id}).join(', '):'—']].forEach(function(v){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=v[0];dd.textContent=v[1];detail.append(dt,dd)})}
function renderTotals(t){const entries=Object.entries(t.items).concat(Object.entries(t.fluids));document.getElementById('baseCount').textContent=entries.length.toLocaleString('en-US');document.getElementById('time').textContent=format(t.duration);document.getElementById('energy').textContent=format(t.energy);resources.replaceChildren.apply(resources,entries.sort(function(a,b){return b[1]-a[1]}).map(function(v){const li=document.createElement('li');li.className='resource';const isTag=v[0].startsWith('#'),id=v[0].replace(/^#/,'');li.append(itemIcon({kind:isTag?'tag':'item',id:id}),Object.assign(document.createElement('span'),{className:'resource-id',textContent:v[0],title:v[0]}),Object.assign(document.createElement('strong'),{textContent:'× '+format(v[1])}));if(!isTag)queueIcon(id);return li}))}
function requestBuild(){const id=target.value.trim(),count=Number(amount.value);if(!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)||!Number.isSafeInteger(count)||count<1){statusEl.className='status error';statusEl.textContent='Check the item ID and amount.';return}vscode.postMessage({type:'build',target:id,amount:count,depth:Number(depth.value)})}
viewport.onpointerdown=function(e){if(e.button!==0||e.target.closest('.craft-node,.toolbar'))return;pan={x:e.clientX,y:e.clientY,px:panX,py:panY};viewport.setPointerCapture(e.pointerId)};viewport.onpointermove=function(e){if(!pan)return;panX=pan.px+e.clientX-pan.x;panY=pan.py+e.clientY-pan.y;applyTransform()};viewport.onpointerup=viewport.onpointercancel=function(){pan=null};viewport.onwheel=function(e){e.preventDefault();const rect=viewport.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top,old=scale;scale=Math.max(.35,Math.min(1.8,scale*(e.deltaY<0?1.1:.9)));panX=mx-(mx-panX)*(scale/old);panY=my-(my-panY)*(scale/old);applyTransform()};
world.addEventListener('dragstart',function(e){e.preventDefault()});document.getElementById('build').onclick=requestBuild;document.getElementById('reload').onclick=function(){vscode.postMessage({type:'reload'})};document.getElementById('pick').onclick=function(){vscode.postMessage({type:'pickRegistry',requestId:++pickRequest,registry:'minecraft:item',current:target.value,title:'KubeVS — select a result'})};document.getElementById('fit').onclick=function(){fitGraph(true)};document.getElementById('reset').onclick=function(){positions.clear();localStorage.removeItem('kubevs.graph.positions');localStorage.removeItem('kubevs.graph.view');if(latestTree)renderTree(latestTree)};document.getElementById('zoom').onclick=function(){scale=1;applyTransform()};target.onkeydown=function(e){if(e.key==='Enter')requestBuild()};restorePositions();applyTransform();
setInterval(function(){document.querySelectorAll('img[data-tag-id]').forEach(function(img){const members=tagMembers.get(img.dataset.tagId)||[];if(members.length<2)return;let next=members[Math.floor(Math.random()*members.length)];if(next===img.dataset.iconId)next=members[(members.indexOf(next)+1)%members.length];img.dataset.iconId=next;const src=iconSources.get(next);if(src)setIcon(img,src);else queueIcon(next)})},900);window.addEventListener('message',function(event){const m=event.data;if(m.type==='loading'){statusEl.className='status';statusEl.textContent='Loading recipe snapshot…'}else if(m.type==='catalog'){document.getElementById('recipeCount').textContent=m.recipes.toLocaleString('en-US');statusEl.className='status';statusEl.textContent=m.recipes.toLocaleString('en-US')+' recipes · '+(m.source==='live'?'Minecraft live':'Offline snapshot');requestBuild()}else if(m.type==='tree'){tagMembers.clear();Object.entries(m.tagMembers||{}).forEach(function(v){tagMembers.set(v[0],v[1]);v[1].forEach(queueIcon)});renderTree(m.tree);renderTotals(m.totals);statusEl.textContent='Graph ready · '+flat.length+' nodes · drag nodes, pan the background, and use the wheel to zoom'+(flat.length>300?' · wires update after drop':'')}else if(m.type==='icons'){Object.entries(m.icons).forEach(function(v){iconSources.set(v[0],v[1]);document.querySelectorAll('[data-icon-id="'+CSS.escape(v[0])+'"]').forEach(function(img){setIcon(img,v[1])})})}else if(m.type==='registryPicked'&&m.requestId===pickRequest&&m.value){target.value=m.value;requestBuild()}else if(m.type==='error'){statusEl.className='status error';statusEl.textContent=m.message;empty.hidden=false;empty.textContent='The graph is unavailable. Connect Minecraft or refresh the snapshot.'}});
</script></body></html>`;
  return html;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}
