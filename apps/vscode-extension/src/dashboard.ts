import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { workbenchCss } from './workbenchUi.js';

export interface DashboardSnapshot {
  readonly state: 'offline' | 'connecting' | 'connected' | 'error';
  readonly scripts: number;
  readonly problems: number;
  readonly workspace: string;
  readonly error?: string;
  readonly player?: string;
  readonly role?: string;
  readonly minecraft?: string;
  readonly kubejsMissing: boolean;
  readonly canReload: boolean;
  readonly connectedHost?: string;
  readonly canInspect?: boolean;
  readonly canViewLocks?: boolean;
  readonly mcp?: { readonly running: boolean; readonly url?: string };
  readonly stats?: {
    readonly items: number;
    readonly tags: number;
    readonly recipes: number;
    readonly mods: number;
  };
  readonly latency?: number;
  readonly recent: readonly {
    readonly label: string;
    readonly path: string;
    readonly uri: string;
  }[];
}

export const dashboardActions = [
  {
    command: 'kubevs.mcp.manage',
    title: 'MCP server',
    hint: 'AI access',
    icon: 'code',
    group: 'tools',
  },
  {
    command: 'kubevs.createRecipe',
    title: 'Vanilla recipe',
    hint: 'Crafting · cooking',
    icon: 'grid',
    group: 'create',
  },
  {
    command: 'kubevs.createAddonRecipe',
    title: 'Mod recipe',
    hint: 'Create · Oritech · Farmer’s Delight',
    icon: 'layers',
    group: 'create',
  },
  {
    command: 'kubevs.createLootRule',
    title: 'Loot rule',
    hint: 'Drops · conditions',
    icon: 'box',
    group: 'create',
  },
  {
    command: 'kubevs.createItem',
    title: 'Item',
    hint: 'startup_scripts',
    icon: 'diamond',
    group: 'create',
  },
  {
    command: 'kubevs.createBlock',
    title: 'Block',
    hint: 'startup_scripts',
    icon: 'cube',
    group: 'create',
  },
  {
    command: 'kubevs.createGenericRecipe',
    title: 'Schema recipe',
    hint: 'Custom formats',
    icon: 'code',
    group: 'create',
  },
  {
    command: 'kubevs.openRegistryBrowser',
    title: 'Registry browser',
    hint: 'Names · IDs · tags',
    icon: 'search',
    group: 'tools',
  },
  {
    command: 'kubevs.openCraftGraph',
    title: 'Craft graph',
    hint: 'Recipes · alternatives',
    icon: 'graph',
    group: 'tools',
  },
  {
    command: 'kubevs.calculateResources',
    title: 'Resource calculator',
    hint: 'Items · fluids · energy',
    icon: 'chart',
    group: 'tools',
  },
  {
    command: 'kubevs.deleteRecipe',
    title: 'Remove recipes',
    hint: 'Filters · restore',
    icon: 'minus',
    group: 'tools',
  },
  {
    command: 'kubevs.replaceRecipe',
    title: 'Replace a recipe',
    hint: 'Preserve the target ID',
    icon: 'swap',
    group: 'tools',
  },
  {
    command: 'kubevs.createRecipeSchema',
    title: 'New schema',
    hint: 'Typed recipe fields',
    icon: 'code',
    group: 'tools',
  },
  {
    command: 'kubevs.importProject',
    title: 'Import recipe JSON',
    hint: 'Readable KubeJS',
    icon: 'file',
    group: 'tools',
  },
  {
    command: 'kubevs.generateTypings',
    title: 'Generate typings',
    hint: 'Live registry completion',
    icon: 'code',
    group: 'tools',
  },
  {
    command: 'kubevs.restoreRecipe',
    title: 'Restore recipes',
    hint: 'Undo removal rules',
    icon: 'restore',
    group: 'tools',
  },
  {
    command: 'kubevs.inspectHeldItem',
    title: 'Held item',
    hint: 'Copy the main-hand item ID',
    icon: 'diamond',
    group: 'tools',
  },
  {
    command: 'kubevs.showServerFileLocks',
    title: 'File locks',
    hint: 'Current team locks',
    icon: 'lock',
    group: 'tools',
  },
  {
    command: 'kubevs.showConnectionDiagnostics',
    title: 'Connection log',
    hint: 'Connector output',
    icon: 'chart',
    group: 'tools',
  },
] as const;

const commands = new Set<string>([
  ...dashboardActions.map((action) => action.command),
  'kubevs.connectWithCode',
  'kubevs.connect',
  'kubevs.changeConnectorToken',
  'kubevs.disconnect',
  'kubevs.checkConnection',
  'kubevs.validateProject',
  'kubevs.refreshProject',
  'kubevs.saveAndReload',
  'kubevs.openServerWorkspace',
  'kubevs.showConnectionDiagnostics',
  'kubevs.openDashboard',
  'kubevs.openSettings',
  'kubevs.openKubeJsSetup',
  'workbench.action.files.openFolder',
  'workbench.actions.view.problems',
]);

export class DashboardController implements vscode.Disposable, vscode.WebviewViewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private home: vscode.WebviewView | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly snapshot: () => DashboardSnapshot,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.home = view;
    view.webview.options = { enableScripts: true };
    this.bindMessages(view.webview, view);
    view.webview.html = dashboardHtml(view.webview, randomBytes(16).toString('hex'), 'sidebar');
    view.onDidDispose(() => {
      if (this.home === view) this.home = undefined;
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.show();
        this.refresh();
      }
    });
    if (view.visible) this.show();
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      this.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'kubevs.dashboard',
      'KubeVS',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = panel;
    panel.onDidDispose(
      () => {
        if (this.panel === panel) this.panel = undefined;
      },
      undefined,
      this.context.subscriptions,
    );
    this.bindMessages(panel.webview, panel);
    panel.webview.html = dashboardHtml(panel.webview, randomBytes(16).toString('hex'));
  }

  private bindMessages(
    webview: vscode.Webview,
    owner: vscode.WebviewView | vscode.WebviewPanel,
  ): void {
    const listener = webview.onDidReceiveMessage(async (message: unknown) => {
      if (typeof message !== 'object' || message === null) return;
      const request = message as {
        type?: unknown;
        command?: unknown;
        index?: unknown;
        code?: unknown;
      };
      if (request.type === 'ready') {
        this.refresh();
        return;
      }
      if (
        request.type === 'connectCode' &&
        typeof request.code === 'string' &&
        request.code.length <= 1024
      ) {
        await vscode.commands.executeCommand('kubevs.connectWithCode', request.code);
        this.refresh();
      } else if (
        request.type === 'command' &&
        typeof request.command === 'string' &&
        commands.has(request.command)
      ) {
        try {
          await vscode.commands.executeCommand(request.command);
        } catch (error) {
          void vscode.window.showErrorMessage(
            `KubeVS: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        this.refresh();
      } else if (request.type === 'openRecent' && Number.isSafeInteger(request.index)) {
        const file = this.snapshot().recent[request.index as number];
        if (file) await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(file.uri));
      }
    });
    owner.onDidDispose(() => listener.dispose());
  }

  refresh(): void {
    if (this.panel) void this.panel.webview.postMessage({ type: 'snapshot', ...this.snapshot() });
    if (this.home) void this.home.webview.postMessage({ type: 'snapshot', ...this.snapshot() });
  }
  get html(): string | undefined {
    return this.panel?.webview.html;
  }
  get homeHtml(): string | undefined {
    return this.home?.webview.html;
  }
  get homeVisible(): boolean {
    return this.home?.visible === true;
  }
  dispose(): void {
    this.panel?.dispose();
  }
}

export function dashboardHtml(
  webview: vscode.Webview,
  nonce: string,
  mode: 'editor' | 'sidebar' = 'editor',
): string {
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}"><title>KubeVS</title>
<style nonce="${nonce}">${workbenchCss}
.runtime-notice{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 22px;padding:12px 14px;border:1px solid var(--vscode-inputValidation-warningBorder,var(--kvs-line));border-radius:9px;background:var(--kvs-surface);font-size:12px}.runtime-notice p{flex:1 1 220px;margin:0;overflow-wrap:anywhere}.runtime-notice button{flex:none;font-size:12px}
body{margin:0;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)}
main{max-width:1100px;margin:auto;padding:clamp(20px,4vw,46px)}
.top{display:flex;align-items:center;gap:12px;margin-bottom:32px}.brand{font-size:24px;font-weight:650;letter-spacing:-1px}.brand-mark{color:var(--kvs-accent);width:29px;height:29px}.top .project{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);margin-left:4px}.search{margin-left:auto;position:relative;width:250px}.search input{width:100%;padding-left:32px}.search svg{position:absolute;left:10px;top:10px;width:15px;height:15px;pointer-events:none;color:var(--vscode-descriptionForeground)}
.connection{display:flex;align-items:center;gap:10px;border:1px solid var(--kvs-line);border-radius:10px;padding:14px 16px;margin-bottom:28px;background:var(--kvs-surface);flex-wrap:wrap}.dot{width:7px;height:7px;border-radius:50%;background:var(--vscode-descriptionForeground)}.dot.live{background:var(--vscode-testing-iconPassed,#65c89a)}.dot.error{background:var(--vscode-errorForeground)}.connection-meta{color:var(--vscode-descriptionForeground);font-size:12px}.connection-actions{margin-left:auto;display:flex;gap:6px}.connection-actions button{font-size:12px}.error-message{flex-basis:100%;color:var(--vscode-errorForeground);font-size:12px;overflow-wrap:anywhere}.metrics{display:flex;flex-wrap:wrap;gap:24px;margin-left:auto;color:var(--vscode-descriptionForeground);font-size:11px}.metrics b{color:var(--vscode-editor-foreground);font-size:14px;font-weight:600;margin-right:5px;font-variant-numeric:tabular-nums}
.group{margin-bottom:26px}.group-heading{display:flex;align-items:center;justify-content:space-between;margin:0 0 12px}.group-heading h2{font-size:12px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.action{display:flex;align-items:center;gap:14px;min-height:80px;text-align:left;padding:17px;border-radius:10px;background:var(--kvs-surface)!important}.action:hover{background:var(--kvs-soft)!important}.action svg{width:22px;height:22px;flex:none;color:var(--kvs-accent)}.action strong{display:block;font-weight:550;font-size:13px}.action small{display:block;color:var(--vscode-descriptionForeground);font-size:11px;margin-top:4px}.action .arrow{margin-left:auto;color:var(--vscode-descriptionForeground);font-size:17px}.tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.tool{border:1px solid var(--kvs-line);border-radius:7px;text-align:left;display:flex;align-items:center;gap:10px;min-height:45px;background:var(--vscode-editor-background)!important;padding:10px 13px}.tool svg{width:16px;height:16px;color:var(--vscode-descriptionForeground)}
.bottom{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:32px;border-top:1px solid var(--kvs-line);padding-top:22px}.files{display:grid}.file{display:flex;align-items:center;gap:10px;width:100%;border:0;text-align:left;background:transparent!important;padding:8px 0}.file:hover{color:var(--kvs-accent)}.file svg{width:16px;height:16px;color:var(--vscode-descriptionForeground)}.file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file small{margin-left:auto;color:var(--vscode-descriptionForeground);font-size:10px;white-space:nowrap}.project-actions{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.project-actions button{display:flex;align-items:center;gap:10px;border:0;background:transparent!important}.project-actions svg{width:16px;height:16px;color:var(--vscode-descriptionForeground)}.muted{color:var(--vscode-descriptionForeground);font-size:12px}.empty{padding:15px 0;color:var(--vscode-descriptionForeground);font-size:12px}.no-results{padding:18px 0;color:var(--vscode-descriptionForeground)}
@media(max-width:720px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tools{grid-template-columns:repeat(2,minmax(0,1fr))}.top{flex-wrap:wrap}.search{width:100%;margin:0}.bottom{grid-template-columns:1fr;gap:20px}.project-actions{flex-direction:row;flex-wrap:wrap}.metrics{margin-left:0;flex-basis:100%;gap:16px}.connection-actions{margin-left:auto}.file small{max-width:50%;overflow:hidden;text-overflow:ellipsis}}
@media(max-width:400px){.grid{grid-template-columns:1fr}.action{min-height:66px}.tools{grid-template-columns:1fr}.top{margin-bottom:20px}}
.top-actions{display:flex;gap:4px;margin-left:auto}.top-actions button{width:32px;padding:5px}.top-actions svg{width:16px;height:16px}.search{margin-left:0}.join{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;margin:0 0 24px;padding:14px 16px;border:1px solid var(--kvs-line);border-radius:9px}.join label{grid-column:1/-1;color:var(--vscode-descriptionForeground);font-size:12px}.join input{width:100%;min-width:0}.join button{white-space:nowrap}#localConnect{grid-column:1/-1;justify-self:start;font-size:11px;border:0;background:transparent;padding:0;min-height:24px;color:var(--vscode-descriptionForeground)}.folder-button{margin-top:10px}.connection .endpoint{font-family:var(--vscode-editor-font-family);font-size:11px}
body.sidebar main{padding:16px 12px}body.sidebar .top{gap:8px;flex-wrap:wrap;margin-bottom:16px}body.sidebar .brand{font-size:18px;letter-spacing:-.5px}body.sidebar .brand-mark{width:22px;height:22px}body.sidebar .top .project{max-width:100%;order:3;margin:0;font-size:11px}body.sidebar .top-actions{margin-left:auto}body.sidebar .search{order:4;width:100%;margin-top:4px}body.sidebar .grid,body.sidebar .tools{grid-template-columns:1fr}body.sidebar .group{margin-bottom:18px}body.sidebar .group-heading{margin-bottom:8px}body.sidebar .action{padding:10px;min-height:55px;gap:11px}body.sidebar .action svg{width:18px;height:18px}body.sidebar .action small{display:none}body.sidebar .tool{min-height:34px;padding:7px 10px}body.sidebar .connection{padding:10px;gap:7px;margin-bottom:16px}body.sidebar .connection-meta{flex-basis:100%;font-size:11px}body.sidebar .connection-actions{margin-left:0;flex-basis:100%}body.sidebar .metrics{gap:10px;flex-basis:100%;margin:0}body.sidebar .metrics b{font-size:12px}body.sidebar .bottom{display:block;padding-top:14px}body.sidebar .project-actions{margin-top:12px;flex-direction:column;gap:3px}body.sidebar .file small{display:none}body.sidebar .file{font-size:12px}body.sidebar .join{padding:10px;grid-template-columns:minmax(0,1fr) auto;margin-bottom:16px}body.sidebar .join input{grid-column:1/-1}body.sidebar .join .cancel-join{justify-self:end}
@media(max-width:720px){.top-actions{margin-left:auto}.top .search{order:4}.join{grid-template-columns:minmax(0,1fr) auto}.join input{grid-column:1/-1}.join .cancel-join{justify-self:end}}
</style></head><body class="${mode}"><main>
<div class="top"><svg class="brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg><span class="brand">KubeVS</span><span id="workspace" class="project"></span><div class="top-actions"><button id="openFull" data-command="kubevs.openDashboard" title="Open full workspace" aria-label="Open full workspace" ${mode === 'sidebar' ? '' : 'hidden'}>${svg('expand')}</button><button data-command="kubevs.openSettings" title="KubeVS settings" aria-label="KubeVS settings">${svg('settings')}</button></div><div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input id="search" type="search" placeholder="Find a tool…" aria-label="Find a tool" autocomplete="off"></div></div>
<div class="connection"><i id="dot" class="dot" aria-hidden="true"></i><strong id="state">Offline</strong><span id="connectionMeta" class="connection-meta"></span><div class="metrics" id="metrics"></div><div class="connection-actions"><button id="health" data-command="kubevs.checkConnection" hidden title="Check the server connection">Check</button><button id="connect" class="primary" data-command="kubevs.connectWithCode">Connect Minecraft</button></div><div id="error" class="error-message" role="alert" hidden></div></div>
<form id="join" class="join" hidden><label for="joinCode">Minecraft: <code>/kvs join</code> · paste the copied code</label><input id="joinCode" type="password" placeholder="kubevs://…" autocomplete="off" spellcheck="false" aria-label="Connection code"><button id="joinSubmit" class="primary" type="submit">Connect</button><button class="cancel-join" id="cancelJoin" type="button">Cancel</button><button id="localConnect" type="button" data-command="kubevs.connect" title="Use a saved token or a local Connector token file">Use token…</button></form>
<div id="runtimeNotice" class="runtime-notice" role="status" hidden><p id="runtimeMessage"></p><button data-command="kubevs.openKubeJsSetup" title="Open KubeJS downloads in your browser">Get KubeJS ↗</button></div>
<section class="group" id="createGroup"><div class="group-heading"><h2>Create</h2></div><div class="grid" id="create"></div></section>
<section class="group" id="toolsGroup"><div class="tools" id="tools"></div></section><div id="noResults" class="no-results" hidden>No matching tools.</div>
<div class="bottom"><section><div class="group-heading"><h2>Project files</h2><span class="muted" id="scriptCount"></span></div><div id="files" class="files"></div><button id="openFolder" class="folder-button" data-command="workbench.action.files.openFolder" hidden>${svg('folder')} Open folder</button></section><div class="project-actions"><button data-command="kubevs.validateProject">${svg('check')}<span id="problems">Check scripts</span></button><button data-command="kubevs.refreshProject">${svg('refresh')}Refresh project</button><button id="serverFiles" data-command="kubevs.openServerWorkspace" hidden>${svg('folder')}Server files</button><button id="reload" data-command="kubevs.saveAndReload" hidden>${svg('refresh')}Save & reload</button></div></div>
</main><script nonce="${nonce}">
const vscode=acquireVsCodeApi(),actions=${JSON.stringify(dashboardActions)},icons=${JSON.stringify(iconPaths)};
let snapshot, query=vscode.getState()?.query||'';const search=document.getElementById('search');search.value=query;
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('aria-hidden','true');svg.innerHTML='<path d="'+icons[name]+'"/>';return svg}
function renderActions(){const filtered=actions.filter(a=>(a.title+' '+a.hint).toLowerCase().includes(query.toLowerCase()));for(const group of ['create','tools']){const list=document.getElementById(group);list.replaceChildren();const selected=filtered.filter(a=>a.group===group);document.getElementById(group+'Group').hidden=selected.length===0;for(const action of selected){const b=document.createElement('button');b.className=group==='create'?'action':'tool';b.dataset.command=action.command;b.append(icon(action.icon));const text=document.createElement('span');if(group==='create'){const name=document.createElement('strong'),hint=document.createElement('small');name.textContent=action.title;hint.textContent=action.hint;text.append(name,hint)}else text.textContent=action.command==='kubevs.mcp.manage'&&snapshot?.mcp?.running?'MCP · running':action.title;b.append(text);if(group==='create'){const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');b.append(arrow)}if(snapshot?.state==='connected'&&snapshot.kubejsMissing&&(group==='create'||action.command==='kubevs.createRecipeSchema'||action.command==='kubevs.importProject')){b.disabled=true;b.title='Requires KubeJS. See the installation notice above.'}if(action.command==='kubevs.inspectHeldItem'&&!snapshot?.canInspect){b.disabled=true;b.title='Connect with a personal player code to inspect the held item'}if(action.command==='kubevs.showServerFileLocks'&&!snapshot?.canViewLocks){b.disabled=true;b.title='Connect to a server with team file locks'}list.append(b)}}document.getElementById('noResults').hidden=filtered.length>0}
function render(s){snapshot=s;const runtimeMissing=s.state==='connected'&&s.kubejsMissing;document.getElementById('runtimeNotice').hidden=!runtimeMissing;document.getElementById('runtimeMessage').textContent=runtimeMissing?'Recipe creation needs KubeJS. Install KubeJS and its required dependencies for Minecraft '+s.minecraft+' (NeoForge), restart Minecraft, then reconnect.':'';document.getElementById('workspace').textContent=s.workspace;document.getElementById('workspace').title=s.workspace;const connected=s.state==='connected',connecting=s.state==='connecting';document.getElementById('state').textContent=connected?'Minecraft '+s.minecraft:connecting?'Connecting…':s.state==='error'?'Connection failed':'Offline';document.getElementById('dot').className='dot'+(connected?' live':s.state==='error'?' error':'');document.getElementById('connectionMeta').textContent=connected?[s.player,s.role,s.latency!==undefined?s.latency+' ms':''].filter(Boolean).join(' · '):'Local tools available';document.getElementById('health').hidden=!connected;const connect=document.getElementById('connect');connect.textContent=connected?'Disconnect':'Connect Minecraft';connect.classList.toggle('primary',!connected);connect.dataset.command=connected?'kubevs.disconnect':'kubevs.connectWithCode';connect.disabled=connecting;document.getElementById('error').hidden=!s.error;document.getElementById('error').textContent=s.error||'';document.getElementById('joinSubmit').disabled=connecting;if(connected)document.getElementById('join').hidden=true;document.getElementById('openFolder').hidden=s.workspace!=='No folder open';const metrics=document.getElementById('metrics');metrics.replaceChildren();if(connected&&s.stats)for(const key of ['items','recipes','mods']){const item=document.createElement('span'),number=document.createElement('b');number.textContent=s.stats[key].toLocaleString('en-US');item.append(number,document.createTextNode(key));metrics.append(item)}document.getElementById('scriptCount').textContent=s.scripts+' scripts';document.getElementById('problems').textContent=s.problems?s.problems+' issues · check scripts':'Check scripts';document.getElementById('serverFiles').hidden=!connected;document.getElementById('reload').hidden=!connected||!s.canReload;const files=document.getElementById('files');files.replaceChildren();s.recent.forEach((file,index)=>{const b=document.createElement('button');b.className='file';b.dataset.index=index;b.title=file.path;b.append(icon('file'));const name=document.createElement('span'),folder=document.createElement('small');name.textContent=file.label;folder.textContent=file.path.substring(0,file.path.lastIndexOf('/'));b.append(name,folder);files.append(b)});if(!s.recent.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=s.scripts?'Open a script to keep it here.':'Open a KubeJS folder or create your first recipe.';files.append(empty)}renderActions()}
search.addEventListener('input',()=>{query=search.value;vscode.setState({query});renderActions()});search.addEventListener('keydown',e=>{if(e.key==='Escape'){search.value='';query='';vscode.setState({query});renderActions()}if(e.key==='Enter'){document.querySelector('.action:not([hidden]):not(:disabled),.tool:not(:disabled)')?.click()}});document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||b.disabled)return;if(b.dataset.command==='kubevs.connectWithCode'){document.getElementById('join').hidden=false;document.getElementById('joinCode').focus();return}if(b.dataset.command)vscode.postMessage({type:'command',command:b.dataset.command});else if(b.dataset.index!==undefined)vscode.postMessage({type:'openRecent',index:Number(b.dataset.index)})});window.addEventListener('message',e=>{if(e.data.type==='snapshot')render(e.data)});document.getElementById('cancelJoin').addEventListener('click',()=>{document.getElementById('joinCode').value='';document.getElementById('join').hidden=true});document.getElementById('join').addEventListener('submit',e=>{e.preventDefault();const input=document.getElementById('joinCode'),code=input.value.trim();if(!code)return;input.value='';document.getElementById('joinSubmit').disabled=true;vscode.postMessage({type:'connectCode',code})});renderActions();vscode.postMessage({type:'ready'});
</script></body></html>`;
}

const iconPaths: Record<string, string> = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  layers: 'm12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5',
  box: 'M3 7h18v14H3zM2 3h20v4H2zM9 11h6',
  diamond: 'm12 3 9 9-9 9-9-9z',
  cube: 'm12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  code: 'm8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM15 15l6 6',
  graph: 'M9 3h6v6H9zM2 16h6v6H2zM16 16h6v6h-6zM12 9v4M5 16v-3h14v3',
  chart: 'M4 3v18h18M8 17v-5M13 17V7M18 17v-8',
  minus: 'M4 12h16',
  swap: 'M3 7h17l-4-4M21 17H4l4 4',
  check: 'm4 12 5 5L20 6',
  refresh: 'M20 7V3l-4 1M20 4a9 9 0 1 0 1 12',
  folder: 'M3 5h7l2 3h9v13H3z',
  file: 'M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h6',
  settings:
    'M12.00 4.00L13.95 2.19L15.83 2.76L16.44 5.35L17.66 6.34L20.31 6.44L21.24 8.17L19.85 10.44L20.00 12.00L21.81 13.95L21.24 15.83L18.65 16.44L17.66 17.66L17.56 20.31L15.83 21.24L13.56 19.85L12.00 20.00L10.05 21.81L8.17 21.24L7.56 18.65L6.34 17.66L3.69 17.56L2.76 15.83L4.15 13.56L4.00 12.00L2.19 10.05L2.76 8.17L5.35 7.56L6.34 6.34L6.44 3.69L8.17 2.76L10.44 4.15zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  expand: 'M14 3h7v7M10 14 21 3M21 14v7H3V3h7',
  restore: 'M3 10V4m0 6h6M3 10a9 9 0 1 1 1 8',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
};
function svg(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="${iconPaths[name]}"/></svg>`;
}
