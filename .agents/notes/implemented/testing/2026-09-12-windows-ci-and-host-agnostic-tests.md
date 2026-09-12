# Agent Note: the suite runs on Windows as well as Linux

Status: implemented

## Problem

Every gate in the repository ran on `ubuntu-latest`, so nothing observed the host-bound half of `node:path`. Separator-dependent defects therefore reached review invisibly: the containment guard behind issue #50 compared paths with the host separator and rejected every local marketplace entry on Windows, and no Linux run could have shown it.

Adding the job found more of the same class, this time in the tests rather than the product. Four suites created their temp roots under the literal `/tmp` — on Windows that is `\tmp` on the current drive, which does not exist, so `mkdtemp` failed with `ENOENT` before any assertion ran. Five more asserted POSIX spellings of paths the product had built natively (`'/tmp/my-suite/data'` against `D:\tmp\my-suite\data`), a POSIX-flavored regex for a manifest path, and a POSIX-only file mode.

## Decision

`.github/workflows/windows.yml` runs the whole suite on `windows-latest`: install, then `pnpm run test`, whose `pretest` hook brings typecheck and lint with it. It triggers on pushes to `main` and `dev`, on pull requests into either, and on `workflow_dispatch`.

The suites that had only ever run on one host now derive what they assert from the host's path rules instead of spelling it out: temp roots come from `os.tmpdir()`, expected paths are built with `join`/`resolve`, and the single permission assertion states that it is POSIX-only, because `chmod` on Windows only toggles the read-only attribute and the mode there is `0o666`.

## Consequences

A separator or casing assumption now fails on the platform where it is actually wrong, before review. The job costs one extra install plus one suite run per push to an integration branch and per pull request.

The file-mode assertion is the one guarantee Windows cannot observe at all; it stays POSIX-gated rather than being weakened into a form that passes everywhere and checks nothing.

## Alternatives considered

**Run a Windows subset instead of the whole suite.** Cheaper, but a subset encodes a guess about where platform assumptions hide: the first full run put six of its nine failures outside the path-handling suites such a subset would have covered.

**Keep the `/tmp` literals and create `C:\tmp` in the job.** That makes the tests pass without making them portable — the next host with a different temp convention breaks them again — and `os.tmpdir()` is the API that already means this.

**Normalize separators inside the assertions.** Folding both sides to `/` before comparing hides the spelling the product actually produced, which is the thing worth seeing.

## Testing

The job is its own test: it fails on `windows-latest` for every `/tmp` root and POSIX assertion listed above, which is how each was found. `tests/paths.test.ts` keeps the separator rules themselves covered on every host, so the win32 behavior stays pinned even when a change is only exercised on Linux.
