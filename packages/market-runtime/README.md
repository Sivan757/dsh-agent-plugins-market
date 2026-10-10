# Market runtime

This private workspace owns the runtime domain of dsh-agent-plugins-market. It is not published or installed independently.

The root build emits this source into the existing public artifact. Runtime cross-package imports remain relative. Package dependencies record the allowed domain graph.

Use [the entry](src/index.ts) for cross-domain access. Portable contracts expose typed subpaths. Keep implementation imports inside this workspace.

## Workspace policy and recovery

The workspace policy owner commits surface and entry choices together through the host file lock. Legacy surface routes read the same live snapshot. Failed persistence leaves memory unchanged; failed refresh retains the committed state and reports its error. Complete preset/reset replacement is one write. Global favorites use their own locked document.

Explicit session recovery retries an unrecorded initial capture or restores its durable choice. Successful recovery resumes existing queued input without a second Send. Ordinary plugin loading does not automatically run restored input. Corrupt durable choices remain denied.

Run validation from the repository root. The root test suite covers domain and integration behavior. See [the migration contract](../../docs/developer/design/domain-workspace-refactor.md).
