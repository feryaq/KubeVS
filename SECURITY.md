# KubeVS Security Policy

## Supported Versions

| Component            | Supported Version |
| -------------------- | ----------------- |
| KubeVS for VS Code   | 0.10.x            |
| KubeVS Connector     | 0.7.x             |
| Minecraft / NeoForge | 1.21.1 / 21.x     |

## Reporting a Vulnerability

Do not publish tokens, server logs, addresses, or a working exploit in a regular Issue.

Use a private GitHub Security Advisory in the repository or contact the author directly:
Telegram / Discord `@F_ery_a`.

Please include the affected component and version, reproduction conditions, impact, and a minimal example.

You can expect an acknowledgment within 72 hours. The time required to release a fix depends on the severity of the vulnerability and the availability of a safe update.

## Baseline Security Model

By default, the Connector listens on `127.0.0.1`, requires a Bearer token, limits message size and request rate, and separates read, write, and reload permissions.

Remote access must be enabled explicitly. For server deployments, use a VPN or a TLS-terminating reverse proxy; do not expose the plain WebSocket port directly to the internet.
