# KubeVS

KubeJS development, visually integrated into Visual Studio Code.

KubeVS provides project indexing, diagnostics, completion, live Minecraft registry and recipe data
through KubeVS Connector, safe generated-file diffs, and an experimental visual Vanilla Recipe
Editor. The Generic Recipe Editor loads validated custom schemas from
`.kubevs/recipe-schemas/**/*.recipe-schema.json`.

To connect, start Minecraft 1.21.1 with KubeVS Connector and run **KubeVS: Connect to Minecraft**.
KubeVS discovers `config/kubevs-connector-token.txt` automatically in trusted local workspaces and
offers file selection or secure paste for remote servers.
