# Language support

Status: **Experimental / Offline Available**

KubeVS augments VS Code's JavaScript and TypeScript support inside `server_scripts`,
`client_scripts`, and `startup_scripts`.

Implemented:

- TextMate highlighting accents for KubeJS event groups, common callbacks, and resource locations;
- snippets for recipe and item registration;
- folder-aware completion for recipes, tags, item registration, modification, and client events;
- hover documentation;
- document and workspace symbols for KubeJS events and resource locations;
- debounced diagnostics in Problems;
- a safe Code Action that adds statically known missing closing braces.

Completion is intentionally a small verified catalog. KubeVS does not invent methods for installed
addons; later stages will merge versioned metadata with live Connector capabilities.

`startup_scripts` hover/completion documentation explicitly marks restart-required APIs.
