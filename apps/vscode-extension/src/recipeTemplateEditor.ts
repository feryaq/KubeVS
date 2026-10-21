import * as vscode from 'vscode';
import {
  buildRecipeFromSchema,
  inferRecipeSchemaFromJson,
  parseRecipeSchema,
  type RecipeSchemaDefinition,
  type ResourceId,
} from '@kubevs/recipe-model';
import {
  parseRecipePack,
  recipePackFileName,
  serializeRecipePack,
  type RecipePack,
} from './recipePacks.js';
import { writeFileWithDiff } from './safeWrite.js';
import { workbenchCss } from './workbenchUi.js';

const PACK_DIRECTORY = ['.kubevs', 'recipe-packs'];
const KINDS = [
  'string',
  'resource_id',
  'ingredient',
  'item_stack',
  'number',
  'integer',
  'boolean',
  'enum',
  'json',
];

function folderForTemplates(): vscode.WorkspaceFolder {
  const active = vscode.window.activeTextEditor?.document.uri;
  const folder =
    (active && vscode.workspace.getWorkspaceFolder(active)) ??
    vscode.workspace.workspaceFolders?.find(
      (candidate) => candidate.uri.scheme !== 'kubevs-remote',
    );
  if (!folder) throw new Error('Open a project folder to install recipe packs.');
  if (folder.uri.scheme === 'kubevs-remote')
    throw new Error('Open a local project folder to install recipe packs.');
  return folder;
}

async function writePack(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  pack: RecipePack,
): Promise<vscode.Uri | undefined> {
  const directory = vscode.Uri.joinPath(folder.uri, ...PACK_DIRECTORY);
  const target = vscode.Uri.joinPath(directory, recipePackFileName(pack.id));
  await vscode.workspace.fs.createDirectory(directory);
  const written = await writeFileWithDiff(context, target, serializeRecipePack(pack), {
    diffTitle: 'KubeVS recipe pack: current ↔ proposed',
    confirmation: `Replace ${vscode.workspace.asRelativePath(target)}? Review the proposed recipe pack first.`,
  });
  return written ? target : undefined;
}

export async function importRecipePack(
  context: vscode.ExtensionContext,
  folder = folderForTemplates(),
): Promise<RecipePack | undefined> {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'KubeVS recipe packs': ['json'] },
    title: 'Import KubeVS recipe pack',
    openLabel: 'Import pack',
  });
  const source = files?.[0];
  if (!source) return undefined;
  const bytes = await vscode.workspace.fs.readFile(source);
  if (bytes.byteLength > 1024 * 1024) throw new Error('Recipe pack exceeds 1 MiB.');
  const pack = parseRecipePack(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown,
  );
  return (await writePack(context, folder, pack)) ? pack : undefined;
}

/** Native file dialogs are invoked only by user actions inside this editor. */
export async function openRecipeTemplateEditor(context: vscode.ExtensionContext): Promise<void> {
  const folder = folderForTemplates();
  const current = vscode.window.activeTextEditor?.document;
  const initial = current?.languageId.startsWith('json') ? current.getText().slice(0, 65536) : '';
  const panel = vscode.window.createWebviewPanel(
    'kubevs.recipeTemplateEditor',
    'KubeVS — Recipe Templates',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    '',
  );
  let sourceSchema: RecipeSchemaDefinition | undefined;
  let imported: RecipePack | undefined;
  let disposed = false;
  panel.onDidDispose(() => {
    disposed = true;
  });
  panel.webview.onDidReceiveMessage(
    async (value: unknown) => {
      if (typeof value !== 'object' || value === null) return;
      const message = value as Record<string, unknown>;
      const revision = message.revision;
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return;
      try {
        if (message.type === 'infer') {
          if (
            typeof message.source !== 'string' ||
            message.source.length > 65536 ||
            typeof message.id !== 'string' ||
            typeof message.label !== 'string'
          )
            throw new Error('Supply a template name, ID and a recipe JSON object.');
          sourceSchema = inferRecipeSchemaFromJson({
            id: message.id as ResourceId,
            label: message.label,
            json: JSON.parse(message.source) as unknown,
          });
          await panel.webview.postMessage({ type: 'inferred', revision, schema: sourceSchema });
          return;
        }
        if (message.type === 'import') {
          const pack = await importRecipePack(context, folder);
          if (pack) {
            imported = pack;
            sourceSchema = pack.schemas[0];
            await panel.webview.postMessage({ type: 'imported', revision, pack });
          } else await panel.webview.postMessage({ type: 'cancelled', revision });
          return;
        }
        if (message.type === 'selectTemplate') {
          const selected = imported?.schemas.find((schema) => schema.id === message.id);
          if (!selected) throw new Error('Select a template from the imported pack.');
          sourceSchema = selected;
          await panel.webview.postMessage({ type: 'inferred', revision, schema: selected });
          return;
        }
        if (!['previewTemplate', 'saveTemplate', 'exportPack'].includes(String(message.type)))
          return;
        if (!sourceSchema) throw new Error('Read the recipe fields first.');
        if (
          !Array.isArray(message.fields) ||
          message.fields.length === 0 ||
          message.fields.length > 100
        )
          throw new Error('Keep at least one editable field.');
        // The recipe base always comes from the backend inference, never the webview.
        const schema = parseRecipeSchema({
          ...sourceSchema,
          id: message.id,
          label: message.label,
          fields: message.fields,
        });
        if (message.type === 'previewTemplate') {
          let recipe: Readonly<Record<string, unknown>> | undefined;
          let previewError: string | undefined;
          try {
            recipe = buildRecipeFromSchema(schema, { values: {} });
          } catch (error) {
            previewError = error instanceof Error ? error.message : String(error);
          }
          await panel.webview.postMessage({
            type: 'templatePreview',
            revision,
            recipe,
            previewError,
          });
          return;
        }
        const basePack = imported ?? {
          format: 'kubevs-recipe-pack',
          version: 1,
          id: schema.id,
          name: schema.label,
          schemas: [],
        };
        const pack = parseRecipePack({
          ...basePack,
          schemas: [
            ...basePack.schemas.filter(
              (candidate) => candidate.id !== sourceSchema?.id && candidate.id !== schema.id,
            ),
            schema,
          ],
        });
        if (message.type === 'exportPack') {
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(folder.uri, recipePackFileName(pack.id)),
            filters: { 'KubeVS recipe pack': ['json'] },
            title: 'Export KubeVS recipe pack',
            saveLabel: 'Export pack',
          });
          if (!uri) {
            await panel.webview.postMessage({ type: 'cancelled', revision });
            return;
          }
          const written = await writeFileWithDiff(context, uri, serializeRecipePack(pack), {
            diffTitle: 'KubeVS recipe pack: current ↔ exported',
            confirmation: 'Replace this file with the exported recipe pack?',
          });
          await panel.webview.postMessage({
            type: written ? 'exported' : 'cancelled',
            revision,
            path: vscode.workspace.asRelativePath(uri),
          });
          return;
        }
        // Preserve sibling templates when editing a pack already installed under this ID.
        const target = vscode.Uri.joinPath(
          folder.uri,
          ...PACK_DIRECTORY,
          recipePackFileName(pack.id),
        );
        let installed: RecipePack | undefined;
        try {
          installed = parseRecipePack(
            JSON.parse(
              new TextDecoder().decode(await vscode.workspace.fs.readFile(target)),
            ) as unknown,
          );
        } catch (error) {
          if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound'))
            throw error;
        }
        const merged = parseRecipePack({
          ...pack,
          schemas: [
            ...(installed?.schemas ?? []).filter(
              (candidate) =>
                candidate.id !== sourceSchema?.id &&
                !pack.schemas.some((next) => next.id === candidate.id),
            ),
            ...pack.schemas,
          ],
        });
        const written = await writePack(context, folder, merged);
        if (written) {
          imported = merged;
          sourceSchema = schema;
        }
        if (!disposed)
          await panel.webview.postMessage({
            type: written ? 'templateSaved' : 'cancelled',
            revision,
            path: written ? vscode.workspace.asRelativePath(written) : undefined,
          });
      } catch (error) {
        if (!disposed)
          await panel.webview.postMessage({
            type: 'templateError',
            revision,
            message: error instanceof Error ? error.message : String(error),
          });
      }
    },
    undefined,
    context.subscriptions,
  );
  panel.webview.html = recipeTemplateEditorHtml(panel.webview, nonce, initial);
}

export function recipeTemplateEditorHtml(
  webview: Pick<vscode.Webview, 'cspSource'>,
  nonce: string,
  source = '',
): string {
  const initial = JSON.stringify(source).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><title>Recipe templates</title><style>
  ${workbenchCss}
  *{box-sizing:border-box}body{margin:0;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size,13px)/1.45 var(--vscode-font-family,system-ui)}button,input,select,textarea{font:inherit}button,input,select,textarea{border:1px solid var(--vscode-panel-border);border-radius:5px}button{padding:6px 11px;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);cursor:pointer}button:hover{background:var(--vscode-button-secondaryHoverBackground)}button.primary{color:var(--vscode-button-foreground);background:var(--vscode-button-background)}button:disabled{opacity:.5;cursor:default}input,select,textarea{min-width:0;color:var(--vscode-input-foreground);background:var(--vscode-input-background);padding:7px}input::placeholder,textarea::placeholder{color:var(--vscode-input-placeholderForeground)}:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}header{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:16px 22px;border-bottom:1px solid var(--vscode-panel-border)}h1{margin:0 auto 0 0;font-size:16px}main{max-width:1280px;margin:auto;padding:24px;display:grid;grid-template-columns:minmax(250px,.85fr) minmax(360px,1.3fr);gap:28px}section{min-width:0}.identity{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-bottom:14px}label{display:grid;gap:5px;font-size:12px}#source{width:100%;min-height:330px;resize:vertical;font:12px/1.55 var(--vscode-editor-font-family,monospace)}.source-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}#packTemplates{max-width:230px}#packTemplates[hidden]{display:none}#status{min-height:22px;margin:12px 0 0;overflow-wrap:anywhere;color:var(--vscode-descriptionForeground)}#status.error{color:var(--vscode-errorForeground)}.field-head,.field-row{display:grid;grid-template-columns:24px minmax(130px,1fr) 116px minmax(110px,.9fr);gap:8px;align-items:start}.field-head{color:var(--vscode-descriptionForeground);font-size:11px;margin-bottom:8px}.field-row{padding:11px 0;border-bottom:1px solid var(--vscode-panel-border)}.field-row input[type=checkbox]{margin-top:10px;accent-color:var(--vscode-button-background)}.field-row .label-input{width:100%}.field-row code{display:block;margin-top:4px;color:var(--vscode-descriptionForeground);font:10px/1.4 var(--vscode-editor-font-family,monospace);overflow-wrap:anywhere}.field-row textarea{width:100%;height:35px;resize:vertical;font:11px/1.4 var(--vscode-editor-font-family,monospace)}.defaults{min-width:0;display:grid;gap:6px}.enum-options[hidden]{display:none}.field-row.excluded{opacity:.55}.empty{color:var(--vscode-descriptionForeground);padding:20px 0}.preview{margin-top:18px}summary{cursor:pointer;color:var(--vscode-descriptionForeground);font-size:12px}pre{font:11px/1.5 var(--vscode-editor-font-family,monospace);max-height:340px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}#preview{margin-top:10px} @media(max-width:900px){main{grid-template-columns:minmax(0,1fr);gap:20px}#source{min-height:220px}} @media(max-width:520px){header{padding:12px}header h1{flex-basis:100%}main{padding:14px 12px}.identity{grid-template-columns:minmax(0,1fr)}.field-head{display:none}.field-row{grid-template-columns:22px minmax(0,1fr) 105px}.field-row .defaults{grid-column:2/-1}.field-row textarea{height:55px}.field-row .label-input{max-width:100%}#source{min-height:200px}}
  </style></head><body><header><h1>Recipe templates</h1><button id="import">Import pack</button><button id="export" disabled>Export pack</button><button id="save" class="primary" disabled>Save template</button></header><main><section><div class="identity"><label>Name<input id="name" maxlength="80" placeholder="Pressure chamber"></label><label>Template ID<input id="id" maxlength="200" value="custom:my_machine" spellcheck="false"></label></div><textarea id="source" spellcheck="false" aria-label="Example recipe JSON" placeholder='Paste an existing recipe JSON with its "type".'></textarea><div class="source-actions"><button id="infer">Read fields</button><select id="packTemplates" aria-label="Templates in imported pack" hidden></select></div><p id="status" role="status"></p></section><section><div class="field-head" aria-hidden="true"><span></span><span>Field</span><span>Editor</span><span>Default</span></div><div id="fields"><p class="empty">Paste a recipe to choose its editable fields.</p></div><details class="preview"><summary>Recipe preview</summary><pre id="preview"></pre></details></section></main><script nonce="${nonce}">
  const vscode=acquireVsCodeApi(),source=document.getElementById('source'),nameInput=document.getElementById('name'),idInput=document.getElementById('id'),fields=document.getElementById('fields'),status=document.getElementById('status'),save=document.getElementById('save'),exportButton=document.getElementById('export');let schema,revision=0,requestRevision=0,busy=false,valid=false,previewTimer;
  source.value=${initial};const saved=vscode.getState();if(saved){source.value=saved.source||source.value;nameInput.value=saved.name||'';idInput.value=saved.id||idInput.value}
  const kinds=${JSON.stringify(KINDS)};
  function setStatus(message,error=false){status.textContent=message;status.className=error?'error':''}
  function remember(){vscode.setState({source:source.value,name:nameInput.value,id:idInput.value})}
  function enable(){document.querySelectorAll('input,textarea,select,button').forEach(control=>control.disabled=busy);save.disabled=busy||!schema||!valid;exportButton.disabled=save.disabled}
  function collect(){return Array.from(fields.querySelectorAll('.field-row')).filter(row=>row.querySelector('input[type=checkbox]').checked).map(row=>{const original=schema.fields[Number(row.dataset.index)],kind=row.querySelector('select').value,raw=row.querySelector('.default-input').value;let value;if(raw!==''){try{value=JSON.parse(raw)}catch{throw new Error(original.label+': default must be valid JSON')}}const field={...original,label:row.querySelector('.label-input').value,kind};delete field.options;if(kind==='enum'){try{field.options=JSON.parse(row.querySelector('.enum-options').value)}catch{throw new Error(original.label+': choices must be a JSON list')}}if(value===undefined)delete field.default;else field.default=value;return field})}
  function send(type){try{const selected=collect();requestRevision=++revision;vscode.postMessage({type,revision:requestRevision,id:idInput.value,label:nameInput.value,fields:selected});if(type!=='previewTemplate'){busy=true;enable();setStatus(type==='saveTemplate'?'Saving template…':'Exporting pack…')}}catch(error){valid=false;enable();setStatus(error.message,true)}}
  function resizeDefaults(){fields.querySelectorAll('textarea').forEach(input=>{input.style.height='35px';input.style.height=Math.min(160,Math.max(35,input.scrollHeight+2))+'px'})}
  window.addEventListener('resize',resizeDefaults);
  function preview(){resizeDefaults();requestRevision=++revision;valid=false;enable();remember();clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(schema&&!busy)send('previewTemplate')},120)}
  function render(next){schema=next;valid=false;nameInput.value=next.label;idInput.value=next.id;source.value=JSON.stringify(next.base||{},null,2);source.scrollTop=0;fields.replaceChildren();next.fields.forEach((field,index)=>{const row=document.createElement('div');row.className='field-row';row.dataset.index=index;const include=document.createElement('input');include.type='checkbox';include.checked=true;include.setAttribute('aria-label','Edit '+field.path);const name=document.createElement('div'),label=document.createElement('input'),path=document.createElement('code');label.className='label-input';label.value=field.label;label.setAttribute('aria-label','Label for '+field.path);path.textContent=field.path;name.append(label,path);const kind=document.createElement('select');kind.setAttribute('aria-label','Editor for '+field.path);kinds.forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=value;kind.append(option)});kind.value=field.kind;const value=document.createElement('textarea');value.className='default-input';value.setAttribute('aria-label','Default for '+field.path);value.value=field.default===undefined?'':JSON.stringify(field.default);const defaults=document.createElement('div');defaults.className='defaults';const choices=document.createElement('textarea');choices.className='enum-options';choices.hidden=field.kind!=='enum';choices.value=JSON.stringify(field.options||[]);choices.placeholder='["low", "high"]';choices.title='Enum choices (JSON list)';choices.setAttribute('aria-label','Choices for '+field.path);kind.onchange=()=>{choices.hidden=kind.value!=='enum';if(kind.value==='enum'&&choices.value==='[]'){try{const current=JSON.parse(value.value);if(typeof current==='string')choices.value=JSON.stringify([current])}catch{}}};defaults.append(value,choices);row.append(include,name,kind,defaults);include.onchange=()=>row.classList.toggle('excluded',!include.checked);row.addEventListener('input',preview);row.addEventListener('change',preview);fields.append(row)});preview()}
  source.addEventListener('input',()=>{requestRevision=++revision;clearTimeout(previewTimer);schema=undefined;valid=false;fields.replaceChildren();document.getElementById('preview').textContent='';enable();remember();setStatus('Read fields to update the template.')});nameInput.oninput=idInput.oninput=preview;
  document.getElementById('infer').onclick=()=>{try{const raw=JSON.parse(source.value);if(!nameInput.value)nameInput.value=String(raw.type||'Recipe').split(':').pop().replaceAll('_',' ');if(idInput.value==='custom:my_machine'&&typeof raw.type==='string')idInput.value='custom:'+raw.type.split(':').pop();requestRevision=++revision;busy=true;enable();setStatus('Reading recipe fields…');vscode.postMessage({type:'infer',revision:requestRevision,id:idInput.value,label:nameInput.value,source:source.value})}catch(error){setStatus(error.message,true)}};
  document.getElementById('import').onclick=()=>{requestRevision=++revision;busy=true;enable();vscode.postMessage({type:'import',revision:requestRevision})};save.onclick=()=>send('saveTemplate');exportButton.onclick=()=>send('exportPack');
  document.getElementById('packTemplates').onchange=function(){requestRevision=++revision;busy=true;enable();vscode.postMessage({type:'selectTemplate',revision:requestRevision,id:this.value})};
  window.addEventListener('message',event=>{const m=event.data;if(m.revision!==requestRevision)return;busy=false;if(m.type==='inferred'){render(m.schema);setStatus('')}else if(m.type==='imported'){const select=document.getElementById('packTemplates');select.replaceChildren();m.pack.schemas.forEach(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.label;select.append(o)});select.hidden=m.pack.schemas.length<2;render(m.pack.schemas[0]);setStatus('Pack installed.')}else if(m.type==='templatePreview'){valid=true;document.getElementById('preview').textContent=m.recipe?JSON.stringify(m.recipe,null,2):'';setStatus(m.previewError?'Template valid · '+m.previewError:'')}else if(m.type==='templateError'){valid=false;setStatus(m.message,true)}else if(m.type==='templateSaved'){valid=true;setStatus('Saved · '+m.path)}else if(m.type==='exported'){valid=true;setStatus('Exported · '+m.path)}else if(m.type==='cancelled'){setStatus('Cancelled');preview()}enable()});
  </script></body></html>`;
}
