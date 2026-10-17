import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectorCredentialKey,
  isConnectorAuthenticationError,
  describeConnectorConnectionError,
  parseConnectorConnectionCode,
  parseConnectorToken,
} from '../dist/connectorAuthCore.mjs';

test('normalizes endpoint credential keys', () => {
  assert.equal(connectorCredentialKey('[::1]', 32145), connectorCredentialKey('::1', 32145));
  assert.equal(
    connectorCredentialKey('LOCALHOST', 32145),
    connectorCredentialKey('localhost', 32145),
  );
  assert.notEqual(
    connectorCredentialKey('localhost', 32145),
    connectorCredentialKey('localhost', 32146),
  );
});

test('trims valid tokens and rejects malformed values', () => {
  const token = 'abcdefghijklmnopqrstuvwxyzABCDEFG_123456789';
  assert.equal(parseConnectorToken(`  ${token}\n`), token);
  assert.throws(() => parseConnectorToken('short'), /32 to 256/u);
  assert.throws(() => parseConnectorToken(`${token}!`), /unsupported characters/u);
});

test('recognizes authentication failures without swallowing network failures', () => {
  assert.equal(isConnectorAuthenticationError(new Error('Unexpected server response: 401')), true);
  assert.equal(isConnectorAuthenticationError(new Error('Authentication failed')), true);
  assert.equal(isConnectorAuthenticationError(new Error('ECONNREFUSED')), false);
});

test('parses one-click KubeVS connection codes', () => {
  const token = 'A'.repeat(43);
  assert.deepEqual(parseConnectorConnectionCode('kubevs://play.example.net:32199?token=' + token), {
    host: 'play.example.net',
    port: 32199,
    token,
    secure: false,
  });
  assert.equal(
    parseConnectorConnectionCode('kubevs://play.example.net:443?token=' + token + '&secure=true')
      .secure,
    true,
  );
  assert.throws(
    () => parseConnectorConnectionCode('https://example.net'),
    /not a KubeVS connection code/u,
  );
  assert.throws(
    () => parseConnectorConnectionCode('kubevs://example.net?token=short'),
    /32 to 256/u,
  );
});

test('connection failures give actionable recovery without exposing pasted credentials', () => {
  assert.match(
    describeConnectorConnectionError(new Error('ECONNREFUSED'), 'localhost', 32145),
    /Open a Minecraft world/u,
  );
  assert.match(
    describeConnectorConnectionError(
      new Error('Unexpected server response: 401'),
      'localhost',
      32145,
    ),
    /\/kvs join/u,
  );
  assert.match(
    describeConnectorConnectionError(new Error('ENOTFOUND'), 'game.example', 32145),
    /network.publicHost/u,
  );
  assert.match(
    describeConnectorConnectionError(new Error('ETIMEDOUT'), 'game.example', 32145),
    /separate Connector port/u,
  );
  assert.match(
    describeConnectorConnectionError(new Error('Protocol mismatch'), 'localhost', 32145),
    /matching KubeVS versions/u,
  );
  assert.match(
    describeConnectorConnectionError(new Error('TLS certificate failure'), 'game.example', 443),
    /TLS proxy/u,
  );
  const secret = 'A'.repeat(43);
  const message = describeConnectorConnectionError(
    new Error(`Failed kubevs://localhost?token=${secret} and token=${secret}`),
    'localhost',
    32145,
  );
  assert.equal(message.includes(secret), false);
});
