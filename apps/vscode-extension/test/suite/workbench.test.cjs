const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

suite('KubeVS workbench', () => {
  test('dashboard opens in installed Code with actions for registered commands', async () => {
    await vscode.commands.executeCommand('kubevs.openDashboard');
    try {
      const html = await vscode.commands.executeCommand('kubevs.__test.dashboardHtml');
      assert.equal(typeof html, 'string');
      assert.match(html, /<title>KubeVS<\/title>/);
      assert.match(html, /id="search"[^>]+aria-label="Find a tool"/);
      assert.match(html, /id="files"/);
      assert.match(html, /Content-Security-Policy/);
      const match = /actions=(\[[\s\S]*?\]),icons=/.exec(html);
      assert.ok(match, 'Dashboard renders its production action catalog');
      const actions = JSON.parse(match[1]);
      assert.ok(actions.length >= 13, 'Creation and existing tools are available');
      const commands = new Set(await vscode.commands.getCommands(true));
      for (const action of actions) assert.ok(commands.has(action.command), action.command);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  });

  test('custom pack files use native JSON validation and registered template commands', async () => {
    const extension = vscode.extensions.getExtension('kubevs.kubevs-extension');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8'),
    );
    assert.ok(
      manifest.contributes.jsonValidation.some((entry) => entry.fileMatch === '*.kubevs-pack.json'),
    );
    const commands = new Set(await vscode.commands.getCommands(true));
    assert.ok(commands.has('kubevs.createRecipeSchema'));
    assert.ok(commands.has('kubevs.importRecipePack'));
    const jsonExtension = vscode.extensions.getExtension('vscode.json-language-features');
    assert.ok(jsonExtension, 'Native JSON support is installed');
    await jsonExtension.activate();
    const folder = vscode.workspace.workspaceFolders.find((folder) => folder.uri.scheme === 'file');
    const uri = vscode.Uri.joinPath(folder.uri, 'acceptance-invalid.kubevs-pack.json');
    try {
      await vscode.workspace.fs.writeFile(
        uri,
        new TextEncoder().encode(
          JSON.stringify({
            format: 'kubevs-recipe-pack',
            version: 1,
            id: 'test:invalid',
            name: 'Invalid',
            schemas: [
              {
                version: 1,
                id: 'test:machine',
                label: 'Machine',
                recipeType: 'test:machine',
                fields: [{ path: 'pressure', label: 'Pressure', kind: 'invalid_kind' }],
              },
            ],
          }),
        ),
      );
      const document = await vscode.workspace.openTextDocument(uri);
      assert.equal(document.languageId, 'json');
      await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          vscode.languages
            .getDiagnostics(uri)
            .some(
              (diagnostic) =>
                (diagnostic.severity === vscode.DiagnosticSeverity.Warning ||
                  diagnostic.severity === vscode.DiagnosticSeverity.Error) &&
                /Value is not accepted|Valid values/i.test(diagnostic.message),
            )
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.fail('Native JSON diagnostics did not reject the invalid pack');
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await vscode.workspace.fs.delete(uri);
    }
  });

  test('dashboard reflects current indexed workspace, not decorative script counts', async () => {
    await vscode.commands.executeCommand('kubevs.refreshProject');
    const snapshot = await vscode.commands.executeCommand('kubevs.__test.dashboardSnapshot');
    assert.equal(snapshot.state, 'offline');
    assert.ok(snapshot.scripts > 0, 'The isolated KubeJS workspace is indexed');
    assert.equal(snapshot.canReload, false);
    assert.equal(snapshot.kubejsMissing, false);
    assert.ok(Array.isArray(snapshot.recent));
    assert.ok(snapshot.recent.length > 0);
    for (const file of snapshot.recent) {
      assert.equal(typeof file.uri, 'string');
      assert.ok(file.label.endsWith('.js'));
      const stat = await vscode.workspace.fs.stat(vscode.Uri.parse(file.uri));
      assert.ok(stat.type & vscode.FileType.File);
    }
  });

  test('KubeVS opens as one home view and promotes its populated dashboard', async () => {
    const extension = vscode.extensions.getExtension('kubevs.kubevs-extension');
    assert.ok(extension, 'KubeVS extension is installed in the test workbench');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8'),
    );
    const containers = manifest.contributes.viewsContainers.activitybar;
    const views = manifest.contributes.views.kubevs;
    assert.equal(containers.length, 1, 'KubeVS contributes one Activity Bar container');
    assert.equal(views.length, 1, 'KubeVS contributes one home view');
    assert.equal(views[0].id, 'kubevs.home');
    assert.equal(views[0].type, 'webview');

    try {
      const waitFor = async (read, predicate, message) => {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const value = await read();
          if (predicate(value)) return value;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.fail(message);
      };

      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await waitFor(
        () => vscode.commands.executeCommand('kubevs.__test.dashboardHtml'),
        (html) => html === undefined,
        'No previous dashboard editor remains before opening the home view',
      );

      await vscode.commands.executeCommand('workbench.view.extension.kubevs');
      await vscode.commands.executeCommand('kubevs.home.focus');
      await vscode.commands.executeCommand('kubevs.refreshProject');

      const visible = await vscode.commands.executeCommand('kubevs.__test.homeVisible');
      assert.equal(visible, true, 'The home WebviewView is visible in the sidebar');
      const html = await vscode.commands.executeCommand('kubevs.__test.homeHtml');
      assert.equal(typeof html, 'string');
      assert.match(html, /<title>KubeVS<\/title>/);
      assert.match(html, /Content-Security-Policy/);
      assert.match(html, /id="search"/);
      assert.match(html, /id="files"/);

      const fullDashboard = await waitFor(
        () => vscode.commands.executeCommand('kubevs.__test.dashboardHtml'),
        (html) => typeof html === 'string',
        'Making the home view visible opens the full dashboard editor automatically',
      );
      const snapshot = await vscode.commands.executeCommand('kubevs.__test.dashboardSnapshot');
      assert.equal(snapshot.state, 'offline');
      assert.ok(snapshot.scripts > 0, 'The project snapshot is populated');
      assert.ok(snapshot.recent.length > 0, 'Recent indexed files appear in the dashboard');
      assert.equal(snapshot.kubejsMissing, false);
      assert.equal(snapshot.canReload, false);

      await vscode.commands.executeCommand('workbench.view.explorer');
      await waitFor(
        () => vscode.commands.executeCommand('kubevs.__test.homeVisible'),
        (isVisible) => isVisible === false,
        'The home view hides when another Activity Bar container opens',
      );
      await vscode.commands.executeCommand('workbench.view.extension.kubevs');
      await vscode.commands.executeCommand('kubevs.home.focus');
      assert.equal(
        await vscode.commands.executeCommand('kubevs.__test.dashboardHtml'),
        fullDashboard,
        'Showing the home view again reuses the open dashboard editor',
      );

      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await waitFor(
        () => vscode.commands.executeCommand('kubevs.__test.dashboardHtml'),
        (html) => html === undefined,
        'Closing the full editor disposes its panel',
      );
      await vscode.commands.executeCommand('workbench.view.explorer');
      await waitFor(
        () => vscode.commands.executeCommand('kubevs.__test.homeVisible'),
        (isVisible) => isVisible === false,
        'The home view is hidden before testing automatic reopen',
      );
      await vscode.commands.executeCommand('workbench.view.extension.kubevs');
      await vscode.commands.executeCommand('kubevs.home.focus');
      await waitFor(
        () => vscode.commands.executeCommand('kubevs.__test.dashboardHtml'),
        (html) => typeof html === 'string',
        'Showing the home view again opens a closed dashboard editor',
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  });

  test('KubeVS settings command opens the native Settings editor', async () => {
    const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;
    let openedSettings = false;
    try {
      await vscode.commands.executeCommand('kubevs.openSettings');
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const tab = activeTab();
        if (tab?.label === 'Settings' && tab.isActive && tab.group.isActive) {
          openedSettings = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(
        openedSettings,
        true,
        'The extension command opens the active native Settings tab in English Code',
      );
    } finally {
      if (activeTab()?.label === 'Settings') {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      }
    }
  });
});
