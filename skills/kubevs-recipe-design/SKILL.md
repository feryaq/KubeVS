---
name: kubevs-recipe-design
description: Design, audit, and implement believable, balanced Minecraft modpack recipes and production chains with KubeVS MCP. Use for KubeJS recipe work, progression reviews, throughput estimates, and GregTech CEu 1.21.1 compatibility.
metadata:
  version: '1.0.0'
---

# KubeVS recipe design

Create recipes that fit the pack's materials, machines, progression, and actual installed versions. Keep physical reasoning plausible without presenting game abstractions as real science. Distinguish **complexity** (meaningful steps, machines, materials, infrastructure) from **tedium** (repeated clicks, travel, waiting, arbitrary gates); add the former only when it creates a useful choice, and reduce the latter.

## Ground truth

1. Read resource `kubevs://guide`; call `kubevs_status` and inspect `kubevs_project_roots`. Confirm Minecraft, KubeJS, integrations, and live Connector state. If MCP is unavailable, report that evidence gap and work only from provided files/docs.
2. Use `kubevs_list_registries`, `kubevs_search_registry`, `kubevs_tag_members`, and `kubevs_list_mods` to confirm item/fluid/tag/machine IDs and installed versions; use `kubevs_list_recipes`/`kubevs_get_recipe` to inspect actual recipes. Read `kubevs_list_recipe_schemas`/`kubevs_recipe_schema` and `kubevs_craft_graph`. Treat live results and version-matched source documentation as authoritative; never invent IDs, GregTech APIs, machine names, voltage tiers, overclock rules, or serializer fields.
3. For GregTech CEu 1.21.1, verify the exact installed mod/version and consult its live docs/source and actual machine/recipe data for every claimed mechanic. Record where each recipe form and machine is confirmed. If unavailable, make a clearly marked draft or ask for the missing source; do not silently substitute GTCEu 1.20 or other forks.
4. Keep model estimates distinct from measured runtime facts. State assumptions for yields, chance, time, power, parallelism, availability, and byproducts. Do not call EU RF or infer conversions without pack-specific evidence.

## Design and review

- Place the recipe in the existing progression: check unlocks, earliest machine access, resource scarcity, adjacent recipes, and whether it bypasses or strands a mod's intended path.
- Give every ingredient and processing step a reason a player can understand. Prefer material transformations or a useful machine property over decorative ingredient piles and unexplained catalysts.
- Inspect the whole dependency graph for cycles, unavailable inputs, dead ends, bypasses, and balance across mods. A cycle is a graph/design finding, not proof of a dupe; investigate item return paths, catalysts, chance, and machine behavior separately.
- Estimate raw demand only after aggregating shared intermediates. Guaranteed mode uses whole batches; expected mode estimates Bernoulli stopping trials and can produce fractional expected batch counts. Propagate steady-state rates through each consumed ingredient before sizing machines. Keep reusable catalyst stock separate from consumed inputs. See [chain-calculator.md](references/chain-calculator.md).
- Calculate time from recipe ticks using nominal 20 TPS, and energy from verified EU/t × ticks × batches. Label these nominal model estimates, not measured durations. Include machine count only when target throughput and relevant parallelism are known; otherwise leave it unknown.
- Consider byproducts, recycling, voiding, and all return paths. Check whether recycling can amplify material, whether chance products alter expected inputs, and whether outputs have a credible sink. Do not claim a dupe without demonstrating a repeatable net-positive loop under actual recipe semantics.
- Assess tedium with concrete evidence: number of distinct stages, repeated batches/clicks, travel, unattended wait, bottleneck, and whether automation removes it. Do not emit a numeric “tedium score” without grounded, agreed inputs.
- Present key assumptions and trade-offs briefly. For implementation, preview with `kubevs_generate_recipe` or the relevant supported generator (`save: false`); for GTCEu use `kubevs_generate_gregtech_recipe` with its native builder. Inspect warnings, IDs, schema, and graph. Before overwriting, call `kubevs_read_file`, then pass its exact revision to `kubevs_write_file` or the generator. Preview does not modify files. A save does not apply recipes in game: use `kubevs_reload` explicitly when permitted; startup registrations require restart.
- After edits, inspect the resulting file and re-read/rebuild the graph. Report what was modelled, what came from live data, and what still needs an in-game check. Avoid large questionnaires; ask only when a missing choice materially changes progression or output.
