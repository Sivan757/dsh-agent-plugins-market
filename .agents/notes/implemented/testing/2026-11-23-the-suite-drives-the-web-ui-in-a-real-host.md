# Agent Note: The suite drives the Web UI in a real host

Status: implemented

## Problem

The repository carried 302 Vitest files across the eight package test trees. They pinned scanning, routes, mounts, the MCP bridge, the translation engine and client rendering, and every change to those layers paid a toll in fixture upkeep. The host's 0.2.3-alpha.1 candidate then removed contracts the suite asserted: Cordis 4.2 exposes the root context only through `Context.root`, `@deepseek-ai/dsh-client-ui-primitives` dropped `rankByName`, and several test-only entry points disappeared with the export cleanup. The direction for this change was to delete the test cases and rebuild around the frontend UI only.

## Decision

- The Vitest stack is gone: no package test tree, no `vitest.config.ts`, no `tsconfig.test*.json`, no test scripts, and no `vitest`, `jsdom`, coverage or test-only host mirrors in `devDependencies`. The fixtures that belonged to those tests were deleted with them.
- One Playwright suite in `e2e/` drives the plugin's Web UI inside a real host. `e2e/host.mjs` provisions an isolated `DSH_HOME` under `node_modules/.cache/e2e`, installs the host CLI pinned to `HOST_SUPPORT_FLOOR`, installs a profile that links this checkout, seeds one local fixture source, and boots `dsh --profile market --no-open --port`. Playwright starts it as its web server; the browser is the installed Chrome (`channel: 'chrome'`), one worker runs at a time, the context locale is `en-US`, and the spawned host's proxy variables point at a closed port so the preset Git source fails fast and the seeded fixture is the only data on the page. The host also gets a `DSH_AGENTS_HOME` under that home: `$DSH_AGENTS_HOME` (default `~/.agents`) is where the user authors skills, commands and MCP servers by hand, and without overriding it a developer's personal resources appeared on the suite's tabs.
- The specs assert only what a reader sees: the workspace row, market refresh, search, status filter, grid/list switch, suite detail, source add/remove, and install/uninstall with the skills list. `e2e/support/market.ts` performs the host navigation (settings, Agent Plugins) that every spec shares and dismisses the boot-time prompts.
- The host baseline moved to `0.2.3-alpha.2` in `scripts/host-support-window.mjs`, `package.json` and `pnpm-workspace.yaml`: support range `>=0.2.3-alpha.2 <0.3.0-0`, dev mirrors at the baseline, Cordis `~4.2.0-alpha.1`, schemastery `~3.20.0-alpha.1`, cosmokit `~1.10.0-alpha.1`. `scripts/check-host-alignment.mjs` resolves the baseline from `next` and `alpha` and takes the newest version, because the 0.2.3 line published its alphas to `alpha` while `next` still named `0.2.2-rc.5`; `--channel` still pins one tag explicitly.
- Two production adaptations came with it: the MCP bridge reads the root context as `ctx[Context.root]`, and the skill menu ranks candidates through a local `rankByName` (`packages/market-ui/src/ui/rank-by-name.ts`) because the host no longer exports one.
- CI runs the suite on Node `24.22.3` on Linux and Windows; it no longer installs a Playwright browser bundle.

## Alternatives considered

- **Keep Vitest for the non-UI layers and add Playwright beside it.** Rejected: the instruction was to delete and rebuild, and two stacks double the maintenance the deletion exists to remove.
- **Run Playwright against a downloaded Playwright Chromium.** Rejected: the download path available here was unusably slow, and the suite needs a browser rather than a particular build; CI images and developer machines already ship Chrome.
- **Seed the suite's market through the plugin's HTTP API.** Rejected: writing the plugin's own `state.json` is cheaper and is the persisted contract the host reads; the specs still assert only rendered UI.
- **Keep the support floor at `0.2.2-rc.5`.** Rejected: `>=0.2.2-rc.5 <0.3.0-0` cannot match `0.2.3-alpha.2` under semver's prerelease rule, and the alpha removed the APIs the plugin had used.

## Related

- [Resolve the alignment baseline from the prerelease candidate line](../process/2026-09-23-next-channel-baseline.md) records the earlier `next`-only rule; this note supersedes its single-tag default while keeping `next` among the candidate tags.
- [Typecheck the suites, lint them with types, and run the checks where development stops](../../archived/testing/2026-09-12-test-typecheck-projects.md) is archived: the test projects it added are gone, and the typed-lint decision it recorded now covers the server, client and Playwright projects.
- [Tests live beside their packages](../../archived/architecture/2026-10-11-tests-live-beside-their-packages.md) is archived: no package carries a test tree now. Its schema relocation under `market-catalog/schemas/` still holds.

## Consequences

- A passing spec means a user can perform that gesture in a booted host, including the host's own settings and plugin pages around the market.
- Scanning, routes, mounts, the MCP bridge, the translation engine and the hook event table no longer have an automated test. They are verified through the host by hand, and the pre-push evidence map says so.
- The first `pnpm run test` on a machine installs the host CLI and a profile (network), then caches both under `node_modules/.cache/e2e`; later runs boot in seconds. The host's engines require Node `^24.22.3 || >=26.13.1`.
- The desktop profile links this checkout while its app runs `0.2.2-rc.5`, and this plugin now requires `0.2.3-alpha.2`. The linked plugin works again when the app moves to the alpha line, or the desktop profile returns to a published stable package.
- The composer's preset entry does not render on this host line: the host calls the `conversation.input.left` seat without a session id, so `PresetEntrySlot` hides itself and warns once. The market's own settings surface is unaffected; the entry stays dark until the host passes the session identity.
