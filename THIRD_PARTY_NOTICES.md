# Third-party notices

KubeVS включает или использует сторонние компоненты на условиях их собственных лицензий.
Коммерческая лицензия KubeVS не заменяет эти лицензии.

## Runtime components

- `ws` — MIT License; WebSocket client used by the VS Code extension.
- `Java-WebSocket` — MIT License; bundled into KubeVS Connector through NeoForge Jar-in-Jar.
- Visual Studio Code Extension API — Microsoft license terms; provided by the host application.
- NeoForge and Minecraft APIs — their respective terms; not relicensed by KubeVS.

TypeScript, ESLint, Prettier, esbuild, VSCE, Gradle, JUnit and related packages are build
or test dependencies and retain their own licenses.

The previous user-supplied `1-bit_Pixel_Icons.zip` assets are not part of the production source tree
or release artifacts because their redistribution license could not be verified. Production UI uses
KubeVS-owned SVG branding and native VS Code Codicons.
