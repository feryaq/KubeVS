import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

let addonRecipeEditorHtml;
try {
  ({ addonRecipeEditorHtml } = require('../dist/addonRecipeEditor.cjs'));
} finally {
  Module._load = originalLoad;
}

test('generated Mod Recipes webview script is valid JavaScript', () => {
  const html = addonRecipeEditorHtml({ cspSource: 'test-webview' }, 'test-nonce');
  const script = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/u)?.[1];

  assert.ok(script, 'expected an inline webview script');
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /<html lang="en">/u);
  assert.match(script, /split\(\/\\r\?\\n\/\)/u);
});
