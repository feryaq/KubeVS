import * as vscode from 'vscode';

/** Shared visual language. Layouts remain owned by their individual workbenches. */
export const workbenchCss = `
:root {
  color-scheme: light dark;
  --kvs-accent: var(--vscode-focusBorder, #aa96ed);
  --kvs-line: color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent);
  --kvs-soft: color-mix(in srgb, var(--kvs-accent) 9%, var(--vscode-editor-background));
  --kvs-surface: color-mix(in srgb, var(--vscode-editor-foreground) 3%, var(--vscode-editor-background));
}
* { box-sizing: border-box; }
body { font: 13px/1.5 var(--vscode-font-family, system-ui); }
body > header {
  min-height: 64px; padding: 14px 22px; gap: 18px; border-bottom: 1px solid var(--kvs-line);
  background: var(--vscode-editor-background);
}
h1 { font-size: 17px; font-weight: 600; letter-spacing: -.025em; }
h2 { font-size: 12px; font-weight: 600; letter-spacing: 0; color: var(--vscode-descriptionForeground); }
button, input, select, textarea { font: inherit; }
button {
  min-height: 32px; border-radius: 7px; padding: 6px 11px;
  border: 1px solid var(--kvs-line); cursor: pointer; transition: background 120ms, border-color 120ms;
}
button:where(:not(.primary):not(.save)) {
  color: var(--vscode-editor-foreground); background: var(--kvs-surface);
}
button:where(:not(.primary):not(.save)):hover { background: var(--kvs-soft); border-color: var(--kvs-accent); }
button.primary, button.save {
  background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent;
}
button.primary:hover, button.save:hover { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: .48; cursor: default; }
input, select, textarea {
  border: 1px solid var(--vscode-input-border, var(--kvs-line)); border-radius: 6px;
  color: var(--vscode-input-foreground); background: var(--vscode-input-background); min-width: 0;
}
input:not(.slot), select { min-height: 33px; padding: 6px 9px; }
textarea { padding: 10px 12px; line-height: 1.55; }
input:hover, textarea:hover, select:hover { border-color: var(--kvs-accent); }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible {
  outline: 2px solid var(--kvs-accent); outline-offset: 2px;
}
input[readonly] { color: var(--vscode-descriptionForeground); }

.picker, .id-editor { min-width: 0; }
.picker.has-icon, .picker.with-icon { grid-template-columns: minmax(0, 1fr) 34px; }
.picker.has-icon:has(img:not([hidden])), .picker.with-icon:has(img:not([hidden])) { grid-template-columns: 28px minmax(0, 1fr) 34px; }
.picker > button { min-width: 32px; width: 32px; padding: 4px; }
.texture-picker { grid-template-columns: minmax(0, 1fr) 34px; }
.texture-picker:has(img:not([hidden])) { grid-template-columns: 30px minmax(0, 1fr) 34px; }
.texture-picker > button { min-width: 32px; width: 32px; padding: 4px; }
.picker > input, .picker > textarea { min-width: 0; width: 100%; }
.picker:has(textarea) { grid-template-columns: minmax(0, 1fr) auto; }
.picker:has(textarea) > button { width: auto; padding: 6px 10px; }
.row:has(#output) { grid-template-columns: minmax(0, 1fr) 60px; }

.types { gap: 4px; }
nav button.type-button { background: transparent; color: var(--vscode-editor-foreground); border: 1px solid transparent; margin: 1px 0; }
nav button.type-button[aria-pressed="true"] { background: var(--kvs-soft); color: var(--vscode-editor-foreground); border-color: var(--kvs-accent); }
.kind-switch button[aria-pressed="true"] { background: var(--kvs-soft); color: var(--vscode-editor-foreground); border-color: var(--kvs-accent); }

.types button { border-radius: 6px; }
.types button[aria-pressed="true"] { background: var(--kvs-soft); color: var(--vscode-editor-foreground); border-color: var(--kvs-accent); }
aside, main > section { min-width: 0; }
.preview { background: var(--kvs-surface); }
pre {
  border: 1px solid var(--kvs-line); border-radius: 8px; background: var(--vscode-editor-background);
  font: 12px/1.65 var(--vscode-editor-font-family, monospace); tab-size: 2;
}
.preview-tools { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin: 0 0 8px; }
.preview-tools button { font-size: 11px; min-height: 28px; }
.status { overflow-wrap: anywhere; }
.subtitle { display: none; }
.crafting { border: 1px solid var(--kvs-line); border-radius: 12px; box-shadow: none; background: var(--kvs-surface); }
.slot { border-radius: 7px; border-color: var(--kvs-line); }
.slot:not(:placeholder-shown) { background: var(--kvs-soft); }
.result-mark { border-radius: 9px; color: var(--kvs-accent); }
.cube { border-radius: 8px; background: var(--kvs-soft); color: var(--kvs-accent); box-shadow: none; }
[hidden] { display: none !important; }
@media (max-width: 620px) {
  body > header { padding: 12px 16px; gap: 10px; flex-wrap: wrap; }
  main { min-width: 0; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
@media (forced-colors: active) {
  button, input, select, textarea, pre, .crafting { border: 1px solid CanvasText; }
  button:focus-visible { outline-color: Highlight; }
}
`;

export async function handleWorkbenchMessage(
  value: unknown,
  webview: vscode.Webview,
): Promise<boolean> {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as { type?: unknown; code?: unknown };
  if (message.type === 'openRecipeHome') {
    await vscode.commands.executeCommand('kubevs.openDashboard');
    return true;
  }
  if (message.type !== 'copyCode') return false;
  if (typeof message.code !== 'string' || message.code.length > 1_048_576) return true;
  await vscode.env.clipboard.writeText(message.code);
  await webview.postMessage({ type: 'copied' });
  return true;
}

/** Uses the panel's existing API instance and validation; never generates or saves code itself. */
export function editorUtilities(): string {
  return `
    document.getElementById('openRecipeHome')?.addEventListener('click', () => vscode.postMessage({type:'openRecipeHome'}));
    const recipePreview = document.querySelector('.recipe-preview > details');
    if (recipePreview && window.matchMedia('(max-width: 700px)').matches) recipePreview.open = false;
    const previewCode = document.getElementById('code');
    if (previewCode) {
      const tools = document.createElement('div');
      tools.className = 'preview-tools';
      const copy = document.createElement('button');
      copy.type = 'button'; copy.textContent = 'Copy'; copy.title = 'Copy generated JavaScript';
      copy.setAttribute('aria-label', 'Copy generated JavaScript');
      copy.addEventListener('click', () => {
        if (previewCode.textContent.trim()) vscode.postMessage({type:'copyCode',code:previewCode.textContent});
      });
      tools.append(copy); previewCode.before(tools);
      window.addEventListener('message', event => {
        if (event.data.type === 'copied') { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1600); }
      });
    }
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); const button = document.getElementById('save');
        if (button && !button.disabled) button.click();
      }
    });
  `;
}
