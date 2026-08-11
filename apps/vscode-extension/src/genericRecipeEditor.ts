import * as vscode from 'vscode';
import {
  buildRecipeFromSchema,
  generateKubeJs,
  importRecipeJson,
  type RecipeSchemaDefinition,
} from '@kubevs/recipe-model';
import {
  createRecipeSchemaWatcher,
  loadRecipeSchemas,
  recipeSchemaTemplate,
  schemaDirectory,
  type RecipeSchemaCatalog,
} from './recipeSchemas.js';
import type { RegistryCatalog } from './registryCatalog.js';
import { generatedCraftTarget } from './generatedTarget.js';
import { handleRegistryIconMessage, handleRegistryPickMessage } from './registryWebview.js';
import { writeFileWithDiff } from './safeWrite.js';

interface RecipeValuesMessage {
  readonly type: 'preview' | 'save';
  readonly revision: number;
  readonly schemaId: string;
  readonly recipeId: string;
  readonly values: Readonly<Record<string, unknown>>;
}

type RecipeActionMessage = { readonly type: 'reloadSchemas' } | { readonly type: 'createSchema' };

type GenericRecipeEditorMessage = RecipeValuesMessage | RecipeActionMessage;

export async function openGenericRecipeEditor(
  context: vscode.ExtensionContext,
  registryCatalog: RegistryCatalog,
): Promise<void> {
  let catalog = await loadRecipeSchemas();
  const panel = vscode.window.createWebviewPanel(
    'kubevs.genericRecipeEditor',
    'KubeVS Generic Recipe Editor',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = createNonce();
  let disposed = false;
  let refreshTimer: NodeJS.Timeout | undefined;

  const postCatalog = async (): Promise<void> => {
    try {
      catalog = await loadRecipeSchemas();
      if (!disposed) await panel.webview.postMessage({ type: 'catalog', catalog });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!disposed) await panel.webview.postMessage({ type: 'catalogError', message });
    }
  };
  const scheduleRefresh = (): void => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void postCatalog(), 120);
  };
  let watcher = createRecipeSchemaWatcher(scheduleRefresh);
  const configurationWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('kubevs.recipeSchemas.directory')) return;
    watcher.dispose();
    try {
      watcher = createRecipeSchemaWatcher(scheduleRefresh);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void panel.webview.postMessage({ type: 'catalogError', message });
    }
    void postCatalog();
  });

  panel.onDidDispose(() => {
    disposed = true;
    watcher.dispose();
    configurationWatcher.dispose();
    if (refreshTimer) clearTimeout(refreshTimer);
  });
  panel.webview.onDidReceiveMessage(
    async (value: unknown) => {
      if (await handleRegistryPickMessage(value, panel.webview, registryCatalog)) return;
      if (await handleRegistryIconMessage(value, panel.webview, registryCatalog)) return;
      if (!isGenericRecipeEditorMessage(value)) return;
      try {
        if (value.type === 'reloadSchemas') {
          await postCatalog();
          return;
        }
        if (value.type === 'createSchema') {
          if (await createRecipeSchema(context)) await postCatalog();
          return;
        }

        const entry = catalog.entries.find((candidate) => candidate.schema.id === value.schemaId);
        if (!entry) throw new Error('The selected schema no longer exists. Reload schemas.');
        const code = generateSchemaRecipe(entry.schema, value);
        if (value.type === 'preview') {
          await panel.webview.postMessage({ type: 'preview', revision: value.revision, code });
          return;
        }

        const target = await generatedCraftTarget(
          value.recipeId,
          entry.schema.recipeType ?? value.schemaId,
          'custom_recipe',
        );
        const written = await writeFileWithDiff(context, target, code, {
          diffTitle: 'KubeVS generic recipe: current ↔ proposed',
          confirmation: `Replace ${vscode.workspace.asRelativePath(target)}? Review the open diff first.`,
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
        const message = error instanceof Error ? error.message : String(error);
        await panel.webview.postMessage({
          type: value.type === 'preview' ? 'previewError' : 'error',
          revision: 'revision' in value ? value.revision : undefined,
          message,
        });
      }
    },
    undefined,
    context.subscriptions,
  );
  panel.webview.html = genericRecipeEditorHtml(panel.webview, nonce, catalog);
}

export async function createRecipeSchema(
  context: vscode.ExtensionContext,
): Promise<vscode.Uri | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Open a workspace folder before creating a recipe schema.');
  const directory = vscode.Uri.joinPath(folder.uri, ...schemaDirectory().split('/'));
  await vscode.workspace.fs.createDirectory(directory);
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(directory, 'my-machine.recipe-schema.json'),
    filters: { 'KubeVS Recipe Schema': ['json'] },
    saveLabel: 'Create recipe schema',
    title: 'Create KubeVS recipe schema',
  });
  if (!target) return undefined;
  if (
    target.scheme !== directory.scheme ||
    target.authority !== directory.authority ||
    !target.path.startsWith(`${directory.path}/`)
  ) {
    throw new Error(
      `Recipe schemas must be saved inside ${vscode.workspace.asRelativePath(directory)}.`,
    );
  }

  const written = await writeFileWithDiff(context, target, recipeSchemaTemplate(), {
    diffTitle: 'KubeVS recipe schema: current ↔ template',
    confirmation: `Replace ${vscode.workspace.asRelativePath(target)} with the schema template?`,
  });
  if (!written) return undefined;
  const document = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(document, { preview: false });
  return target;
}

function generateSchemaRecipe(
  schema: RecipeSchemaDefinition,
  message: RecipeValuesMessage,
): string {
  const recipeId = message.recipeId.trim() || undefined;
  const raw = buildRecipeFromSchema(schema, {
    values: message.values,
    ...(recipeId === undefined ? {} : { recipeId }),
  });
  const imported = importRecipeJson(recipeId, raw);
  const errors = imported.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => `${issue.path}: ${issue.message}`).join(' '));
  }
  return wrapRecipe(generateKubeJs(imported.recipe));
}

function wrapRecipe(expression: string): string {
  return `ServerEvents.recipes(event => {\n${expression
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')}\n})\n`;
}

function isGenericRecipeEditorMessage(value: unknown): value is GenericRecipeEditorMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<GenericRecipeEditorMessage>;
  if (message.type === 'reloadSchemas' || message.type === 'createSchema') return true;
  if (message.type !== 'preview' && message.type !== 'save') return false;
  const values = (message as Partial<RecipeValuesMessage>).values;
  if (
    typeof (message as Partial<RecipeValuesMessage>).revision !== 'number' ||
    !Number.isSafeInteger((message as Partial<RecipeValuesMessage>).revision) ||
    ((message as Partial<RecipeValuesMessage>).revision ?? -1) < 0 ||
    typeof (message as Partial<RecipeValuesMessage>).schemaId !== 'string' ||
    typeof (message as Partial<RecipeValuesMessage>).recipeId !== 'string' ||
    typeof values !== 'object' ||
    values === null ||
    Array.isArray(values)
  ) {
    return false;
  }
  const entries = Object.entries(values);
  if (entries.length > 100) return false;
  const valuesMessage = message as Partial<RecipeValuesMessage>;
  if ((valuesMessage.schemaId?.length ?? 0) > 200 || (valuesMessage.recipeId?.length ?? 0) > 300) {
    return false;
  }
  const validEntries = entries.every(
    ([key, entry]) =>
      key.length <= 200 &&
      ((typeof entry === 'string' && entry.length <= 65_536) ||
        typeof entry === 'boolean' ||
        (Array.isArray(entry) &&
          entry.length <= 100 &&
          entry.every((item) => typeof item === 'string' && item.length <= 16_384))),
  );
  if (!validEntries) return false;
  try {
    return JSON.stringify(values).length <= 128 * 1024;
  } catch {
    return false;
  }
}

function genericRecipeEditorHtml(
  webview: vscode.Webview,
  nonce: string,
  catalog: RecipeSchemaCatalog,
): string {
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    'img-src data:',
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  const initialCatalog = jsonForScript(catalog);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>KubeVS Generic Recipe Editor</title>
  <style>
    /* THESIS: A custom recipe is a typed contract, not an unstructured JSON gamble.
       OWN-WORLD: The established VS Code workbench with crafting amber reserved for schema state and actions.
       STORY: Select a trusted schema, complete its contract, inspect canonical KubeJS, then save through diff.
       FIRST VIEWPORT: Schema identity and actions above a catalog, structured field canvas, and code proof.
       FORM: Three-pane operator workbench extending the existing Recipe Editor surface. */
    * { box-sizing: border-box; }
    :root { color-scheme: light dark; }
    body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.45 var(--vscode-font-family); }
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }
    header { min-height: 62px; display: flex; align-items: center; gap: 16px; padding: 10px 20px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-titleBar-activeBackground); }
    .identity { min-width: 220px; }
    h1 { margin: 0; font-size: 16px; letter-spacing: -.01em; }
    .subtitle, .muted, .field-help { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .schema-switcher { min-width: 220px; max-width: 430px; flex: 1; }
    select, input, textarea { width: 100%; border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); background: var(--vscode-input-background); }
    select, input { min-height: 30px; padding: 4px 7px; }
    textarea { min-height: 112px; padding: 7px; resize: vertical; font-family: var(--vscode-editor-font-family); line-height: 1.5; }
    input::placeholder, textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
    button { min-height: 30px; padding: 4px 10px; border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary { min-height: 32px; margin-left: auto; padding-inline: 15px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: .55; cursor: default; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    main { min-height: calc(100vh - 62px); display: grid; grid-template-columns: minmax(220px, 270px) minmax(360px, 1fr) minmax(320px, .9fr); }
    aside, section { min-width: 0; padding: 22px; }
    aside { border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .preview { border-left: 1px solid var(--vscode-panel-border); }
    h2 { margin: 0 0 7px; font-size: 13px; font-weight: 600; }
    .schema-meta { display: grid; gap: 18px; }
    .origin { display: inline-flex; width: fit-content; align-items: center; gap: 6px; margin-top: 10px; padding: 2px 7px; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 11px; }
    .origin::before { content: ""; width: 6px; height: 6px; background: #b88445; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 7px; }
    .errors { margin: 0; padding-left: 18px; color: var(--vscode-errorForeground); font-size: 12px; overflow-wrap: anywhere; }
    .errors:empty { display: none; }
    .form { display: grid; align-content: start; gap: 20px; max-width: 760px; }
    .field { display: grid; gap: 6px; }
    .id-editor { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; }
    .field-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .field-label { font-size: 12px; font-weight: 600; }
    .required { color: #b88445; }
    .kind { color: var(--vscode-descriptionForeground); font: 11px var(--vscode-editor-font-family); }
    .list { display: grid; gap: 7px; }
    .list-row { display: grid; grid-template-columns: minmax(0, 1fr) 30px; gap: 7px; }
    .input-picker { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 7px; align-items: center; }
    .field-icon { width: 30px; height: 30px; object-fit: contain; image-rendering: pixelated; }
    .field-icon[hidden] { display: none; }
    .pick-id { min-width: 34px; padding-inline: 8px; }
    .remove { width: 30px; padding: 0; font-size: 17px; }
    .list-row .remove { grid-column: 2; }
    .add { justify-self: start; }
    .check { display: flex; width: fit-content; align-items: center; gap: 8px; }
    .check input { width: 16px; min-height: 16px; accent-color: var(--vscode-button-background); }
    pre { min-height: 330px; max-height: calc(100vh - 180px); margin: 0; padding: 14px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--vscode-panel-border); background: var(--vscode-textCodeBlock-background); font: 12px/1.55 var(--vscode-editor-font-family); }
    .status { min-height: 22px; margin: 10px 0 0; color: var(--vscode-descriptionForeground); }
    .status.error { color: var(--vscode-errorForeground); }
    .empty { padding: 18px; border: 1px dashed var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
    @media (max-width: 960px) {
      main { grid-template-columns: 230px 1fr; }
      .preview { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--vscode-panel-border); }
      pre { max-height: none; }
    }
    @media (max-width: 660px) {
      header { align-items: stretch; flex-direction: column; }
      .schema-switcher { min-width: 0; max-width: none; }
      button.primary { margin-left: 0; }
      main { display: block; }
      aside { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); }
    }
    @media (forced-colors: active) {
      select, input, textarea, pre, .origin, .empty { border: 1px solid CanvasText; }
      .origin::before { background: Highlight; forced-color-adjust: none; }
    }
  </style>
</head>
<body>
  <header>
    <div class="identity"><h1>Schema Recipe</h1><div class="subtitle">Typed custom JSON · safe generated file</div></div>
    <label class="schema-switcher"><span class="muted">Recipe schema</span><select id="schema"></select></label>
    <button type="button" id="reload">Reload schemas</button>
    <button class="primary" type="button" id="save">Save recipe</button>
  </header>
  <main>
    <aside>
      <div class="schema-meta">
        <div>
          <h2 id="schemaName">Schema</h2>
          <div class="muted" id="schemaDescription"></div>
          <div class="origin" id="schemaOrigin"></div>
        </div>
        <label class="field"><span class="field-label">ID рецепта</span><span class="id-editor"><input id="recipeId" value="" readonly spellcheck="false" placeholder="namespace:recipe_id"><button id="editRecipeId" type="button">Изменить</button></span><span class="field-help">Формируется из результата, процесса и основного ингредиента.</span></label>
        <div>
          <h2>Schema library</h2>
          <div class="toolbar">
            <button type="button" id="newSchema">New schema</button>
          </div>
          <p class="muted">Workspace schemas update automatically from <code id="schemaDirectory"></code>.</p>
          <ul class="errors" id="catalogErrors"></ul>
        </div>
      </div>
    </aside>
    <section>
      <h2>Recipe fields</h2>
      <p class="muted" id="fieldSummary"></p>
      <div class="form" id="form"></div>
    </section>
    <section class="preview">
      <h2>Canonical KubeJS preview</h2>
      <pre id="code"></pre>
      <p class="status" id="status" role="status" aria-live="polite">Ready.</p>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let catalog = ${initialCatalog};
    let selectedId = catalog.entries[0]?.schema.id || '';
    let revision = 0;
    let appliedRevision = -1;
    let busy = false;
    let recipeIdAutomatic = true;
    let pendingCatalog;
    let controlSequence = 0;
    let pickSequence = 0;
    let iconSequence = 0;
    const pendingPicks = new Map();
    const pendingIcons = new Map();
    const iconTimers = new WeakMap();
    const iconById = new Map();
    const state = new Map();
    const schemaSelect = document.getElementById('schema');
    const recipeId = document.getElementById('recipeId');
    const form = document.getElementById('form');
    const code = document.getElementById('code');
    const status = document.getElementById('status');
    const save = document.getElementById('save');

    function selectedEntry() {
      return catalog.entries.find((entry) => entry.schema.id === selectedId);
    }
    function schemaFingerprint(schema) {
      return JSON.stringify(schema);
    }
    function displayValue(field, value) {
      if (value === undefined || value === null) return field.kind === 'boolean' ? false : '';
      if (field.kind === 'json' && typeof value !== 'string') return JSON.stringify(value, null, 2);
      return typeof value === 'boolean' ? value : String(value);
    }
    function initialValues(schema) {
      const values = {};
      for (const field of schema.fields) {
        if (field.multiple) {
          const entries = Array.isArray(field.default) ? field.default : [];
          values[field.path] = entries.map((entry) => displayValue(field, entry));
          if (values[field.path].length === 0 && field.required) values[field.path] = [''];
        } else {
          values[field.path] = displayValue(field, field.default);
        }
      }
      return values;
    }
    function currentValues() {
      const entry = selectedEntry();
      if (!entry) return {};
      const values = {};
      for (const field of entry.schema.fields) {
        if (field.multiple) {
          values[field.path] = [...form.querySelectorAll('[data-path="' + CSS.escape(field.path) + '"]')].map((input) => input.value);
        } else {
          const input = form.querySelector('[data-path="' + CSS.escape(field.path) + '"]');
          values[field.path] = field.kind === 'boolean' ? Boolean(input?.checked) : (input?.value ?? '');
        }
      }
      return values;
    }
    function canonicalPart(value, fallback) {
      const match = typeof value === 'string' ? /^#?([a-z0-9_.-]+):([a-z0-9_./-]+)/.exec(value.trim()) : undefined;
      if (!match) return fallback;
      const path = match[2].replaceAll('/', '_');
      return match[1] === 'minecraft' ? path : match[1] + '_' + path;
    }
    function firstValue(value) {
      return Array.isArray(value) ? value.find(Boolean) : value;
    }
    function updateRecipeId() {
      if (!recipeIdAutomatic) return;
      const entry = selectedEntry();
      if (!entry) return;
      const values = currentValues();
      const outputField = entry.schema.fields.find(field => /(^|\\.)(result|results|output|outputs)(\\.|$)/i.test(field.path));
      const inputField = entry.schema.fields.find(field => /(^|\\.)(ingredient|ingredients|input|inputs)(\\.|$)/i.test(field.path));
      const schemaPart = entry.schema.id.replace(/^[^:]+:/, '').replace(/[^a-z0-9_.-]+/g, '_');
      const outputPart = canonicalPart(firstValue(outputField ? values[outputField.path] : ''), 'new_recipe');
      const inputPart = canonicalPart(firstValue(inputField ? values[inputField.path] : ''), 'material');
      recipeId.value = 'kubevs:' + outputPart + '_from_' + schemaPart + '_' + inputPart;
    }
    function saveState() {
      const entry = selectedEntry();
      if (entry && form.childElementCount > 0) {
        state.set(selectedId, {
          fingerprint: schemaFingerprint(entry.schema),
          values: currentValues()
        });
      }
    }
    function makeInput(field, value, id, accessibleName, helpId) {
      let input;
      if (field.kind === 'enum') {
        input = document.createElement('select');
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = field.required ? 'Select a value' : 'Not set';
        input.append(empty);
        for (const option of field.options || []) {
          const element = document.createElement('option');
          element.value = option;
          element.textContent = option;
          input.append(element);
        }
      } else if (field.kind === 'json') {
        input = document.createElement('textarea');
      } else {
        input = document.createElement('input');
        input.type = field.kind === 'number' || field.kind === 'integer' ? 'number' : 'text';
        if (field.kind === 'integer') input.step = '1';
        input.spellcheck = false;
      }
      input.id = id;
      input.dataset.path = field.path;
      if (accessibleName) input.setAttribute('aria-label', accessibleName);
      if (helpId) input.setAttribute('aria-describedby', helpId);
      if (field.required) {
        input.required = true;
        input.setAttribute('aria-required', 'true');
      }
      if (field.placeholder) input.placeholder = field.placeholder;
      input.value = displayValue(field, value);
      return input;
    }
    function canPickId(field) {
      return field.kind === 'ingredient' || field.kind === 'item_stack' || field.kind === 'resource_id';
    }
    function makePicker(field, input) {
      const wrapper = document.createElement('span');
      wrapper.className = 'input-picker';
      const icon = document.createElement('img');
      icon.className = 'field-icon';
      icon.alt = '';
      icon.hidden = true;
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'pick-id';
      pick.textContent = '⌕';
      pick.title = 'Найти по имени в игре или ID';
      pick.setAttribute('aria-label', 'Найти значение для ' + field.label);
      pick.addEventListener('click', () => {
        const requestId = ++pickSequence;
        pendingPicks.set(requestId, {input, icon});
        vscode.postMessage({
          type: 'pickRegistry',
          requestId,
          registry: field.kind === 'ingredient' || field.kind === 'item_stack' ? 'minecraft:item' : undefined,
          includeTags: field.kind === 'ingredient',
          current: input.value,
          title: 'KubeVS — выберите игровой ID'
        });
      });
      wrapper.append(icon, input, pick);
      scheduleIcon(input, icon);
      return wrapper;
    }
    function applyIcon(input, icon, source) {
      icon.hidden = !source;
      if (source) icon.src = source;
      else icon.removeAttribute('src');
      input.dataset.iconId = input.value.trim();
    }
    function scheduleIcon(input, knownIcon) {
      const icon = knownIcon || input.closest('.input-picker')?.querySelector('.field-icon');
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
      delete input.dataset.iconId;
      icon.hidden = true;
      icon.removeAttribute('src');
      const timer = setTimeout(() => {
        if (!input.isConnected || input.value.trim() !== value) return;
        const requestId = ++iconSequence;
        pendingIcons.set(requestId, { input, icon, value });
        vscode.postMessage({ type: 'resolveRegistryIcon', requestId, value });
      }, 220);
      iconTimers.set(input, timer);
    }
    function renderField(field, values, fieldIndex) {
      const baseId = 'schema-field-' + fieldIndex;
      const labelId = baseId + '-label';
      const helpId = field.description ? baseId + '-help' : undefined;
      const group = document.createElement('div');
      group.className = 'field';
      if (field.multiple) {
        group.setAttribute('role', 'group');
        group.setAttribute('aria-labelledby', labelId);
        if (helpId) group.setAttribute('aria-describedby', helpId);
        if (field.required) group.setAttribute('aria-required', 'true');
      }
      const heading = document.createElement('div');
      heading.className = 'field-heading';
      const label = document.createElement(field.multiple ? 'div' : 'label');
      label.className = 'field-label';
      label.id = labelId;
      if (!field.multiple) label.htmlFor = baseId + '-control';
      label.textContent = field.label;
      if (field.required) {
        const required = document.createElement('span');
        required.className = 'required';
        required.textContent = ' *';
        label.append(required);
      }
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = field.multiple ? field.kind + '[]' : field.kind;
      heading.append(label, kind);
      group.append(heading);
      if (field.kind === 'boolean' && !field.multiple) {
        const checkLabel = document.createElement('label');
        checkLabel.className = 'check';
        const input = document.createElement('input');
        input.id = baseId + '-control';
        input.type = 'checkbox';
        input.dataset.path = field.path;
        input.setAttribute('aria-label', field.label);
        if (helpId) input.setAttribute('aria-describedby', helpId);
        if (field.required) input.setAttribute('aria-required', 'true');
        input.checked = Boolean(values[field.path]);
        const text = document.createElement('span');
        text.textContent = 'Enabled';
        checkLabel.append(input, text);
        group.append(checkLabel);
      } else if (field.multiple) {
        const list = document.createElement('div');
        list.className = 'list';
        const entries = Array.isArray(values[field.path]) ? values[field.path] : [];
        const addRow = (value = '') => {
          const rowNumber = ++controlSequence;
          const row = document.createElement('div');
          row.className = 'list-row';
          const input = makeInput(
            field,
            value,
            baseId + '-value-' + rowNumber,
            field.label + ' value ' + rowNumber,
            helpId
          );
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'remove';
          remove.setAttribute('aria-label', 'Remove ' + field.label + ' value ' + rowNumber);
          remove.textContent = '×';
          remove.addEventListener('click', () => { row.remove(); preview(); });
          if (canPickId(field)) row.append(makePicker(field, input), remove);
          else row.append(input, remove);
          list.append(row);
        };
        entries.forEach(addRow);
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'add';
        add.textContent = 'Add value';
        add.setAttribute('aria-label', 'Add ' + field.label + ' value');
        add.addEventListener('click', () => { addRow(); list.lastElementChild?.querySelector('input,select,textarea')?.focus(); preview(); });
        group.append(list, add);
      } else {
        const input = makeInput(field, values[field.path], baseId + '-control', undefined, helpId);
        group.append(canPickId(field) ? makePicker(field, input) : input);
      }
      if (field.description) {
        const help = document.createElement('div');
        help.id = helpId;
        help.className = 'field-help';
        help.textContent = field.description;
        group.append(help);
      }
      return group;
    }
    function render() {
      const entry = selectedEntry();
      form.replaceChildren();
      if (!entry) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No valid schemas are available.';
        form.append(empty);
        save.disabled = true;
        return;
      }
      const fingerprint = schemaFingerprint(entry.schema);
      const saved = state.get(selectedId);
      const values =
        saved?.fingerprint === fingerprint ? saved.values : initialValues(entry.schema);
      state.set(selectedId, { fingerprint, values });
      document.getElementById('schemaName').textContent = entry.schema.label;
      document.getElementById('schemaDescription').textContent = entry.schema.description || entry.schema.recipeType || 'Dynamic recipe type';
      document.getElementById('schemaOrigin').textContent = entry.builtIn ? 'Built in' : entry.source;
      document.getElementById('fieldSummary').textContent = entry.schema.fields.length + ' typed field' + (entry.schema.fields.length === 1 ? '' : 's') + ' · ' + (entry.schema.recipeType || 'dynamic type');
      entry.schema.fields.forEach((field, index) =>
        form.append(renderField(field, values, index))
      );
      preview();
    }
    function setCatalog(next) {
      saveState();
      catalog = next;
      schemaSelect.replaceChildren();
      for (const entry of catalog.entries) {
        const option = document.createElement('option');
        option.value = entry.schema.id;
        option.textContent = entry.schema.label + (entry.builtIn ? ' · built in' : '');
        schemaSelect.append(option);
      }
      if (!catalog.entries.some((entry) => entry.schema.id === selectedId)) selectedId = catalog.entries[0]?.schema.id || '';
      schemaSelect.value = selectedId;
      document.getElementById('schemaDirectory').textContent = catalog.directory;
      const errors = document.getElementById('catalogErrors');
      errors.replaceChildren();
      for (const message of catalog.errors) {
        const item = document.createElement('li');
        item.textContent = message;
        errors.append(item);
      }
      render();
      status.className = catalog.errors.length ? 'status error' : 'status';
      status.textContent = catalog.errors.length ? catalog.errors.length + ' schema file(s) could not be loaded.' : 'Schema library is current.';
    }
    function preview() {
      const entry = selectedEntry();
      if (!entry || busy) return;
      updateRecipeId();
      const nextRevision = ++revision;
      const values = currentValues();
      state.set(selectedId, {
        fingerprint: schemaFingerprint(entry.schema),
        values
      });
      const hasMissing = entry.schema.fields.some((field) => {
        if (!field.required) return false;
        const value = values[field.path];
        return Array.isArray(value) ? value.filter((item) => item.trim()).length < field.minItems : field.kind !== 'boolean' && String(value ?? '').trim() === '';
      });
      save.disabled = hasMissing;
      if (hasMissing) {
        appliedRevision = nextRevision;
        code.textContent = '// Complete the required schema fields.';
        return;
      }
      vscode.postMessage({ type: 'preview', revision: nextRevision, schemaId: selectedId, recipeId: recipeId.value, values });
    }
    function setBusy(next) {
      busy = next;
      for (const control of document.querySelectorAll('button,input,select,textarea')) {
        control.disabled = next;
      }
      save.textContent = next ? 'Saving…' : 'Save recipe';
      if (next) save.disabled = true;
    }
    function finishOperation() {
      setBusy(false);
      if (pendingCatalog) {
        const next = pendingCatalog;
        pendingCatalog = undefined;
        setCatalog(next);
      } else {
        preview();
      }
    }
    schemaSelect.addEventListener('change', () => {
      saveState();
      selectedId = schemaSelect.value;
      render();
    });
    form.addEventListener('input', event => {
      const input = event.target;
      if (input instanceof HTMLInputElement) {
        const icon = input.closest('.input-picker')?.querySelector('.field-icon');
        if (icon) scheduleIcon(input, icon);
      }
      preview();
    });
    form.addEventListener('change', preview);
    recipeId.addEventListener('input', preview);
    document.getElementById('editRecipeId').addEventListener('click', event => {
      recipeIdAutomatic = !recipeIdAutomatic;
      recipeId.readOnly = recipeIdAutomatic;
      event.currentTarget.textContent = recipeIdAutomatic ? 'Изменить' : 'Авто';
      if (recipeIdAutomatic) updateRecipeId();
      else recipeId.focus();
      preview();
    });
    document.getElementById('reload').addEventListener('click', () => {
      status.className = 'status';
      status.textContent = 'Reloading schema library…';
      vscode.postMessage({ type: 'reloadSchemas' });
    });
    document.getElementById('newSchema').addEventListener('click', () => vscode.postMessage({ type: 'createSchema' }));
    save.addEventListener('click', () => {
      if (save.disabled || busy) return;
      const values = currentValues();
      const schemaId = selectedId;
      const id = recipeId.value;
      const saveRevision = ++revision;
      setBusy(true);
      status.className = 'status';
      status.setAttribute('role', 'status');
      status.textContent = 'Сохраняем в kubevs/crafts/generic…';
      vscode.postMessage({ type: 'save', revision: saveRevision, schemaId, recipeId: id, values });
    });
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type === 'registryPicked') {
        const pending = pendingPicks.get(message.requestId);
        pendingPicks.delete(message.requestId);
        if (pending && message.value) {
          pending.input.value = message.value;
          pending.input.dataset.iconId = message.value;
          pending.icon.hidden = !message.icon;
          if (message.icon) pending.icon.src = message.icon;
          else pending.icon.removeAttribute('src');
          pending.input.dispatchEvent(new Event('input', { bubbles: true }));
          pending.input.focus();
        }
      } else if (message?.type === 'registryIcon') {
        const pending = pendingIcons.get(message.requestId);
        pendingIcons.delete(message.requestId);
        if (pending && pending.input.isConnected && pending.input.value.trim() === pending.value && message.value === pending.value) {
          iconById.set(pending.value, message.icon || null);
          applyIcon(pending.input, pending.icon, message.icon);
        }
      } else if (message?.type === 'catalog') {
        if (busy) {
          pendingCatalog = message.catalog;
          status.className = 'status';
          status.setAttribute('role', 'status');
          status.textContent = 'A schema update is queued until saving finishes.';
        } else {
          setCatalog(message.catalog);
        }
      } else if (message?.type === 'catalogError') {
        status.className = 'status error';
        status.setAttribute('role', 'alert');
        status.textContent = 'Schema library could not be loaded: ' + message.message;
      } else if (message?.type === 'preview' && message.revision === revision && message.revision >= appliedRevision) {
        appliedRevision = message.revision;
        code.textContent = message.code;
      } else if (message?.type === 'previewError' && message.revision === revision && message.revision >= appliedRevision) {
        appliedRevision = message.revision;
        code.textContent = '// ' + message.message;
        save.disabled = true;
      } else if (message?.type === 'saved') {
        status.className = 'status';
        status.setAttribute('role', 'status');
        status.textContent = 'Saved ' + message.path;
        finishOperation();
      } else if (message?.type === 'error') {
        status.className = 'status error';
        status.setAttribute('role', 'alert');
        status.textContent = message.message;
        finishOperation();
      } else if (message?.type === 'cancelled') {
        status.className = 'status';
        status.setAttribute('role', 'status');
        status.textContent = 'Save cancelled. No file was changed.';
        finishOperation();
      }
    });
    setCatalog(catalog);
  </script>
</body>
</html>`;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}
