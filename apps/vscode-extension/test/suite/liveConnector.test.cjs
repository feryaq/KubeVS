const assert = require('node:assert/strict');
const vscode = require('vscode');

suite('KubeVS live Connector', () => {
  test('mounts remote files, saves a Vanilla recipe remotely, and loads the craft graph', async () => {
    const connectionCode = process.env.KUBEVS_LIVE_CODE;
    assert.ok(connectionCode, 'KUBEVS_LIVE_CODE is required');
    const extension = vscode.extensions.getExtension('kubevs.kubevs-extension');
    assert.ok(extension);

    const started = Date.now();
    await extension.activate();
    assert.ok(Date.now() - started < 5_000, 'Extension activation must not wait for network I/O');

    const remoteFolder = vscode.workspace.workspaceFolders?.find(
      (folder) => folder.uri.scheme === 'kubevs-remote',
    );
    assert.ok(remoteFolder, 'Preconfigured remote KubeJS workspace is missing');
    await vscode.commands.executeCommand('kubevs.__test.connectWithCode', connectionCode);

    const rootEntries = await vscode.workspace.fs.readDirectory(remoteFolder.uri);
    assert.ok(rootEntries.some(([name]) => name === 'server_scripts'));

    const testFile = vscode.Uri.joinPath(
      remoteFolder.uri,
      'server_scripts',
      'kubevs-live-vscode-test.js',
    );
    const expected = new TextEncoder().encode('// KubeVS live VS Code integration test\n');
    let recipeFile;
    try {
      await vscode.workspace.fs.writeFile(testFile, expected);
      assert.deepEqual(await vscode.workspace.fs.readFile(testFile), expected);

      const catalog = await vscode.commands.executeCommand('kubevs.__test.loadCraftRecipes');
      assert.equal(catalog.source, 'live');
      assert.ok(catalog.total > 0, 'Minecraft recipe snapshot is empty');

      const recipeId = `kubevs:live_vanilla_${Date.now()}`;
      const recipeUri = await vscode.commands.executeCommand('kubevs.__test.saveVanillaRecipe', {
        type: 'save',
        revision: 1,
        kind: 'shaped',
        recipeId,
        output: 'minecraft:diamond',
        count: 1,
        experience: 0,
        cookingTime: 200,
        slots: ['minecraft:stone', '', '', '', '', '', '', '', ''],
      });
      assert.equal(typeof recipeUri, 'string');
      recipeFile = vscode.Uri.parse(recipeUri);
      assert.equal(recipeFile.scheme, 'kubevs-remote');
      assert.match(recipeFile.path, /\/server_scripts\/kubevs\/crafts\/vanilla\/.+\.js$/u);
      const generated = new TextDecoder().decode(await vscode.workspace.fs.readFile(recipeFile));
      assert.match(generated, /ServerEvents\.recipes/u);
      assert.match(generated, /minecraft:diamond/u);
    } finally {
      if (recipeFile) {
        await vscode.workspace.fs.delete(recipeFile).then(undefined, () => undefined);
      }
      await vscode.workspace.fs.delete(testFile).then(undefined, () => undefined);
      await vscode.commands.executeCommand('kubevs.disconnect');
    }
  });
});
