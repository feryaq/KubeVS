import * as vscode from 'vscode';
import { classifyScriptPath, type ScriptKind } from '@kubevs/kubejs-parser';

interface ApiEntry {
  readonly name: string;
  readonly detail: string;
  readonly documentation: string;
  readonly snippet?: string;
  readonly kinds: readonly ScriptKind[];
}

const API: readonly ApiEntry[] = [
  {
    name: 'ServerEvents.recipes',
    detail: 'KubeJS server recipe event',
    documentation: 'Adds, removes, or replaces recipes during server resource loading.',
    snippet: 'ServerEvents.recipes(event => {\n\t${1:// recipes}\n})',
    kinds: ['server_scripts'],
  },
  {
    name: 'ServerEvents.tags',
    detail: 'KubeJS server tag event',
    documentation: 'Modifies item, block, fluid, entity, or other data-pack tags.',
    snippet: "ServerEvents.tags('${1:item}', event => {\n\tevent.add('${2:tag}', '${3:item}')\n})",
    kinds: ['server_scripts'],
  },
  {
    name: 'StartupEvents.registry',
    detail: 'KubeJS startup registry event',
    documentation:
      'Registers startup objects. Changes require a Minecraft restart and must match on client and server.',
    snippet: "StartupEvents.registry('${1:item}', event => {\n\tevent.create('${2:example}')\n})",
    kinds: ['startup_scripts'],
  },
  {
    name: 'ItemEvents.modification',
    detail: 'KubeJS startup item modification event',
    documentation: 'Changes properties of registered items during startup.',
    snippet:
      "ItemEvents.modification(event => {\n\tevent.modify('${1:minecraft:stone}', item => {\n\t\t${2:// properties}\n\t})\n})",
    kinds: ['startup_scripts'],
  },
  {
    name: 'ClientEvents',
    detail: 'KubeJS client event group',
    documentation: 'Client-only events. These scripts are not available on a dedicated server.',
    kinds: ['client_scripts'],
  },
  {
    name: 'event.shaped',
    detail: 'Adds a shaped crafting recipe',
    documentation: 'Creates a shaped crafting recipe from an output, pattern, and key mapping.',
    snippet:
      "event.shaped('${1:minecraft:result}', [\n\t'${2:AAA}',\n\t'${3:A A}',\n\t'${4:AAA}'\n], {\n\tA: '${5:minecraft:stone}'\n})",
    kinds: ['server_scripts'],
  },
  {
    name: 'event.shapeless',
    detail: 'Adds a shapeless crafting recipe',
    documentation: 'Creates a shapeless crafting recipe from an output and ingredient list.',
    snippet: "event.shapeless('${1:minecraft:result}', [${2:'minecraft:stone'}])",
    kinds: ['server_scripts'],
  },
  {
    name: 'event.remove',
    detail: 'Removes matching recipes',
    documentation: 'Removes recipes matching an id, output, input, mod, or recipe type filter.',
    snippet: "event.remove({ ${1:output}: '${2:minecraft:result}' })",
    kinds: ['server_scripts'],
  },
];

const EVENT_PATTERN = /\b([A-Z][A-Za-z]+Events\.[A-Za-z_]\w*)\s*\(/gu;
const RESOURCE_PATTERN = /['"]([a-z0-9_.-]+:[a-z0-9_./-]+)['"]/gu;

export function registerLanguageSupport(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [
    {
      language: 'javascript',
      pattern: '**/{server_scripts,client_scripts,startup_scripts}/**/*.{js,ts}',
    },
    {
      language: 'typescript',
      pattern: '**/{server_scripts,client_scripts,startup_scripts}/**/*.{js,ts}',
    },
  ];

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems(document) {
        const kind = classifyScriptPath(document.uri.fsPath);
        if (!kind) return [];
        return API.filter((entry) => entry.kinds.includes(kind)).map((entry) => {
          const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Function);
          item.detail = entry.detail;
          item.documentation = new vscode.MarkdownString(entry.documentation);
          item.insertText = new vscode.SnippetString(entry.snippet ?? entry.name);
          item.sortText = entry.name.startsWith('event.') ? `1-${entry.name}` : `0-${entry.name}`;
          return item;
        });
      },
    }),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        const range = document.getWordRangeAtPosition(position, /[A-Za-z.]+/u);
        if (!range) return undefined;
        const word = document.getText(range);
        const entry = API.find((candidate) => candidate.name === word);
        if (!entry) return undefined;
        const markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(entry.name, 'javascript');
        markdown.appendMarkdown(`\n${entry.documentation}`);
        return new vscode.Hover(markdown, range);
      },
    }),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(document) {
        return symbolsForDocument(document);
      },
    }),
    vscode.languages.registerWorkspaceSymbolProvider({
      async provideWorkspaceSymbols(query, token) {
        const files = await vscode.workspace.findFiles(
          '**/{server_scripts,client_scripts,startup_scripts}/**/*.{js,ts}',
          '**/{node_modules,.git,build}/**',
          2000,
        );
        const symbols: vscode.SymbolInformation[] = [];
        for (const uri of files) {
          if (token.isCancellationRequested || symbols.length >= 5000) break;
          const document = await vscode.workspace.openTextDocument(uri);
          for (const symbol of symbolsForDocument(document)) {
            if (
              query.length === 0 ||
              symbol.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
            ) {
              symbols.push(
                new vscode.SymbolInformation(
                  symbol.name,
                  symbol.kind,
                  vscode.workspace.asRelativePath(uri),
                  new vscode.Location(uri, symbol.range),
                ),
              );
            }
          }
        }
        return symbols;
      },
    }),
    vscode.languages.registerCodeActionsProvider(
      selector,
      {
        provideCodeActions(document, _range, context) {
          const actions: vscode.CodeAction[] = [];
          for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== 'KubeVS') continue;
            if (diagnostic.code === 'kubevs/unbalanced-brace') {
              const match = /^(\d+) closing brace/u.exec(diagnostic.message);
              if (!match) continue;
              const count = Number(match[1]);
              if (!Number.isSafeInteger(count) || count <= 0 || count > 100) continue;
              const action = new vscode.CodeAction(
                `Add ${count} missing closing brace${count === 1 ? '' : 's'}`,
                vscode.CodeActionKind.QuickFix,
              );
              action.diagnostics = [diagnostic];
              action.isPreferred = true;
              const edit = new vscode.WorkspaceEdit();
              const end = document.lineAt(document.lineCount - 1).range.end;
              edit.insert(document.uri, end, `\n${'}'.repeat(count)}`);
              action.edit = edit;
              actions.push(action);
            }
          }
          return actions;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
}

function symbolsForDocument(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const symbols: vscode.DocumentSymbol[] = [];
  for (const match of document.getText().matchAll(EVENT_PATTERN)) {
    if (match.index === undefined || !match[1]) continue;
    const start = document.positionAt(match.index);
    const end = document.positionAt(match.index + match[1].length);
    const range = new vscode.Range(start, end);
    symbols.push(
      new vscode.DocumentSymbol(match[1], 'KubeJS event', vscode.SymbolKind.Event, range, range),
    );
  }
  for (const match of document.getText().matchAll(RESOURCE_PATTERN)) {
    if (match.index === undefined || !match[1]) continue;
    const valueOffset = match[0].indexOf(match[1]);
    const start = document.positionAt(match.index + valueOffset);
    const end = document.positionAt(match.index + valueOffset + match[1].length);
    const range = new vscode.Range(start, end);
    symbols.push(
      new vscode.DocumentSymbol(
        match[1],
        'Resource location',
        vscode.SymbolKind.String,
        range,
        range,
      ),
    );
  }
  return symbols;
}
