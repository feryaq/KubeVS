import * as vscode from 'vscode';
import { generatedLootRuleTarget } from './generatedTarget.js';
import { generateLootRule, LOOT_RULE_PRESETS, type LootRuleDraft } from './lootRuleCore.js';
import type { RegistryCatalog } from './registryCatalog.js';
import { handleRegistryPickMessage } from './registryWebview.js';
import { writeFileWithDiff } from './safeWrite.js';
import { runtimeLanguage } from './localization.js';

interface LootRuleMessage {
  readonly type: 'preview' | 'save';
  readonly revision: number;
  readonly draft: LootRuleDraft;
}

export function openLootRuleEditor(
  context: vscode.ExtensionContext,
  registryCatalog: RegistryCatalog,
): void {
  const panel = vscode.window.createWebviewPanel(
    'kubevs.lootRuleEditor',
    'KubeVS — LootJS Builder',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = createNonce();
  panel.webview.onDidReceiveMessage(
    async (value: unknown) => {
      if (await handleRegistryPickMessage(value, panel.webview, registryCatalog)) return;
      if (!isLootRuleMessage(value)) return;
      try {
        const code = generateLootRule(value.draft);
        if (value.type === 'preview') {
          await panel.webview.postMessage({ type: 'preview', revision: value.revision, code });
          return;
        }
        const target = await generatedLootRuleTarget(value.draft.target);
        const written = await writeFileWithDiff(context, target, code, {
          diffTitle: 'KubeVS: текущий файл ↔ новое правило LootJS',
          confirmation: `Перезаписать ${vscode.workspace.asRelativePath(target)}? Сначала проверьте открытый diff.`,
          confirmButton: 'Перезаписать',
          confirmExisting: false,
        });
        if (!written) {
          await panel.webview.postMessage({ type: 'cancelled' });
          return;
        }
        const document = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(document, { preview: false });
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
  panel.webview.html = lootRuleEditorHtml(panel.webview, nonce);
}

function isLootRuleMessage(value: unknown): value is LootRuleMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<LootRuleMessage>;
  if (
    (message.type !== 'preview' && message.type !== 'save') ||
    !Number.isSafeInteger(message.revision) ||
    (message.revision ?? -1) < 0 ||
    typeof message.draft !== 'object' ||
    message.draft === null
  ) {
    return false;
  }
  try {
    return JSON.stringify(message.draft).length <= 128 * 1024;
  } catch {
    return false;
  }
}

function lootRuleEditorHtml(webview: vscode.Webview, nonce: string): string {
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  // THESIS: a calm, native VS Code form that explains LootJS in Minecraft terms.
  // HIERARCHY: where loot changes → what happens → when it happens → generated code.
  // CONTRAST: one primary save action, semantic logic badges, theme-owned surfaces.
  // DEPTH: one-pixel dividers and tree rails; no ornamental card stacking.
  let html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>KubeVS — LootJS Builder</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; --accent: var(--vscode-testing-iconPassed, #4caf50); }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 13px/1.45 var(--vscode-font-family); }
    button, input, select, textarea { font: inherit; color: inherit; }
    button { min-height: 30px; border: 1px solid var(--vscode-button-border, transparent); padding: 5px 10px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.ghost { border-color: var(--vscode-panel-border); background: transparent; }
    button.danger { color: var(--vscode-errorForeground); }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    button:disabled, input:disabled, select:disabled, textarea:disabled { opacity: .55; cursor: default; }
    input, select, textarea { width: 100%; min-height: 30px; border: 1px solid var(--vscode-input-border, transparent); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 5px 8px; }
    .picker { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; margin-top: 4px; }
    .picker input { margin: 0; }
    .picker button { min-width: 34px; padding: 4px 8px; }
    textarea { resize: vertical; min-height: 78px; font-family: var(--vscode-editor-font-family); }
    header { min-height: 58px; display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 200px; }
    .cube { width: 24px; height: 24px; display: grid; place-items: center; color: #102613; background: var(--accent); font-weight: 800; }
    h1 { font-size: 15px; margin: 0; }
    .subtitle { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .status { margin-left: auto; min-width: 190px; text-align: right; color: var(--vscode-descriptionForeground); }
    main { display: grid; grid-template-columns: minmax(300px, .9fr) minmax(380px, 1.1fr); height: calc(100vh - 58px); }
    section { min-width: 0; overflow: auto; border-right: 1px solid var(--vscode-panel-border); }
    section:last-of-type { border-right: 0; }
    .section-head { position: sticky; top: 0; z-index: 2; min-height: 43px; padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .section-head strong { display: block; font-size: 13px; }
    .section-head span { display: block; margin-top: 1px; color: var(--vscode-descriptionForeground); font-size: 12px; font-weight: 400; }
    .pane { padding: 16px; }
    .group + .group { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--vscode-panel-border); }
    h2 { margin: 0 0 4px; font-size: 13px; }
    .group-intro { margin: 0 0 12px; color: var(--vscode-descriptionForeground); }
    label { display: block; margin-bottom: 12px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    label > input, label > select, label > textarea { margin-top: 4px; color: var(--vscode-input-foreground); }
    .hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .preset-row, .add-action { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; margin-bottom: 12px; }
    .preset-row { grid-template-columns: minmax(0, 1fr) auto; gap: 6px; margin-bottom: 14px; }
    .action { border: 1px solid var(--vscode-panel-border); padding: 11px; margin-bottom: 8px; background: var(--vscode-editorWidget-background); }
    .action-head, .node-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
    .action-head strong, .node-head strong { flex: 1; font-size: 12px; }
    .action-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .action-fields label:first-child { grid-column: 1 / -1; }
    .action-fields label, .single-field label { margin: 0; }
    .single-field + .single-field { margin-top: 8px; }
    .checkbox { display: flex; align-items: center; gap: 7px; margin: 9px 0 0; color: var(--vscode-foreground); }
    .checkbox input { width: auto; min-height: auto; margin: 0; }
    .node { position: relative; margin: 0 0 8px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); padding: 10px; }
    .children { margin: 10px 0 0 12px; padding-left: 12px; border-left: 2px solid var(--vscode-tree-indentGuidesStroke); }
    .badge { min-width: 38px; padding: 2px 6px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font: 700 10px/1.4 var(--vscode-font-family); text-align: center; letter-spacing: .05em; }
    .badge.not { color: var(--vscode-errorForeground); background: color-mix(in srgb, var(--vscode-errorForeground) 15%, transparent); }
    .node-tools { display: flex; gap: 4px; }
    .node-tools button { padding: 2px 7px; }
    .add-child { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; padding-top: 4px; }
    details.preview { grid-column: 1 / -1; position: fixed; z-index: 5; right: 16px; bottom: 16px; width: min(620px, calc(100vw - 32px)); max-height: min(55vh, 520px); border: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); box-shadow: 0 6px 24px var(--vscode-widget-shadow); }
    details.preview summary { min-height: 38px; padding: 9px 12px; cursor: pointer; font-weight: 600; }
    details.preview[open] summary { border-bottom: 1px solid var(--vscode-panel-border); }
    pre { margin: 0; max-height: calc(min(55vh, 520px) - 39px); padding: 13px; white-space: pre; overflow: auto; font: 12px/1.55 var(--vscode-editor-font-family); tab-size: 2; }
    .error { color: var(--vscode-errorForeground); white-space: pre-wrap; }
    .empty { padding: 12px; color: var(--vscode-descriptionForeground); border: 1px dashed var(--vscode-panel-border); }
    @media (max-width: 780px) { body { overflow: auto; } header { flex-wrap: wrap; } .status { order: 3; width: 100%; text-align: left; } main { display: block; height: auto; } section { min-height: 45vh; border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } }
    @media (max-width: 480px) { .action-fields, .add-action, .add-child { grid-template-columns: 1fr; } details.preview { right: 8px; bottom: 8px; width: calc(100vw - 16px); } }
    @media (forced-colors: active) { button, input, select, textarea, .action, .node, details.preview { border-color: CanvasText; } }
  </style>
</head>
<body>
  <header>
    <div class="brand"><div class="cube" aria-hidden="true">K</div><div><h1>Правило добычи</h1><div class="subtitle">LootJS · визуальный редактор</div></div></div>
    <div id="status" class="status" role="status" aria-live="polite">Готово</div>
    <button id="save" class="primary">Сохранить правило</button>
  </header>
  <main>
    <section>
      <div class="section-head"><strong>Изменения добычи</strong><span>Выберите источник и результат</span></div>
      <div class="pane">
        <div class="group">
          <h2>Где менять</h2>
          <p class="group-intro">Сундук, блок или сущность, чью добычу нужно изменить.</p>
          <div class="preset-row">
            <select id="preset" aria-label="Готовый пресет LootJS">
              <option value="chest">Сундук данжа · редкий изумруд</option>
              <option value="fishing">Рыбалка · шанс на алмаз</option>
              <option value="leaves">Листва · дополнительные яблоки</option>
              <option value="stone">Камень · редкий кремень</option>
              <option value="zombie">Зомби · шанс на железо</option>
              <option value="skeleton">Скелет · дополнительные стрелы</option>
            </select>
            <button id="applyPreset" type="button">Применить пресет</button>
          </div>
          <label>Источник добычи<select id="targetKind"><option value="table">Готовая таблица добычи</option><option value="block">Блок или тег блоков</option><option value="entity">Сущность или тег сущностей</option></select></label>
          <label>Игровой ID<div class="picker"><input id="target" spellcheck="false" value="minecraft:chests/simple_dungeon"><button id="pickTarget" class="ghost" type="button" title="Найти по имени или ID" aria-label="Найти цель по имени или ID">⌕</button></div></label>
          <div class="hint">Например: <code>minecraft:chests/simple_dungeon</code>. Для блоков и сущностей поддерживаются теги с <code>#</code>.</div>
        </div>
        <div class="group">
          <h2>Что сделать</h2>
          <p class="group-intro">Действия выполняются по порядку сверху вниз.</p>
          <div class="add-action">
            <select id="actionKind" aria-label="Новое действие">
              <option value="add">Добавить предмет</option>
              <option value="remove">Удалить предмет</option>
              <option value="replace">Заменить предмет</option>
              <option value="experience">Добавить опыт</option>
            </select>
            <button id="addAction" type="button">Добавить</button>
          </div>
          <div id="actions"></div>
        </div>
      </div>
    </section>
    <section>
      <div class="section-head"><strong>Когда применять</strong><span>Условия можно объединять в группы</span></div>
      <div class="pane"><p class="group-intro">AND — все условия, OR — любое, NOT — наоборот. Главное условие нельзя удалить.</p><div id="tree"></div></div>
    </section>
    <details class="preview">
      <summary>Показать сгенерированный JavaScript</summary>
      <pre id="code">Подготовка предпросмотра…</pre>
    </details>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let sequence = 10, revision = 0, busy = false, previewValid = false, previewTimer, pickSequence = 0;
    const pendingPicks = new Map();
    const restored = vscode.getState();
    const initial = {
      targetKind: 'table', target: 'minecraft:chests/simple_dungeon',
      condition: { id: 'root', kind: 'and', children: [{ id: 'n1', kind: 'chance', value: 0.5, children: [] }] },
      actions: [{ id: 'a1', kind: 'add', item: 'minecraft:diamond', count: 1, chance: 1 }]
    };
    const presets = ${JSON.stringify(LOOT_RULE_PRESETS)};
    let state = isUsableState(restored) ? restored : initial;
    const labels = { and:'AND — все условия', or:'OR — любое условие', not:'NOT — инверсия', chance:'Случайный шанс', tool:'Инструмент', killedByPlayer:'Убит игроком', survivesExplosion:'Пережило взрыв', custom:'Своё JSON-условие' };
    const actionLabels = { add:'Добавить предмет', remove:'Удалить добычу', replace:'Заменить добычу', experience:'Добавить опыт' };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const id = prefix => prefix + (++sequence);
    const byId = (node, wanted) => node.id === wanted ? node : node.children.map(child => byId(child, wanted)).find(Boolean);
    const parentOf = (node, wanted) => node.children.some(child => child.id === wanted) ? node : node.children.map(child => parentOf(child, wanted)).find(Boolean);
    const removeNode = (node, wanted) => { const i = node.children.findIndex(child => child.id === wanted); if (i >= 0) return node.children.splice(i, 1); return node.children.some(child => removeNode(child, wanted)); };
    const defaults = kind => ({ id:id('n'), kind, value: kind === 'chance' ? 0.5 : kind === 'tool' ? 'minecraft:iron_pickaxe' : kind === 'custom' ? '{"condition":"minecraft:weather_check","raining":true}' : undefined, children: kind === 'and' || kind === 'or' ? [{id:id('n'),kind:'chance',value:0.5,children:[]}] : kind === 'not' ? [{id:id('n'),kind:'chance',value:0.5,children:[]}] : [] });
    function isUsableState(value) {
      const kinds = new Set(['and','or','not','chance','tool','killedByPlayer','survivesExplosion','custom']);
      const actions = new Set(['add','remove','replace','experience']);
      let count = 0;
      const nodeOk = node => node && typeof node === 'object' && typeof node.id === 'string' && kinds.has(node.kind) && Array.isArray(node.children) && ++count <= 100 && node.children.every(nodeOk);
      return value && typeof value === 'object' && ['table','block','entity'].includes(value.targetKind) && typeof value.target === 'string' && Array.isArray(value.actions) && value.actions.length <= 100 && value.actions.every(action => action && typeof action.id === 'string' && actions.has(action.kind)) && nodeOk(value.condition);
    }
    function normalizeIds() {
      const used = new Set();
      const safe = (candidate, prefix) => {
        const match = String(candidate || '').match(/(\\d+)$/); if (match) sequence = Math.max(sequence, Number(match[1]));
        let next = String(candidate || ''); if (!/^[A-Za-z0-9_-]{1,80}$/.test(next) || used.has(next)) next = id(prefix);
        used.add(next); return next;
      };
      const visit = node => { node.id = safe(node.id, 'n'); node.children.forEach(visit); };
      visit(state.condition); state.actions.forEach(action => { action.id = safe(action.id, 'a'); });
    }
    normalizeIds();
    const setBusy = value => {
      busy = value;
      document.querySelectorAll('button,input,select,textarea').forEach(control => { control.disabled = value; });
      if (!value) {
        document.querySelectorAll('[data-add-child]').forEach(button => {
          const parent = byId(state.condition, button.dataset.addChild);
          button.disabled = parent?.kind === 'not' && parent.children.length > 0;
        });
        document.getElementById('save').disabled = !previewValid;
      }
    };
    const status = (text, error = false) => { const el = document.getElementById('status'); el.textContent = text; el.style.color = error ? 'var(--vscode-errorForeground)' : ''; };

    function renderActions() {
      const host = document.getElementById('actions');
      host.innerHTML = state.actions.length ? state.actions.map(action => {
        let fields = '';
        if (action.kind === 'add') fields = '<div class="action-fields"><label>Предмет<div class="picker"><input aria-label="ID предмета" data-action-field="item" value="'+esc(action.item)+'"><button class="ghost" data-pick-registry="minecraft:item" data-include-tags="false" title="Найти предмет" aria-label="Найти предмет по имени или ID">⌕</button></div></label><label>Количество<input aria-label="Количество предметов" type="number" min="1" data-action-field="count" value="'+esc(action.count)+'"></label><label>Шанс, от 0 до 1<input aria-label="Шанс добавления от нуля до единицы" type="number" min="0.001" max="1" step="0.05" data-action-field="chance" value="'+esc(action.chance)+'"></label></div>';
        if (action.kind === 'remove') fields = '<div class="single-field"><label>Предмет или тег<div class="picker"><input aria-label="Предмет или тег для удаления" data-action-field="filter" value="'+esc(action.filter)+'"><button class="ghost" data-pick-registry="minecraft:item" data-include-tags="true" title="Найти предмет или тег" aria-label="Найти предмет или тег для удаления">⌕</button></div></label></div>';
        if (action.kind === 'replace') fields = '<div class="single-field"><label>Что заменить<div class="picker"><input aria-label="Что заменить" data-action-field="filter" value="'+esc(action.filter)+'"><button class="ghost" data-pick-registry="minecraft:item" data-include-tags="true" title="Найти исходный предмет" aria-label="Найти исходный предмет или тег">⌕</button></div></label></div><div class="single-field"><label>На что заменить<div class="picker"><input aria-label="На что заменить" data-action-field="replacement" value="'+esc(action.replacement)+'"><button class="ghost" data-pick-registry="minecraft:item" data-include-tags="false" title="Найти новый предмет" aria-label="Найти новый предмет">⌕</button></div></label></div><label class="checkbox"><input type="checkbox" data-action-field="preserveCount" '+(action.preserveCount?'checked':'')+'> Сохранить исходное количество</label>';
        if (action.kind === 'experience') fields = '<div class="single-field"><label>Количество опыта<input aria-label="Количество опыта" type="number" min="0" data-action-field="amount" value="'+esc(action.amount)+'"></label></div>';
        return '<div class="action" data-action="'+esc(action.id)+'"><div class="action-head"><strong>'+actionLabels[action.kind]+'</strong><button class="ghost danger" data-remove-action="'+esc(action.id)+'" aria-label="Удалить действие">×</button></div>'+fields+'</div>';
      }).join('') : '<div class="empty">Действий пока нет. Выберите нужное выше и нажмите «Добавить».</div>';
    }
    function nodeHtml(node, root = false) {
      let editor = '';
      if (node.kind === 'chance') editor = '<label>Шанс, от 0 до 1<input aria-label="Шанс от нуля до единицы" type="number" min="0" max="1" step="0.05" data-node-value="'+esc(node.id)+'" value="'+esc(node.value)+'"></label>';
      if (node.kind === 'tool') editor = '<div class="picker"><input aria-label="ID или тег инструмента" data-node-value="'+esc(node.id)+'" value="'+esc(node.value)+'"><button class="ghost" data-pick-registry="minecraft:item" data-include-tags="true" title="Найти инструмент или тег">⌕</button></div>';
      if (node.kind === 'custom') editor = '<label>JSON условия<textarea aria-label="Пользовательское JSON-условие" data-node-value="'+esc(node.id)+'">'+esc(node.value)+'</textarea></label>';
      const composite = ['and','or','not'].includes(node.kind);
      const add = composite ? '<div class="add-child"><select aria-label="Тип нового условия" data-child-kind="'+esc(node.id)+'"><option value="chance">Случайный шанс</option><option value="tool">Инструмент</option><option value="killedByPlayer">Убит игроком</option><option value="survivesExplosion">Пережило взрыв</option><option value="and">Группа AND</option><option value="or">Группа OR</option><option value="not">Инверсия NOT</option><option value="custom">Своё JSON</option></select><button data-add-child="'+esc(node.id)+'" '+(node.kind==='not'&&node.children.length?'disabled':'')+'>Добавить условие</button></div>' : '';
      return '<div class="node" data-node="'+esc(node.id)+'"><div class="node-head"><span class="badge '+(node.kind==='not'?'not':'')+'">'+esc(node.kind.toUpperCase())+'</span><strong>'+labels[node.kind]+'</strong>'+(root?'':'<button class="ghost danger" data-remove-node="'+esc(node.id)+'" aria-label="Удалить условие">×</button>')+'</div>'+editor+(composite?'<div class="children">'+node.children.map(child => nodeHtml(child)).join('')+add+'</div>':'')+'</div>';
    }
    function render(focusSelector) {
      document.getElementById('targetKind').value = state.targetKind;
      document.getElementById('target').value = state.target;
      const pickTarget = document.getElementById('pickTarget');
      pickTarget.hidden = state.targetKind === 'table';
      pickTarget.dataset.pickRegistry = state.targetKind === 'block' ? 'minecraft:block' : 'minecraft:entity_type';
      pickTarget.dataset.includeTags = 'true';
      renderActions();
      document.getElementById('tree').innerHTML = nodeHtml(state.condition, true);
      vscode.setState(state);
      requestPreview();
      if (focusSelector) requestAnimationFrame(() => document.querySelector(focusSelector)?.focus());
    }
    function changed() { vscode.setState(state); clearTimeout(previewTimer); previewTimer = setTimeout(requestPreview, 180); }
    function requestPreview() {
      if (busy) return;
      previewValid = false;
      document.getElementById('save').disabled = true;
      const current = ++revision;
      document.getElementById('code').textContent = 'Проверка правила…';
      vscode.postMessage({type:'preview', revision:current, draft:state});
    }
    document.addEventListener('input', event => {
      const el = event.target;
      if (el.id === 'target') state.target = el.value;
      if (el.id === 'targetKind') state.targetKind = el.value;
      const actionHost = el.closest('[data-action]');
      if (actionHost && el.dataset.actionField) {
        const action = state.actions.find(item => item.id === actionHost.dataset.action);
        if (action) action[el.dataset.actionField] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      }
      if (el.dataset.nodeValue) {
        const node = byId(state.condition, el.dataset.nodeValue);
        if (node) node.value = el.type === 'number' ? Number(el.value) : el.value;
      }
      changed();
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || busy) return;
      if (button.id === 'applyPreset') {
        const selected = presets[document.getElementById('preset').value];
        if (selected) {
          state = JSON.parse(JSON.stringify(selected));
          normalizeIds();
          status('Пресет применён — проверьте цель, шанс и награду');
          render('#target');
        }
        return;
      }
      if (button.dataset.pickRegistry) {
        const input = button.closest('.picker')?.querySelector('input');
        if (input) {
          const requestId = ++pickSequence; pendingPicks.set(requestId, input);
          vscode.postMessage({type:'pickRegistry',requestId,registry:button.dataset.pickRegistry,includeTags:button.dataset.includeTags==='true',current:input.value,title:'KubeVS — выберите игровой ID'});
        }
        return;
      }
      if (button.id === 'addAction') {
        const kind = document.getElementById('actionKind').value;
        const action = kind === 'add' ? {id:id('a'),kind,item:'minecraft:diamond',count:1,chance:1} : kind === 'remove' ? {id:id('a'),kind,filter:'minecraft:rotten_flesh'} : kind === 'replace' ? {id:id('a'),kind,filter:'minecraft:rotten_flesh',replacement:'minecraft:leather',preserveCount:true} : {id:id('a'),kind,amount:5};
        state.actions.push(action);
        render('[data-action="'+CSS.escape(action.id)+'"] input');
      }
      if (button.dataset.removeAction) { state.actions = state.actions.filter(a => a.id !== button.dataset.removeAction); render('#actionKind'); }
      if (button.dataset.removeNode) { const parent = parentOf(state.condition, button.dataset.removeNode); removeNode(state.condition, button.dataset.removeNode); render(parent ? '[data-child-kind="'+CSS.escape(parent.id)+'"]' : '#tree button'); }
      if (button.dataset.addChild) {
        const parent = byId(state.condition, button.dataset.addChild);
        const select = document.querySelector('[data-child-kind="'+CSS.escape(button.dataset.addChild)+'"]');
        if (parent && select && !(parent.kind === 'not' && parent.children.length)) { const child = defaults(select.value); parent.children.push(child); render('[data-node="'+CSS.escape(child.id)+'"] input, [data-node="'+CSS.escape(child.id)+'"] textarea, [data-node="'+CSS.escape(child.id)+'"] button'); }
      }
    });
    document.getElementById('targetKind').addEventListener('change', event => { state.targetKind = event.target.value; changed(); });
    document.getElementById('save').addEventListener('click', () => { if (!previewValid) return; setBusy(true); status('Сохранение в папку KubeVS…'); vscode.postMessage({type:'save',revision:++revision,draft:state}); });
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'registryPicked') {
        const input = pendingPicks.get(message.requestId); pendingPicks.delete(message.requestId);
        if (input && message.value) { input.value = message.value; input.dispatchEvent(new Event('input', {bubbles:true})); input.focus(); }
        return;
      }
      if (message.type === 'preview' && message.revision === revision) { previewValid = true; document.getElementById('save').disabled = false; document.getElementById('code').className=''; document.getElementById('code').textContent=message.code; status('Правило корректно'); }
      if (message.type === 'previewError' && message.revision === revision) { previewValid = false; document.getElementById('save').disabled = true; document.getElementById('code').className='error'; document.getElementById('code').textContent=message.message; status('Исправьте параметры', true); }
      if (message.type === 'saved') { setBusy(false); status('Сохранено: '+message.path); requestPreview(); }
      if (message.type === 'cancelled') { setBusy(false); status('Сохранение отменено'); requestPreview(); }
      if (message.type === 'error') { setBusy(false); status(message.message, true); requestPreview(); }
    });
    render();
  </script>
</body>
</html>`;
  if (runtimeLanguage() === 'en') html = translateLootEditorToEnglish(html);
  return html;
}

const lootEditorEnglish = new Map<string, string>([
  ['<html lang="ru">', '<html lang="en">'],
  ['Правило добычи', 'Loot rule'],
  ['визуальный редактор', 'visual editor'],
  ['Сохранить правило', 'Save rule'],
  ['Изменения добычи', 'Loot changes'],
  ['Выберите источник и результат', 'Choose a source and result'],
  ['Где менять', 'Where to change loot'],
  [
    'Сундук, блок или сущность, чью добычу нужно изменить.',
    'The chest, block, or entity whose loot should change.',
  ],
  ['Сундук данжа · редкий изумруд', 'Dungeon chest · rare emerald'],
  ['Рыбалка · шанс на алмаз', 'Fishing · chance for a diamond'],
  ['Листва · дополнительные яблоки', 'Leaves · extra apples'],
  ['Камень · редкий кремень', 'Stone · rare flint'],
  ['Зомби · шанс на железо', 'Zombie · chance for iron'],
  ['Скелет · дополнительные стрелы', 'Skeleton · extra arrows'],
  ['Применить пресет', 'Apply preset'],
  ['Источник добычи', 'Loot source'],
  ['Готовая таблица добычи', 'Loot table'],
  ['Блок или тег блоков', 'Block or block tag'],
  ['Сущность или тег сущностей', 'Entity or entity tag'],
  ['Игровой ID', 'Game ID'],
  ['Найти по имени или ID', 'Find by name or ID'],
  ['Найти цель по имени или ID', 'Find target by name or ID'],
  ['Для блоков и сущностей поддерживаются теги с', 'Block and entity tags can start with'],
  ['Что сделать', 'What to do'],
  ['Действия выполняются по порядку сверху вниз.', 'Actions run from top to bottom.'],
  ['Новое действие', 'New action'],
  ['Добавить предмет', 'Add item'],
  ['Удалить предмет', 'Remove item'],
  ['Заменить предмет', 'Replace item'],
  ['Добавить опыт', 'Add experience'],
  ['Когда применять', 'When to apply'],
  ['Условия можно объединять в группы', 'Conditions can be grouped'],
  [
    'AND — все условия, OR — любое, NOT — наоборот. Главное условие нельзя удалить.',
    'AND requires every condition, OR requires any condition, and NOT inverts one condition. The root condition cannot be removed.',
  ],
  ['Показать сгенерированный JavaScript', 'Show generated JavaScript'],
  ['Подготовка предпросмотра…', 'Preparing preview…'],
  ['AND — все условия', 'AND — all conditions'],
  ['OR — любое условие', 'OR — any condition'],
  ['NOT — инверсия', 'NOT — inverted'],
  ['Случайный шанс', 'Random chance'],
  ['Инструмент', 'Tool'],
  ['Убит игроком', 'Killed by player'],
  ['Пережило взрыв', 'Survives explosion'],
  ['Своё JSON-условие', 'Custom JSON condition'],
  ['Удалить добычу', 'Remove loot'],
  ['Заменить добычу', 'Replace loot'],
  ['Предмет или тег', 'Item or tag'],
  ['Что заменить', 'Loot to replace'],
  ['На что заменить', 'Replacement item'],
  ['Сохранить исходное количество', 'Preserve original count'],
  ['Количество опыта', 'Experience amount'],
  ['Количество предметов', 'Item count'],
  ['Шанс, от 0 до 1', 'Chance, from 0 to 1'],
  ['Шанс добавления от нуля до единицы', 'Add chance from zero to one'],
  [
    'Действий пока нет. Выберите нужное выше и нажмите «Добавить».',
    'No actions yet. Choose one above and select Add.',
  ],
  ['JSON условия', 'Condition JSON'],
  ['Тип нового условия', 'New condition type'],
  ['Группа AND', 'AND group'],
  ['Группа OR', 'OR group'],
  ['Инверсия NOT', 'NOT group'],
  ['Своё JSON', 'Custom JSON'],
  ['Добавить условие', 'Add condition'],
  ['Удалить условие', 'Remove condition'],
  ['Удалить действие', 'Remove action'],
  ['Найти предмет или тег', 'Find item or tag'],
  ['Найти предмет', 'Find item'],
  ['Найти инструмент или тег', 'Find tool or tag'],
  ['KubeVS — выберите игровой ID', 'KubeVS — select a game ID'],
  [
    'Пресет применён — проверьте цель, шанс и награду',
    'Preset applied — review the target, chance, and reward',
  ],
  ['Проверка правила…', 'Validating rule…'],
  ['Сохранение в папку KubeVS…', 'Saving to the KubeVS folder…'],
  ['Правило корректно', 'Rule is valid'],
  ['Исправьте параметры', 'Fix the parameters'],
  ['Сохранение отменено', 'Save cancelled'],
  ['Сохранено: ', 'Saved: '],
  ['Готово', 'Ready'],
  ['Добавить', 'Add'],
  ['Количество', 'Amount'],
  ['Шанс', 'Chance'],
  ['Предмет', 'Item'],
]);

function translateLootEditorToEnglish(html: string): string {
  const entries = [...lootEditorEnglish].sort((left, right) => right[0].length - left[0].length);
  for (const [source, translation] of entries) html = html.replaceAll(source, translation);
  return html;
}
function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}
