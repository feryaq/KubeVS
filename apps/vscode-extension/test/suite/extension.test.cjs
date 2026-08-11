const assert = require('node:assert/strict');
const vscode = require('vscode');

suite('KubeVS Extension', () => {
  test('activates, contributes commands, and indexes the fixture', async () => {
    const extension = vscode.extensions.getExtension('kubevs.kubevs-extension');
    assert.ok(extension);
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('kubevs.openDashboard'));
    assert.ok(commands.includes('kubevs.validateProject'));
    await vscode.commands.executeCommand('kubevs.refreshProject');
  });

  test('connector commands are registered and disconnect is safe offline', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('kubevs.connect'));
    assert.ok(commands.includes('kubevs.connectWithCode'));
    assert.ok(commands.includes('kubevs.openServerWorkspace'));
    assert.ok(commands.includes('kubevs.disconnect'));
    assert.ok(commands.includes('kubevs.changeConnectorToken'));
    assert.ok(commands.includes('kubevs.saveAndReload'));
    assert.ok(commands.includes('kubevs.insertRegistryArray'));
    assert.ok(commands.includes('kubevs.insertTaggedValues'));
    assert.ok(commands.includes('kubevs.insertRecipeJson'));
    assert.ok(commands.includes('kubevs.insertRecipeAsKubeJs'));
    assert.ok(commands.includes('kubevs.generateTypings'));
    assert.ok(commands.includes('kubevs.createGenericRecipe'));
    assert.ok(commands.includes('kubevs.createAddonRecipe'));
    assert.ok(commands.includes('kubevs.createLootRule'));
    assert.ok(commands.includes('kubevs.searchRegistry'));
    assert.ok(commands.includes('kubevs.createRecipeSchema'));
    assert.ok(commands.includes('kubevs.deleteRecipe'));
    assert.ok(commands.includes('kubevs.restoreRecipe'));
    assert.ok(commands.includes('kubevs.openCraftGraph'));
    assert.ok(commands.includes('kubevs.calculateResources'));
    await vscode.commands.executeCommand('kubevs.disconnect');
  });

  test('discovers the local Connector token without prompting', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const config = vscode.Uri.joinPath(folder.uri, 'config');
    const tokenFile = vscode.Uri.joinPath(config, 'kubevs-connector-token.txt');
    const token = 'abcdefghijklmnopqrstuvwxyzABCDEFG_123456789';
    await vscode.workspace.fs.createDirectory(config);
    await vscode.workspace.fs.writeFile(tokenFile, new TextEncoder().encode(`${token}\n`));
    try {
      const credentials = await vscode.commands.executeCommand(
        'kubevs.__test.resolveConnectorCredentials',
      );
      assert.equal(credentials?.source, 'discovered');
      assert.equal(credentials?.token, token);
    } finally {
      await vscode.workspace.fs.delete(tokenFile);
      await vscode.workspace.fs.delete(config);
    }
  });

  test('provides KubeJS completion, hover, and document symbols', async () => {
    const files = await vscode.workspace.findFiles('**/server_scripts/example.js');
    assert.equal(files.length, 1);
    const document = await vscode.workspace.openTextDocument(files[0]);

    const completions = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      document.uri,
      new vscode.Position(0, 0),
    );
    assert.ok(completions.items.some((item) => item.label === 'ServerEvents.recipes'));

    const hovers = await vscode.commands.executeCommand(
      'vscode.executeHoverProvider',
      document.uri,
      new vscode.Position(0, 4),
    );
    assert.ok(hovers.length > 0);

    const symbols = await vscode.commands.executeCommand(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );
    assert.ok(symbols.some((symbol) => symbol.name === 'ServerEvents.recipes'));
  });

  test('provides registry completion by English game name and ID', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const file = vscode.Uri.joinPath(folder.uri, 'server_scripts', 'registry-completion-test.js');
    await vscode.workspace.fs.writeFile(file, new TextEncoder().encode('const item = "dia"\n'));
    try {
      const document = await vscode.workspace.openTextDocument(file);
      const completions = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        document.uri,
        new vscode.Position(0, 17),
      );
      assert.ok(
        completions.items.some((item) => {
          const label = typeof item.label === 'string' ? item.label : item.label.label;
          return label === 'Diamond' && item.insertText === 'minecraft:diamond';
        }),
      );
    } finally {
      await vscode.workspace.fs.delete(file);
    }
  });

  test('does not provide registry completion after a closing quote', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const file = vscode.Uri.joinPath(folder.uri, 'server_scripts', 'closed-string-test.js');
    const source = 'const item = "minecraft:stone"\n';
    await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(source));
    try {
      const document = await vscode.workspace.openTextDocument(file);
      const completions = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        document.uri,
        new vscode.Position(0, source.indexOf('\n')),
      );
      assert.ok(
        !completions?.items.some((item) => {
          const label = typeof item.label === 'string' ? item.label : item.label.label;
          return label === 'Diamond' && item.insertText === 'minecraft:diamond';
        }),
      );
    } finally {
      await vscode.workspace.fs.delete(file);
    }
  });

  test('opens the Vanilla Recipe Editor webview', async () => {
    await vscode.commands.executeCommand('kubevs.createRecipe');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('opens the Generic Recipe Editor with the built-in raw schema', async () => {
    await vscode.commands.executeCommand('kubevs.createGenericRecipe');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('opens the English addon recipe editor', async () => {
    await vscode.commands.executeCommand('kubevs.createAddonRecipe');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('opens the English LootJS Builder', async () => {
    await vscode.commands.executeCommand('kubevs.createLootRule');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('opens Item and Block Builders', async () => {
    await vscode.commands.executeCommand('kubevs.createItem');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.commands.executeCommand('kubevs.createBlock');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('opens Craft Graph in Offline Mode', async () => {
    await vscode.commands.executeCommand('kubevs.openCraftGraph');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('provides full binary-safe CRUD through the remote filesystem provider', async () => {
    const port = Number.parseInt(process.env.KUBEVS_TEST_CONNECTOR_PORT ?? '', 10);
    const token = process.env.KUBEVS_TEST_CONNECTOR_TOKEN;
    assert.ok(Number.isInteger(port));
    assert.ok(token);

    await vscode.commands.executeCommand(
      'kubevs.__test.connectWithCode',
      `kubevs://127.0.0.1:${port}?token=${token}`,
    );

    const root = vscode.Uri.parse('kubevs-remote://server/');
    const names = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name);
    assert.ok(names.includes('server_scripts'));

    const directory = vscode.Uri.joinPath(root, 'server_scripts', 'team');
    const source = vscode.Uri.joinPath(directory, 'binary.png');
    const renamed = vscode.Uri.joinPath(directory, 'renamed.png');
    const copied = vscode.Uri.joinPath(directory, 'copied.png');
    const bytes = Uint8Array.from([0, 1, 2, 255, 10]);

    await vscode.workspace.fs.createDirectory(directory);
    await vscode.workspace.fs.writeFile(source, bytes);
    assert.deepEqual(await vscode.workspace.fs.readFile(source), bytes);

    await vscode.workspace.fs.rename(source, renamed);
    await vscode.workspace.fs.copy(renamed, copied);
    assert.deepEqual(await vscode.workspace.fs.readFile(copied), bytes);

    await vscode.workspace.fs.delete(directory, { recursive: true });
    await assert.rejects(() => vscode.workspace.fs.stat(directory));
    await vscode.commands.executeCommand('kubevs.disconnect');
  });
});
