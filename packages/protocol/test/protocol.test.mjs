import assert from 'node:assert/strict';
import test from 'node:test';
import { isConnectorMessage, isConnectorStatus, PROTOCOL_VERSION } from '../dist/index.js';

test('accepts a valid hello and rejects malformed input', () => {
  assert.equal(PROTOCOL_VERSION, 2);
  assert.equal(
    isConnectorMessage({
      type: 'hello',
      protocolVersion: 2,
      connectorVersion: '0.1.0',
      minecraftVersion: '1.21.1',
      kubejsVersion: null,
      session: {
        kind: 'player',
        displayName: 'Builder',
        playerId: '123e4567-e89b-42d3-a456-426614174000',
        role: 'editor',
        permissions: ['kubevs.workspace.read', 'kubevs.workspace.write'],
      },
      workspace: {
        instancePath: 'C:\\Minecraft\\Instance',
        kubejsPath: 'C:\\Minecraft\\Instance\\kubejs',
      },
      capabilities: {
        registries: true,
        recipes: true,
        logs: false,
        reload: false,
        inspect: false,
        integrations: [],
      },
    }),
    true,
  );
  assert.equal(
    isConnectorMessage({
      type: 'hello',
      protocolVersion: 2,
      connectorVersion: '0.3.1',
      minecraftVersion: '1.21.1',
      kubejsVersion: '2101.7.1',
      workspace: { instancePath: 42, kubejsPath: [] },
      capabilities: {
        registries: true,
        recipes: true,
        logs: false,
        reload: false,
        inspect: false,
        integrations: [],
      },
    }),
    false,
  );
  assert.equal(isConnectorMessage({ type: 'hello' }), false);
  assert.equal(
    isConnectorMessage({
      type: 'hello',
      protocolVersion: 2,
      connectorVersion: '0.4.0',
      minecraftVersion: '1.21.1',
      kubejsVersion: '2101.7.1',
      session: { kind: 'player', displayName: 'Builder', playerId: '../invalid' },
      capabilities: {
        registries: true,
        recipes: true,
        logs: false,
        reload: false,
        inspect: false,
        integrations: [],
      },
    }),
    false,
  );
});

test('accepts workspace change events', () => {
  assert.equal(
    isConnectorMessage({
      type: 'event',
      event: 'workspace.changed',
      data: { change: 'changed', path: 'server_scripts/main.js' },
    }),
    true,
  );
});

test('guards capability and session types and bounded response correlation', () => {
  const hello = {
    type: 'hello',
    protocolVersion: 2,
    connectorVersion: 'test',
    minecraftVersion: '1.21.1',
    kubejsVersion: null,
    capabilities: {
      registries: true,
      recipes: true,
      logs: false,
      reload: false,
      inspect: false,
      integrations: [],
    },
  };
  assert.equal(isConnectorMessage(hello), true);
  for (const capabilities of [
    {},
    { ...hello.capabilities, reload: 'yes' },
    { ...hello.capabilities, integrations: [42] },
    { ...hello.capabilities, workspaceMaxFileBytes: -1 },
  ])
    assert.equal(isConnectorMessage({ ...hello, capabilities }), false);
  for (const session of [
    { kind: 'player', displayName: 'Name', role: 'god' },
    { kind: 'player', displayName: 'Name', permissions: [42] },
    { kind: 'player', displayName: 'Name', locale: [] },
  ])
    assert.equal(isConnectorMessage({ ...hello, session }), false);
  assert.equal(
    isConnectorMessage({ type: 'response', requestId: '', ok: true, result: null }),
    false,
  );
  assert.equal(isConnectorMessage({ type: 'error', code: 'UNKNOWN', message: 'invalid' }), false);
});

test('status exposes validated counts and rejects unsafe numbers or types', () => {
  const status = {
    uptimeSeconds: 10,
    players: 1,
    maxPlayers: 20,
    clients: 2,
    reloadAllowed: false,
    kubejsVersion: null,
  };
  assert.equal(isConnectorStatus(status), true);
  for (const patch of [
    { players: -1 },
    { clients: NaN },
    { uptimeSeconds: Infinity },
    { maxPlayers: 1.5 },
    { reloadAllowed: 'yes' },
    { kubejsVersion: 1 },
  ])
    assert.equal(isConnectorStatus({ ...status, ...patch }), false);
});
