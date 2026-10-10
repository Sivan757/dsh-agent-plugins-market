# Market bundle

This private workspace owns the bundle domain of dsh-agent-plugins-market. It is not published or installed independently.

The root build emits this source into the existing public artifact. Runtime cross-package imports remain relative. Package dependencies record the allowed domain graph.

Use [the entry](src/index.ts) for cross-domain access. Portable contracts expose typed subpaths. Keep implementation imports inside this workspace.

## Internal modules

[Session extensions](src/session-extension.ts) own the per-agent gates, project readers, selection application and nested host lifecycle. Construction exposes inert readers; the entry mounts the module once after catalog loading.

[Suite queries](src/application/suite-queries.ts) resolve source-qualified documents and details through a read-only port. The catalog facade preserves caller methods and delegates presentation without caching another snapshot.

Run validation from the repository root. The root test suite covers domain and integration behavior. See [the migration contract](../../docs/developer/design/domain-workspace-refactor.md).
