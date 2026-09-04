# Agent Note: Source acquisition expansion — adoption, git acceleration, archive sources

Status: implemented

## Problem

Three user-facing gaps shared one root: source acquisition. (1) A user who cannot reach GitHub through the UI (proxy-restricted networks) clones repositories manually into `~/.dsh/agent-plugins/.sources/`, but the user dimension scans only sources registered in `state.json`, so those checkouts stay invisible — and re-adding the same URL through the UI invented a `-2` suffixed id and cloned a second copy instead of adopting the existing directory. (2) Cloning was a bare `git clone --depth 1` with a fixed 120 s timeout: no proxy, no mirror, no retry, no early failure on stalled transfers, and shallow-unfriendly `git pull --ff-only` updates. (3) Claude Code marketplaces support acquisition kinds this manager did not — most notably `{ source: "archive", url, sha256? }` HTTPS zip payloads — while Codex supports local paths and git URLs only; our source model had exactly two kinds (git, local).

## Decision

One acquisition layer with three kinds, `resolveSourceKind` being the single authority (explicit `kind` wins, legacy `local` flag maps to `'local'`, archive-shaped URLs infer `'archive'`, everything else is `'git'`):

- **Adoption (manual-clone repair).** `addSource` first checks the candidate ids' checkout directories: a directory whose `origin` remote matches the input URL under `canonicalGitUrl` equality is registered as-is with `adopted: true` — no clone, no rename, no invented id. `sources/adopt` registers any unmanaged `.sources/` checkout explicitly (non-git directories become `local` sources). The overview payload reports `unmanaged` checkouts and the client renders an adoption row. Adopted and local sources are user-owned: `removeSource` and URL changes never delete their directories.
- **Git acceleration.** `GitOptions` rides the host config: `proxy` (injected as `http.proxy`/`https.proxy` `-c` args), `insteadOf` URL rewrites (mirror acceleration), `timeoutMs`, `cloneRetry` (one automatic retry; default on), and `fallbackTarball` (default off — retry a failed `github.com` clone as a codeload `tar.gz` download through the archive pipeline). Every remote-touching invocation gets `GIT_HTTP_LOW_SPEED_LIMIT/TIME` so stalled transfers fail early. Updates use `fetch --depth 1` + `reset --hard FETCH_HEAD` (shallow-safe, idempotent) instead of `git pull --ff-only`, resolving the branch from the source pin or the checkout's current branch.
- **Archive sources.** `catalog/archive.ts` downloads over HTTPS (plain http only with `allowHttpArchives`), caps at 256 MiB, verifies an optional `sha256` pin, and extracts zip (fflate) or tar.gz/tar (system `tar`) with zip-slip guards (entry-name checks, no zip symlinks, post-extraction symlink-containment walk), unwraps a single top-level wrapper directory, and swaps into `.sources/<id>`. The download digest is the source's lock value (no git HEAD exists). Refresh re-downloads and swaps.

State compatibility: `kind`, `sha256`, and `adopted` are optional `state.json` fields; `version` stays 1. Wire: `SourceOverview` gains `kind`/`adopted`, the overview payload gains optional `unmanaged`, and `sources/adopt` joins the route table.

## Alternatives considered

- **Auto-scanning unmanaged checkouts as temporary sources** (project-dimension style) was deferred: it would surface junk directories and duplicates as cards without user intent; the explicit adoption row keeps discovery visible but registration deliberate.
- **URL-level dedupe on `addSource`** (rejecting a URL already registered under another id) was not added — it changes existing duplicate-tolerant semantics; adoption covers the real-world case.
- **A native zip dependency-free path** (system `unzip`) was rejected: `unzip` is absent on stock Windows and its flags vary; fflate is zero-dependency and small. Tar.gz reuses the system `tar`, which every target platform ships.
- **ETag/If-None-Match short-circuit on archive refresh** was deferred: the digest pin already prevents wasted installs for pinned sources, and re-download semantics stay simple.

## Risks

- Archive downloads are SSRF-adjacent: HTTPS-only by default and the 256 MiB cap bound it, but `allowHttpArchives` is an explicit trust decision for intranet mirrors.
- The tarball fallback produces a non-git checkout; its "lock commit" is a sha256 hex, not a commit — downstream consumers must treat `lockCommit` as an opaque token (they already do).
- `reset --hard` on update discards working-tree drift in managed checkouts; this is intended (sources are read-only inputs) but surprises anyone who edited a checkout in place.

## Verification

- `tests/source-acquisition.test.ts`: kind inference, id derivation for archive URLs, codeload URL mapping, state round-trip, download/verify/extract/unwrap/zip-slip/tar.gz/symlink-capable pipeline over a local HTTP server, adoption listing/idempotent adoption/git+local registration/removal keeps user directories.
- `tests/routes.test.ts` covers the route table; `tests/skills-provider.test.ts` pins the local-source persisted shape.
- `pnpm run check:refactor` and the full vitest suite are green.
