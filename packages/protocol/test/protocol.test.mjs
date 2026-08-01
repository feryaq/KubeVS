import assert from 'node:assert/strict';
import test from 'node:test';
import { isConnectorMessage, PROTOCOL_VERSION } from '../dist/index.js';

test('accepts a valid hello and rejects malformed input', () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(
    isConnectorMessage({
      type: 'hello',
      protocolVersion: 1,
      connectorVersion: '0.1.0',
      minecraftVersion: '1.21.1',
      kubejsVersion: null,
      session: {
        kind: 'player',
        displayName: 'Builder',
        playerId: '123e4567-e89b-42d3-a456-426614174000',
      },
      workspace: {
        instancePath: 'C:\\Minecraft\\Instance',
        kubejsPath: 'C:\\Minecraft\\Instance\\kubejs',
      },
      capabilities: {},
    }),
    true,
  );
  assert.equal(
    isConnectorMessage({
      type: 'hello',
      protocolVersion: 1,
      connectorVersion: '0.3.1',
      minecraftVersion: '1.21.1',
      kubejsVersion: '2101.7.1',
      workspace: { instancePath: 42, kubejsPath: [] },
      capabilities: {},
    }),
    false,
  );
  assert.equal(isConnectorMessage({ type: 'hello' }), false);
  assert.equal(
    isConnectorMessage({
      type: 'hello',
      protocolVersion: 1,
      connectorVersion: '0.4.0',
      minecraftVersion: '1.21.1',
      kubejsVersion: '2101.7.1',
      session: { kind: 'player', displayName: 'Builder', playerId: '../invalid' },
      capabilities: {},
    }),
    false,
  );
});
