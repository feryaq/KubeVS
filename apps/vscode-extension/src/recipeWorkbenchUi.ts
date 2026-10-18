/** Recipe editors share the Home palette while keeping their own form behavior. */
export function recipeWorkbenchHeader(title: string): string {
  const safe = title.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
  return `<header class="recipe-header"><div class="recipe-heading"><button id="openRecipeHome" class="recipe-home" type="button" title="Back to KubeVS" aria-label="Back to KubeVS"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg><span>KubeVS</span></button><span class="recipe-separator" aria-hidden="true">/</span><h1>${safe}</h1></div><button class="save" type="button" id="save">Save recipe</button></header>`;
}

export const recipeWorkbenchCss = `
body.recipe-workbench { margin:0; background:var(--vscode-editor-background); color:var(--vscode-editor-foreground); }
.recipe-workbench .recipe-header { display:flex; align-items:center; justify-content:space-between; gap:16px; width:min(1280px,calc(100% - 48px)); min-height:48px; margin:28px auto 24px; padding:0; border:0; background:transparent; }
.recipe-heading { display:flex; align-items:center; gap:14px; min-width:0; }
.recipe-workbench .recipe-home { display:flex; align-items:center; gap:10px; padding:0; border:0; background:transparent; min-height:36px; font-size:21px; font-weight:600; letter-spacing:-.6px; }
.recipe-home svg { width:25px; height:25px; flex:none; color:var(--kvs-accent); }
.recipe-separator { color:var(--vscode-descriptionForeground); opacity:.5; font-size:20px; }
.recipe-workbench h1 { margin:0; font-size:14px; font-weight:500; letter-spacing:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.recipe-workbench .save { margin-left:auto; min-height:34px; padding:7px 15px; border-radius:7px; white-space:nowrap; }
.recipe-workbench main.recipe-layout { display:grid; grid-template-columns:196px minmax(0,1fr) minmax(270px,.72fr); align-items:start; gap:20px; min-height:0; width:min(1280px,calc(100% - 48px)); margin:0 auto; padding:0 0 36px; }
.recipe-workbench .recipe-rail { min-width:0; border:0; padding:0; background:transparent; }
.recipe-workbench .recipe-editor { min-width:0; padding:22px; border:1px solid var(--kvs-line); border-radius:12px; background:var(--kvs-surface); }
.recipe-workbench .recipe-editor > .section:first-child { padding-top:0; margin-top:0; border-top:0; }
.recipe-workbench .section { padding:20px 0 0; margin:20px 0 0; border-top:1px solid var(--kvs-line); }
.recipe-workbench .section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
.recipe-workbench h2 { margin:0 0 12px; color:var(--vscode-descriptionForeground); font-size:12px; font-weight:500; }
.recipe-workbench .section-head h2 { margin:0; }
.recipe-workbench label { margin-bottom:14px; color:var(--vscode-descriptionForeground); font-size:12px; }
.recipe-workbench label > input,.recipe-workbench input,.recipe-workbench textarea { color:var(--vscode-input-foreground); }
.recipe-workbench .recipe-preview { position:sticky; top:20px; padding:18px; min-width:0; border:1px solid var(--kvs-line); border-radius:12px; background:transparent; }
.recipe-workbench .recipe-preview pre { min-height:220px; max-height:calc(100vh - 230px); padding:14px; margin:0; white-space:pre-wrap; overflow-wrap:anywhere; overflow:auto; border:0; background:var(--kvs-surface); border-radius:8px; font-size:11px; line-height:1.7; }
.recipe-workbench .recipe-preview summary {cursor:pointer;font-size:12px;color:var(--vscode-descriptionForeground);font-weight:500}.recipe-workbench .recipe-preview .preview-content{margin-top:12px}.recipe-workbench .preview-tools { margin-bottom:10px; }
.recipe-workbench .status { min-height:18px; margin:12px 0 0; font-size:11px; color:var(--vscode-descriptionForeground); }
.recipe-workbench .status.error { color:var(--vscode-errorForeground); }
.recipe-workbench .recipe-rail button.type-button { width:100%; text-align:left; padding:9px 11px; border-radius:7px; min-height:36px; }
.recipe-workbench .recipe-rail button.type-button[aria-pressed="true"] { background:var(--kvs-soft); border-color:var(--kvs-line); }
.recipe-workbench .recipe-type-list { display:grid; gap:3px; }
.recipe-workbench details.recipe-details { padding-top:16px; margin-top:20px; border-top:1px solid var(--kvs-line); }
.recipe-workbench details.recipe-details > summary { cursor:pointer; color:var(--vscode-descriptionForeground); padding:2px 0 12px; font-size:12px; }
.recipe-workbench details.recipe-details[open] > summary { margin-bottom:6px; }
.recipe-workbench .recipe-search { width:100%; margin-bottom:12px; }
.recipe-workbench .hint { font-size:11px; }
.recipe-workbench .row { min-width:0; }
@media(min-width:1600px){.recipe-workbench .recipe-header,.recipe-workbench main.recipe-layout{width:min(1360px,calc(100% - 96px));}}
@media(max-width:1120px){.recipe-workbench main.recipe-layout{grid-template-columns:184px minmax(0,1fr);}.recipe-workbench .recipe-preview{grid-column:2;position:static;}.recipe-workbench .recipe-preview pre{max-height:440px;}.recipe-workbench .recipe-rail{grid-row:1 / span 2;}}
@media(max-width:700px){.recipe-workbench .recipe-header{width:calc(100% - 28px);margin:16px auto 18px;gap:10px;}.recipe-heading{gap:9px;}.recipe-workbench .recipe-home{font-size:18px;gap:7px;}.recipe-home svg{width:21px;height:21px;}.recipe-workbench h1{font-size:12px;}.recipe-workbench main.recipe-layout{display:flex;flex-direction:column;width:calc(100% - 28px);gap:14px;}.recipe-workbench .recipe-rail,.recipe-workbench .recipe-editor,.recipe-workbench .recipe-preview{width:100%;}.recipe-workbench .recipe-rail{grid-row:auto;}.recipe-workbench .recipe-editor{padding:17px;}.recipe-workbench .recipe-preview{padding:16px;}.recipe-workbench .recipe-type-list{grid-template-columns:repeat(2,minmax(0,1fr));}.recipe-workbench .recipe-rail button.type-button{min-height:36px;padding:8px 10px;}.recipe-workbench .save{padding:7px 11px;font-size:12px;}}
@media(max-width:380px){.recipe-workbench .recipe-home span{display:none;}.recipe-workbench .recipe-separator{display:none;}}
`;
