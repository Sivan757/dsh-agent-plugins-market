# Security and dependency-health audit

Pass: dev head `3853273`, read on 2026-10-27. Axis: security and dependency health, using the `security-and-hardening` skill. Read-only: no source was changed by this pass.

Gate state on the audited tree:

| Gate                          | Result                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm run check:quick`        | pass                                                                                             |
| `pnpm run check:architecture` | pass (299 modules, 1123 dependencies)                                                            |
| `pnpm run test:contract`      | pass                                                                                             |
| `pnpm run format:check`       | fail, caused only by this untracked `docs/scratch/audit/` directory; the committed tree is clean |
| `pnpm audit`                  | 2 advisories: `zod` high, `katex` low                                                            |

Ranked by the cost of not fixing.

## S1 — High — The plugin's own HTTP routes have no DNS-rebinding fence

**Where.** `packages/market-bundle/src/routes.ts:726`, and the same function copied into `routes-extension-presets.ts:36`, `routes-instructions.ts:119`, `routes-resources.ts:121`, `routes-tab-layout.ts:157`, `routes-output-styles.ts:150`. Six copies of one predicate, one per route module.

**The defect.** Every copy is this:

```ts
const origin = request.headers['origin']
if (origin === undefined) return true
return new URL(origin).host === request.headers['host']
```

That compares two values the attacker controls in the attack that matters. A rebound browser carries the attacker's domain in **both** `Origin` and `Host`, because the browser fills `Host` from the URL it believes it is talking to. `Origin === Host` therefore holds, the check passes, and the request is accepted as same-origin.

**Why the host's equivalent is stronger, and this one is not.** The harness applies a real fence to its own `/api` surface at `packages/client/connection/src/api-request-trust.ts:121` (`isTrustedApiRequest`). It checks three things, in this order: the `Host` authority must be loopback, a declared `trustedHosts` entry, or the bind address; a `sec-fetch-site: cross-site` marker is refused outright; and only then, if `Origin` is present, it must match `Host`. Its own comment states the reason the first check exists: "Host is the one header rebinding cannot forge."

The plugin implements only the third check, which is the weakest one. The first check is the defence, and it is absent. Note that this fence is applied in the RPC host for `/api` only. `packages/host/webserver/src/index.ts:428` dispatches `await route.handler(req, res)` straight to a registered route with no fence, and the plugin registers its routes through `host.webServer.register`. Plugin routes are therefore not covered by the host's fence by construction.

**The reachable sequence.** An attacker serves a page at `http://rebind.example` whose DNS record answers with the attacker's IP, then flips to `127.0.0.1` after the page loads. The page then issues `fetch('http://rebind.example/market/...', {method:'POST'})`. The browser sends `Origin: http://rebind.example` and `Host: rebind.example`; the plugin's predicate returns true and the mutation runs. Every mutating route is reachable this way: source create/update/remove (clone a repository of the attacker's choosing), suite install/uninstall and enable/disable, instruction save and delete, tab-layout save, output-style save, and the hook dry run.

**Cost of leaving it.** The enable/disable path is the one that matters. Enabling a suite mounts its hooks, and a hook is a shell command (`hooks-mounts.ts:105` mounts the bridge with `configPath` from the suite). A rebound page that flips one suite to enabled converts a drive-by web page into command execution on the next session. The same primitive clones an arbitrary repository and deletes instruction files.

**Smallest repair.** Replace the six copies with one shared predicate that mirrors the host's, and call it from one place. Concretely: require the `Host` authority to be loopback, or the bind address, or an explicitly configured `trustedHosts` entry; refuse `sec-fetch-site: cross-site`; keep the existing `Origin === Host` comparison last. Exporting the host's `isTrustedApiRequest` and calling it would be better than copying it a seventh time, but it is not published as an importable export for a plugin. Until then, one local module with the three checks and a test that drives a rebinding-shaped request is the whole fix.

## S2 — High — The hook dry run executes commands from a disabled project suite

**Where.** `packages/market-bundle/src/session-extension.ts:254`.

**The defect.** Two neighbouring call sites pass the enabled set and one passes the full set:

- `session-extension.ts:96` — `readHooksOverview` → `catalog.enabledUserSuites()`
- `session-extension.ts:184` — suite declarations → `readExtensionSuiteDeclarations(project.enabledSuites)`
- `session-extension.ts:254` — `hookRun` → `(await catalog.readProjectCatalog(cwd)).suites`

`CatalogSnapshot` (`packages/market-catalog/src/application/snapshot-cache.ts:42`) carries both `suites: Suite[]` and `enabledSuites: Suite[]`. `.suites` is every suite the scan found, whether installed, enabled, or not. The hook-run resolver (`resolveHookDeclaration`, `session-extension.ts:114`) then matches against whatever it is handed, so a hook declared by a disabled project suite resolves and runs.

**The reachable sequence.** A user clones a repository, or opens a workspace, whose checked-in project layout carries a suite with a hook declaration. That suite is not enabled, so it contributes nothing: its hooks are not mounted, and the Hooks overview does not list it. The market page's Hooks tab can still dry-run that declaration by `sourceId`/`suiteId`/`event`/`hookIndex` against `POST` on `EXTENSION_ROUTES.hookRun`, and `runHookDryRun` executes the declared command through the host shell.

The user's trust decision — "this suite is disabled" — is exactly what the operation bypasses. The command itself is not attacker-supplied by the client, which is the property the module's own JSDoc claims and which holds. What does not hold is that the command has to come from something the user turned on.

**Cost of leaving it.** Reviewed repository content becomes runnable while visibly disabled. Chained with S1, a rebound page can run a command from any suite present in any scanned project, with no user interaction beyond loading the page.

**Smallest repair.** Use the enabled set at line 254, matching `:96`: `(await catalog.readProjectCatalog(cwd)).enabledSuites`. If a dry run of a disabled declaration is deliberately wanted, it needs the enable-state carried into `resolveHookDeclaration` and an explicit, documented decision, because the current JSDoc at `:246` says the session "only widens the lookup to that workspace's project hooks", which reads as if it widened to the workspace's _enabled_ hooks.

## S3 — Medium — No dependency audit in CI

**Where.** `.github/workflows/quality.yml`, `.github/workflows/npm-publish.yml`. Neither runs `pnpm audit`.

**Evidence.** `grep -c audit` returns 0 in both files. `pnpm audit --json` on the committed lockfile exits 1 with two advisories:

| Severity | Package | Vulnerable         | Patched    |
| -------- | ------- | ------------------ | ---------- |
| high     | `zod`   | `<4.6.6`           | `>=4.6.6`  |
| low      | `katex` | `>=0.11.0 <0.18.2` | `>=0.18.2` |

**Cost.** Nothing in the pipeline notices a new advisory, so the repository learns about one from Dependabot after the fact rather than from a gate before the release. The release job runs `check:refactor` and `test`, neither of which reads the advisory database.

**Smallest repair.** Add one step to `npm-publish.yml` before release-please, matching where `check-host-alignment.mjs` already runs (`npm-publish.yml:51`). It needs a documented policy for the two known advisories, or it will be red on day one: a checked-in ignore list naming `zod` and `katex` with the reason each is accepted and the version that would clear it.

## S4 — Low — `katex` is pinned below its fix, and the reason lives in the wrong file

**Where.** `package.json:226` (`"katex": "^0.16.47"`), `.github/dependabot.yml:31-36`.

**Evidence.** `katex` resolves to `0.16.47`; the advisory needs `>=0.18.2`. The pin is deliberate: the devDependency exists so vitest can inline the host's `dsh-client-ui-primitives`, which renders TeX through katex and declares `^0.16.47`, so testing against `0.18.x` would exercise a version the host does not ship.

**The gap.** The rationale is recorded in `dependabot.yml` as an ignore rule and in `docs/developer/release/release-v0.9.1.md`. It is not in `.github/SECURITY.md`, which is where the `zod` acceptance was just recorded and is where a reader looking for "which advisories do we knowingly carry" now goes. Two accepted advisories are documented in two different places, and the security policy names only one.

**Smallest repair.** Add a row for `katex` to the accepted-risk table in `.github/SECURITY.md`, with the host's `^0.16.47` as the reason and "a host release that moves off `^0.16.x`" as what would clear it. No code change.

## S5 — Low — Application error text is echoed to the browser unmodified

**Where.** `packages/market-bundle/src/routes.ts:115-119`, and the same `error.message` passthrough in `routes-extension-presets.ts:70`, `routes-instructions.ts`, `routes-resources.ts`.

**The defect.** `sendJson(response, 400, { ok: false, error: error.message })` returns whatever the application layer threw, verbatim. Some of those messages carry absolute local paths. `gitError` (`packages/market-catalog/src/scanning/git.ts:141`) builds `git <op> failed: <stderr tail>`, and git's stderr names the absolute checkout path on a failed clone or fetch.

**Reachability caveat, stated plainly.** I traced the construction of the leaking messages and the passthrough that would carry them, but I did not drive a failing clone through the route to observe the response body. Treat this as a code-path finding awaiting one runtime confirmation, not a measured one. Severity is low regardless: the surface is a single-user local page that already displays these paths elsewhere, so the disclosure is to the same reader who could read them from the page.

**Smallest repair.** Map thrown errors to a stable code plus a message from a fixed table at the route boundary, and log the original. That is a change to the error contract for every mutating route, so it is worth doing once, deliberately.

## Defended

Checked and correct. Do not re-investigate.

- **Archive extraction.** `scanning/archive.ts` guards every path I probed for: per-entry traversal on zip (`:229-241`, normalizes `\\` and rejects `..` segments via `assertSafeEntryName` at `:289` plus an `isWithin` check), symlinks that escape the extraction root (`:352` `assertNoEscapingSymlinks`, using `readlink` rather than `readFile` and saying why), decompression bounds enforced during the stream (`:251-258`), a declared-entry-count preflight before decompression (`:178`), and a post-extraction tree bound for tar (`:310`). The write fan-out is capped at 32 slots (`:213`) with the Windows descriptor-limit reason recorded.
- **Manifest- and entry-derived paths.** `claimLocal` (`scan-resolvers.ts:115`) checks containment lexically and again through `realpath`, and returns an authoritative `rejected` verdict so a later handler cannot reinterpret an escaping path. `componentPath` (`component-files.ts:25`) does the same for declared component files.
- **Identifiers reaching a filesystem path.** `suiteDataDir` composes `${dataRoot}/${sourceId}/${suiteId}` from unsanitized-looking values, but every producer runs them through `sanitizeId` (`manifests.ts:214`, `scan-resolvers.ts:440,515,520,541`, `paths.ts:150`), which strips to `[a-z0-9_-]`. A suite id cannot carry `..` or a separator.
- **Instruction write and delete.** Not path-keyed: the body names a candidate, and `resolveTarget` (`instructions.ts:497`) looks it up in the server-derived candidate list by `scope\0directory\0candidate`, throwing on a miss. A request cannot reach a file the session does not load. Delete additionally requires a stat-able identity (`:590`) and reports hard-link and symlink aliases instead of silently deleting one name of two.
- **Command construction.** Every subprocess is `execFile`/`spawn` with an argv array and no shell: git (`git.ts:62`, with `--` before the URL at `:73`), tar (`archive.ts:305`), and the browser opener (`bridge/oauth.ts:127`, `stdio: 'ignore'`, scrubbed env). A source URL or branch cannot interpolate into a command string.
- **Untrusted suite text reaching the model.** `prompt-frame.ts:44` escapes `</system-reminder>` in the body before framing, `attribute` (`:69`) collapses contributor headings to a single line so a name cannot forge a heading, and `escapeEntry` reuses the host's own skill-catalog escaper. The suite instruction section is registered with `interpolate: false` (`scoped-contributors.ts:195`) with the reason recorded, so a suite quoting `{{cwd}}` cannot break prompt assembly. I found no producer that skips the frame.
- **Secret handling in status and logs.** `market-contracts/src/redaction.ts` redacts secret-shaped keys, preserves `${NAME}` placeholders deliberately, redacts credential query values by URL, and scans for placeholders in linear time with a comment explaining the quadratic-time attack it avoids.
- **Concurrency and disposal.** The mount registries serialize mount/unmount through a `SerialPassQueue`, and the hook disposer is ordered before the grant closes (`scoped-contributors.ts:198-211`) with the ordering reason recorded.

## Not covered by this pass

`pnpm run test` and `pnpm run build` were not run here; the cheap gates above were. The `zod` advisory is accepted by design and recorded in `.github/SECURITY.md` with the host packages that force `4.4.3`; it is not a finding of this pass and should not be re-filed.
