# Contributing

Contributions are welcome. You may create local branches and commits, or use a
GitHub fork whose primary purpose is preparing a pull request for the official
KubeVS repository. You do not need separate written permission for that
contribution workflow. Direct pushes require collaborator access.

Keep Extension Host, webview, pure packages, and Connector responsibilities
separate. New features need a working vertical scenario, tests for pure logic,
explicit Offline/Connector status, keyboard support, theme support, and honest
documentation.

Before submitting a pull request:

1. Describe the user-facing problem and the reason for the chosen solution.
2. Keep unrelated changes out of the branch.
3. Run pnpm check and the Gradle build.
4. Confirm that your contribution is your own work or that you have permission
   to submit it.

By intentionally submitting a contribution, you agree to the contribution grant
in the [KubeVS Community Source License 1.0](LICENSE). A contribution fork does
not grant permission to publish independent KubeVS releases or products.
