# Domain workspace refactor acceptance

## Result

The repository uses eight private domain workspaces and one public installation artifact. Frozen behavior is recorded in local commit d2f391e. This refactor does not publish a release.

## Structure

| Owner              | Responsibility                                                       | Entry                                                   |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------- |
| market-bundle      | Product composition, HTTP assembly and compatibility facade          | [entry](../../packages/market-bundle/src/index.ts)      |
| market-catalog     | Sources, dialects, discovery, snapshots and installation             | [entry](../../packages/market-catalog/src/index.ts)     |
| market-runtime     | Session choices, content contributions, Team roles and shared demand | [entry](../../packages/market-runtime/src/index.ts)     |
| market-mcp         | MCP configuration, connection, tools and status                      | [entry](../../packages/market-mcp/src/index.ts)         |
| market-lsp         | LSP configuration, provider lifecycle and status                     | [entry](../../packages/market-lsp/src/index.ts)         |
| market-translation | Translation service, queue, cache and providers                      | [entry](../../packages/market-translation/src/index.ts) |
| market-ui          | Browser views, transport and presentation                            | [entry](../../packages/market-ui/src/index.ts)          |
| market-contracts   | Stateless records, identifiers and typed ports                       | [entry](../../packages/market-contracts/src/index.ts)   |

The root [installation entry](../../index.ts) re-exports the product bundle. The public package name, exports, bundle row, settings namespace and persistent formats remain unchanged.

The runtime receives concrete MCP/LSP factories from composition. The catalog package does not instantiate those adapters or translation. MCP and LSP configuration use cases are separate. Translation rules move into TranslationService instead of remaining in the product facade.

The UI translation types live in leaf modules rather than the browser entry. Shared Hook event grouping lives in shared UI. Existing internal unit tests remain at the repository root.

## Enforced boundaries

[Architecture rules](../../.dependency-cruiser.cjs) reject cycles, reverse composition imports, concrete connectors in runtime, browser imports of server code, and cross-domain deep imports. The public root entry is included.

[Package tests](../../tests/domain-workspaces.test.ts) require eight private owners, complete public artifact entry paths, an acyclic manifest graph, declared cross-domain dependencies and no bare private runtime imports.

External published dependencies remain declared by the public deployment package. Private workspace dependencies document source relationships. Compiled relative imports need no private npm installation.

## Measured validation

| Validation | Observed result | Evidence |
| --- | --- | --- |
| Full tests | 195 files, 1,863 tests pass | [test log](domain-refactor-2026-10-08-evidence/tests.txt) |
| Frozen identity comparison | All 1,860 baseline identities remain; three package tests added | [comparison](domain-refactor-2026-10-08-evidence/test-comparison.json) |
| Standing gate | Type, lint, format, route contracts, architecture and reuse pass | [gate log](domain-refactor-2026-10-08-evidence/gates.txt) |
| Dependency graph | 258 modules and 964 edges, no violations or cycles | [gate log](domain-refactor-2026-10-08-evidence/gates.txt#L20-L26) |
| Public packing | One tarball, 359 files, no source workspaces, private runtime dependencies or symlinks | [artifact record](domain-refactor-2026-10-08-evidence/packed-acceptance.txt#L4-L7) |
| Installed exports | Public server/client/types paths exist; MCP identity remains 0.9.0 | [artifact record](domain-refactor-2026-10-08-evidence/packed-acceptance.txt#L6-L7) |
| Real isolated DSH | Session creation, mock response, actual Hook marker and browser settings pass | [runtime record](domain-refactor-2026-10-08-evidence/packed-acceptance.txt#L8-L14) |

The live test uses the extracted tarball, not the source workspaces. External dependencies reuse the existing installation. It is not a clean registry dependency installation. The test uses a new DSH_HOME, Agent layout, workspace and loopback port. Tokens and cookies are not committed.

The experimental preset entry remains off by default. Enabling it through host settings shows the entry without a reload. The session runtime remains available while the entry is hidden.

Existing source-map and CodeMirror DOM-test warnings remain in the passing log. A current Windows CI run and live external-provider reliability test are not part of this local result.

## Preserved scope

This is source ownership and package-boundary refactoring. It does not introduce separate host plugin instances, independent package publication, new toggles, or stronger shutdown semantics.

Recovery interaction, polling cadence, translation cancellation policy, legacy filter behavior and Hook identity semantics remain frozen. Further behavior changes need their own decisions and tests.

The prior [audit](version-audit-2026-10-07.md) and [repair report](version-repair-2026-10-07.md) retain historical snapshot references. Current implementation paths are owned by the package entries above. Frozen fixture content and archived decision records remain unchanged.

## Dev Note

The initial bulk path rewrite also touched one fixture and foreign documentation paths. Both were restored from the frozen commit before acceptance. No baseline assertion was relaxed to hide these failures.

The structural migration is committed separately from the behavior freeze. The live profile, host source and remote repository remain unchanged. The isolated test process is stopped after evidence collection.
