export function connectorCredentialKey(host: string, port: number): string {
  const normalizedHost = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, '$1');
  return `kubevs.connector.token.v2.${encodeURIComponent(normalizedHost)}.${port}`;
}

export function parseConnectorToken(value: string): string {
  const token = value.trim();
  if (token.length < 32 || token.length > 256) {
    throw new Error('Connector token must contain 32 to 256 characters.');
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(token)) {
    throw new Error('Connector token contains unsupported characters.');
  }
  return token;
}

export function isConnectorAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b401\b|unauthori[sz]ed|authentication|invalid token|forbidden)/iu.test(message);
}
