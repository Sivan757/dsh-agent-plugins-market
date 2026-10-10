# Host foundation map

The npm-published `@deepseek-ai/dsh-*` packages are the authority for what this plugin may reuse; what the harness monorepo contains but has not published is a lookahead, never a use. This page indexes the general-purpose foundation packages — the ones any feature package may build on — so a capability is looked up here before it is built.

Paths below are relative to the harness checkout (`~/workspace/deepseek-harness`), not to this repository; they are written as plain paths for that reason. The standing reuse rule and its machine-checkable ledger live in [reuse-manifest.md](reuse-manifest.md) and the [plugin development standard](dsh-plugin-development-standard.md) §3.4; component and token rules live in that checkout's `docs/web-styling.md`.

## Web client components and assembly (`packages/client/`)

| Package | npm name | What it provides |
| --- | --- | --- |
| `packages/client/ui-primitives` | `@deepseek-ai/dsh-client-ui-primitives` | **Core UI component library**: Button, Switch, SegmentedControl, SegmentedTabs, Checkbox, Input, Menu, Modal, Toast, Tooltip, Pill, Tag, StateDot, DisclosureRow, HoverCard, RiskConfirmation and icons, plus the Markdown+TeX, terminal, file-read, diff, search, web-fetch and JSON output cards. Settings forms ride it too: `SettingsForm`, `SettingsValueField`, `SettingsSecretField`, `SettingsFormModel`. Zero Cordis, styled only through `--dsw-*` tokens; untrusted model output is rendered with raw HTML dropped, links restricted and ANSI parsed |
| `packages/client/ui-slots` | `@deepseek-ai/dsh-client-ui-slots` | **Composition library** (no React): ordinary Slots give parents owned extension positions, Component Factories give reusable assemblies; both derive props types from declaration merging, and conflicts (registering into an undeclared slot, declaring an already-declared child, mounting one shared handle under two scopes) throw during plugin loading |
| `packages/client/ui-renderer` | `@deepseek-ai/dsh-client-ui-renderer` | Mounts the assembled Web GUI (`ctx.uiRenderer.mount`): binds the slot runtime's bare observables (`getSnapshot`/`subscribe`) into React selector hooks at the render position, and owns the React context and the final component tree. Business packages stay plain React components and never wire subscriptions themselves |
| `packages/client/ui-theme` | `@deepseek-ai/dsh-client-ui-theme` | Theme and content font size: `light`/`dark`/`system`, 10–22px, immutable `ThemeSnapshot`s, the `--dsw-*` token stylesheets and the synchronous pre-plugin bootstrap; third-party themes override alias tokens through `ctx.theme` |
| `packages/client/ui-layout` | `@deepseek-ai/dsh-client-ui-layout` | Window chrome: the three-column AppFrame, edge-column widths, `ctx.layout` presentation control; the right column's yield logic and applying the theme snapshot to the document also belong to it |
| `packages/client/ui-dockkit` | `@deepseek-ai/dsh-client-ui-dockkit` | **Docking layout engine**: a split tree of tabbed panes with invertible operations, planners and a linear history. Marked an internal engine — its exports may change in any release and are not a stable API |
| `packages/client/ui-session` | `@deepseek-ai/dsh-client-ui-session` | React/Slot adapters for the Session catalog, retain information and unified UI status; materializes each `SessionBinding` into hooks and props, and owns process-local pending-interaction and completion-reminder policy |
| `packages/client/ui-workspace` | `@deepseek-ai/dsh-client-ui-workspace` | Workspace browsing and picking foundation: grouped or flat session rows, management actions, the slot-composed row actions (`sidebar.workspaces.session.menu.item` / `sidebar.workspaces.session.row.action`), and the two directory-picker holes |
| `packages/client/ui-conversation` | `@deepseek-ai/dsh-client-ui-conversation` | Target-neutral conversation assembly: event and view registries, per-session bindings, input state, slots, and temporary composer takeovers |
| `packages/client/ui-tool` | `@deepseek-ai/dsh-client-ui-tool` | Tool-call presentation: whole-call tree composition, the `tool.call.toolview` slot keyed by tool name, and the built-in atomic tool cards |
| `packages/client/ui-settings` | `@deepseek-ai/dsh-client-ui-settings` | Settings domain base plugin: configuration forms, the schema service, namespace-scoped reads and writes with concurrent-write protection, and the standard extension points `settings.section` / `settings.plugins.tab` / `settings.onboarding` |
| `packages/client/store` | `@deepseek-ai/dsh-client-store` | React-free observable/snapshot state primitives: synchronous and animation-frame publication, Immer updates, shallow equality, optional browser persistence |
| `packages/client/locale` | `@deepseek-ai/dsh-client-locale` | Localization: the zh/en preference, typed namespace dictionaries and `t()`; plugins may add languages |
| `packages/client/resources` | `@deepseek-ai/dsh-client-resources` | Resource model: `dsh-resource://<type>/…` addresses resolve to live values through protocol-registered providers, read by components through `useResource` |

## Client runtime and transport

| Package | npm name | What it provides |
| --- | --- | --- |
| `packages/client/modules` | `@deepseek-ai/dsh-client-modules` | Turns a plugin package's `dsh.client` declaration into a loadable browser bundle; the host composes the boot graph and serves it over `/plugins`, the browser loads lazily |
| `packages/client/connection` | `@deepseek-ai/dsh-client-connection` | Browser↔Host wire layer: Remote RPC, event-stream delivery with reconnect, exact Fetch routes, connection generations and observable recovery state |
| `packages/client/shortcuts` | `@deepseek-ai/dsh-client-shortcuts` | Per-device keyboard command customization; bindings survive reloads, and commands disappear when their owning plugin unloads while the saved overrides remain |
| `packages/client/file-upload` | `@deepseek-ai/dsh-client-file-upload` | Session-addressed browser uploads: Blob, exact bytes and streaming sources, with progress, cancellation and staged receipts |
| `packages/client/hmr` | `@deepseek-ai/dsh-client-hmr` | Development-time synchronization of the host plugin graph and rebuilt bundles into open pages; plugin enable/disable needs no page reload |
| `packages/extensions/cordis-client-runner` | `@deepseek-ai/dsh-cordis-client-runner` | Browser half of dynamic Cordis packages: loads a definition after an approved request or a user gesture and unloads it when the host retracts the run; also provides the browser-side `ctx.timer` |

## Zero-dependency utility packages (`packages/util/`)

| Package | npm name | What it provides |
| --- | --- | --- |
| `packages/util/brand` | `@deepseek-ai/dsh-brand` | Nominal string and number types for confusable domain values (cross-boundary ids use `Branded<B>`) |
| `packages/util/values` | `@deepseek-ai/dsh-util-values` | Lossless JSON validation, detached snapshots, deep freezing, structural equality, exhaustive-union assertions |
| `packages/util/timeout` | `@deepseek-ai/dsh-timeout` | Timeout arithmetic and deadline fusion: `clampTimeout` clamps a caller's hint, `deadline` fuses upstream cancellation, `idleWatchdog` watches streaming reads |
| `packages/util/time` | `@deepseek-ai/dsh-util-time` | IANA time-zone validation and canonicalization for wire boundaries; it validates, it does not format |
| `packages/util/chunked-list` | `@deepseek-ai/dsh-chunked-list` | Immutable append-only lists for projection state: bounded append copying, insertion order, Zod checkpoint validation |
| `packages/util/deque` | `@deepseek-ai/dsh-deque` | Circular deque with amortized constant-time operations, immediate release of removed entries and bounded vacant storage |
| `packages/util/crypto` | `@deepseek-ai/dsh-util-crypto` | Cross-runtime UUID generation, replacing secure-context-only `crypto.randomUUID` |
| `packages/util/code-language` | `@deepseek-ai/dsh-util-code-language` | The file-extension → syntax-highlighting language table shared by the client code surfaces and the host read card |
| `packages/util/workspace-path` | `@deepseek-ai/dsh-util-workspace-path` | Browser-safe Workspace path joining, POSIX home abbreviation and display-title derivation |
| `packages/util/output-retention` | `@deepseek-ai/dsh-output-retention` | Bounded model-facing output: item and text retainers plus the standardized omission footer |
| `packages/util/atomic-write` | `@deepseek-ai/dsh-atomic-write` | Atomic file replacement and cross-process writer locking, so no partial, symlink-hijacked or wider-permission content reaches disk |
| `packages/util/launch-environment` | `@deepseek-ai/dsh-launch-environment` | An immutable snapshot of this run's environment that remembers which layer supplied each value |
| `packages/util/http-proxy` | `@deepseek-ai/dsh-http-proxy` | Outbound HTTP proxy policy: resolved once from the launch environment and applied to every fetch that would otherwise go direct |
| `packages/util/home-paths` | `@deepseek-ai/dsh-home-paths` | One consistent resolution of the Harness home and user-data paths, `~` expansion and stable watch paths |
| `packages/util/native-command` | `@deepseek-ai/dsh-native-command` | Host-native command and path-opening utilities: shell-free execution, cancellation, desktop detection, WSL path handoff |
| `packages/util/lazy-require` | `@deepseek-ai/dsh-lazy-require` | Caller-relative lazy loading for CommonJS host dependencies not needed during startup |
| `packages/util/package-manifest` | `@deepseek-ai/dsh-package-manifest` | Shared type declarations for package identity, runtime requirements and DSH plugin metadata |

## Timing and time (do not build another scheduler)

- **`ctx.timer`** — the host Cordis TimerService (`@deepseek-ai/cordis-plugin-timer`): `timeout`, `interval`, `throttle`, `debounce`; `setTimeout`/`setInterval` are deprecated aliases. Callbacks register on `ctx.effect`, the returned disposer cancels the schedule, and plugin unload cleans up. The browser half is `packages/extensions/cordis-client-runner/src/client/timer.ts`.
- **`@deepseek-ai/dsh-timeout`** — business-level timeout semantics: `clampTimeout` clamps a hint, `deadline` fuses a deadline with cancellation, `idleWatchdog` watches a stream, and `timeoutOf` separates timeout from cancellation.
- **`@deepseek-ai/dsh-util-time`** — time-zone identity (IANA validation and canonicalization), not timing.
- **`relativeTime`** (exported by `ui-primitives`) — the "how long ago" bucketing for UI, returning `{ unit, n }` for the caller to localize; current consumers are `ui-reference` (reference ages) and `ui-workspace` (session row times).

## Release discipline

- A capability package's own `latest` dist-tag often sits at its first-publish placeholder (for example `0.0.1-rc.1`); `next` is the live release line. Judge "is it published" by `next`, not `latest`.
- Present in the monorepo is not published: `@deepseek-ai/dsh-client-ui-primitives` declares a `./src/*` export, but its tarball `files` carry only `lib/`, so the importable surface is `lib/*.js` plus `lib/types/**/*.d.ts` (and `lib/**/*.css`). See the repository root `AGENTS.md` for the verification procedure.
