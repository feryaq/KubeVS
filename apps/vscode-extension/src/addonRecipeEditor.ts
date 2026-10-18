import { workbenchCss, editorUtilities, handleWorkbenchMessage } from './workbenchUi.js';
import { recipeWorkbenchCss, recipeWorkbenchHeader } from './recipeWorkbenchUi.js';
import { gregtechAdvancedHtml, gregtechAdvancedScript } from './gregtechRecipeFields.js';
import * as vscode from 'vscode';
import {
  generateAddonRecipe,
  isAddonRecipeDraft,
  type AddonRecipeDraft,
  type AddonRecipeType,
  MAX_MECHANICAL_SIZE,
} from './addonRecipeCore.js';
import type { RegistryCatalog } from './registryCatalog.js';
import { generatedCraftTarget } from './generatedTarget.js';
import { handleRegistryIconMessage, handleRegistryPickMessage } from './registryWebview.js';
import { writeFileWithDiff } from './safeWrite.js';

interface AddonRecipeMessage {
  readonly type: 'preview' | 'save';
  readonly revision: number;
  readonly draft: AddonRecipeDraft;
}

export function openAddonRecipeEditor(
  context: vscode.ExtensionContext,
  registryCatalog: RegistryCatalog,
  availableIntegrations?: ReadonlySet<string>,
): void {
  const panel = vscode.window.createWebviewPanel(
    'kubevs.addonRecipeEditor',
    'KubeVS — Mod Recipes',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = createNonce();
  panel.webview.onDidReceiveMessage(
    async (value: unknown) => {
      if (await handleWorkbenchMessage(value, panel.webview)) return;
      if (await handleRegistryPickMessage(value, panel.webview, registryCatalog)) return;
      if (await handleRegistryIconMessage(value, panel.webview, registryCatalog)) return;
      if (!isAddonRecipeMessage(value)) return;
      try {
        const namespace = value.draft.type.split(':', 1)[0] ?? '';
        if (availableIntegrations && !availableIntegrations.has(namespace)) {
          throw new Error(
            `Mod ${namespace} is not installed on the connected server. This recipe cannot be saved.`,
          );
        }
        const code = generateAddonRecipe(value.draft);
        if (value.type === 'preview') {
          await panel.webview.postMessage({ type: 'preview', revision: value.revision, code });
          return;
        }
        const target = await saveAddonRecipeDraft(context, value.draft, availableIntegrations);
        if (!target) {
          await panel.webview.postMessage({ type: 'cancelled' });
          return;
        }
        await panel.webview.postMessage({
          type: 'saved',
          path: vscode.workspace.asRelativePath(target),
        });
      } catch (error) {
        await panel.webview.postMessage({
          type: value.type === 'preview' ? 'previewError' : 'error',
          revision: value.revision,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    undefined,
    context.subscriptions,
  );
  panel.webview.html = addonRecipeEditorHtml(panel.webview, nonce, availableIntegrations);
}

export async function saveAddonRecipeDraft(
  context: vscode.ExtensionContext,
  draft: AddonRecipeDraft,
  availableIntegrations?: ReadonlySet<string>,
): Promise<vscode.Uri | undefined> {
  const code = generateAddonRecipe(draft);
  const namespace = draft.type.split(':', 1)[0] ?? '';
  if (availableIntegrations && !availableIntegrations.has(namespace)) {
    throw new Error(
      `Mod ${namespace} is not installed on the connected server. This recipe cannot be saved.`,
    );
  }
  const target = await generatedCraftTarget(draft.recipeId, draft.type, 'addon_recipe');
  const written = await writeFileWithDiff(context, target, code, {
    diffTitle: 'KubeVS: current file ↔ new mod recipe',
    confirmation: `Overwrite ${vscode.workspace.asRelativePath(target)}? Review the open diff first.`,
    confirmButton: 'Overwrite',
  });
  return written ? target : undefined;
}

function isAddonRecipeMessage(value: unknown): value is AddonRecipeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<AddonRecipeMessage>;
  if (
    (message.type !== 'preview' && message.type !== 'save') ||
    !Number.isSafeInteger(message.revision) ||
    (message.revision ?? -1) < 0 ||
    !isAddonRecipeDraft(message.draft)
  ) {
    return false;
  }
  try {
    return JSON.stringify(message.draft).length <= 128 * 1024;
  } catch {
    return false;
  }
}

export function addonRecipeEditorHtml(
  webview: vscode.Webview,
  nonce: string,
  availableIntegrations?: ReadonlySet<string>,
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>KubeVS — Mod Recipe Editor</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.45 var(--vscode-font-family); }
    button, input, select, textarea { font: inherit; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    header { min-height: 60px; display: flex; align-items: center; gap: 18px; padding: 10px 20px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-titleBar-activeBackground); }
    h1 { margin: 0; font-size: 17px; letter-spacing: -.02em; }
    .subtitle, .help, .status { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .save { margin-left: auto; min-height: 32px; padding: 5px 14px; border: 0; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    .save:hover { background: var(--vscode-button-hoverBackground); }
    .save:disabled { opacity: .55; cursor: default; }
    main { min-height: calc(100vh - 60px); display: grid; grid-template-columns: 230px minmax(380px, 1fr) minmax(320px, .85fr); }
    nav, .workspace, .preview { min-width: 0; padding: 20px; }
    nav { border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .preview { border-left: 1px solid var(--vscode-panel-border); }
    h2 { margin: 0 0 12px; font-size: 13px; }
    .mod-group { margin: 0 0 22px; }
    .mod-name { margin-bottom: 6px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 600; }
    .type-button { width: 100%; min-height: 30px; margin: 1px 0; padding: 5px 8px; border: 0; color: var(--vscode-sideBar-foreground); background: transparent; text-align: left; cursor: pointer; }
    .type-button:hover { background: var(--vscode-list-hoverBackground); }
    .type-button[aria-pressed="true"] { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
    .workspace { display: grid; align-content: start; gap: 22px; }
    .fields { display: grid; grid-template-columns: 1fr 150px; gap: 12px; }
    .id-editor { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; }
    label { display: grid; gap: 5px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    input, select, textarea { width: 100%; min-height: 30px; padding: 5px 7px; border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); background: var(--vscode-input-background); }
    .picker { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; }
    .picker.with-icon { grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; }
    .field-icon { width: 30px; height: 30px; object-fit: contain; image-rendering: pixelated; }
    .field-icon[hidden] { display: none; }
    .picker > input, .picker > textarea { min-width: 0; }
    textarea { min-height: 104px; resize: vertical; font-family: var(--vscode-editor-font-family); }
    .section { padding-top: 18px; border-top: 1px solid var(--vscode-panel-border); }
    .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .section-head h2 { margin: 0; }
    .secondary, .mini { min-height: 28px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
    .secondary { padding: 4px 10px; }
    .mini { min-width: 28px; padding: 3px 7px; }
    .secondary:hover, .mini:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .output-row { display: grid; grid-template-columns: minmax(190px, 1fr) 72px 88px 32px; gap: 7px; margin-bottom: 7px; }
    .fluid-row { display: grid; grid-template-columns: minmax(190px, 1fr) 112px 32px; gap: 7px; margin-bottom: 7px; }
    .row-legend { display: grid; grid-template-columns: minmax(190px, 1fr) 72px 88px 32px; gap: 7px; margin: 0 0 5px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .fluid-legend { grid-template-columns: minmax(190px, 1fr) 112px 32px; }
    .fluid-mark { width: 30px; height: 30px; display: grid; place-items: center; color: var(--vscode-symbolIcon-colorForeground, var(--vscode-descriptionForeground)); background: var(--vscode-input-background); font-size: 16px; }
    .options { display: grid; grid-template-columns: repeat(3, minmax(110px, 1fr)); gap: 10px; }
    .timeline { position: relative; display: grid; gap: 8px; padding-left: 22px; }
    .timeline::before { content: ""; position: absolute; left: 8px; top: 16px; bottom: 16px; width: 2px; background: #b87333; }
    .step { position: relative; display: grid; grid-template-columns: 30px minmax(130px, .8fr) minmax(180px, 1fr) 32px 32px 32px; gap: 7px; align-items: center; }
    .step-index { position: relative; z-index: 1; width: 26px; height: 26px; display: grid; place-items: center; color: #fff; background: #9a5b28; font-size: 11px; font-weight: 700; }
    .step input:disabled { opacity: .55; }
    pre { min-height: 360px; margin: 0; padding: 14px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--vscode-panel-border); background: var(--vscode-textCodeBlock-background); font: 12px/1.55 var(--vscode-editor-font-family); }
    .status { min-height: 22px; margin-top: 10px; }
    .status.error { color: var(--vscode-errorForeground); }
    [hidden] { display: none !important; }
    @media (max-width: 980px) { main { grid-template-columns: 210px 1fr; } .preview { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--vscode-panel-border); } }
    @media (max-width: 680px) { header { flex-wrap: wrap; } .save { margin-left: 0; } main { display: block; } nav { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } .fields, .options { grid-template-columns: 1fr; } .output-row { grid-template-columns: 1fr 64px 76px 32px; } .fluid-row { grid-template-columns: 1fr 96px 32px; } .row-legend { display: none; } .step { grid-template-columns: 30px 1fr 32px 32px 32px; } .step input { grid-column: 2 / -1; } }
    @media (forced-colors: active) { input, select, textarea, pre, .step-index { border: 1px solid CanvasText; } .timeline::before { background: CanvasText; } }
    ${workbenchCss}
    ${recipeWorkbenchCss}
    .recipe-addon .recipe-rail { min-width: 0; }
    .recipe-addon .recipe-type-search { width: 100%; margin-bottom: 12px; }
    .recipe-addon .mod-group { margin: 0 0 6px; border: 1px solid var(--kvs-line); border-radius: 9px; overflow: hidden; }
    .recipe-addon .mod-group > summary { padding: 9px 11px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 650; letter-spacing: .04em; cursor: pointer; list-style-position: inside; }
    .recipe-addon .mod-group > summary:hover { background: var(--kvs-soft); }
    .recipe-addon .mod-group > summary[data-current]::after { content: attr(data-current); display: block; margin: 2px 0 0 18px; color: var(--vscode-editor-foreground); font-size: 12px; font-weight: 500; letter-spacing: 0; }
    .recipe-addon .mod-group[open] > summary[data-current]::after { display: none; }
    .recipe-addon .recipe-rail .mod-group > .type-button { width: calc(100% - 12px); margin: 2px 6px; padding: 7px 9px; text-align: left; }
    .recipe-addon .recipe-rail .mod-group > .type-button:last-child { margin-bottom: 6px; }
    .recipe-addon .mod-group[hidden] { display: none; }
    .recipe-addon .recipe-context { display: grid; grid-template-columns: minmax(0,1fr); }
    .recipe-addon #selectedType { display: none; }
    .recipe-addon .workspace { gap: 0; grid-template-columns:minmax(0,1fr); }
    .recipe-addon .section { padding: 16px 0; }
    .recipe-addon .section-head { margin-bottom: 10px; }
    .recipe-addon .section-head .help { display: block; margin-top: 2px; }
    .recipe-addon .preview pre { min-height: 0; max-height: min(55vh, 650px); }
    .recipe-addon .preview details > summary { font-size: 12px; font-weight: 600; cursor: pointer; }
    .recipe-addon .preview details > .preview-content { margin-top: 10px; }
    .recipe-addon .advanced-settings { margin-top: 15px; border-top: 1px solid var(--kvs-line); padding-top: 12px; }
    .recipe-addon .advanced-settings > summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
    .recipe-addon .advanced-settings .field-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .recipe-addon .advanced-settings .field-row > * { flex: 1 1 150px; min-width: 0; }
    .recipe-addon .gt-operation {padding:14px 0;border-top:1px solid var(--kvs-line)} .recipe-addon .gt-operation-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:10px}.recipe-addon .gt-operation-fields label{margin:0}.recipe-addon #gtAddOperation{flex:0 0 34px}.recipe-addon #gtOperations { width: 100%; min-height: 90px; font-family: var(--vscode-editor-font-family); }
    @media (max-width: 740px) {
      .recipe-addon .recipe-rail { padding-bottom: 4px; }
      .recipe-addon .mod-group { display: inline-block; width: min(100%, 220px); margin: 0 6px 6px 0; vertical-align: top; }
      .recipe-addon .mod-group > summary { white-space: nowrap; overflow:hidden; text-overflow:ellipsis; }
      .recipe-addon .mod-group[open] { display: block; width: 100%; }
      .recipe-addon .fields, .recipe-addon .options { grid-template-columns: repeat(2,minmax(0,1fr)); }
    }
    @media (max-width: 480px) {
      .recipe-addon .recipe-rail { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 6px; }
      .recipe-addon .recipe-type-search { grid-column: 1 / -1; margin-bottom: 6px; }
      .recipe-addon .mod-group { width: 100%; min-width:0; margin: 0; overflow:hidden; }
      .recipe-addon .mod-group[open] { grid-column: 1 / -1; }
      .recipe-addon .fields, .recipe-addon .options { grid-template-columns: 1fr; }
      .recipe-addon .output-row { grid-template-columns: minmax(0,1fr) 56px 66px 32px; gap: 4px; }
      .recipe-addon .fluid-row { grid-template-columns: minmax(0,1fr) 75px 32px; gap: 4px; }
      .recipe-addon .step { grid-template-columns: 26px minmax(0,1fr) repeat(3,28px); gap: 4px; }
    }
    .gt-tools-mode .mechanical-grid input{text-transform:none}
    #gtTools{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}#gtTools[hidden]{display:none}#gtTools button{font-size:11px;padding:5px 7px}.mechanical-grid{display:grid;gap:4px;max-width:100%;margin:16px 0}.mechanical-grid input{min-width:0;width:100%;height:auto;aspect-ratio:1;text-align:center;padding:0;font-weight:650;font-family:var(--vscode-editor-font-family);text-transform:uppercase}.grid-size{display:flex;align-items:center;gap:7px}.grid-size input{width:52px;min-width:0}.mechanical-key{display:grid;grid-template-columns:24px minmax(0,1fr) 30px;gap:7px;align-items:center;margin:7px 0}.mechanical-key>span:first-child{font-family:var(--vscode-editor-font-family);font-weight:650;text-align:center}.mechanical-mirror{display:flex;align-items:center;gap:8px;margin:14px 0}.mechanical-mirror input{width:auto}.mechanical-mode .output-row{grid-template-columns:minmax(0,1fr) 70px}.mechanical-mode [data-field="chance"],.mechanical-mode [data-remove-output],.mechanical-mode #outputLegend,.mechanical-mode #addOutput{display:none}
  </style>
</head>
<body class="recipe-workbench recipe-addon">
  ${recipeWorkbenchHeader('Mod recipe')}
  <main class="recipe-layout">
    <nav class="recipe-rail" aria-label="Recipe type">
      <input id="typeSearch" class="recipe-type-search" type="search" placeholder="Find a recipe type" aria-label="Find a recipe type" autocomplete="off">
      <details class="mod-group" open><summary>Create</summary>
        ${typeButtons(
          [
            ['create:pressing', 'Mechanical Pressing'],
            ['create:crushing', 'Crushing'],
            ['create:milling', 'Milling'],
            ['create:mixing', 'Mechanical Mixing'],
            ['create:compacting', 'Basin Compacting'],
            ['create:cutting', 'Mechanical Cutting'],
            ['create:deploying', 'Deploying'],
            ['create:mechanical_crafting', 'Mechanical Crafting'],
            ['create:sequenced_assembly', 'Sequenced Assembly'],
          ],
          availableIntegrations,
        )}
      </details>
      <details class="mod-group"><summary>Oritech</summary>
        ${typeButtons(
          [
            ['oritech:assembler', 'Assembler'],
            ['oritech:pulverizer', 'Pulverizer'],
            ['oritech:grinder', 'Grinder'],
            ['oritech:centrifuge', 'Centrifuge'],
            ['oritech:foundry', 'Foundry'],
            ['oritech:atomic_forge', 'Atomic Forge'],
          ],
          availableIntegrations,
        )}
      </details>
      <details class="mod-group"><summary>GregTech CEu</summary>
        ${typeButtons(
          [
            ['gtceu:machine', 'Machine recipe'],
            ['gtceu:shaped', 'Tool crafting'],
          ],
          availableIntegrations,
        )}
      </details>
      <details class="mod-group"><summary>Farmer’s Delight</summary>
        ${typeButtons(
          [
            ['farmersdelight:cooking', 'Cooking Pot'],
            ['farmersdelight:cutting', 'Cutting Board'],
          ],
          availableIntegrations,
        )}
      </details>
    </nav>
    <section class="workspace recipe-editor">
      <div class="fields recipe-context">
        <label>Recipe ID<span class="id-editor"><input id="recipeId" value="" readonly spellcheck="false"><button id="editRecipeId" class="mini" type="button">Edit</button></span></label>
        <input id="selectedType" value="create:pressing" readonly aria-hidden="true" tabindex="-1">
      </div>
      <div class="section" id="itemIngredientsSection">
        <div class="section-head"><h2>Item Ingredients</h2><button class="secondary" data-pick-for="ingredients" data-pick-mode="append" data-include-tags="true" type="button">⌕ Add Item</button></div>
        <textarea id="ingredients" aria-label="Item Ingredients, one per line" title="One item ID or #tag per line" spellcheck="false">minecraft:iron_ingot</textarea>
      </div>
      <div class="section" id="mechanicalSection" hidden>
        <div class="section-head"><h2>Crafting grid</h2><div class="grid-size"><input id="mechanicalWidth" type="number" min="1" max="${MAX_MECHANICAL_SIZE}" value="5" aria-label="Grid width" title="Grid width (1–9)"><span aria-hidden="true">×</span><input id="mechanicalHeight" type="number" min="1" max="${MAX_MECHANICAL_SIZE}" value="5" aria-label="Grid height" title="Grid height (1–9)"></div></div>
        <div id="mechanicalGrid" class="mechanical-grid" role="group" aria-label="Mechanical crafting pattern"></div>
        <div id="mechanicalKeys"></div>
        <button id="addMechanicalKey" class="secondary" type="button">Add ingredient</button>
        <label id="gtMaterialInfoLabel" class="mechanical-mirror" hidden><input id="gtMaterialInfo" type="checkbox">Add recycling data</label>
        <div id="gtTools" hidden></div>
        <label class="mechanical-mirror"><input id="acceptMirrored" type="checkbox">Allow mirrored recipes</label>
        <button id="crushingWheelPreset" class="secondary" type="button" title="Load Create’s 5×5 crushing wheel recipe">Crushing wheels</button>
      </div>
      <div class="section" id="fluidInputsSection" hidden>
        <div class="section-head"><div><h2>Fluid Ingredients</h2><span class="help">Amounts use millibuckets: 1 bucket = 1000 mB</span></div><button class="secondary" id="addFluidInput" type="button">Add Fluid</button></div>
        <div class="row-legend fluid-legend"><span>Fluid or #tag</span><span>Amount, mB</span><span></span></div>
        <div id="fluidInputs"></div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Item Outputs</h2><button class="secondary" id="addOutput" type="button">Add Item</button></div>
        <div class="row-legend" id="outputLegend"><span>Item</span><span>Count</span><span>Chance / Weight</span><span></span></div>
        <div id="outputs"></div>
      </div>
      <div class="section" id="fluidOutputsSection" hidden>
        <div class="section-head"><div><h2>Fluid Outputs</h2><span class="help">The output must be a concrete fluid, not a tag</span></div><button class="secondary" id="addFluidOutput" type="button">Add Fluid</button></div>
        <div class="row-legend fluid-legend"><span>Fluid</span><span>Amount, mB</span><span></span></div>
        <div id="fluidOutputs"></div>
      </div>
      <div class="section" id="optionsSection">
        <div class="section-head"><h2>Machine Settings</h2></div>
        <div class="options">
          <label>Processing time, ticks<input id="processingTime" type="number" min="1" step="1" value="100"></label>
          <label>Cooking experience<input id="experience" type="number" min="0" step="0.1" value="0"></label>
          <label>Required basin heat<select id="heat"><option value="none">No heat</option><option value="heated">Heated</option><option value="superheated">Superheated</option></select></label>
          <label id="toolLabel">Tool<span class="picker with-icon"><img class="field-icon" alt="" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" hidden><input id="tool" value="#minecraft:axes" spellcheck="false"><button class="mini" data-pick-for="tool" data-include-tags="true" type="button" title="Find a tool or tag">⌕</button></span></label>
        </div>
      </div>
      <div class="section" id="gregtechSection" hidden>

        <div class="options">
          <label>Recipe type<input id="gtMachine" value="assembler" spellcheck="false" placeholder="assembler"></label>
          <label>EU/t<input id="gtEUt" type="number" step="1" value="30"></label>
          <label>Circuit (optional)<input id="gtCircuit" type="number" min="0" max="32" step="1" placeholder="0–32"></label>
        </div>
        ${gregtechAdvancedHtml(`<div class="options">
          <label>Y min (optional)<input id="gtYMin" type="number" step="1" placeholder="-64"></label>
          <label>Y max<input id="gtYMax" type="number" step="1" placeholder="320"></label>
        </div>
        <div class="options" style="margin-top:10px;grid-template-columns:repeat(2,minmax(0,1fr))">
          <label title="One item ID or #tag per line">Reusable items<textarea id="gtReusableItems" spellcheck="false"></textarea></label>
          <label title="One fluid ID and amount in mB per line">Reusable fluids<textarea id="gtReusableFluids" spellcheck="false" placeholder="minecraft:water 1000"></textarea></label>
        </div>
`)}
      </div>
      <div class="section" id="sequenceSection" hidden>
        <div class="section-head"><h2>Sequenced Assembly Line</h2><button class="secondary" id="addStep" type="button">Add Step</button></div>
        <div class="options">
          <label>Transitional item<span class="picker with-icon"><img class="field-icon" alt="" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" hidden><input id="transitionalItem" value="create:incomplete_precision_mechanism" spellcheck="false"><button class="mini" data-pick-for="transitionalItem" type="button" title="Find item">⌕</button></span></label>
          <label>Loop count<input id="loops" type="number" min="1" step="1" value="5"></label>
        </div>
        <div class="timeline" id="timeline"></div>
      </div>
    </section>
    <section class="preview recipe-preview">
      <details open><summary>JavaScript</summary><div class="preview-content"><pre id="code"></pre></div></details>
      <p class="status" id="status" role="status">Preview updates automatically.</p>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    ${gregtechAdvancedScript()}
    const types = [...document.querySelectorAll('.type-button')];
    const typeSearch = document.getElementById('typeSearch');
    typeSearch.addEventListener('input', () => {
      const query = typeSearch.value.trim().toLocaleLowerCase();
      for (const group of document.querySelectorAll('.mod-group')) {
        const modName = group.querySelector('summary').textContent.toLocaleLowerCase();
        let matches = 0;
        for (const button of group.querySelectorAll('.type-button')) {
          const visible = !query || modName.includes(query) || button.textContent.toLocaleLowerCase().includes(query) || button.dataset.type.includes(query);
          button.hidden = !visible;
          if (visible) matches++;
        }
        group.hidden = matches === 0;
        if (query && matches) group.open = true;
        else if (!query && matchMedia('(max-width: 700px)').matches) group.open = false;
      }
    });
    const outputsEl = document.getElementById('outputs');
    const fluidInputsEl = document.getElementById('fluidInputs');
    const fluidOutputsEl = document.getElementById('fluidOutputs');
    const timeline = document.getElementById('timeline');
    const save = document.getElementById('save');
    const recipeId = document.getElementById('recipeId');
    const status = document.getElementById('status');
    const code = document.getElementById('code');
    const mechanicalGrid = document.getElementById('mechanicalGrid');
    const mechanicalKeysEl = document.getElementById('mechanicalKeys');
    const gridDrafts = {};
    document.getElementById('itemIngredientsSection').before(document.getElementById('gregtechSection'));
    const gtToolNames = {s:'Saw',h:'Hammer',r:'Soft mallet',w:'Wrench',f:'File',c:'Crowbar',d:'Screwdriver',m:'Mortar',x:'Wire cutter',k:'Knife'};
    for (const [symbol,name] of Object.entries(gtToolNames)) { const button = document.createElement('button'); button.type = 'button'; button.dataset.gtTool = symbol; button.textContent = symbol+' · '+name; button.title = name+' — enter '+symbol+' in a grid slot'; document.getElementById('gtTools').append(button); }
    let mechanicalPattern = [' AAA ', 'AAPAA', 'APSPA', 'AAPAA', ' AAA '];
    let mechanicalKeys = { A: 'create:andesite_alloy', P: '#minecraft:planks', S: '#c:stones' };
    let recipeType = 'create:pressing';
    let revision = 0;
    let appliedRevision = -1;
    let busy = false;
    let recipeIdAutomatic = true;
    let pickSequence = 0;
    let iconSequence = 0;
    const pendingPicks = new Map();
    const pendingIcons = new Map();
    const iconTimers = new WeakMap();
    const iconById = new Map();
    let outputs = [{ item: 'minecraft:iron_plate', count: 1, chance: 1 }];
    let mechanicalOutputs = [{ item: 'create:crushing_wheel', count: 2, chance: 1 }];
    let processingOutputs = outputs;
    let fluidInputs = [];
    let fluidOutputs = [];
    let steps = [
      { type: 'create:deploying', ingredient: 'create:cogwheel' },
      { type: 'create:pressing', ingredient: '' },
    ];
    function esc(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function iconMarkup(value) {
      const icon = iconById.get(value);
      return '<img class="field-icon" alt=""' + (icon ? ' src="' + esc(icon) + '"' : ' hidden') + '>';
    }
    function renderOutputs() {
      outputsEl.innerHTML = outputs.map((entry, index) => '<div class="output-row" data-output="' + index + '"><span class="picker with-icon">' + iconMarkup(entry.item) + '<input aria-label="Output ID" data-field="item" value="' + esc(entry.item) + '" spellcheck="false"><button class="mini" data-pick-input="true" type="button" title="Find an item by name or ID">⌕</button></span><input aria-label="Count" data-field="count" type="number" min="1" step="1" value="' + entry.count + '"><input aria-label="Chance or weight" data-field="chance" type="number" min="0.001" step="0.05" value="' + entry.chance + '"><button class="mini" data-remove-output="' + index + '" title="Remove output" type="button">×</button></div>').join('');
      outputsEl.querySelectorAll('.with-icon input').forEach(scheduleIcon);
    }
    function renderFluids(container, entries, output) {
      container.innerHTML = entries.map((entry, index) => '<div class="fluid-row" data-fluid="' + index + '"><span class="picker with-icon">' + iconMarkup(entry.fluid) + '<input aria-label="' + (output ? 'Fluid output ID' : 'Fluid ingredient ID or tag') + '" data-fluid-field="fluid" data-registry="minecraft:fluid" value="' + esc(entry.fluid) + '" spellcheck="false"><button class="mini" data-pick-input="true" data-registry="minecraft:fluid" data-include-tags="' + (!output) + '" type="button" title="Find a fluid by name or ID">⌕</button></span><input aria-label="Amount in millibuckets" data-fluid-field="amount" type="number" min="1" step="1" value="' + entry.amount + '"><button class="mini" data-remove-fluid="' + index + '" data-fluid-output="' + output + '" title="Remove fluid" type="button">×</button></div>').join('');
      container.querySelectorAll('.with-icon input').forEach(scheduleIcon);
    }
    function renderMechanicalGrid() {
      const width = mechanicalPattern[0].length;
      mechanicalGrid.style.gridTemplateColumns = 'repeat(' + width + ', minmax(0, 1fr))';
      mechanicalGrid.style.width = (width * 40) + 'px';
      mechanicalGrid.innerHTML = mechanicalPattern.flatMap((row, y) => [...row].map((symbol, x) => '<input data-cell="' + (y * width + x) + '" aria-label="Row ' + (y + 1) + ', column ' + (x + 1) + '" title="Ingredient symbol; clear for an empty slot" maxlength="1" placeholder="·" spellcheck="false" value="' + esc(symbol.trim()) + '">')).join('');
    }
    function readMechanical() {
      const width = mechanicalPattern[0].length;
      const cells = [...mechanicalGrid.querySelectorAll('[data-cell]')];
      mechanicalPattern = mechanicalPattern.map((row, y) => [...row].map((_, x) => (recipeType === 'gtceu:shaped' ? cells[y * width + x].value : cells[y * width + x].value.toUpperCase()) || ' ').join(''));
      mechanicalKeys = Object.fromEntries([...mechanicalKeysEl.querySelectorAll('[data-symbol]')].map(row => [row.dataset.symbol, row.querySelector('input').value]));
    }
    function renderMechanicalKeys() {
      mechanicalKeysEl.innerHTML = Object.entries(mechanicalKeys).map(([symbol, ingredient]) => '<div class="mechanical-key" data-symbol="' + symbol + '"><span>' + symbol + '</span><span class="picker with-icon">' + iconMarkup(ingredient) + '<input aria-label="Ingredient ' + symbol + '" value="' + esc(ingredient) + '" spellcheck="false"><button class="mini" data-pick-input="true" data-include-tags="true" type="button" title="Find an item or tag for ' + symbol + '">⌕</button></span><button class="mini" data-remove-key="' + symbol + '" type="button" aria-label="Remove ingredient ' + symbol + '" title="Remove ingredient">×</button></div>').join('');
      mechanicalKeysEl.querySelectorAll('input').forEach(scheduleIcon);
    }
    function resizeMechanicalGrid() {
      readMechanical();
      const widthInput = document.getElementById('mechanicalWidth');
      const heightInput = document.getElementById('mechanicalHeight');
      const width = Math.min(recipeType === 'gtceu:shaped' ? 3 : ${MAX_MECHANICAL_SIZE}, Math.max(1, Math.floor(Number(widthInput.value) || mechanicalPattern[0].length)));
      const height = Math.min(recipeType === 'gtceu:shaped' ? 3 : ${MAX_MECHANICAL_SIZE}, Math.max(1, Math.floor(Number(heightInput.value) || mechanicalPattern.length)));
      widthInput.value = String(width); heightInput.value = String(height);
      // Preserve overlapping cells as the grid dimensions change.
      mechanicalPattern = Array.from({length:height}, (_, y) => (mechanicalPattern[y] || '').padEnd(width, ' ').slice(0, width));
      renderMechanicalGrid();
    }
    function renderSteps() {
      timeline.innerHTML = steps.map((step, index) => '<div class="step" data-step="' + index + '"><span class="step-index">' + (index + 1) + '</span><select data-step-field="type" aria-label="Step operation ' + (index + 1) + '"><option value="create:deploying"' + (step.type === 'create:deploying' ? ' selected' : '') + '>Deploying</option><option value="create:pressing"' + (step.type === 'create:pressing' ? ' selected' : '') + '>Pressing</option><option value="create:cutting"' + (step.type === 'create:cutting' ? ' selected' : '') + '>Cutting</option></select><span class="picker"><input data-step-field="ingredient" aria-label="Additional ingredient for step ' + (index + 1) + '" value="' + esc(step.ingredient) + '" placeholder="Additional ingredient" spellcheck="false"' + (step.type === 'create:deploying' ? '' : ' disabled') + '><button class="mini" data-pick-input="true" type="button" title="Find item"' + (step.type === 'create:deploying' ? '' : ' disabled') + '>⌕</button></span><button class="mini" data-move="-1" aria-label="Move step ' + (index + 1) + ' up" title="Up" type="button">↑</button><button class="mini" data-move="1" aria-label="Move step ' + (index + 1) + ' down" title="Down" type="button">↓</button><button class="mini" data-remove-step="' + index + '" aria-label="Remove step ' + (index + 1) + '" title="Remove step" type="button">×</button></div>').join('');
    }
    function readRows() {
      outputs = [...outputsEl.querySelectorAll('[data-output]')].map(row => ({
        item: row.querySelector('[data-field="item"]').value,
        count: Number(row.querySelector('[data-field="count"]').value),
        chance: Number(row.querySelector('[data-field="chance"]').value),
      }));
      fluidInputs = [...fluidInputsEl.querySelectorAll('[data-fluid]')].map(row => ({
        fluid: row.querySelector('[data-fluid-field="fluid"]').value,
        amount: Number(row.querySelector('[data-fluid-field="amount"]').value),
      }));
      fluidOutputs = [...fluidOutputsEl.querySelectorAll('[data-fluid]')].map(row => ({
        fluid: row.querySelector('[data-fluid-field="fluid"]').value,
        amount: Number(row.querySelector('[data-fluid-field="amount"]').value),
      }));
      steps = [...timeline.querySelectorAll('[data-step]')].map(row => ({
        type: row.querySelector('[data-step-field="type"]').value,
        ingredient: row.querySelector('[data-step-field="ingredient"]').value,
      }));
    }
    function draft() {
      readRows();
      readMechanical();
      const mechanical = ['create:mechanical_crafting','gtceu:shaped'].includes(recipeType);
      const gregtech = recipeType === 'gtceu:machine';
      const lines = id => document.getElementById(id).value.split(/\\r?\\n/).map(value => value.trim()).filter(Boolean);
      const yMin = document.getElementById('gtYMin').value.trim();
      const yMax = document.getElementById('gtYMax').value.trim();
      return {
        type: recipeType,
        recipeId: recipeId.value,
        ingredients: mechanical ? [] : document.getElementById('ingredients').value.split(/\\r?\\n/),
        fluidInputs: mechanical ? [] : fluidInputs,
        outputs,
        fluidOutputs: mechanical ? [] : fluidOutputs,
        processingTime: Number(document.getElementById('processingTime').value),
        experience: Number(document.getElementById('experience').value),
        heat: document.getElementById('heat').value,
        loops: Number(document.getElementById('loops').value),
        transitionalItem: document.getElementById('transitionalItem').value,
        tool: document.getElementById('tool').value,
        sequence: steps,
        ...(mechanical ? {mechanical:{pattern:mechanicalPattern,key:mechanicalKeys,acceptMirrored:document.getElementById('acceptMirrored').checked,addMaterialInfo:document.getElementById('gtMaterialInfo').checked}} : {}),
        ...(gregtech ? {gregtech:{
          machine:document.getElementById('gtMachine').value.trim(),recipeId:recipeId.value,
          itemInputs:lines('ingredients'),fluidInputs,
          itemOutputs:outputs,fluidOutputs,
          nonConsumableItems:lines('gtReusableItems'),
          nonConsumableFluids:lines('gtReusableFluids').map(line => { const match = /^(\\S+)\\s+(\\d+)$/.exec(line); return {fluid:match ? match[1] : line,amount:match ? Number(match[2]) : 0}; }),
          circuit:document.getElementById('gtCircuit').value.trim() === '' ? null : Number(document.getElementById('gtCircuit').value),
          duration:Number(document.getElementById('processingTime').value),eut:document.getElementById('gtEUt').value.trim() === '' ? null : Number(document.getElementById('gtEUt').value),
          posY:yMin || yMax ? {min:Number(yMin),max:Number(yMax)} : null,
          ...gregtechAdvancedDraft(),
        }} : {}),
      };
    }
    function preview() {
      if (busy) return;
      updateRecipeId();
      const next = ++revision;
      vscode.postMessage({ type: 'preview', revision: next, draft: draft() });
    }
    function canonicalPart(value, fallback) {
      const match = /^#?([a-z0-9_.-]+):([a-z0-9_./-]+)/.exec(value.trim());
      if (!match) return fallback;
      const path = match[2].replaceAll('/', '_');
      return match[1] === 'minecraft' ? path : match[1] + '_' + path;
    }
    function updateRecipeId() {
      if (!recipeIdAutomatic) return;
      readRows();
      const output = outputsEl.querySelector('[data-field="item"]')?.value.trim() || outputs[0]?.item || '';
      const ingredients = document.getElementById('ingredients').value.split(/\\r?\\n/).map(value => value.trim()).filter(Boolean);
      const primaryIngredient = ['create:mechanical_crafting','gtceu:shaped'].includes(recipeType) ? Object.values(mechanicalKeys)[0] || '' : ingredients[0] || fluidInputs[0]?.fluid || '';
      const outputPart = canonicalPart(output, 'new_recipe');
      const inputPart = canonicalPart(primaryIngredient, 'material');
      const processPart = recipeType === 'gtceu:machine' ? document.getElementById('gtMachine').value.trim() || 'machine' : recipeType.split(':').at(-1).replaceAll('/', '_');
      recipeId.value = 'kubevs:' + outputPart + '_from_' + processPart + '_' + inputPart;
    }
    function applyIcon(input, icon, source) {
      icon.hidden = !source;
      if (source) icon.src = source;
      else icon.removeAttribute('src');
      input.dataset.iconId = input.value.trim();
    }
    function scheduleIcon(input) {
      const icon = input.closest('.picker')?.querySelector('.field-icon');
      if (!icon) return;
      const previousTimer = iconTimers.get(input);
      if (previousTimer) clearTimeout(previousTimer);
      const value = input.value.trim();
      if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value)) {
        delete input.dataset.iconId;
        icon.hidden = true;
        icon.removeAttribute('src');
        return;
      }
      if (iconById.has(value)) {
        applyIcon(input, icon, iconById.get(value));
        return;
      }
      applyIcon(input, icon, undefined);
      delete input.dataset.iconId;
      const timer = setTimeout(() => {
        if (!input.isConnected || input.value.trim() !== value) return;
        const requestId = ++iconSequence;
        pendingIcons.set(requestId, { input, icon, value });
        vscode.postMessage({ type: 'resolveRegistryIcon', requestId, value });
      }, 220);
      iconTimers.set(input, timer);
    }
    function setBusy(next) {
      busy = next;
      document.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = next; });
      if (!next) { save.disabled = false; renderSteps(); }
    }
    function selectType(next) {
      readRows();
      const wasMechanical = ['create:mechanical_crafting','gtceu:shaped'].includes(recipeType);
      if (next !== recipeType && (next === 'gtceu:shaped' || recipeType === 'gtceu:shaped')) {
        readMechanical();
        gridDrafts[recipeType] = { pattern:mechanicalPattern, key:mechanicalKeys };
        const stored = gridDrafts[next] || (next === 'gtceu:shaped' ? {pattern:['hA ',' A ','   '],key:{A:'minecraft:iron_ingot'}} : {pattern:[' AAA ','AAPAA','APSPA','AAPAA',' AAA '],key:{A:'create:andesite_alloy',P:'#minecraft:planks',S:'#c:stones'}});
        mechanicalPattern = stored.pattern; mechanicalKeys = stored.key;
        document.getElementById('mechanicalWidth').value = String(mechanicalPattern[0].length); document.getElementById('mechanicalHeight').value = String(mechanicalPattern.length);
        renderMechanicalGrid(); renderMechanicalKeys();
      }
      recipeType = next;
      document.getElementById('gtMaterialInfoLabel').hidden = next !== 'gtceu:shaped';
      document.getElementById('gtTools').hidden = next !== 'gtceu:shaped';
      document.getElementById('crushingWheelPreset').hidden = next === 'gtceu:shaped';
      document.getElementById('mechanicalWidth').max = next === 'gtceu:shaped' ? '3' : '${MAX_MECHANICAL_SIZE}';
      document.getElementById('mechanicalHeight').max = next === 'gtceu:shaped' ? '3' : '${MAX_MECHANICAL_SIZE}';
      if (next === 'gtceu:machine' && outputs.length === 1 && outputs[0].item === 'minecraft:iron_plate' && document.getElementById('ingredients').value.trim() === 'minecraft:iron_ingot') {
        outputs = [{ item: 'minecraft:gravel', count: 1, chance: 1 }];
        document.getElementById('ingredients').value = 'minecraft:stone';
        document.getElementById('gtMachine').value = 'macerator';
        document.getElementById('gtEUt').value = '2';
        renderOutputs();
      }
      const mechanical = ['create:mechanical_crafting','gtceu:shaped'].includes(next);
      document.querySelector('.workspace').classList.toggle('mechanical-mode', mechanical);
      document.querySelector('.workspace').classList.toggle('gt-tools-mode', next === 'gtceu:shaped');
      document.getElementById('mechanicalSection').hidden = !mechanical;
      document.getElementById('itemIngredientsSection').hidden = mechanical;
      const gregtech = next === 'gtceu:machine';
      document.getElementById('gregtechSection').hidden = !gregtech;
      if (mechanical !== wasMechanical) {
        if (wasMechanical) mechanicalOutputs = outputs;
        else processingOutputs = outputs;
        outputs = mechanical ? mechanicalOutputs : processingOutputs;
        renderOutputs();
      }
      updateRecipeId();
      document.getElementById('selectedType').value = next;
      types.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.type === next)));
      for (const group of document.querySelectorAll('.mod-group')) {
        const summary = group.querySelector('summary');
        const selected = group.querySelector('.type-button[aria-pressed="true"]');
        if (selected) summary.dataset.current = selected.textContent.replace(' · unavailable', '');
        else delete summary.dataset.current;
      }
      if (matchMedia('(max-width: 700px)').matches) {
        typeSearch.value = '';
        for (const group of document.querySelectorAll('.mod-group')) {
          group.hidden = false;
          group.open = false;
          group.querySelectorAll('.type-button').forEach(button => { button.hidden = false; });
        }
      }
      const sequenced = next === 'create:sequenced_assembly';
      const basinRecipe = next === 'create:mixing' || next === 'create:compacting';
      document.getElementById('sequenceSection').hidden = !sequenced;
      document.getElementById('fluidInputsSection').hidden = !basinRecipe && !gregtech;
      document.getElementById('fluidOutputsSection').hidden = !basinRecipe && !gregtech;
      document.getElementById('toolLabel').hidden = next !== 'farmersdelight:cutting';
      document.getElementById('experience').closest('label').hidden = next !== 'farmersdelight:cooking';
      document.getElementById('heat').closest('label').hidden = next !== 'create:mixing' && next !== 'create:compacting';
      document.getElementById('processingTime').closest('label').hidden = gregtech ? false : !next.startsWith('oritech:') && next !== 'farmersdelight:cooking' && next !== 'create:crushing' && next !== 'create:milling' && next !== 'create:cutting';
      document.getElementById('optionsSection').hidden = mechanical || ![...document.querySelectorAll('#optionsSection label')].some(label => !label.hidden);
      preview();
    }
    document.addEventListener('click', event => {
      if (event.target.dataset.gtTool) { const empty = [...mechanicalGrid.querySelectorAll('input')].find(input => !input.value.trim()) || mechanicalGrid.querySelector('input'); empty.value = event.target.dataset.gtTool; empty.dispatchEvent(new Event('input', {bubbles:true})); empty.focus(); return; }
      if (event.target.id === 'addMechanicalKey') {
        readMechanical();
        const symbol = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].find(value => !(value in mechanicalKeys));
        if (!symbol) return;
        mechanicalKeys[symbol] = ''; renderMechanicalKeys();
        mechanicalKeysEl.querySelector('[data-symbol="' + symbol + '"] input').focus(); preview(); return;
      }
      if (event.target.dataset.removeKey) {
        readMechanical(); delete mechanicalKeys[event.target.dataset.removeKey]; renderMechanicalKeys(); preview(); return;
      }
      if (event.target.id === 'crushingWheelPreset') {
        mechanicalPattern = [' AAA ', 'AAPAA', 'APSPA', 'AAPAA', ' AAA '];
        mechanicalKeys = {A:'create:andesite_alloy',P:'#minecraft:planks',S:'#c:stones'};
        document.getElementById('mechanicalWidth').value = '5'; document.getElementById('mechanicalHeight').value = '5'; document.getElementById('acceptMirrored').checked = false;
        outputs = [{item:'create:crushing_wheel',count:2,chance:1}];
        renderMechanicalGrid(); renderMechanicalKeys(); renderOutputs(); preview(); return;
      }
      if (event.target.id === 'editRecipeId') {
        recipeIdAutomatic = !recipeIdAutomatic;
        recipeId.readOnly = recipeIdAutomatic;
        event.target.textContent = recipeIdAutomatic ? 'Edit' : 'Auto';
        if (recipeIdAutomatic) updateRecipeId();
        else recipeId.focus();
        preview();
        return;
      }
      const picker = event.target.closest('[data-pick-for], [data-pick-input]');
      if (picker) {
        const input = picker.dataset.pickFor ? document.getElementById(picker.dataset.pickFor) : picker.closest('.picker')?.querySelector('input');
        if (input) {
          const requestId = ++pickSequence;
          pendingPicks.set(requestId, {input, append:picker.dataset.pickMode==='append', icon:input.closest('.picker')?.querySelector('.field-icon')});
          const registry = picker.dataset.registry || input.dataset.registry || 'minecraft:item';
          const fluid = registry === 'minecraft:fluid';
          vscode.postMessage({type:'pickRegistry',requestId,registry,includeTags:picker.dataset.includeTags==='true',current:input.value,title:fluid ? 'KubeVS — select a fluid or tag' : 'KubeVS — select an item or tag'});
        }
        return;
      }
      const typeButton = event.target.closest('[data-type]');
      if (typeButton) { selectType(typeButton.dataset.type); return; }
      if (event.target.id === 'addOutput') { readRows(); outputs.push({ item: 'minecraft:stone', count: 1, chance: 1 }); renderOutputs(); preview(); return; }
      if (event.target.id === 'addFluidInput') { readRows(); fluidInputs.push({ fluid: 'minecraft:water', amount: 1000 }); renderFluids(fluidInputsEl, fluidInputs, false); preview(); return; }
      if (event.target.id === 'addFluidOutput') { readRows(); fluidOutputs.push({ fluid: 'minecraft:water', amount: 1000 }); renderFluids(fluidOutputsEl, fluidOutputs, true); preview(); return; }
      if (event.target.id === 'addStep') { readRows(); steps.push({ type: 'create:deploying', ingredient: 'minecraft:iron_ingot' }); renderSteps(); preview(); return; }
      if (event.target.dataset.removeOutput !== undefined) { readRows(); outputs.splice(Number(event.target.dataset.removeOutput), 1); renderOutputs(); preview(); return; }
      if (event.target.dataset.removeFluid !== undefined) {
        readRows();
        const entries = event.target.dataset.fluidOutput === 'true' ? fluidOutputs : fluidInputs;
        entries.splice(Number(event.target.dataset.removeFluid), 1);
        renderFluids(event.target.dataset.fluidOutput === 'true' ? fluidOutputsEl : fluidInputsEl, entries, event.target.dataset.fluidOutput === 'true');
        preview();
        return;
      }
      if (event.target.dataset.removeStep !== undefined) { readRows(); steps.splice(Number(event.target.dataset.removeStep), 1); renderSteps(); preview(); return; }
      if (event.target.dataset.move !== undefined) {
        readRows(); const row = event.target.closest('[data-step]'); const from = Number(row.dataset.step); const to = from + Number(event.target.dataset.move);
        if (to >= 0 && to < steps.length) { [steps[from], steps[to]] = [steps[to], steps[from]]; renderSteps(); preview(); } return;
      }
    });
    document.addEventListener('input', event => {
      const input = event.target;
      if (input.hasAttribute('data-cell') && recipeType !== 'gtceu:shaped') input.value = input.value.toUpperCase();
      if (input instanceof HTMLInputElement) {
        const icon = input.closest('.picker')?.querySelector('.field-icon');
        if (icon) scheduleIcon(input);
      }
      preview();
    });
    document.addEventListener('change', event => { if (event.target.matches('[data-step-field="type"]')) { readRows(); renderSteps(); } if (event.target.id === 'mechanicalWidth' || event.target.id === 'mechanicalHeight') resizeMechanicalGrid(); preview(); });
    save.addEventListener('click', () => {
      if (busy) return; const snapshot = draft(); setBusy(true); save.textContent = 'Saving…'; status.textContent = 'Saving to kubevs/crafts/' + recipeType.split(':')[0] + '…';
      vscode.postMessage({ type: 'save', revision: ++revision, draft: snapshot });
    });
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'registryPicked') {
        const pending = pendingPicks.get(message.requestId); pendingPicks.delete(message.requestId);
        if (pending && message.value) {
          pending.input.value = pending.append && pending.input.value.trim() ? pending.input.value.replace(/\\s*$/, '\\n') + message.value : message.value;
          if (message.icon) iconById.set(message.value, message.icon);
          if (pending.icon) { pending.icon.hidden = !message.icon; if (message.icon) pending.icon.src = message.icon; else pending.icon.removeAttribute('src'); }
          pending.input.dispatchEvent(new Event('input', {bubbles:true}));
          pending.input.focus();
        }
      }
      else if (message.type === 'registryIcon') {
        const pending = pendingIcons.get(message.requestId); pendingIcons.delete(message.requestId);
        if (pending && pending.input.isConnected && pending.input.value.trim() === pending.value && message.value === pending.value) {
          iconById.set(pending.value, message.icon || null);
          applyIcon(pending.input, pending.icon, message.icon);
        }
      }
      else if (message.type === 'preview' && message.revision === revision && message.revision >= appliedRevision) { appliedRevision = message.revision; code.textContent = message.code; status.className = 'status'; status.textContent = 'Recipe is ready to save.'; }
      else if (message.type === 'previewError' && message.revision === revision && message.revision >= appliedRevision) { appliedRevision = message.revision; code.textContent = '// ' + message.message; status.className = 'status error'; status.textContent = message.message; }
      else if (message.type === 'saved') { setBusy(false); save.textContent = 'Save Recipe'; status.className = 'status'; status.textContent = 'Saved: ' + message.path; preview(); }
      else if (message.type === 'error') { setBusy(false); save.textContent = 'Save Recipe'; status.className = 'status error'; status.textContent = message.message; preview(); }
      else if (message.type === 'cancelled') { setBusy(false); save.textContent = 'Save Recipe'; status.className = 'status'; status.textContent = 'Save cancelled; no files were changed.'; preview(); }
    });
    renderOutputs(); renderFluids(fluidInputsEl, fluidInputs, false); renderFluids(fluidOutputsEl, fluidOutputs, true); renderSteps(); renderMechanicalGrid(); renderMechanicalKeys();
    document.querySelectorAll('.with-icon input').forEach(scheduleIcon);
    updateRecipeId();
    if (matchMedia('(max-width: 700px)').matches) document.querySelectorAll('.mod-group').forEach(group => { group.open = false; });
    selectType(recipeType);
    ${editorUtilities()}
  </script>
</body>
</html>`;
}

function typeButtons(
  entries: readonly (readonly [AddonRecipeType, string])[],
  availableIntegrations?: ReadonlySet<string>,
): string {
  return entries
    .map(([type, label], index) => {
      const namespace = type.split(':', 1)[0] ?? '';
      const available = !availableIntegrations || availableIntegrations.has(namespace);
      return `<button class="type-button" type="button" data-type="${type}" aria-pressed="${index === 0 && type === 'create:pressing' ? 'true' : 'false'}"${available ? '' : ` disabled title="Mod ${namespace} is not installed"`}>${label}${available ? '' : ' · unavailable'}</button>`;
    })
    .join('');
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}
