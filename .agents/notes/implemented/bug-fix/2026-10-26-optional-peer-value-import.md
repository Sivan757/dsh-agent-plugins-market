# Agent Note: An optional peer cannot be a value import

Status: implemented

## Problem

`dsh-agent-plugins-market@0.12.0` declared `@deepseek-ai/dsh-session-query` as an **optional** peer, and `packages/market-runtime/src/runtime/host/extension-session-state.ts` opened with a side-effect import of it. A side-effect import emits a real runtime import. Measured on the published tarball installed into an empty directory, `await import('dsh-agent-plugins-market')` failed with `ERR_MODULE_NOT_FOUND` naming that package, so the plugin registered nothing at all.

Two facts kept it hidden. A dsh profile sets `autoInstallPeers: false`, so no peer is ever installed by the plugin's own install. The shipped desktop profile supplies the package anyway, from `~/.dsh/profiles/node_modules`, next to 248 other host packages, so the desktop app loaded the plugin fine. And this repository's own tree carries the devDependencies mirror, so every local run resolved it too.

The same defect sat one import later, unnoticed because the first failure stopped evaluation. `@deepseek-ai/dsh-tools` was also declared optional while `packages/market-bundle/src/platform/feedback-tool.ts` imports `defineTool` from it for value, and `settings-namespace.ts` reaches that module statically. Had session-query resolved, the plugin would have failed on `dsh-tools` instead.

The alignment gate accepted both. It derived required-versus-optional from the _shape_ of the import statement, treating every `from` clause as a static import without asking whether the statement is type-only or for value. A type-only import is erased at build time and costs nothing at runtime, so the marker was valid for the other three uses of these packages and the gate could not separate them.

## Decision

An optional peer stays valid only for an import the build erases. `extension-session-state.ts` now imports `SessionQueryEngine` with `import type`, so the `sessionQuery` cordis augmentation still reaches the compiler and no runtime import emits. The declaration stays an optional peer with the support window `>=0.2.0-rc.2 <0.3.0-0`.

The fallback is the seam the module already reads. `optionalService(ctx, 'sessionQuery')` is the plugin's existing tolerant read of an optional host service, and the module answers `undefined` through it instead of throwing. A profile that provides no service governs no agent: every pre-step hook passes through untouched, every managed resource stays denied, `status()` reports `extension-session-query-unavailable`, and `read()` returns `undefined` rather than a state that authorizes anything. A host that supplies the service behaves exactly as before.

That answer is what the other optional seams give. `hooks-mounts.ts` reports the missing bridge as a suite row with a reason, and the LSP path reports `host-missing`. An unavailable capability is reported with a code a caller can name, never a `TypeError` and never a silently allowed turn.

`@deepseek-ai/dsh-tools` has no such seam. Its `defineTool` is a pure function that runs while the tool definition is built, and the packages that call it read the result at mount time, so a lazy load would only move the failure. It becomes a required peer: the installation supplies it, as it supplies the other service packages, and the optional marker goes.

**The gate now separates the two import forms.** `scripts/check-host-alignment.mjs` reads the statement that owns each host specifier and records a production file's value import separately from a type-only one. A new violation, `optional-static`, fails when `peerDependenciesMeta[name].optional` is set on a package a production file imports for value, and `--fix` deletes the marker instead of shipping it. The `optional-undeclared` rule is unchanged: a package reached only through `import(...)` still requires the marker. Together the two rules say the marker tracks what the runtime does, not what the manifest hopes.

## The import chain a host-free install still wants

Measured on the rebuilt tarball installed into an empty directory. `npm install` resolves the required peers on its own, so a plain install now reaches `IMPORT OK`. Withholding every peer (`--legacy-peer-deps`, which is the shape a profile has) leaves only the five `dependencies` entries resolving, and the chain wants these sixteen host specifiers, in this order:

```text
 1. @deepseek-ai/dsh-session              peer
 2. @deepseek-ai/dsh-home-paths           dependency
 3. @deepseek-ai/dsh-timeout              peer
 4. @deepseek-ai/dsh-atomic-write         dependency
 5. @deepseek-ai/dsh-llm                  peer
 6. @deepseek-ai/dsh-tools                peer
 7. @deepseek-ai/dsh-agent                peer
 8. @deepseek-ai/dsh-system-prompt        peer
 9. @deepseek-ai/dsh-subagent             peer
10. @deepseek-ai/dsh-lsp                  dependency
11. @deepseek-ai/dsh-scope                peer
12. @deepseek-ai/dsh-hook-protocol        dependency
13. @deepseek-ai/dsh-subprocess           peer
14. @deepseek-ai/dsh-credentials          peer
15. @deepseek-ai/dsh-attachment           peer
16. @deepseek-ai/schemastery              dependency (not a host package)
```

`@deepseek-ai/dsh-session-query` no longer appears. Every remaining specifier is declared, and every one that is a peer is a package the installation supplies, which is the provisioning split [the plugin development standard](../../../../docs/reference/dsh-plugin-development-standard.md) §2.1 states.

## Alternatives considered

- **Self-provision session-query as a `dependencies` entry**, the way `dsh-hook-protocol` and `dsh-lsp` are. Rejected: those two are plain stateless libraries, so a profile copy cannot shadow a host service. `dsh-session-query` exports a cordis `Service`, and the host's own instance is the one that observes the session log. A profile-local copy would be a second instance of a host service, which is the shadowing the [self-provisioned LSP capability](../architecture/2026-09-11-self-provisioned-lsp-capability.md) note names as its own reason not to self-provision the host's service packages.
- **Delete the import entirely and leave a bare `ctx.sessionQuery` read.** Rejected: the import is type-only for a reason. It carries the `sessionQuery` augmentation and the `SessionQueryEngine` type, and without it the property read neither typechecks nor names a published member.
- **Make the `dsh-tools` import lazy at each of its four call sites.** Rejected: `defineTool` runs while the definition is built, and the callers hand the result to `ctx.tools.register` in the same mount. A lazy load would defer the failure to the mount and give the feedback tool a second "unavailable" diagnostic for a package the plugin cannot work without. The required-peer answer costs nothing and matches how the installation already supplies that package.
- **Teach the gate to read the emitted JavaScript instead of the source.** Rejected as the general rule: the gate runs in the pre-commit hook and `prepack`, and it must not depend on a build having run. Reading the statement that owns the specifier answers the same question from source, and the fixture test pins a mixed `import { type X, y }` statement to the value form.
- **Drop the optional marker from every peer.** Rejected: `dsh-mcp-client` and `dsh-hooks-claude-code` are reached only through `import(...)` and genuinely degrade, so the marker is true for them and the `optional-undeclared` rule keeps requiring it.

## Testing

- `packages/market-runtime/test/session-query-seam.test.ts` reads the source file and requires exactly one mention of the package, in an `import type` statement, and requires the manifest to keep the optional peer. A value import or a dropped declaration fails it.
- `packages/market-bundle/test/integration/extension-session-query-seam.test.ts` mounts the state service on a context with no `sessionQuery` plugin and requires `status()` to report `extension-session-query-unavailable`, `read()` to return `undefined`, the agent to stay idle, and `initialize()` to reject with that code.
- `packages/market-bundle/test/repo/host-alignment.test.ts` adds a case that runs the real script over a fixture tree: a value import with the optional marker reports `optional-static` and `--fix` removes the marker, while a type-only import keeps the marker and passes.
- `pnpm run build && npm pack`, installed into an empty directory, then `node --input-type=module -e "await import('dsh-agent-plugins-market')"` reaches `IMPORT OK` and lists `Config, apply, inject, name`. The same command against the 0.12.0 tarball fails with `ERR_MODULE_NOT_FOUND` on `@deepseek-ai/dsh-session-query`.
- `node scripts/check-host-alignment.mjs --refresh` reports 36 packages checked and no violations.

## Consequences

- A profile that supplies the session-query service behaves exactly as before. A profile that does not now loads the plugin, loses only extension selection, and reports `extension-session-query-unavailable` where the surface shows why.
- The extension selection surface is unavailable, not degraded-but-working, in that profile. It cannot replay a session's durable selection without the reader, so claiming any agent would park every turn waiting for a state that can never be published. Denying the surface is the honest answer.
- `@deepseek-ai/dsh-tools` stops being optional in the manifest. A profile that ships no copy now reports an unmet peer at install, which is the declaration doing its job.
- The gate gained a rule and can now fail a tree it used to pass. That is the point: both defects were green before this change.
- The published tarball's manifest and its runtime graph now agree, so `package.json` answers "what does this plugin need" without a reader having to open the built output.
