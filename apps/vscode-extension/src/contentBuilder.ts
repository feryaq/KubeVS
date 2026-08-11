import * as vscode from 'vscode';
import {
  generateContentScript,
  type ContentBuilderDraft,
  type ContentKind,
} from './contentBuilderCore.js';
import { generatedStartupDirectoryUri } from './generatedTarget.js';
import type { RegistryCatalog } from './registryCatalog.js';
import { handleRegistryIconMessage, handleRegistryPickMessage } from './registryWebview.js';
import { writeFileWithDiff } from './safeWrite.js';

interface ContentBuilderMessage {
  readonly type: 'preview' | 'save';
  readonly revision: number;
  readonly draft: ContentBuilderDraft;
}

export function openContentBuilder(
  context: vscode.ExtensionContext,
  registryCatalog: RegistryCatalog,
  initialKind: ContentKind,
): void {
  const panel = vscode.window.createWebviewPanel(
    'kubevs.contentBuilder',
    initialKind === 'item' ? 'KubeVS — Item Builder' : 'KubeVS — Block Builder',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = createNonce();
  panel.webview.onDidReceiveMessage(
    async (value: unknown) => {
      if (await handleRegistryPickMessage(value, panel.webview, registryCatalog)) return;
      if (await handleRegistryIconMessage(value, panel.webview, registryCatalog)) return;
      if (!isContentBuilderMessage(value)) return;
      try {
        const code = generateContentScript(value.draft);
        if (value.type === 'preview') {
          await panel.webview.postMessage({ type: 'preview', revision: value.revision, code });
          return;
        }
        const directory = await generatedStartupDirectoryUri();
        const path = value.draft.id.split(':').at(-1)?.replaceAll('/', '_') || 'content';
        const target = vscode.Uri.joinPath(directory, `kubevs_${value.draft.kind}_${path}.js`);
        const written = await writeFileWithDiff(context, target, code, {
          diffTitle: `KubeVS: ${value.draft.kind === 'item' ? 'item' : 'block'} — current file ↔ new file`,
          confirmation: `Save ${vscode.workspace.asRelativePath(target)}? Review the diff first.`,
          confirmButton: 'Save',
        });
        await panel.webview.postMessage(
          written
            ? { type: 'saved', path: vscode.workspace.asRelativePath(target) }
            : { type: 'cancelled' },
        );
        if (written) {
          void vscode.window.showInformationMessage(
            'KubeVS: startup registration saved. Restart Minecraft to load the new content.',
          );
        }
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
  panel.webview.html = contentBuilderHtml(panel.webview, nonce, initialKind);
}

function isContentBuilderMessage(value: unknown): value is ContentBuilderMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<ContentBuilderMessage>;
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
    return JSON.stringify(message.draft).length <= 32 * 1024;
  } catch {
    return false;
  }
}

function contentBuilderHtml(
  webview: vscode.Webview,
  nonce: string,
  initialKind: ContentKind,
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
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>KubeVS Content Builder</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.45 var(--vscode-font-family); }
    button, input, select, textarea { font: inherit; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    header { min-height: 62px; display: flex; align-items: center; gap: 14px; padding: 10px 18px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-titleBar-activeBackground); }
    h1, h2 { margin: 0; }
    h1 { font-size: 17px; letter-spacing: -.02em; }
    h2 { margin-bottom: 12px; font-size: 13px; }
    .identity { min-width: 210px; }
    .muted, .help, .status { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .kind-switch { display: flex; gap: 1px; padding: 2px; background: var(--vscode-editor-background); }
    button { min-height: 30px; padding: 4px 10px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button[aria-pressed="true"], .primary { border-color: transparent; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button:disabled { opacity: .55; cursor: default; }
    .save { margin-left: auto; }
    main { min-height: calc(100vh - 62px); display: grid; grid-template-columns: minmax(390px, 46%) 1fr; }
    .editor { padding: 20px; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .preview { min-width: 0; padding: 20px; }
    .primary-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(210px, .8fr); gap: 12px; }
    .section { margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--vscode-panel-border); }
    label { display: grid; gap: 5px; min-width: 0; color: var(--vscode-descriptionForeground); font-size: 11px; }
    input, select, textarea { width: 100%; min-height: 32px; padding: 5px 8px; border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); background: var(--vscode-input-background); }
    input[readonly] { color: var(--vscode-descriptionForeground); }
    textarea { min-height: 66px; resize: vertical; }
    .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .inline { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; }
    .texture-picker { display: grid; grid-template-columns: 38px minmax(0, 1fr) 34px; gap: 5px; align-items: center; }
    .texture-picker img { width: 34px; height: 34px; object-fit: contain; image-rendering: pixelated; }
    .texture-picker img[hidden] { visibility: hidden; display: block; }
    .checkbox { display: flex; align-items: center; gap: 7px; min-height: 32px; color: var(--vscode-editor-foreground); }
    .checkbox input { width: auto; min-height: auto; }
    .specimen { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 16px; align-items: center; margin-bottom: 22px; padding-bottom: 20px; border-bottom: 1px solid var(--vscode-panel-border); }
    .slot { width: 82px; height: 82px; display: grid; place-items: center; border: 2px solid color-mix(in srgb, var(--vscode-panel-border) 65%, #b87333 35%); background: color-mix(in srgb, var(--vscode-editor-background) 88%, #b87333 12%); box-shadow: 0 5px 14px rgba(0,0,0,.18); }
    .slot img { width: 58px; height: 58px; object-fit: contain; image-rendering: pixelated; }
    .slot img[hidden] { visibility: hidden; }
    .game-name { overflow-wrap: anywhere; font-size: 16px; font-weight: 650; }
    .game-id { overflow-wrap: anywhere; color: var(--vscode-descriptionForeground); font: 11px/1.5 var(--vscode-editor-font-family); }
    pre { min-height: 300px; margin: 0; padding: 14px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--vscode-panel-border); background: var(--vscode-textCodeBlock-background); font: 12px/1.55 var(--vscode-editor-font-family); }
    .status { margin: 10px 0 0; }
    .status.error { color: var(--vscode-errorForeground); }
    [hidden] { display: none !important; }
    @media (max-width: 820px) { main { display: block; } .editor { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } }
    @media (max-width: 520px) { header { align-items: stretch; flex-direction: column; } .save { margin-left: 0; } .primary-fields, .row { grid-template-columns: 1fr; } }
    @media (forced-colors: active) { button, input, select, textarea, .slot, pre { border: 1px solid CanvasText; } }
  </style>
</head>
<body>
  <header>
    <div class="identity"><h1>Content Builder</h1><div class="muted">KubeJS · startup_scripts</div></div>
    <div class="kind-switch" role="group" aria-label="Content type">
      <button type="button" data-kind="item" aria-pressed="${initialKind === 'item'}">Item</button>
      <button type="button" data-kind="block" aria-pressed="${initialKind === 'block'}">Block</button>
    </div>
    <button class="save primary" id="save" type="button">Save</button>
  </header>
  <main>
    <section class="editor">
      <div class="primary-fields">
        <label>In-game Name<input id="displayName" value="${initialKind === 'item' ? 'Test Component' : 'Test Block'}" maxlength="120" autofocus><span class="help">The ID is generated automatically.</span></label>
        <label>Technical ID<span class="inline"><input id="contentId" readonly><button id="editId" type="button">Edit</button></span><span class="help">You normally do not need to enter it.</span></label>
      </div>
      <div class="section">
        <h2>Appearance</h2>
        <label>Sample icon from an existing <span id="textureKind">item</span>
          <span class="texture-picker"><img id="textureIcon" alt="" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" hidden><input id="textureItem" value="${initialKind === 'item' ? 'minecraft:iron_ingot' : 'minecraft:iron_block'}" spellcheck="false"><button id="pickTexture" type="button" title="Find by name or ID">⌕</button></span>
          <span class="help">Used for preview only. Complex in-game models are not copied as invalid texture paths.</span>
        </label>
      </div>
      <div class="section" id="itemOptions">
        <h2>Item Properties</h2>
        <div class="row">
          <label>Stack size<input id="maxStackSize" type="number" min="1" max="64" value="64"></label>
          <label>Rarity<select id="rarity"><option>common</option><option>uncommon</option><option>rare</option><option>epic</option></select></label>
        </div>
        <div class="row">
          <label>Tooltip<textarea id="tooltip" placeholder="What this item is used for"></textarea></label>
          <label class="checkbox"><input id="glow" type="checkbox"> Always show enchantment glint</label>
        </div>
      </div>
      <div class="section" id="blockOptions" hidden>
        <h2>Block Properties</h2>
        <div class="row">
          <label>Hardness<input id="hardness" type="number" min="0" step="0.1" value="2"></label>
          <label>Blast resistance<input id="resistance" type="number" min="0" step="0.1" value="6"></label>
        </div>
        <div class="row">
          <label>Sound<select id="soundType"><option>stone</option><option>metal</option><option>wood</option><option>glass</option><option>wool</option></select></label>
          <label>Tool<select id="miningTool"><option value="pickaxe">Pickaxe</option><option value="axe">Axe</option><option value="shovel">Shovel</option><option value="hoe">Hoe</option><option value="none">Any</option></select></label>
        </div>
        <label class="checkbox"><input id="requiresTool" type="checkbox" checked> The block drops nothing without the correct tool</label>
      </div>
    </section>
    <section class="preview">
      <div class="specimen">
        <div class="slot"><img id="specimenIcon" alt="" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" hidden></div>
        <div><div class="game-name" id="specimenName"></div><div class="game-id" id="specimenId"></div><div class="muted" id="specimenMeta"></div></div>
      </div>
      <h2>Generated KubeJS</h2>
      <pre id="code"></pre>
      <p class="status" id="status" role="status">Preview updates automatically.</p>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const displayName = document.getElementById('displayName');
    const contentId = document.getElementById('contentId');
    const textureItem = document.getElementById('textureItem');
    const miningTool = document.getElementById('miningTool');
    const requiresTool = document.getElementById('requiresTool');
    const textureIcon = document.getElementById('textureIcon');
    const specimenIcon = document.getElementById('specimenIcon');
    const save = document.getElementById('save');
    const status = document.getElementById('status');
    const code = document.getElementById('code');
    let kind = ${JSON.stringify(initialKind)};
    let idAutomatic = true;
    let revision = 0;
    let busy = false;
    let pickSequence = 0;
    let iconSequence = 0;
    let iconTimer;
    const pendingPicks = new Map();
    const pendingIcons = new Map();
function slug(value) {
      return value.trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
    }
    function updateAutomaticId() {
      if (idAutomatic) contentId.value = 'kubejs:' + (slug(displayName.value) || (kind === 'item' ? 'new_item' : 'new_block'));
    }
    function draft() {
      return {
        kind,
        id: contentId.value.trim(),
        displayName: displayName.value.trim(),
        textureItem: textureItem.value.trim(),
        maxStackSize: Number(document.getElementById('maxStackSize').value),
        rarity: document.getElementById('rarity').value,
        glow: document.getElementById('glow').checked,
        tooltip: document.getElementById('tooltip').value,
        hardness: Number(document.getElementById('hardness').value),
        resistance: Number(document.getElementById('resistance').value),
        soundType: document.getElementById('soundType').value,
        requiresTool: requiresTool.checked,
        miningTool: miningTool.value,
      };
    }
    function preview() {
      updateAutomaticId();
      const current = ++revision;
      const value = draft();
      document.getElementById('specimenName').textContent = value.displayName || 'Untitled';
      document.getElementById('specimenId').textContent = value.id;
      document.getElementById('specimenMeta').textContent = kind === 'item' ? 'Stack: ' + value.maxStackSize + ' · ' + value.rarity : 'Hardness: ' + value.hardness + ' · ' + value.soundType;
      save.disabled = busy || !value.displayName || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value.id);
      vscode.postMessage({ type: 'preview', revision: current, draft: value });
    }
    function scheduleIcon() {
      clearTimeout(iconTimer);
      const value = textureItem.value.trim();
      textureIcon.hidden = true; specimenIcon.hidden = true;
      textureIcon.removeAttribute('src'); specimenIcon.removeAttribute('src');
      if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value)) return;
      iconTimer = setTimeout(() => {
        if (textureItem.value.trim() !== value) return;
        const requestId = ++iconSequence;
        pendingIcons.set(requestId, value);
        vscode.postMessage({ type: 'resolveRegistryIcon', requestId, value });
      }, 220);
    }
    document.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => {
      kind = button.dataset.kind;
      document.querySelectorAll('[data-kind]').forEach(candidate => candidate.setAttribute('aria-pressed', String(candidate === button)));
      document.getElementById('itemOptions').hidden = kind !== 'item';
      document.getElementById('blockOptions').hidden = kind !== 'block';
      document.getElementById('textureKind').textContent = kind === 'item' ? 'item' : 'block';
      if (idAutomatic) updateAutomaticId();
      preview();
    }));
    miningTool.addEventListener('change', () => {
      if (miningTool.value === 'none') requiresTool.checked = false;
      requiresTool.disabled = miningTool.value === 'none';
      preview();
    });
    requiresTool.addEventListener('change', preview);
    document.getElementById('editId').addEventListener('click', () => {
      idAutomatic = !idAutomatic;
      contentId.readOnly = idAutomatic;
      document.getElementById('editId').textContent = idAutomatic ? 'Edit' : 'Auto';
      if (idAutomatic) updateAutomaticId();
      else contentId.focus();
      preview();
    });
    document.getElementById('pickTexture').addEventListener('click', () => {
      const requestId = ++pickSequence;
      pendingPicks.set(requestId, true);
      vscode.postMessage({ type: 'pickRegistry', requestId, registry: kind === 'item' ? 'minecraft:item' : 'minecraft:block', current: textureItem.value, title: 'KubeVS — select a sample icon' });
    });
    document.addEventListener('input', event => {
      if (event.target === displayName) updateAutomaticId();
      if (event.target === textureItem) scheduleIcon();
      preview();
    });
    document.addEventListener('change', preview);
    save.addEventListener('click', () => {
      if (save.disabled || busy) return;
      busy = true; save.disabled = true; save.textContent = 'Saving…';
      status.className = 'status'; status.textContent = 'Creating the startup script through a safe diff…';
      vscode.postMessage({ type: 'save', revision: ++revision, draft: draft() });
    });
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'registryPicked') {
        if (pendingPicks.delete(message.requestId) && message.value) {
          textureItem.value = message.value;
          if (message.icon) {
            textureIcon.src = message.icon; specimenIcon.src = message.icon;
            textureIcon.hidden = false; specimenIcon.hidden = false;
          }
          textureItem.dispatchEvent(new Event('input', { bubbles: true }));
          textureItem.focus();
        }
      } else if (message.type === 'registryIcon') {
        const value = pendingIcons.get(message.requestId); pendingIcons.delete(message.requestId);
        if (value && value === textureItem.value.trim() && value === message.value && message.icon) {
          textureIcon.src = message.icon; specimenIcon.src = message.icon;
          textureIcon.hidden = false; specimenIcon.hidden = false;
        }
      } else if (message.type === 'preview' && message.revision === revision) {
        code.textContent = message.code; status.className = 'status'; status.textContent = 'Content is ready to save.';
      } else if (message.type === 'previewError' && message.revision === revision) {
        code.textContent = '// ' + message.message; status.className = 'status error'; status.textContent = message.message; save.disabled = true;
      } else if (message.type === 'saved') {
        busy = false; save.textContent = 'Save'; status.className = 'status'; status.textContent = 'Saved: ' + message.path + '. Restart Minecraft.'; preview();
      } else if (message.type === 'cancelled') {
        busy = false; save.textContent = 'Save'; status.className = 'status'; status.textContent = 'Save cancelled.'; preview();
      } else if (message.type === 'error') {
        busy = false; save.textContent = 'Save'; status.className = 'status error'; status.textContent = message.message; preview();
      }
    });
    updateAutomaticId(); scheduleIcon(); preview();
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
