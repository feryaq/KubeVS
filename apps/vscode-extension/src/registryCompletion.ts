import * as vscode from 'vscode';
import type { RegistryCatalog } from './registryCatalog.js';

export function registerRegistryCompletion(
  context: vscode.ExtensionContext,
  catalog: RegistryCatalog,
): void {
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems: async (document, position, token) => {
      const prefix = document.lineAt(position.line).text.slice(0, position.character);
      const match = prefix.match(/(["'])([\p{L}\p{N}_.:/# -]*)$/iu);
      if (!match || token.isCancellationRequested) return undefined;
      if (!isInsideQuotedString(prefix, match[1] ?? '')) return undefined;
      const query = match[2] ?? '';
      const start = position.translate(0, -query.length);
      const range = new vscode.Range(start, position);
      const suggestions = await catalog.suggestions(query);
      if (token.isCancellationRequested) return undefined;
      const items = suggestions.map((entry) => {
        const item = new vscode.CompletionItem(
          {
            label: entry.name,
            description: entry.id,
          },
          completionKind(entry.registry, entry.source === 'tag'),
        );
        item.filterText = `${entry.name} ${entry.id} ${entry.translationKey ?? ''}`;
        item.insertText = entry.id;
        item.range = range;
        item.detail = `${registryLabel(entry.registry)} · ${entry.id}`;
        item.documentation = new vscode.MarkdownString(
          entry.source === 'minecraft'
            ? `Name and ID received from the connected Minecraft instance.\n\n\`${entry.id}\``
            : `KubeVS offline suggestion.\n\n\`${entry.id}\``,
        );
        item.sortText = `${entry.source === 'minecraft' ? '0' : '1'}-${entry.name}-${entry.id}`;
        return item;
      });
      return new vscode.CompletionList(items, true);
    },
  };
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [
        { language: 'javascript', scheme: 'file' },
        { language: 'typescript', scheme: 'file' },
        { language: 'json', scheme: 'file' },
        { language: 'jsonc', scheme: 'file' },
      ],
      provider,
      '"',
      "'",
      ':',
      '#',
    ),
  );
}

function isInsideQuotedString(prefix: string, quote: string): boolean {
  let count = 0;
  for (let index = 0; index < prefix.length; index++) {
    if (prefix[index] !== quote) continue;
    let slashes = 0;
    for (let previous = index - 1; previous >= 0 && prefix[previous] === '\\'; previous--) {
      slashes++;
    }
    if (slashes % 2 === 0) count++;
  }
  return count % 2 === 1;
}

function completionKind(registry: string, tag: boolean): vscode.CompletionItemKind {
  if (tag) return vscode.CompletionItemKind.Reference;
  if (registry === 'minecraft:item') return vscode.CompletionItemKind.Value;
  if (registry === 'minecraft:block') return vscode.CompletionItemKind.Field;
  if (registry === 'minecraft:entity_type') return vscode.CompletionItemKind.Class;
  if (registry.includes('structure')) return vscode.CompletionItemKind.Struct;
  return vscode.CompletionItemKind.EnumMember;
}

function registryLabel(registry: string): string {
  if (registry === 'minecraft:item') return 'Item';
  if (registry === 'minecraft:block') return 'Block';
  if (registry === 'minecraft:fluid') return 'Fluid';
  if (registry === 'minecraft:entity_type') return 'Entity';
  if (registry.includes('structure')) return 'Structure';
  if (registry.includes('biome')) return 'Biome';
  return registry;
}
