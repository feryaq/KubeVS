# ProbeJS feature reference

KubeVS uses [ProbeJS](https://github.com/Prunoideae/ProbeJS) and
[ProbeJS Extension](https://github.com/Prunoideae/ProbeJS-Extension) as product references, not as
source dependencies. Their code was not copied into KubeVS.

ProbeJS demonstrates the value of generating editor declarations from a running Minecraft
instance. ProbeJS Extension also demonstrates practical registry/tag insertion and existing-recipe
inspection workflows. KubeVS implements these ideas independently through its own authenticated
WebSocket protocol and native VS Code commands.

Current KubeVS equivalents:

- `KubeVS: Insert Registry Array` with include/exclude regex filters;
- `KubeVS: Insert Values from Tags`;
- `KubeVS: Insert Existing Recipe JSON`;
- `KubeVS: Insert Existing Recipe as KubeJS`, backed by the normalized recipe model;
- `KubeVS: Generate Live Typings`;
- generic registry, tag-value, recipe-type and recipe-JSON Connector endpoints;
- generated declarations under `.kubevs/generated/registries.d.ts`;
- a native diff and explicit confirmation before replacing an existing generated file.

ProbeJS is GPL-3.0 licensed. ProbeJS Extension declares LGPL-2.1 licensing. Any future adoption of
their implementation code requires a separate license and distribution review.
