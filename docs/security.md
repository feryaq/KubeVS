# Security

## Connector

- Loopback bind is enforced by default.
- A 256-bit random token is generated atomically on first start.
- Permission-level-4 administrators can copy or rotate the token through `/kubevs auth`.
- Token rotation applies immediately, disconnects existing clients, and needs no server restart.
- Tokens are compared without ordinary string equality and are never logged.
- The dedicated-server console shows only the token file path, never the secret.
- Unauthenticated and non-loopback peers are closed before protocol requests are accepted.
- Messages and page sizes are bounded.
- Per-connection request rate limiting is enabled.
- Reload is disabled unless the server owner opts in.

Setting `network.allowRemote = true` in `config/kubevs-connector.toml` changes the trust boundary.
Plain `ws://` does not provide transport encryption; use a trusted TLS tunnel or reverse proxy and
restrict network access.

## Extension

- Tokens use SecretStorage, not `settings.json`.
- Stored credentials are scoped to Connector `host:port`.
- Automatic token-file discovery only runs in a trusted workspace.
- Automatic connections to non-loopback hosts are refused.
- Manual remote connection displays a modal warning.
- Webview messages remain allow-listed and cannot directly access Node.js APIs.
