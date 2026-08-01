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
- `recipeViewers.status`
- `recipeViewers.categories`
- `recipeViewers.displays`
- `recipeViewers.display.get`
- `recipeViewers.workstations`
- `recipeViewers.usages`
- `recipeViewers.recipesFor`
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

## Optional JEI/EMI recipe displays

The Connector advertises `recipeViewer`, `recipeViewerProvider`, `recipeDisplays`,
`recipeWorkstations`, and `recipeViewerProviders` in `hello.capabilities`.

`recipeViewers.displays` accepts optional `categoryId` and `ingredientId` filters plus the standard
`offset`/`limit` pagination fields. Every entry is a full display:

```json
{
  "recipeId": "create:pressing/iron_ingot",
  "recipeType": "create:pressing",
  "categoryId": "create:pressing",
  "categoryName": "Прессование",
  "provider": "emi",
  "inputs": [
    {
      "kind": "item",
      "id": "minecraft:iron_ingot",
      "count": 1,
      "amount": 1,
      "chance": 1.0,
      "name": "Железный слиток",
      "slot": 0
    }
  ],
  "outputs": [],
  "catalysts": [],
  "workstations": [],
  "width": 134,
  "height": 60
}
```

`slot` groups alternatives occupying the same visual recipe slot. `count` and `amount` intentionally
carry the same value so item-oriented and fluid-oriented consumers can share the DTO.

JEI and EMI are optional, client-only integrations. With neither rich provider available, all
recipe-viewer methods remain available through the server `RecipeManager`; fallback displays include
the registry-aware recipe JSON in `rawJson`. The fallback does not invent machine/workstation data.
