import { workbenchCss, handleWorkbenchMessage } from './workbenchUi.js';
import * as vscode from 'vscode';
import type { ConnectorClient } from './connectorClient.js';
import {
  buildCraftTree,
  calculateCraftTotals,
  normalizeRecipe,
  fetchRecipeSnapshot,
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
      if (await handleWorkbenchMessage(value, panel.webview)) return;
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
          return fetchRecipeSnapshot(
            async (offset, limit, revision) => {
              if (token.isCancellationRequested) throw new vscode.CancellationError();
              return connector.request('recipes.snapshot', {
                offset,
                limit,
                ...(revision ? { revision } : {}),
              });
            },
            (loaded, total, added) =>
              progress.report({
                message: `${loaded.toLocaleString('en-US')} / ${total.toLocaleString('en-US')}`,
                increment: total > 0 ? (added / total) * 100 : 0,
              }),
          );
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

${workbenchCss}
:root{--wire:var(--kvs-accent)}
header{height:72px;min-height:72px;padding:10px 16px;gap:12px;flex-wrap:nowrap}
main{height:calc(100vh - 72px);grid-template-columns:220px minmax(0,1fr) 230px}
.identity{min-width:120px}.target{grid-template-columns:minmax(100px,1fr) 34px 70px 65px auto}
.target label{font-size:10px}.target input,.target select{min-height:30px}
.craft-node{border-radius:10px;border-color:var(--kvs-line);box-shadow:0 4px 12px #0002}
.node-head{background:var(--kvs-soft);padding:9px 11px;min-height:46px}.node-body{padding:11px}
.base .node-head{background:var(--kvs-surface)}.side{background:var(--kvs-surface);padding:18px 14px}
.side-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
.side-heading h2{margin:0}.side-heading button{font-size:11px;min-height:26px;padding:3px 7px}
.toolbar{align-items:center;flex-wrap:wrap}.toolbar button{min-height:28px;padding:4px 8px;font-size:11px}
.status{border-radius:6px;font-size:11px}.badge,.chip{border-radius:4px}.empty{border:0;background:transparent}
.panel-toggle{display:none}
.view-mode{display:inline-flex;align-items:center}.view-mode select{min-width:100px;height:30px;padding-inline:8px;border-radius:5px}
body.resources-only main{grid-template-columns:minmax(0,1fr)}body.resources-only .workspace,body.resources-only .inspector{display:none}body.resources-only .ledger{display:block;width:100%;max-width:1040px;margin:0 auto;padding:20px 24px;border:0;background:transparent}body.resources-only .summary{display:none}body.resources-only .ledger .resource-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));column-gap:24px}body.resources-only .ledger .resource{min-height:42px}body.resources-only #status{display:block;max-width:none;margin:0 0 12px;overflow:visible;white-space:normal}body.resources-only #status[hidden],#status[hidden]{display:none}
.resource-warning{display:none;margin:0 0 12px;padding:8px 10px;border-left:2px solid var(--vscode-editorWarning-foreground,var(--vscode-editorWarning-border,#c57a37));color:var(--vscode-editorWarning-foreground,var(--vscode-descriptionForeground));background:color-mix(in srgb,var(--vscode-editorWarning-foreground,#c57a37) 9%,transparent);font-size:11px}.resource-warning.visible{display:block}
@media(max-width:1050px){main{grid-template-columns:190px minmax(0,1fr)}.inspector{display:none}.panel-toggle.details-toggle{display:block}.show-inspector .inspector{display:block;position:absolute;z-index:30;right:0;top:72px;bottom:0;width:min(280px,85vw);box-shadow:-8px 0 28px #0003}.identity{display:none}}
@media(max-width:650px){header{height:118px;min-height:118px;padding:10px 12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.target{grid-column:1/-1;grid-row:1;grid-template-columns:minmax(0,1fr) 32px 64px auto;gap:5px}.target .depth{display:none}.target label{font-size:10px}.target button.primary{grid-column:4}.panel-toggle{display:block}.resources-only .panel-toggle{display:none}.header-actions{display:flex;justify-content:flex-end;gap:5px}main{height:calc(100vh - 118px);grid-template-columns:minmax(0,1fr)}.ledger{display:none}body.resources-only .ledger{display:block;position:static;width:100%;max-width:none;height:100%;padding:14px 12px;overflow:auto;box-shadow:none}.show-resources .ledger{display:block;position:absolute;z-index:30;left:0;top:118px;bottom:0;width:min(280px,85vw);box-shadow:8px 0 28px #0003}.show-inspector .inspector{top:118px}.toolbar .status{max-width:100%;flex-basis:100%}.toolbar{right:8px;left:8px;gap:4px}.summary strong{font-size:15px}body.resources-only .ledger .resource-list{grid-template-columns:minmax(0,1fr);column-gap:0}}

</style></head><body>
<header><div class="identity"><h1>${calculatorMode ? 'Resource Calculator' : 'Craft Graph'}</h1></div><div class="target"><label>Result<input id="target" value="minecraft:diamond_pickaxe" spellcheck="false"></label><button id="pick" title="Find by name or ID">⌕</button><label>Amount<input id="amount" type="number" min="1" max="1000000000" value="1"></label><label class="depth">Depth<select id="depth">${[4, 6, 8, 12, 16, 24, 32].map((n) => `<option${n === 8 ? ' selected' : ''}>${n}</option>`).join('')}</select></label><button class="primary" id="build">Build</button></div><div class="header-actions"><label class="view-mode"><select id="viewMode" aria-label="View"><option value="graph">Graph</option><option value="resources">Resources</option></select></label><button class="panel-toggle" id="resourcesToggle" aria-expanded="false">Resources</button><button class="panel-toggle details-toggle" id="inspectorToggle" aria-expanded="false">Details</button><button id="reload" title="Refresh Minecraft data" aria-label="Refresh Minecraft data">↻</button></div></header>
<main><aside class="side ledger"><div class="side-heading"><h2>Resources</h2><button id="copyResources" disabled title="Copy quantities and IDs">Copy</button></div><div class="summary"><div><strong id="baseCount">—</strong><span class="muted">entries</span></div><div><strong id="recipeCount">—</strong><span class="muted">recipes</span></div><div><strong id="time">—</strong><span class="muted">ticks</span></div><div><strong id="energy">—</strong><span class="muted">energy</span></div></div><div class="resource-warning" id="resourceWarning" role="status"></div><ul class="resource-list" id="resources"></ul></aside>
<section class="workspace" id="viewport"><div class="toolbar"><div class="status" id="status">Loading recipes…</div><span class="toolbar-spacer"></span><button id="fit">Fit all</button><button id="reset">Reset positions</button><button class="zoom" id="zoom">100%</button></div><div class="world" id="world"><svg class="wires" id="wires" aria-hidden="true"></svg><div id="nodes"></div></div><div class="empty" id="empty">Load a recipe snapshot to build a chain.</div></section>
<aside class="side inspector"><h2>Inspector</h2><p class="muted" id="inspectHint">Select a node.</p><dl class="detail" id="detail"></dl></aside></main>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(),viewport=document.getElementById('viewport'),world=document.getElementById('world'),nodesEl=document.getElementById('nodes'),wires=document.getElementById('wires'),statusEl=document.getElementById('status'),target=document.getElementById('target'),amount=document.getElementById('amount'),depth=document.getElementById('depth'),resources=document.getElementById('resources'),detail=document.getElementById('detail'),empty=document.getElementById('empty'),resourceWarning=document.getElementById('resourceWarning'),resourceLedger=document.querySelector('.ledger'),graphToolbar=document.querySelector('.toolbar'),graphStatusAnchor=statusEl.nextSibling;
const presentationKey='kubevs.graph.presentation.${calculatorMode ? 'calculator' : 'graph'}',defaultPresentation='${calculatorMode ? 'resources' : 'graph'}';
const freshPositions=new Set();let latestTotals;
const iconQueue=new Set(),requestedIcons=new Set(),iconSources=new Map(),positions=new Map(),tagMembers=new Map();let iconTimer,pickRequest=0,latestTree,flat=[],edges=[],panX=30,panY=70,scale=1,drag=null,pan=null,wireFrame=0;
function humanize(id){return id.split(':').pop().replaceAll('/',' › ').replaceAll('_',' ').replace(/\\b\\p{L}/gu,function(c){return c.toUpperCase()})}function format(v){return Number.isInteger(v)?v.toLocaleString('en-US'):v.toLocaleString('en-US',{maximumFractionDigits:2})}
function flushIcons(){const ids=Array.from(iconQueue).slice(0,128);ids.forEach(function(id){iconQueue.delete(id);requestedIcons.add(id)});if(ids.length)vscode.postMessage({type:'icons',ids:ids});if(iconQueue.size)iconTimer=setTimeout(flushIcons,30)}function queueIcon(id){if(!id||requestedIcons.has(id))return;iconQueue.add(id);clearTimeout(iconTimer);iconTimer=setTimeout(flushIcons,20)}
const observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(!entry.isIntersecting)return;entry.target.querySelectorAll('[data-icon-id]').forEach(function(img){const id=img.dataset.iconId,cached=iconSources.get(id);if(cached)img.src=cached;else queueIcon(id)});observer.unobserve(entry.target)})},{root:viewport,rootMargin:'220px'});
function applyTransform(){world.style.transform='translate('+panX+'px,'+panY+'px) scale('+scale+')';document.getElementById('zoom').textContent=Math.round(scale*100)+'%'}
function flatten(tree){freshPositions.clear();flat=[];edges=[];let order=0,maxDepth=0;function walk(node,d,path,parent){const item={node:node,depth:d,path:path,key:path+'|'+(node.recipeId||node.item.id),order:order++};flat.push(item);maxDepth=Math.max(maxDepth,d);if(parent)edges.push([parent.key,item.key]);node.children.forEach(function(child,i){walk(child,d+1,path+'.'+i,item)})}walk(tree,0,'0',null);const rows=new Map();flat.forEach(function(item){const y=(rows.get(item.depth)||0)*220+60;rows.set(item.depth,(rows.get(item.depth)||0)+1);if(!positions.has(item.key)){positions.set(item.key,{x:(maxDepth-item.depth)*360+60,y:y});freshPositions.add(item.key)}})}
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
function renderTree(tree){latestTree=tree;empty.hidden=true;flatten(tree);const fragment=document.createDocumentFragment();flat.forEach(function(item){fragment.append(makeNode(item))});nodesEl.replaceChildren(fragment);const rowBottoms=new Map();flat.forEach(function(item){const el=nodesEl.querySelector('[data-key="'+CSS.escape(item.key)+'"]'),pos=positions.get(item.key);if(freshPositions.has(item.key)){pos.y=rowBottoms.get(item.depth)||60;el.style.top=pos.y+'px'}rowBottoms.set(item.depth,Math.max(rowBottoms.get(item.depth)||60,pos.y+el.offsetHeight+34))});Array.from(nodesEl.children).forEach(function(el){observer.observe(el)});updateResourceWarning(tree);requestAnimationFrame(function(){updateWorldBounds();drawWires();fitGraph(false)})}
function updateResourceWarning(tree){const warnings=new Set();function visit(node){if(node.state==='depth')warnings.add('Depth or node limit reached');if(node.state==='cycle')warnings.add('Recipe cycle detected');if(node.item.kind==='tag'&&!(tagMembers.get(node.item.id)||[]).length)warnings.add('Some tags have no resolved items');node.children.forEach(visit)}visit(tree);resourceWarning.textContent=warnings.size?'Incomplete: '+Array.from(warnings).join(' · '):'';resourceWarning.classList.toggle('visible',warnings.size>0)}
function setPresentation(value,persist){const mode=value==='resources'?'resources':'graph';document.body.classList.toggle('resources-only',mode==='resources');if(mode==='resources')resourceLedger.insertBefore(statusEl,resourceWarning);else graphToolbar.insertBefore(statusEl,graphStatusAnchor);document.getElementById('viewMode').value=mode;if(persist){try{localStorage.setItem(presentationKey,mode)}catch{}}refreshStatusVisibility();if(mode==='graph'&&latestTree){renderTree(latestTree);requestAnimationFrame(function(){fitGraph(true)})}}
function refreshStatusVisibility(){statusEl.hidden=document.body.classList.contains('resources-only')&&!statusEl.classList.contains('loading')&&!statusEl.classList.contains('error')}
function clearResourceResult(){latestTotals=undefined;resources.replaceChildren();document.getElementById('copyResources').disabled=true;document.getElementById('baseCount').textContent='—';document.getElementById('time').textContent='—';document.getElementById('energy').textContent='—';resourceWarning.textContent='';resourceWarning.classList.remove('visible')}
function fitGraph(force){if(!flat.length)return;const elements=Array.from(nodesEl.children),bounds=elements.map(function(el){const p=positions.get(el.dataset.key);return{x:p.x,y:p.y,right:p.x+el.offsetWidth,bottom:p.y+el.offsetHeight}}),minX=Math.min(...bounds.map(function(b){return b.x})),minY=Math.min(...bounds.map(function(b){return b.y})),maxX=Math.max(...bounds.map(function(b){return b.right})),maxY=Math.max(...bounds.map(function(b){return b.bottom})),w=viewport.clientWidth,h=viewport.clientHeight,next=Math.min(1.15,Math.max(.08,Math.min((w-70)/(maxX-minX),(h-100)/(maxY-minY))));if(force||!localStorage.getItem('kubevs.graph.view')){scale=next;panX=(w-(maxX-minX)*scale)/2-minX*scale;panY=(h-(maxY-minY)*scale)/2-minY*scale;applyTransform();localStorage.setItem('kubevs.graph.view','1')}}
function savePositions(){const out={};positions.forEach(function(v,k){out[k]=v});localStorage.setItem('kubevs.graph.positions',JSON.stringify(out))}function restorePositions(){try{const raw=JSON.parse(localStorage.getItem('kubevs.graph.positions')||'{}');Object.entries(raw).forEach(function(e){if(Number.isFinite(e[1].x)&&Number.isFinite(e[1].y))positions.set(e[0],e[1])})}catch{}}
function selectNode(el,n){if(window.innerWidth<=1050){document.body.classList.add('show-inspector');document.getElementById('inspectorToggle').setAttribute('aria-expanded','true');document.body.classList.remove('show-resources');document.getElementById('resourcesToggle').setAttribute('aria-expanded','false')}document.querySelectorAll('.craft-node.selected').forEach(function(x){x.classList.remove('selected')});el.classList.add('selected');document.getElementById('inspectHint').hidden=true;detail.replaceChildren();[['Item',(n.item.kind==='tag'?'#':'')+n.item.id],['Required',format(n.required)],['Recipe',n.recipeId||'—'],['Operation',n.recipeLabel||n.recipeType||'—'],['Source','Minecraft snapshot'],['Workstations',n.workstations.length?n.workstations.map(function(x){return x.id}).join(', '):'—'],['By-products',n.byproducts.length?n.byproducts.map(function(x){return format(x.count)+' '+x.id}).join(', '):'—']].forEach(function(v){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=v[0];dd.textContent=v[1];detail.append(dt,dd)})}
function renderTotals(t){latestTotals=t;document.getElementById('copyResources').disabled=Object.keys(t.items).length+Object.keys(t.fluids).length===0;const entries=Object.entries(t.items).concat(Object.entries(t.fluids));document.getElementById('baseCount').textContent=entries.length.toLocaleString('en-US');document.getElementById('time').textContent=format(t.duration);document.getElementById('energy').textContent=format(t.energy);resources.replaceChildren.apply(resources,entries.sort(function(a,b){return b[1]-a[1]}).map(function(v){const li=document.createElement('li');li.className='resource';const isTag=v[0].startsWith('#'),id=v[0].replace(/^#/,'');li.append(itemIcon({kind:isTag?'tag':'item',id:id}),Object.assign(document.createElement('span'),{className:'resource-id',textContent:v[0],title:v[0]}),Object.assign(document.createElement('strong'),{textContent:Object.hasOwn(t.fluids,v[0])?format(v[1])+' mB':'× '+format(v[1])}));if(!isTag)queueIcon(id);return li}))}
function requestBuild(){const id=target.value.trim(),count=Number(amount.value);clearResourceResult();if(!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)||!Number.isSafeInteger(count)||count<1){statusEl.className='status error';statusEl.textContent='Check the item ID and amount.';refreshStatusVisibility();return}if(document.body.classList.contains('resources-only')){statusEl.className='status loading';statusEl.textContent='Calculating…';refreshStatusVisibility()}vscode.postMessage({type:'build',target:id,amount:count,depth:Number(depth.value)})}
viewport.onpointerdown=function(e){if(e.button!==0||e.target.closest('.craft-node,.toolbar'))return;pan={x:e.clientX,y:e.clientY,px:panX,py:panY};viewport.setPointerCapture(e.pointerId)};viewport.onpointermove=function(e){if(!pan)return;panX=pan.px+e.clientX-pan.x;panY=pan.py+e.clientY-pan.y;applyTransform()};viewport.onpointerup=viewport.onpointercancel=function(){pan=null};viewport.onwheel=function(e){e.preventDefault();const rect=viewport.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top,old=scale;scale=Math.max(.08,Math.min(1.8,scale*(e.deltaY<0?1.1:.9)));panX=mx-(mx-panX)*(scale/old);panY=my-(my-panY)*(scale/old);applyTransform()};
world.addEventListener('dragstart',function(e){e.preventDefault()});document.getElementById('build').onclick=requestBuild;document.getElementById('reload').onclick=function(){vscode.postMessage({type:'reload'})};document.getElementById('pick').onclick=function(){vscode.postMessage({type:'pickRegistry',requestId:++pickRequest,registry:'minecraft:item',current:target.value,title:'KubeVS — select a result'})};document.getElementById('fit').onclick=function(){fitGraph(true)};document.getElementById('reset').onclick=function(){positions.clear();localStorage.removeItem('kubevs.graph.positions');localStorage.removeItem('kubevs.graph.view');if(latestTree)renderTree(latestTree)};document.getElementById('zoom').onclick=function(){scale=1;applyTransform()};document.getElementById('viewMode').onchange=function(){setPresentation(this.value,true)};target.onkeydown=function(e){if(e.key==='Enter')requestBuild()};restorePositions();applyTransform();let initialPresentation=defaultPresentation;try{initialPresentation=localStorage.getItem(presentationKey)||defaultPresentation}catch{}setPresentation(initialPresentation,false);
setInterval(function(){document.querySelectorAll('img[data-tag-id]').forEach(function(img){const members=tagMembers.get(img.dataset.tagId)||[];if(members.length<2)return;let next=members[Math.floor(Math.random()*members.length)];if(next===img.dataset.iconId)next=members[(members.indexOf(next)+1)%members.length];img.dataset.iconId=next;const src=iconSources.get(next);if(src)setIcon(img,src);else queueIcon(next)})},900);window.addEventListener('message',function(event){const m=event.data;if(m.type==='loading'){clearResourceResult();statusEl.className='status loading';statusEl.textContent='Loading recipe snapshot…';refreshStatusVisibility()}else if(m.type==='catalog'){document.getElementById('recipeCount').textContent=m.recipes.toLocaleString('en-US');statusEl.className='status';statusEl.textContent=m.recipes.toLocaleString('en-US')+' recipes · '+(m.source==='live'?'Minecraft live':'Offline snapshot');refreshStatusVisibility();requestBuild()}else if(m.type==='tree'){tagMembers.clear();Object.entries(m.tagMembers||{}).forEach(function(v){tagMembers.set(v[0],v[1]);v[1].forEach(queueIcon)});if(document.body.classList.contains('resources-only')){latestTree=m.tree;updateResourceWarning(m.tree)}else renderTree(m.tree);renderTotals(m.totals);statusEl.className='status';statusEl.textContent=flat.length+' nodes'+(flat.length>300?' · wires update after drop':'');refreshStatusVisibility()}else if(m.type==='icons'){Object.entries(m.icons).forEach(function(v){iconSources.set(v[0],v[1]);document.querySelectorAll('[data-icon-id="'+CSS.escape(v[0])+'"]').forEach(function(img){setIcon(img,v[1])})})}else if(m.type==='registryPicked'&&m.requestId===pickRequest&&m.value){target.value=m.value;requestBuild()}else if(m.type==='error'){clearResourceResult();statusEl.className='status error';statusEl.textContent=m.message;refreshStatusVisibility();empty.hidden=false;empty.textContent='The graph is unavailable. Connect Minecraft or refresh the snapshot.'}});

document.getElementById('resourcesToggle').onclick=function(){const on=document.body.classList.toggle('show-resources');this.setAttribute('aria-expanded',String(on));if(on){document.body.classList.remove('show-inspector');document.getElementById('inspectorToggle').setAttribute('aria-expanded','false')}};
document.getElementById('inspectorToggle').onclick=function(){const on=document.body.classList.toggle('show-inspector');this.setAttribute('aria-expanded',String(on));if(on){document.body.classList.remove('show-resources');document.getElementById('resourcesToggle').setAttribute('aria-expanded','false')}};
document.getElementById('copyResources').onclick=function(){if(!latestTotals)return;const lines=Object.entries(latestTotals.items).map(function(v){return format(v[1])+' × '+v[0]}).concat(Object.entries(latestTotals.fluids).map(function(v){return format(v[1])+' mB '+v[0]}));vscode.postMessage({type:'copyCode',code:lines.join('\\n')})};
window.addEventListener('message',function(e){if(e.data.type==='copied'){statusEl.textContent='Resources copied';refreshStatusVisibility()}});

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
