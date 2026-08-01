# Recipe Editor

Status: **Experimental · Offline Available**

Run `KubeVS: Create Recipe` to open the first visual Recipe Editor vertical. It supports Vanilla
shaped, shapeless, smelting, blasting, smoking and campfire cooking, item or tag ingredients,
result count, experience/cooking time where applicable, a live readable KubeJS preview, and
keyboard navigation.

Saving opens the native VS Code save dialog. If the selected file already exists, KubeVS opens a
native diff and requires explicit replacement confirmation. Generated code uses a stable
`ServerEvents.recipes` wrapper and an optional recipe ID.

`KubeVS: Insert Existing Recipe as KubeJS` is a live-only companion workflow. It imports recipe
JSON from KubeVS Connector into the same normalized model. Vanilla shaped, shapeless, smelting,
blasting, smoking, and campfire recipes receive specialized models; unknown modded recipes remain
lossless generic JSON and generate through `event.custom`.

Run `KubeVS: Create Generic Recipe` for schema-driven mod recipes. It includes a raw JSON fallback
and loads validated workspace schemas from `.kubevs/recipe-schemas`. See
[custom-recipe-schemas.md](custom-recipe-schemas.md).

Planned additions:

- opening an existing local JavaScript or JSON recipe directly in the visual editor;
- built-in Create, Oritech and Farmer's Delight schema-specific panes;
- reusable ingredient pickers backed by Registry Browser;
- custom editor persistence rather than command-created panels.
