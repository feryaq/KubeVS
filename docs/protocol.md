# Protocol

Status: **Experimental**

`@kubevs/protocol` currently defines protocol version 1, connector capabilities, permissions, hello
and structured error messages, plus a runtime input guard.

Transport is RFC 6455 WebSocket. The client authenticates during the opening handshake with
`Authorization: Bearer <token>`, after which the Connector sends `hello`. Requests use a unique
`requestId`; responses and structured errors echo it.

Implemented methods:

- `registry.list`
- `registry.entries`
- `registry.items`
- `registry.tags`
- `registry.tagValues`
- `recipes.list`
- `recipes.types`
- `recipes.get`
- `mods.list`
- `logs.list`
- `reload.server`

Messages are text JSON, limited to 1 MiB. Each connection is limited to 30 requests per 10 seconds.
List operations are paginated with a maximum page size of 500.

Generic registry methods accept a namespaced `registry` key such as `minecraft:item`.
`registry.tagValues` additionally requires a namespaced `tag`. `recipes.get` requires a recipe
`id` and returns its type plus the recipe encoded through Minecraft's registry-aware recipe codec.
Invalid parameters produce a structured error carrying the original `requestId`.

Protocol version 1 remains experimental; compatibility is checked before any snapshot request.
