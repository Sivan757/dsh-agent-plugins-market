# Market translation

This private workspace owns the translation domain of dsh-agent-plugins-market. It is not published or installed independently.

The root build emits this source into the existing public artifact. Runtime cross-package imports remain relative. Package dependencies record the allowed domain graph.

Use [the entry](src/index.ts) for cross-domain access. Portable contracts expose typed subpaths. Keep implementation imports inside this workspace.

Run validation from the repository root. The root test suite covers domain and integration behavior. See [the migration contract](../../docs/developer/design/domain-workspace-refactor.md).
