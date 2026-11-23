# Agent Note: the suite runs on Windows as well as Linux

Status: implemented

## Problem

Every gate in the repository ran on `ubuntu-latest`, so nothing observed the host-bound half of `node:path`. Separator-dependent defects therefore reached review invisibly: the containment guard behind issue #50 compared paths with the host separator and rejected every local marketplace entry on Windows, and no Linux run could have shown it.

Adding the job found more of the same class, this time in the tests rather than the product. Four suites created their temp roots under the literal `/tmp` — on Windows that is `\tmp` on the current drive, which does not exist, so `mkdtemp` failed with `ENOENT` before any assertion ran. Five more asserted POSIX spellings of paths the product had built natively (`'/tmp/my-suite/data'` against `D:\tmp\my-suite\data`), a POSIX-flavored regex for a manifest path, and a POSIX-only file mode.

## Decision

`.github/workflows/windows.yml` runs the static gates and the Web UI suite on `windows-latest`: install, `pnpm run check:quick`, then `pnpm run test`. It triggers on pushes to `main` and `dev`, on pull requests into either, and on `workflow_dispatch`.

The suite that remains resolves what it touches through the host's own path rules instead of spelling it out: the e2e cache root is built with `join`/`resolve`, and the host boots from it on either platform.

`.gitattributes` checks every text file out with `eol=lf`, because a second Windows-only failure had nothing to do with paths: a `commands/*.md` fixture is forwarded byte-for-byte and its trailing newline is asserted, so a CRLF checkout reported a difference the product does not have. `eol=lf` is the attribute that overrides the host's `core.autocrlf`; `text=auto` alone defers to it and still yields CRLF. Every committed blob was already LF, so the rule renormalized nothing.

## Consequences

A separator or casing assumption now fails on the platform where it is actually wrong, before review. The job costs one extra install plus one suite run per push to an integration branch and per pull request.

The file-mode assertion is the one guarantee Windows cannot observe at all; it stays POSIX-gated rather than being weakened into a form that passes everywhere and checks nothing.

## Alternatives considered

**Run a Windows subset instead of the whole suite.** Cheaper, but a subset encodes a guess about where platform assumptions hide: the first full run put six of its nine failures outside the path-handling suites such a subset would have covered.

**Keep the `/tmp` literals and create `C:\tmp` in the job.** That makes the tests pass without making them portable — the next host with a different temp convention breaks them again — and `os.tmpdir()` is the API that already means this.

**Normalize separators inside the assertions.** Folding both sides to `/` before comparing hides the spelling the product actually produced, which is the thing worth seeing.

**Normalize line endings inside the suite instead of in `.gitattributes`.** It would have to be repeated in every assertion that reads a file verbatim, and it would hide a genuine CRLF regression in a future fixture rather than only the checkout's.

## Testing

The job is its own test: it fails on `windows-latest` when the host boot or a UI assertion assumes POSIX paths or POSIX file modes. Separator and casing rules for the scanning paths have no automated test; a change there is checked by adding a source on each host and reading the suite detail.
