import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectorCredentialKey,
  isConnectorAuthenticationError,
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
