import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { RegistryBrowsePage, RegistryCatalog } from './registryCatalog.js';
import { workbenchCss } from './workbenchUi.js';

const panels = new WeakMap<vscode.ExtensionContext, vscode.WebviewPanel>();
const RESOURCE_ID = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/u;

export function openRegistryBrowser(
  context: vscode.ExtensionContext,
  catalog: RegistryCatalog,
): void {
  const existing = panels.get(context);
  if (existing) {
    existing.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'kubevs.registryBrowser',
    'KubeVS · Registries',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panels.set(context, panel);
  panel.onDidDispose(() => panels.delete(context));
  let revision = 0;
  let current: RegistryBrowsePage | undefined;
  panel.webview.onDidReceiveMessage(async (value: unknown) => {
    if (typeof value !== 'object' || value === null) return;
    const message = value as Record<string, unknown>;
    try {
      if (message.type === 'ready') {
        await panel.webview.postMessage({
          type: 'choices',
          entries: await catalog.browseChoices(),
        });
      } else if (
        message.type === 'browse' &&
        typeof message.query === 'string' &&
        message.query.length <= 200 &&
        typeof message.registry === 'string' &&
        RESOURCE_ID.test(message.registry) &&
        Number.isSafeInteger(message.offset) &&
        (message.offset as number) >= 0 &&
        (message.offset as number) <= 100_000 &&
        typeof message.tagsOnly === 'boolean'
      ) {
        const request = ++revision;
        const page = await catalog.browse(
          message.query,
          message.registry,
          message.offset as number,
          message.tagsOnly,
        );
        if (request !== revision) return;
        current = page;
        await panel.webview.postMessage({ type: 'page', ...page });
        const icons = await catalog.iconDataUris(
          page.entries
            .filter((entry) => entry.registry === 'minecraft:item')
            .map((entry) => entry.id),
        );
        if (request === revision)
          await panel.webview.postMessage({ type: 'icons', entries: icons });
      } else if (
        (message.type === 'copy' || message.type === 'inspect') &&
        typeof message.id === 'string'
      ) {
        const entry = current?.entries.find((entry) => entry.id === message.id);
        if (!entry) return;
        if (message.type === 'copy') {
          await vscode.env.clipboard.writeText(entry.id);
          await panel.webview.postMessage({ type: 'copied', id: entry.id });
        } else {
          const members = entry.id.startsWith('#')
            ? await catalog.tagEntries(entry.id, entry.registry)
            : [];
          await panel.webview.postMessage({
            type: 'detail',
            entry,
            members: members.slice(0, 128),
            total: members.length,
          });
        }
      }
    } catch (error) {
      await panel.webview.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  panel.webview.html = registryBrowserHtml(panel.webview, randomBytes(16).toString('hex'));
}

export function registryBrowserHtml(webview: vscode.Webview, nonce: string): string {
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>KubeVS · Registries</title>
<style nonce="${nonce}">${workbenchCss}
body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground)}header{display:flex;align-items:center;gap:14px}h1{margin:0;white-space:nowrap}header input{flex:1;max-width:600px}header select{max-width:180px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;min-height:calc(100vh - 65px)}.catalog{padding:20px 24px}.catalog-bar{display:flex;align-items:center;gap:16px;margin-bottom:15px;font-size:12px;color:var(--vscode-descriptionForeground)}.tag-toggle{display:flex;align-items:center;gap:6px;white-space:nowrap}.tag-toggle input{min-height:0;accent-color:var(--kvs-accent)}.count{margin-left:auto;font-variant-numeric:tabular-nums}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:7px}.entry{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr);align-items:center;gap:11px;min-height:68px;padding:12px;border:1px solid var(--kvs-line);border-radius:8px;cursor:pointer;background:var(--kvs-surface)}.entry:hover,.entry[aria-selected="true"]{border-color:var(--kvs-accent);background:var(--kvs-soft)}.entry img{width:32px;height:32px;object-fit:contain;image-rendering:pixelated;grid-area:1/1}.entry img:not([src]){visibility:hidden}.glyph{color:var(--vscode-descriptionForeground);grid-area:1/1;text-align:center;font-size:22px}.entry.has-icon .glyph{visibility:hidden}.entry strong{display:block;font-weight:550;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.entry code{display:block;margin-top:3px;color:var(--vscode-descriptionForeground);font:10px var(--vscode-editor-font-family);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.detail{padding:24px 20px;border-left:1px solid var(--kvs-line);background:var(--kvs-surface);overflow-wrap:anywhere}.detail h2{margin:0 0 12px;font-size:15px;color:var(--vscode-editor-foreground)}.detail code{display:block;font:12px/1.6 var(--vscode-editor-font-family);margin-bottom:16px}.detail .meta{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:18px}.members{padding-left:0;list-style:none;font:11px/1.9 var(--vscode-editor-font-family);max-height:60vh;overflow:auto}.members li{border-bottom:1px solid var(--kvs-line);padding:5px 0}.empty{grid-column:1/-1;padding:50px 15px;text-align:center;color:var(--vscode-descriptionForeground)}.pagination{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}.status{font-size:12px;color:var(--vscode-descriptionForeground)}.status.error{color:var(--vscode-errorForeground)}
@media(max-width:850px){.layout{grid-template-columns:minmax(0,1fr) 230px}.catalog{padding:18px 16px}.grid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}}
@media(max-width:620px){header{flex-wrap:wrap}header input{flex-basis:100%;order:2}.layout{grid-template-columns:1fr}.detail{border-left:0;border-top:1px solid var(--kvs-line)}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.entry{grid-template-columns:24px minmax(0,1fr);gap:7px;padding:10px}.entry img{width:24px;height:24px}}
</style></head><body><header><h1>Registries</h1><input type="search" id="query" placeholder="Search names, IDs or tags…" aria-label="Search registries" maxlength="200"><select id="registry" aria-label="Registry"><option value="minecraft:item">Items</option></select></header>
<main class="layout"><section class="catalog"><div class="catalog-bar"><span id="source">Loading…</span><label class="tag-toggle"><input type="checkbox" id="tags">Tags only</label><span class="count" id="count"></span></div><div id="entries" class="grid" role="listbox" aria-label="Registry entries"></div><div class="pagination"><span class="status" id="status" role="status" aria-live="polite"></span><button id="previous" disabled aria-label="Previous page">←</button><button id="next" disabled aria-label="Next page">→</button></div></section><aside class="detail"><h2 id="name">Select an entry</h2><code id="id"></code><button id="copy" disabled>Copy ID</button><div class="meta" id="meta"></div><ul class="members" id="members"></ul></aside></main>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(),query=document.getElementById('query'),registry=document.getElementById('registry'),tags=document.getElementById('tags'),entries=document.getElementById('entries'),status=document.getElementById('status');let offset=0,selected='',timer,pageEntries=[];
const restored=vscode.getState();if(restored){query.value=restored.query||'';tags.checked=restored.tagsOnly===true}
function browse(reset=true){if(reset)offset=0;status.textContent='Loading…';status.className='status';document.getElementById('previous').disabled=true;document.getElementById('next').disabled=true;vscode.setState({query:query.value,registry:registry.value,tagsOnly:tags.checked});vscode.postMessage({type:'browse',query:query.value,registry:registry.value,tagsOnly:tags.checked,offset})}
function select(entry){selected=entry.id;entries.querySelectorAll('[role=option]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.id===selected)));document.getElementById('name').textContent=entry.name;document.getElementById('id').textContent=entry.id;document.getElementById('copy').disabled=false;document.getElementById('members').replaceChildren();document.getElementById('meta').textContent=entry.registry;vscode.postMessage({type:'inspect',id:entry.id})}
query.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>browse(),180)});query.addEventListener('keydown',e=>{if(e.key==='Enter'){clearTimeout(timer);browse()}});registry.onchange=tags.onchange=()=>browse();document.getElementById('previous').onclick=()=>{offset=Math.max(0,offset-60);browse(false)};document.getElementById('next').onclick=()=>{offset+=60;browse(false)};document.getElementById('copy').onclick=()=>{if(selected)vscode.postMessage({type:'copy',id:selected})};
window.addEventListener('message',e=>{const m=e.data;if(m.type==='choices'){registry.replaceChildren(...m.entries.map(entry=>Object.assign(document.createElement('option'),{value:entry.id,textContent:entry.label})));if(restored?.registry&&m.entries.some(entry=>entry.id===restored.registry))registry.value=restored.registry;browse()}else if(m.type==='page'){pageEntries=m.entries;offset=m.offset;selected='';document.getElementById('copy').disabled=true;document.getElementById('name').textContent='Select an entry';document.getElementById('id').textContent='';document.getElementById('members').replaceChildren();document.getElementById('meta').textContent='';entries.replaceChildren();document.getElementById('source').textContent=m.source==='live'?'Minecraft':'Offline · project IDs and built-in samples';document.getElementById('count').textContent=m.total?Math.min(m.total,m.offset+1)+'–'+Math.min(m.total,m.offset+m.entries.length)+' / '+m.total.toLocaleString('en-US'):'0 entries';document.getElementById('previous').disabled=offset===0;document.getElementById('next').disabled=!m.hasMore;status.textContent='';if(!m.entries.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No matching entries.';entries.append(empty)}for(const entry of m.entries){const el=document.createElement('div');el.className='entry';el.tabIndex=0;el.setAttribute('role','option');el.setAttribute('aria-selected','false');el.dataset.id=entry.id;el.title=entry.name+' · '+entry.id;const glyph=document.createElement('span'),image=document.createElement('img'),text=document.createElement('span'),name=document.createElement('strong'),id=document.createElement('code');glyph.className='glyph';glyph.textContent=entry.id.startsWith('#')?'#':'◇';glyph.setAttribute('aria-hidden','true');image.alt='';image.draggable=false;name.textContent=entry.name;id.textContent=entry.id;text.append(name,id);el.append(glyph,image,text);el.onclick=()=>select(entry);el.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select(entry)}if(event.key==='ArrowRight'||event.key==='ArrowDown'){event.preventDefault();el.nextElementSibling?.focus()}if(event.key==='ArrowLeft'||event.key==='ArrowUp'){event.preventDefault();el.previousElementSibling?.focus()}};entries.append(el)}}else if(m.type==='icons'){for(const el of entries.children){const src=m.entries[el.dataset.id];if(src){el.querySelector('img').src=src;el.classList.add('has-icon')}}}else if(m.type==='detail'&&m.entry.id===selected){document.getElementById('meta').textContent=m.entry.id.startsWith('#')?m.total+' matching entries':m.entry.registry;document.getElementById('members').replaceChildren(...m.members.map(id=>Object.assign(document.createElement('li'),{textContent:id})));if(m.total>m.members.length){const more=document.createElement('li');more.textContent='… '+(m.total-m.members.length)+' more';document.getElementById('members').append(more)}}else if(m.type==='copied'){status.className='status';status.textContent='Copied '+m.id}else if(m.type==='error'){status.className='status error';status.textContent=m.message}});vscode.postMessage({type:'ready'});
</script></body></html>`;
}
