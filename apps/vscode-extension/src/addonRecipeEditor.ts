import * as vscode from 'vscode';
import {
  generateAddonRecipe,
  isAddonRecipeDraft,
  type AddonRecipeDraft,
  type AddonRecipeType,
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
    'KubeVS — рецепты модов',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = createNonce();
  panel.webview.onDidReceiveMessage(
    async (value: unknown) => {
      if (await handleRegistryPickMessage(value, panel.webview, registryCatalog)) return;
      if (await handleRegistryIconMessage(value, panel.webview, registryCatalog)) return;
      if (!isAddonRecipeMessage(value)) return;
      try {
        const namespace = value.draft.type.split(':', 1)[0] ?? '';
        if (availableIntegrations && !availableIntegrations.has(namespace)) {
          throw new Error(
            `Мод ${namespace} не установлен на подключённом сервере. Этот рецепт нельзя сохранить.`,
          );
        }
        const code = generateAddonRecipe(value.draft);
        if (value.type === 'preview') {
          await panel.webview.postMessage({ type: 'preview', revision: value.revision, code });
          return;
        }
        const target = await generatedCraftTarget(
          value.draft.recipeId,
          value.draft.type,
          'addon_recipe',
        );
        const written = await writeFileWithDiff(context, target, code, {
          diffTitle: 'KubeVS: текущий файл ↔ новый рецепт мода',
          confirmation: `Перезаписать ${vscode.workspace.asRelativePath(target)}? Сначала проверьте открытый diff.`,
          confirmButton: 'Перезаписать',
        });
        if (!written) {
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

function addonRecipeEditorHtml(
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
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>KubeVS — редактор рецептов модов</title>
  <!-- THESIS: сложный рецепт читается как производственная линия, а не как JSON-анкета.
       OWN-WORLD: нативные поверхности VS Code, медь Create, сталь Oritech и тёплый акцент кухни.
       STORY: выбрать машину, собрать входы и выходы, увидеть точный код, безопасно сохранить.
       FIRST VIEWPORT: навигация слева, рабочая линия в центре, доказательство кодом справа.
       FORM: плотное операторское рабочее место, продолжающее существующий KubeVS Dashboard. -->
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
  </style>
</head>
<body>
  <header>
    <div><h1>Рецепты модов</h1><div class="subtitle">Create · Oritech · Farmer’s Delight</div></div>
    <button class="save" id="save" type="button">Сохранить рецепт</button>
  </header>
  <main>
    <nav aria-label="Тип рецепта">
      <div class="mod-group"><div class="mod-name">CREATE</div>
        ${typeButtons(
          [
            ['create:pressing', 'Механическое прессование'],
            ['create:crushing', 'Дробление колёсами'],
            ['create:milling', 'Помол на жерновах'],
            ['create:mixing', 'Механическое смешивание'],
            ['create:compacting', 'Прессование в бассейне'],
            ['create:cutting', 'Механическая резка'],
            ['create:deploying', 'Установка манипулятором'],
            ['create:sequenced_assembly', 'Последовательная сборка'],
          ],
          availableIntegrations,
        )}
      </div>
      <div class="mod-group"><div class="mod-name">ORITECH</div>
        ${typeButtons(
          [
            ['oritech:assembler', 'Сборка в ассемблере'],
            ['oritech:pulverizer', 'Измельчение в пульверизаторе'],
            ['oritech:grinder', 'Измельчение в дробилке'],
            ['oritech:centrifuge', 'Разделение в центрифуге'],
            ['oritech:foundry', 'Плавка в литейной'],
            ['oritech:atomic_forge', 'Обработка в атомной кузнице'],
          ],
          availableIntegrations,
        )}
      </div>
      <div class="mod-group"><div class="mod-name">FARMER’S DELIGHT</div>
        ${typeButtons(
          [
            ['farmersdelight:cooking', 'Приготовление в котле'],
            ['farmersdelight:cutting', 'Нарезка на доске'],
          ],
          availableIntegrations,
        )}
      </div>
    </nav>
    <section class="workspace">
      <div class="fields">
        <label>ID рецепта<span class="id-editor"><input id="recipeId" value="" readonly spellcheck="false"><button id="editRecipeId" class="mini" type="button">Изменить</button></span><span class="help">Создаётся автоматически; короткий отпечаток отличает альтернативные рецепты.</span></label>
        <label>Тип машины<input id="selectedType" value="create:pressing" readonly></label>
      </div>
      <div class="section">
        <div class="section-head"><div><h2>Предметные ингредиенты</h2><span class="help">Один ID предмета или #тег на строку</span></div><button class="secondary" data-pick-for="ingredients" data-pick-mode="append" data-include-tags="true" type="button">⌕ Добавить предмет</button></div>
        <textarea id="ingredients" aria-label="Предметные ингредиенты, по одному на строку" spellcheck="false">minecraft:iron_ingot</textarea>
      </div>
      <div class="section" id="fluidInputsSection" hidden>
        <div class="section-head"><div><h2>Жидкостные ингредиенты</h2><span class="help">Объём задаётся в миллибакетах: 1 ведро = 1000 mB</span></div><button class="secondary" id="addFluidInput" type="button">Добавить жидкость</button></div>
        <div class="row-legend fluid-legend"><span>Жидкость или #тег</span><span>Объём, mB</span><span></span></div>
        <div id="fluidInputs"></div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Предметные результаты</h2><button class="secondary" id="addOutput" type="button">Добавить предмет</button></div>
        <div class="row-legend"><span>Предмет</span><span>Штук</span><span>Шанс / вес</span><span></span></div>
        <div id="outputs"></div>
      </div>
      <div class="section" id="fluidOutputsSection" hidden>
        <div class="section-head"><div><h2>Жидкостные результаты</h2><span class="help">Результатом должна быть конкретная жидкость, не тег</span></div><button class="secondary" id="addFluidOutput" type="button">Добавить жидкость</button></div>
        <div class="row-legend fluid-legend"><span>Жидкость</span><span>Объём, mB</span><span></span></div>
        <div id="fluidOutputs"></div>
      </div>
      <div class="section" id="optionsSection">
        <div class="section-head"><h2>Параметры машины</h2></div>
        <div class="options">
          <label>Время обработки, тики<input id="processingTime" type="number" min="1" step="1" value="100"></label>
          <label>Опыт за приготовление<input id="experience" type="number" min="0" step="0.1" value="0"></label>
          <label>Требуемый нагрев бассейна<select id="heat"><option value="none">Без нагрева</option><option value="heated">Нагрев горелкой</option><option value="superheated">Сверхнагрев</option></select></label>
          <label id="toolLabel">Инструмент<span class="picker with-icon"><img class="field-icon" alt="" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" hidden><input id="tool" value="#minecraft:axes" spellcheck="false"><button class="mini" data-pick-for="tool" data-include-tags="true" type="button" title="Найти инструмент или тег">⌕</button></span></label>
        </div>
      </div>
      <div class="section" id="sequenceSection" hidden>
        <div class="section-head"><h2>Линия последовательной сборки</h2><button class="secondary" id="addStep" type="button">Добавить шаг</button></div>
        <div class="options">
          <label>Переходный предмет<span class="picker with-icon"><img class="field-icon" alt="" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" hidden><input id="transitionalItem" value="create:incomplete_precision_mechanism" spellcheck="false"><button class="mini" data-pick-for="transitionalItem" type="button" title="Найти предмет">⌕</button></span></label>
          <label>Количество циклов<input id="loops" type="number" min="1" step="1" value="5"></label>
        </div>
        <div class="timeline" id="timeline"></div>
      </div>
    </section>
    <section class="preview">
      <h2>Готовый KubeJS</h2>
      <pre id="code"></pre>
      <p class="status" id="status" role="status">Предпросмотр обновляется автоматически.</p>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const types = [...document.querySelectorAll('.type-button')];
    const outputsEl = document.getElementById('outputs');
    const fluidInputsEl = document.getElementById('fluidInputs');
    const fluidOutputsEl = document.getElementById('fluidOutputs');
    const timeline = document.getElementById('timeline');
    const save = document.getElementById('save');
    const recipeId = document.getElementById('recipeId');
    const status = document.getElementById('status');
    const code = document.getElementById('code');
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
      outputsEl.innerHTML = outputs.map((entry, index) => '<div class="output-row" data-output="' + index + '"><span class="picker with-icon">' + iconMarkup(entry.item) + '<input aria-label="ID результата" data-field="item" value="' + esc(entry.item) + '" spellcheck="false"><button class="mini" data-pick-input="true" type="button" title="Найти предмет по имени или ID">⌕</button></span><input aria-label="Количество" data-field="count" type="number" min="1" step="1" value="' + entry.count + '"><input aria-label="Шанс или вес" data-field="chance" type="number" min="0.001" step="0.05" value="' + entry.chance + '"><button class="mini" data-remove-output="' + index + '" title="Удалить результат" type="button">×</button></div>').join('');
      outputsEl.querySelectorAll('.with-icon input').forEach(scheduleIcon);
    }
    function renderFluids(container, entries, output) {
      container.innerHTML = entries.map((entry, index) => '<div class="fluid-row" data-fluid="' + index + '"><span class="picker with-icon">' + iconMarkup(entry.fluid) + '<input aria-label="' + (output ? 'ID жидкостного результата' : 'ID или тег жидкостного ингредиента') + '" data-fluid-field="fluid" data-registry="minecraft:fluid" value="' + esc(entry.fluid) + '" spellcheck="false"><button class="mini" data-pick-input="true" data-registry="minecraft:fluid" data-include-tags="' + (!output) + '" type="button" title="Найти жидкость по имени или ID">⌕</button></span><input aria-label="Объём в миллибакетах" data-fluid-field="amount" type="number" min="1" step="1" value="' + entry.amount + '"><button class="mini" data-remove-fluid="' + index + '" data-fluid-output="' + output + '" title="Удалить жидкость" type="button">×</button></div>').join('');
      container.querySelectorAll('.with-icon input').forEach(scheduleIcon);
    }
    function renderSteps() {
      timeline.innerHTML = steps.map((step, index) => '<div class="step" data-step="' + index + '"><span class="step-index">' + (index + 1) + '</span><select data-step-field="type" aria-label="Операция шага ' + (index + 1) + '"><option value="create:deploying"' + (step.type === 'create:deploying' ? ' selected' : '') + '>Установка</option><option value="create:pressing"' + (step.type === 'create:pressing' ? ' selected' : '') + '>Прессование</option><option value="create:cutting"' + (step.type === 'create:cutting' ? ' selected' : '') + '>Резка</option></select><span class="picker"><input data-step-field="ingredient" aria-label="Дополнительный ингредиент шага ' + (index + 1) + '" value="' + esc(step.ingredient) + '" placeholder="Дополнительный ингредиент" spellcheck="false"' + (step.type === 'create:deploying' ? '' : ' disabled') + '><button class="mini" data-pick-input="true" type="button" title="Найти предмет"' + (step.type === 'create:deploying' ? '' : ' disabled') + '>⌕</button></span><button class="mini" data-move="-1" aria-label="Переместить шаг ' + (index + 1) + ' выше" title="Выше" type="button">↑</button><button class="mini" data-move="1" aria-label="Переместить шаг ' + (index + 1) + ' ниже" title="Ниже" type="button">↓</button><button class="mini" data-remove-step="' + index + '" aria-label="Удалить шаг ' + (index + 1) + '" title="Удалить шаг" type="button">×</button></div>').join('');
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
      return {
        type: recipeType,
        recipeId: recipeId.value,
        ingredients: document.getElementById('ingredients').value.split(/\\r?\\n/),
        fluidInputs,
        outputs,
        fluidOutputs,
        processingTime: Number(document.getElementById('processingTime').value),
        experience: Number(document.getElementById('experience').value),
        heat: document.getElementById('heat').value,
        loops: Number(document.getElementById('loops').value),
        transitionalItem: document.getElementById('transitionalItem').value,
        tool: document.getElementById('tool').value,
        sequence: steps,
      };
    }
    function preview() {
      if (busy) return;
      updateRecipeId();
      const next = ++revision;
      vscode.postMessage({ type: 'preview', revision: next, draft: draft() });
    }
    function updateRecipeId() {
      if (!recipeIdAutomatic) return;
      readRows();
      const output = outputsEl.querySelector('[data-field="item"]')?.value.trim() || outputs[0]?.item || '';
      const match = /^([a-z0-9_.-]+):([a-z0-9_./-]+)$/.exec(output);
      const outputPart = match ? (match[1] + '_' + match[2]).replaceAll('/', '_') : 'new_recipe';
      const signature = JSON.stringify({
        type: recipeType,
        ingredients: document.getElementById('ingredients').value.split(/\\r?\\n/).map(value => value.trim()).filter(Boolean),
        fluidInputs,
        outputs,
        fluidOutputs,
        steps,
        heat: document.getElementById('heat').value,
      });
      recipeId.value = 'kubevs:' + outputPart + '_' + recipeType.replace(':', '_') + '_' + shortHash(signature);
    }
    function shortHash(value) {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36).padStart(6, '0').slice(-6);
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
      recipeType = next;
      updateRecipeId();
      document.getElementById('selectedType').value = next;
      types.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.type === next)));
      const sequenced = next === 'create:sequenced_assembly';
      const basinRecipe = next === 'create:mixing' || next === 'create:compacting';
      document.getElementById('sequenceSection').hidden = !sequenced;
      document.getElementById('fluidInputsSection').hidden = !basinRecipe;
      document.getElementById('fluidOutputsSection').hidden = !basinRecipe;
      document.getElementById('toolLabel').hidden = next !== 'farmersdelight:cutting';
      document.getElementById('experience').closest('label').hidden = next !== 'farmersdelight:cooking';
      document.getElementById('heat').closest('label').hidden = next !== 'create:mixing' && next !== 'create:compacting';
      preview();
    }
    document.addEventListener('click', event => {
      if (event.target.id === 'editRecipeId') {
        recipeIdAutomatic = !recipeIdAutomatic;
        recipeId.readOnly = recipeIdAutomatic;
        event.target.textContent = recipeIdAutomatic ? 'Изменить' : 'Авто';
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
          vscode.postMessage({type:'pickRegistry',requestId,registry,includeTags:picker.dataset.includeTags==='true',current:input.value,title:fluid ? 'KubeVS — выберите жидкость или тег' : 'KubeVS — выберите предмет или тег'});
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
      if (input instanceof HTMLInputElement) {
        const icon = input.closest('.picker')?.querySelector('.field-icon');
        if (icon) scheduleIcon(input);
      }
      preview();
    });
    document.addEventListener('change', event => { if (event.target.matches('[data-step-field="type"]')) { readRows(); renderSteps(); } preview(); });
    save.addEventListener('click', () => {
      if (busy) return; const snapshot = draft(); setBusy(true); save.textContent = 'Сохранение…'; status.textContent = 'Сохраняем в kubevs/crafts/' + recipeType.split(':')[0] + '…';
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
      else if (message.type === 'preview' && message.revision === revision && message.revision >= appliedRevision) { appliedRevision = message.revision; code.textContent = message.code; status.className = 'status'; status.textContent = 'Рецепт готов к сохранению.'; }
      else if (message.type === 'previewError' && message.revision === revision && message.revision >= appliedRevision) { appliedRevision = message.revision; code.textContent = '// ' + message.message; status.className = 'status error'; status.textContent = message.message; }
      else if (message.type === 'saved') { setBusy(false); save.textContent = 'Сохранить рецепт'; status.className = 'status'; status.textContent = 'Сохранено: ' + message.path; preview(); }
      else if (message.type === 'error') { setBusy(false); save.textContent = 'Сохранить рецепт'; status.className = 'status error'; status.textContent = message.message; preview(); }
      else if (message.type === 'cancelled') { setBusy(false); save.textContent = 'Сохранить рецепт'; status.className = 'status'; status.textContent = 'Сохранение отменено, файлы не изменены.'; preview(); }
    });
    renderOutputs(); renderFluids(fluidInputsEl, fluidInputs, false); renderFluids(fluidOutputsEl, fluidOutputs, true); renderSteps();
    document.querySelectorAll('.with-icon input').forEach(scheduleIcon);
    updateRecipeId();
    selectType(recipeType);
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
      return `<button class="type-button" type="button" data-type="${type}" aria-pressed="${index === 0 && type === 'create:pressing' ? 'true' : 'false'}"${available ? '' : ` disabled title="Мод ${namespace} не установлен"`}>${label}${available ? '' : ' · недоступно'}</button>`;
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
