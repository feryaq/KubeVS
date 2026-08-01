# Custom Recipe Schemas

Status: **Experimental · Offline Available**

KubeVS can turn an arbitrary mod recipe serializer into a typed visual form without hard-coding
that mod into the extension. Run **KubeVS: Create Generic Recipe** to open the schema-driven editor.

The editor always includes **Raw Custom Recipe** as a lossless fallback. Workspace schemas add
named fields, validation, defaults, repeatable ingredient/result rows, and safer generated JSON.

## Schema location

Place schema files below:

```text
.kubevs/recipe-schemas/**/*.recipe-schema.json
```

The directory can be changed with `kubevs.recipeSchemas.directory`. It must remain relative to the
workspace. Open editors watch this directory and reload valid schemas automatically.

Run **KubeVS: Create Recipe Schema** to create a documented starter template in the configured
directory.

## Complete example

```json
{
  "version": 1,
  "id": "my_mod:machine_recipe",
  "label": "My Machine",
  "recipeType": "my_mod:machine",
  "description": "Recipes processed by My Machine.",
  "fields": [
    {
      "path": "ingredients",
      "label": "Ingredients",
      "kind": "ingredient",
      "required": true,
      "multiple": true,
      "minItems": 1,
      "placeholder": "minecraft:stone or #c:ingots/iron"
    },
    {
      "path": "results",
      "label": "Results",
      "kind": "item_stack",
      "required": true,
      "multiple": true,
      "minItems": 1,
      "placeholder": "minecraft:diamond x 2"
    },
    {
      "path": "processing_time",
      "label": "Processing time",
      "kind": "integer",
      "default": 200
    }
  ]
}
```

The form above generates a custom recipe with this shape:

```json
{
  "type": "my_mod:machine",
  "ingredients": [
    {
      "item": "minecraft:stone"
    }
  ],
  "results": [
    {
      "id": "minecraft:diamond",
      "count": 2
    }
  ],
  "processing_time": 200
}
```

KubeJS output uses `event.custom(...)` and an optional `.id(...)`. The exact JSON fields must match
the recipe codec supplied by the target Minecraft mod.

## Schema properties

| Property      | Required | Meaning                                  |
| ------------- | -------- | ---------------------------------------- |
| `version`     | Yes      | Schema format version. Currently `1`.    |
| `id`          | Yes      | Unique namespaced schema ID.             |
| `label`       | Yes      | Human-readable name shown in the editor. |
| `recipeType`  | Usually  | Fixed namespaced recipe serializer ID.   |
| `description` | No       | Short explanation shown beside the form. |
| `fields`      | Yes      | One to 100 field definitions.            |

If `recipeType` is omitted, the schema must declare a required, non-repeatable `resource_id` field
at path `type`. This is how the built-in raw editor supports serializers discovered at runtime.

## Field properties

| Property      | Required   | Meaning                                                |
| ------------- | ---------- | ------------------------------------------------------ |
| `path`        | Yes        | Dot-separated output path such as `settings.duration`. |
| `label`       | Yes        | Visible field label.                                   |
| `kind`        | Yes        | Parsing and UI control type.                           |
| `description` | No         | Recovery-oriented help shown below the control.        |
| `placeholder` | No         | Example input, never used as a value.                  |
| `required`    | No         | Rejects an empty value. Default is `false`.            |
| `multiple`    | No         | Produces an array and repeatable rows.                 |
| `minItems`    | No         | Minimum array length from `0` to `100`.                |
| `options`     | For `enum` | One to 100 unique values.                              |
| `default`     | No         | Typed value used when the field is empty.              |

Supported field kinds:

- `string` — text;
- `resource_id` — a namespaced ID such as `create:mixing`;
- `ingredient` — `namespace:item` becomes `{ "item": "..." }`, while `#namespace:tag` becomes
  `{ "tag": "..." }`;
- `item_stack` — accepts `namespace:item` or `namespace:item x 4`;
- `number` — any finite number;
- `integer` — a safe whole number;
- `boolean` — a checkbox;
- `enum` — a select control backed by `options`;
- `json` — bounded structured JSON.

The special path `$` is available only to a `json` field. Its object properties are merged into the
recipe root. A root `type` property cannot override the editor's validated recipe type.

## Validation and safety

KubeVS rejects:

- duplicate schema IDs or field paths;
- invalid namespaced IDs;
- absolute or parent-relative schema directories;
- paths containing `__proto__`, `prototype`, or `constructor`;
- prototype-polluting keys inside JSON values;
- unknown values not declared by the selected schema;
- schema files larger than 256 KiB;
- form payloads larger than 128 KiB;
- arrays longer than 100 values.

Schema files never execute JavaScript. The webview receives parsed definitions and cannot read or
write workspace files directly. Generated scripts still open a native diff before replacement and
recheck the target immediately before writing.

## Raw Custom Recipe

Use the built-in raw schema when a specialized schema is not available:

1. enter the namespaced recipe serializer ID;
2. enter the recipe body as a JSON object without relying on its `type`;
3. inspect the canonical KubeJS preview;
4. save the generated script.

Raw mode preserves nested JSON values, but it cannot prove that another mod will accept the recipe.
Use the target mod's documented recipe codec or inspect a real recipe through KubeVS Connector.
