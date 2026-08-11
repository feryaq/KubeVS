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

let craftGraphHtml;
try {
  ({ craftGraphHtml } = require('../dist/craftGraph.cjs'));
} finally {
  Module._load = originalLoad;
}

test('Craft Graph webview keeps tag previews visible and keyboard accessible', () => {
  const html = craftGraphHtml({ cspSource: 'test-webview' }, 'test-nonce', false);
  const script = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/u)?.[1];

  assert.ok(script, 'expected an inline webview script');
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /className='tag-mark'/u);
  assert.doesNotMatch(script, /img\.removeAttribute\('src'\)/u);
  assert.match(script, /direction:-1/u);
  assert.match(script, /ArrowLeft/u);
  assert.match(script, /updateWorldBounds/u);
  assert.match(script, /flat\.length<=300/u);
  assert.match(script, /Math\.max\(\.08/u);
});
