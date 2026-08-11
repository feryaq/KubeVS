import * as vscode from 'vscode';
import { generateKubeJs, importRecipeJson } from '@kubevs/recipe-model';
import type { RegistryCatalog } from './registryCatalog.js';
import { generatedCraftTarget } from './generatedTarget.js';
import { handleRegistryIconMessage, handleRegistryPickMessage } from './registryWebview.js';
import { writeFileWithDiff } from './safeWrite.js';

interface RecipeEditorMessage {
  readonly type: 'preview' | 'save';
  readonly revision: number;
  readonly kind: 'shaped' | 'shapeless' | 'smelting' | 'blasting' | 'smoking' | 'campfire_cooking';
  readonly recipeId: string;
  readonly output: string;
  readonly count: number;
  readonly experience: number;
  readonly cookingTime: number;
  readonly slots: readonly string[];
}

export function openRecipeEditor(
  context: vscode.ExtensionContext,
  registryCatalog: RegistryCatalog,
): void {
  const panel = vscode.window.createWebviewPanel(
    'kubevs.recipeEditor',
    'KubeVS Recipe Editor',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = createNonce();
  panel.webview.onDidReceiveMessage(
    async (value: unknown) => {
      if (await handleRegistryPickMessage(value, panel.webview, registryCatalog)) return;
      if (await handleRegistryIconMessage(value, panel.webview, registryCatalog)) return;
      if (!isRecipeEditorMessage(value)) return;
      try {
        if (value.type === 'preview') {
          await panel.webview.postMessage({
            type: 'preview',
            revision: value.revision,
            code: vanillaRecipeCode(value),
          });
          return;
        }
        const target = await saveVanillaRecipeDraft(context, value);
        if (target) {
          await panel.webview.postMessage({
            type: 'saved',
            path: vscode.workspace.asRelativePath(target),
          });
        } else {
          await panel.webview.postMessage({ type: 'cancelled' });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await panel.webview.postMessage({
          type: value.type === 'preview' ? 'previewError' : 'error',
          revision: value.revision,
          message,
        });
      }
    },
    undefined,
    context.subscriptions,
  );
  panel.webview.html = recipeEditorHtml(panel.webview, nonce);
}

export async function saveVanillaRecipeDraft(
  context: vscode.ExtensionContext,
  value: unknown,
): Promise<vscode.Uri | undefined> {
  if (!isRecipeEditorMessage(value) || value.type !== 'save') {
    throw new Error('Invalid Vanilla recipe draft.');
  }
  const target = await generatedCraftTarget(value.recipeId, 'minecraft:crafting', 'recipe');
  const written = await writeFileWithDiff(context, target, vanillaRecipeCode(value), {
    diffTitle: 'KubeVS recipe: current ↔ proposed',
    confirmation: `Replace ${vscode.workspace.asRelativePath(target)}? Review the open diff first.`,
  });
  return written ? target : undefined;
}

function vanillaRecipeCode(value: RecipeEditorMessage): string {
  const recipe = importRecipeJson(value.recipeId.trim() || undefined, recipeJson(value));
  const errors = recipe.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.message).join(' '));
  }
  return wrapRecipe(generateKubeJs(recipe.recipe));
}

function recipeJson(message: RecipeEditorMessage): Readonly<Record<string, unknown>> {
  const cooking = message.kind !== 'shaped' && message.kind !== 'shapeless';
  const ingredients = (cooking ? message.slots.slice(0, 1) : message.slots)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (ingredients.length === 0) throw new Error('Add at least one ingredient.');
  const result = { id: message.output.trim(), count: message.count };
  if (message.kind === 'shapeless') {
    return { type: 'minecraft:crafting_shapeless', ingredients, result };
  }
  if (message.kind !== 'shaped') {
    return {
      type: `minecraft:${message.kind}`,
      ingredient: ingredients[0],
      result,
      experience: message.experience,
      cookingtime: message.cookingTime,
    };
  }

  const symbols = new Map<string, string>();
  const alphabet = 'ABCDEFGHI';
  const pattern = Array.from({ length: 3 }, (_, row) =>
    message.slots
      .slice(row * 3, row * 3 + 3)
      .map((entry) => {
        const ingredient = entry.trim();
        if (!ingredient) return ' ';
        let symbol = symbols.get(ingredient);
        if (!symbol) {
          symbol = alphabet[symbols.size] ?? '';
          symbols.set(ingredient, symbol);
        }
        return symbol;
      })
      .join(''),
  );
  while (pattern.at(-1)?.trim().length === 0) pattern.pop();
  const key = Object.fromEntries([...symbols].map(([ingredient, symbol]) => [symbol, ingredient]));
  return { type: 'minecraft:crafting_shaped', pattern, key, result };
}

function wrapRecipe(expression: string): string {
  return `ServerEvents.recipes(event => {\n${expression
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')}\n})\n`;
}

function isRecipeEditorMessage(value: unknown): value is RecipeEditorMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RecipeEditorMessage>;
  return (
    (message.type === 'preview' || message.type === 'save') &&
    typeof message.revision === 'number' &&
    Number.isSafeInteger(message.revision) &&
    message.revision >= 0 &&
    (message.kind === 'shaped' ||
      message.kind === 'shapeless' ||
      message.kind === 'smelting' ||
      message.kind === 'blasting' ||
      message.kind === 'smoking' ||
      message.kind === 'campfire_cooking') &&
    typeof message.recipeId === 'string' &&
    typeof message.output === 'string' &&
    typeof message.count === 'number' &&
    Number.isSafeInteger(message.count) &&
    message.count >= 1 &&
    message.count <= 64 &&
    typeof message.experience === 'number' &&
    Number.isFinite(message.experience) &&
    message.experience >= 0 &&
    typeof message.cookingTime === 'number' &&
    Number.isSafeInteger(message.cookingTime) &&
    message.cookingTime >= 1 &&
    Array.isArray(message.slots) &&
    message.slots.length === 9 &&
    message.slots.every((entry) => typeof entry === 'string')
  );
}

function recipeEditorHtml(webview: vscode.Webview, nonce: string): string {
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    'img-src data:',
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>KubeVS Recipe Editor</title>
  <style>
    /* THESIS: Recipe structure stays visible at all times; this is an IDE workbench, not a form wizard.
       OWN-WORLD: Native VS Code surfaces with a restrained crafting-table amber and precise slot geometry.
       STORY: Choose a recipe, compose ingredients, verify readable code, then save through a safe diff.
       FIRST VIEWPORT: Controls left, tactile 3x3 work area center, generated-code proof on the right.
       FORM: Dense three-pane operator workspace inherited from KubeVS Dashboard and VS Code. */
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.45 var(--vscode-font-family); }
    button, input { font: inherit; }
    header { min-height: 58px; display: flex; align-items: center; gap: 18px; padding: 10px 20px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-titleBar-activeBackground); }
    .identity { min-width: 190px; }
    h1 { margin: 0; font-size: 16px; letter-spacing: -.01em; }
    .subtitle, .hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .types { display: flex; flex-wrap: wrap; padding: 2px; background: var(--vscode-input-background); }
    .types button { min-height: 28px; padding: 4px 11px; border: 0; color: var(--vscode-foreground); background: transparent; cursor: pointer; }
    .types button[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .save { margin-left: auto; min-height: 32px; padding: 5px 14px; border: 1px solid transparent; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    .save:hover, .types button[aria-pressed="true"]:hover { background: var(--vscode-button-hoverBackground); }
    .save:disabled { opacity: .55; cursor: default; }
    button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    main { min-height: calc(100vh - 58px); display: grid; grid-template-columns: minmax(210px, 260px) minmax(330px, 1fr) minmax(300px, .9fr); }
    aside, section { min-width: 0; padding: 22px; }
    aside { border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .workbench { display: grid; align-content: start; justify-items: center; gap: 24px; }
    .preview { border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
    h2 { margin: 0 0 16px; font-size: 13px; font-weight: 600; }
    label { display: grid; gap: 5px; margin-bottom: 16px; font-size: 12px; }
    input { width: 100%; min-height: 30px; padding: 4px 7px; border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); background: var(--vscode-input-background); }
    input::placeholder { color: var(--vscode-input-placeholderForeground); }
    .row { display: grid; grid-template-columns: 1fr 72px; gap: 10px; }
    .id-editor { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; }
    .picker { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; }
    .picker.has-icon { grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; }
    .item-icon { width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated; }
    .item-icon[hidden] { display: none; }
    .pick { min-width: 34px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
    .ingredient-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .ingredient-toolbar h2 { margin: 0; }
    .crafting { position: relative; width: min(270px, 100%); display: grid; grid-template-columns: repeat(3, minmax(56px, 78px)); gap: 8px; padding: clamp(10px, 5%, 18px); background: color-mix(in srgb, var(--vscode-sideBar-background) 86%, #b88445 14%); box-shadow: 0 8px 24px rgba(0,0,0,.18); overflow: auto; }
    .slot-frame { position: relative; width: 100%; aspect-ratio: 1; min-width: 0; }
    .slot { width: 100%; height: 100%; min-width: 0; padding: 40px 4px 4px; border: 1px solid var(--vscode-panel-border); border-bottom-color: color-mix(in srgb, var(--vscode-panel-border) 70%, #b88445 30%); background: var(--vscode-input-background); text-align: center; font-family: var(--vscode-editor-font-family); font-size: 9px; }
    .slot-icon { position: absolute; z-index: 1; top: 8px; left: 50%; width: 30px; height: 30px; object-fit: contain; image-rendering: pixelated; pointer-events: none; transform: translateX(-50%); }
    .slot-icon[hidden] { display: none; }
    .slot:not(:placeholder-shown) { background: color-mix(in srgb, var(--vscode-input-background) 88%, #b88445 12%); }
    .crafting.cooking { grid-template-columns: minmax(64px, 78px); justify-content: center; }
    .crafting.cooking .slot-frame:not(:first-child) { display: none; }
    .cooking-options[hidden] { display: none; }
    .result { width: min(252px, 100%); display: grid; grid-template-columns: 48px 1fr; gap: 12px; align-items: center; padding-top: 4px; }
    .result-mark { width: 48px; height: 48px; display: grid; place-items: center; border: 1px solid var(--vscode-panel-border); background: var(--vscode-input-background); color: #b88445; font-size: 22px; }
    pre { min-height: 260px; margin: 0; padding: 14px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--vscode-panel-border); background: var(--vscode-textCodeBlock-background); font: 12px/1.55 var(--vscode-editor-font-family); }
    .status { min-height: 22px; margin: 10px 0 0; color: var(--vscode-descriptionForeground); }
    .status.error { color: var(--vscode-errorForeground); }
    @media (max-width: 900px) {
      main { grid-template-columns: 220px 1fr; }
      .preview { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--vscode-panel-border); }
    }
    @media (max-width: 620px) {
      header { align-items: flex-start; flex-wrap: wrap; }
      .save { margin-left: 0; }
      main { display: block; }
      aside { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); }
      .crafting { grid-template-columns: repeat(3, minmax(52px, 1fr)); width: 100%; }
      .slot { width: 100%; }
    }
    @media (forced-colors: active) {
      .crafting, .slot, pre, input { border: 1px solid CanvasText; }
      .types button[aria-pressed="true"] { color: HighlightText; background: Highlight; forced-color-adjust: none; }
    }
  </style>
</head>
<body>
  <header>
    <div class="identity"><h1>Vanilla-рецепт</h1><div class="subtitle">Наглядная сетка · читаемый KubeJS · безопасный diff</div></div>
    <div class="types" role="group" aria-label="Тип рецепта">
      <button type="button" data-kind="shaped" aria-pressed="true">Верстак</button>
      <button type="button" data-kind="shapeless" aria-pressed="false">Без формы</button>
      <button type="button" data-kind="smelting" aria-pressed="false">Печь</button>
      <button type="button" data-kind="blasting" aria-pressed="false">Плавильня</button>
      <button type="button" data-kind="smoking" aria-pressed="false">Коптильня</button>
      <button type="button" data-kind="campfire_cooking" aria-pressed="false">Костёр</button>
    </div>
    <button class="save" type="button" id="save">Сохранить рецепт</button>
  </header>
  <main>
    <aside>
      <h2>Параметры рецепта</h2>
      <label>ID рецепта <span class="id-editor"><input id="recipeId" value="" readonly spellcheck="false"><button id="editRecipeId" class="pick" type="button">Изменить</button></span><span class="hint">Создаётся автоматически; короткий отпечаток отличает альтернативные рецепты.</span></label>
      <div class="row">
        <label>Результат <span class="picker has-icon"><img id="outputIcon" class="item-icon" alt="" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" hidden><input id="output" value="minecraft:diamond" spellcheck="false"><button id="pickOutput" class="pick" type="button" title="Найти предмет по имени или ID">⌕</button></span></label>
        <label>Кол-во <input id="count" type="number" min="1" max="64" value="1"></label>
      </div>
      <div class="row cooking-options" id="cookingOptions" hidden>
        <label>Опыт <input id="experience" type="number" min="0" step="0.05" value="0"></label>
        <label>Время, тики <input id="cookingTime" type="number" min="1" step="1" value="200"></label>
      </div>
      <p class="hint">Выберите предмет по имени или ID. Для группы предметов используйте тег вида <strong>#namespace:tag</strong>.</p>
    </aside>
    <section class="workbench" aria-labelledby="ingredientsTitle">
      <div>
        <div class="ingredient-toolbar"><h2 id="ingredientsTitle">Ингредиенты</h2><button id="pickIngredient" class="pick" type="button">⌕ Найти для выбранной ячейки</button></div>
        <div class="crafting" id="grid">
          ${Array.from({ length: 9 }, (_, index) => `<span class="slot-frame"><img class="slot-icon" alt="" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" hidden><input class="slot" aria-label="Ингредиент, ячейка ${index + 1}" placeholder="${index === 0 ? 'minecraft:stone' : 'пусто'}" spellcheck="false"></span>`).join('')}
        </div>
      </div>
      <div class="result"><div class="result-mark" aria-hidden="true">→</div><div><strong id="resultName">minecraft:diamond</strong><div class="hint">Результат рецепта</div></div></div>
    </section>
    <section class="preview">
      <h2>Сгенерированный KubeJS</h2>
      <pre id="code"></pre>
      <p class="status" id="status" role="status" aria-live="polite">Рецепт готов к проверке.</p>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let kind = 'shaped';
    let revision = 0;
    let appliedRevision = -1;
    let busy = false;
    let recipeIdAutomatic = true;
    let pickSequence = 0;
    let iconSequence = 0;
    const pendingPicks = new Map();
    const pendingIcons = new Map();
    const iconTimers = new WeakMap();
    const slots = [...document.querySelectorAll('.slot')];
    const recipeId = document.getElementById('recipeId');
    const output = document.getElementById('output');
    const outputIcon = document.getElementById('outputIcon');
    const count = document.getElementById('count');
    const experience = document.getElementById('experience');
    const cookingTime = document.getElementById('cookingTime');
    const cookingOptions = document.getElementById('cookingOptions');
    const grid = document.getElementById('grid');
    const code = document.getElementById('code');
    const status = document.getElementById('status');
    const save = document.getElementById('save');
    let activeSlot = slots[0];
    slots.forEach(slot => slot.addEventListener('focus', () => { activeSlot = slot; }));
    function pickInto(input, includeTags) {
      const requestId = ++pickSequence;
      const icon = input === output ? outputIcon : input.closest('.slot-frame')?.querySelector('.slot-icon');
      pendingPicks.set(requestId, {input, icon});
      vscode.postMessage({type:'pickRegistry',requestId,registry:'minecraft:item',includeTags,current:input.value,title:'KubeVS — выберите предмет или тег'});
    }
    function updateRecipeId() {
      if (!recipeIdAutomatic) return;
      const match = /^([a-z0-9_.-]+):([a-z0-9_./-]+)$/.exec(output.value.trim());
      const base = match ? (match[1] + '_' + match[2]).replaceAll('/', '_') : 'new_recipe';
      const signature = JSON.stringify({kind, output: output.value.trim(), count: count.value, slots: slots.map(slot => slot.value.trim())});
      recipeId.value = 'kubevs:' + base + '_' + kind + '_' + shortHash(signature);
    }
    function shortHash(value) {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36).padStart(6, '0').slice(-6);
    }
    function iconFor(input) {
      return input === output ? outputIcon : input.closest('.slot-frame')?.querySelector('.slot-icon');
    }
    function scheduleIcon(input) {
      const previousTimer = iconTimers.get(input);
      if (previousTimer) clearTimeout(previousTimer);
      const value = input.value.trim();
      const icon = iconFor(input);
      if (input.dataset.iconId !== value) {
        delete input.dataset.iconId;
        if (icon) { icon.hidden = true; icon.removeAttribute('src'); }
      }
      if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value) || input.dataset.iconId === value) return;
      const timer = setTimeout(() => {
        if (!input.isConnected || input.value.trim() !== value) return;
        const requestId = ++iconSequence;
        pendingIcons.set(requestId, { input, icon, value });
        vscode.postMessage({ type: 'resolveRegistryIcon', requestId, value });
      }, 220);
      iconTimers.set(input, timer);
    }
    document.getElementById('pickOutput').addEventListener('click', () => pickInto(output, false));
    document.getElementById('pickIngredient').addEventListener('click', () => pickInto(activeSlot || slots.find(slot => !slot.value), true));
    document.getElementById('editRecipeId').addEventListener('click', () => {
      recipeIdAutomatic = !recipeIdAutomatic;
      recipeId.readOnly = recipeIdAutomatic;
      document.getElementById('editRecipeId').textContent = recipeIdAutomatic ? 'Изменить' : 'Авто';
      if (recipeIdAutomatic) updateRecipeId();
      else recipeId.focus();
      preview();
    });
    function preview() {
      const nextRevision = ++revision;
      const values = slots.map((slot) => slot.value.trim());
      document.getElementById('resultName').textContent = output.value.trim() || 'Не указан результат';
      const countValue = Number(count.value);
      const cooking = kind !== 'shaped' && kind !== 'shapeless';
      const ingredients = (cooking ? values.slice(0, 1) : values).filter(Boolean);
      const experienceValue = Number(experience.value);
      const cookingTimeValue = Number(cookingTime.value);
      const cookingInvalid = cooking && (!Number.isFinite(experienceValue) || experienceValue < 0 || !Number.isSafeInteger(cookingTimeValue) || cookingTimeValue < 1);
      save.disabled = busy || !output.value.trim() || ingredients.length === 0 || !Number.isSafeInteger(countValue) || countValue < 1 || countValue > 64 || cookingInvalid;
      if (!Number.isSafeInteger(countValue) || countValue < 1 || countValue > 64) {
        appliedRevision = nextRevision;
        code.textContent = '// Количество должно быть целым числом от 1 до 64.';
        return;
      }
      if (cookingInvalid) {
        appliedRevision = nextRevision;
        code.textContent = '// Опыт не может быть отрицательным, а время должно быть целым числом больше нуля.';
        return;
      }
      vscode.postMessage({ type: 'preview', revision: nextRevision, kind, recipeId: recipeId.value, output: output.value, count: countValue, experience: experienceValue, cookingTime: cookingTimeValue, slots: slots.map((slot) => slot.value) });
    }
    document.querySelector('.types').addEventListener('click', (event) => {
      const button = event.target.closest('[data-kind]');
      if (!button) return;
      kind = button.dataset.kind;
      updateRecipeId();
      document.querySelectorAll('[data-kind]').forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
      const cooking = kind !== 'shaped' && kind !== 'shapeless';
      cookingOptions.hidden = !cooking;
      grid.classList.toggle('cooking', cooking);
      slots.forEach((slot, index) => { slot.disabled = cooking && index > 0; });
      if (kind === 'campfire_cooking' && cookingTime.value === '200') cookingTime.value = '600';
      if (kind !== 'campfire_cooking' && cookingTime.value === '600') cookingTime.value = kind === 'blasting' || kind === 'smoking' ? '100' : '200';
      preview();
    });
    document.addEventListener('input', (event) => {
      const input = event.target;
      if (input === output) updateRecipeId();
      if (input instanceof HTMLInputElement && (input === output || input.classList.contains('slot'))) scheduleIcon(input);
      preview();
    });
    save.addEventListener('click', () => {
      if (save.disabled || busy) return;
      busy = true;
      save.disabled = true;
      save.textContent = 'Сохранение…';
      status.className = 'status';
      status.setAttribute('role', 'status');
      status.textContent = 'Сохраняем в kubevs/crafts/vanilla…';
      vscode.postMessage({ type: 'save', revision: ++revision, kind, recipeId: recipeId.value, output: output.value, count: Number(count.value), experience: Number(experience.value), cookingTime: Number(cookingTime.value), slots: slots.map((slot) => slot.value) });
    });
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'registryPicked') {
        const pending = pendingPicks.get(event.data.requestId); pendingPicks.delete(event.data.requestId);
        if (pending && event.data.value) {
          pending.input.value = event.data.value;
          pending.input.dataset.iconId = event.data.value;
          if (pending.icon) {
            pending.icon.hidden = !event.data.icon;
            if (event.data.icon) pending.icon.src = event.data.icon;
            else pending.icon.removeAttribute('src');
          }
          pending.input.dispatchEvent(new Event('input', {bubbles:true}));
          pending.input.focus();
        }
      } else if (event.data?.type === 'registryIcon') {
        const pending = pendingIcons.get(event.data.requestId); pendingIcons.delete(event.data.requestId);
        if (pending && pending.input.isConnected && pending.input.value.trim() === pending.value && event.data.value === pending.value) {
          pending.input.dataset.iconId = pending.value;
          pending.icon.hidden = !event.data.icon;
          if (event.data.icon) pending.icon.src = event.data.icon;
          else pending.icon.removeAttribute('src');
        }
      } else if (event.data?.type === 'preview' && event.data.revision === revision && event.data.revision >= appliedRevision) {
        appliedRevision = event.data.revision;
        code.textContent = event.data.code;
      } else if (event.data?.type === 'previewError' && event.data.revision === revision && event.data.revision >= appliedRevision) {
        appliedRevision = event.data.revision;
        code.textContent = '// ' + event.data.message;
      } else if (event.data?.type === 'saved') {
        busy = false;
        save.textContent = 'Сохранить рецепт';
        preview();
        status.className = 'status';
        status.setAttribute('role', 'status');
        status.textContent = 'Сохранено: ' + event.data.path;
      } else if (event.data?.type === 'error') {
        busy = false;
        save.textContent = 'Сохранить рецепт';
        preview();
        status.className = 'status error';
        status.setAttribute('role', 'alert');
        status.textContent = event.data.message + ' Проверьте значения и повторите сохранение.';
      } else if (event.data?.type === 'cancelled') {
        busy = false;
        save.textContent = 'Сохранить рецепт';
        preview();
        status.className = 'status';
        status.setAttribute('role', 'status');
        status.textContent = 'Сохранение отменено. Файлы не изменены.';
      }
    });
    slots[0].value = 'minecraft:stone';
    updateRecipeId();
    slots.forEach(scheduleIcon);
    scheduleIcon(output);
    preview();
  </script>
</body>
</html>`;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}
