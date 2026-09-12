# Agent Note: zip entry writes run through a bounded slot set

Status: implemented

## Problem

`extractZip` pushed one `writeZipEntry` promise per finished entry into an unbounded array and awaited the array at the end. The unzip stream drives `onfile` synchronously, so a whole archive schedules its writes before the first one finishes: a 20,000-entry zip asks the process for 20,000 file descriptors at once. Linux and macOS absorb that; Windows refuses around the 8,192nd, and the failure surfaced as 11,812 unhandled `EMFILE` rejections that failed the test run even though the guard under test had done its job.

The same code also reported a guard failure before its writes had settled. `extractZip` threw while entry writes were still running, and the caller removes the staging directory in its `finally` — a write that had not started yet recreated its path underneath that removal, so the cleanup failed with `ENOTEMPTY`.

## Decision

Writes go through a fixed set of 32 slots. Each finished entry is appended to one slot's chain, so at most 32 descriptors are open at once while extraction keeps streaming. A failure recorded during the stream turns writes that have not started yet into no-ops, and `extractZip` reports only after every chain has settled.

Settle-then-report is what makes the staging directory safe to remove: nothing may still be writing into `.extract` when `archiveInstall` deletes it. Errors funnel into the existing `failure` slot rather than rejecting a chain, so the first failure is still the one reported and no rejection goes unobserved.

## Consequences

An archive that trips the entry-count guard is rejected without materializing its entries first: the entry-limit test went from 20.5s to 1.0s on Windows and from 31.9s to 3.1s locally, because the guard now stops the work instead of racing it.

Throughput on a legitimate archive is unaffected in practice — the writes are tiny, and 32 in flight is far more than a disk has outstanding in normal extraction.

## Alternatives considered

**Await each write where it is queued.** One descriptor per archive removes the spike entirely, at the cost of a full round trip per entry on every install.

**Bound only the success path and keep the old fan-out on failure.** The spike comes from the fan-out itself, and an archive that trips a guard is precisely the one whose remaining entries we do not want to write.

**Raise the process descriptor limit before extracting.** The limit is the host's, not ours; a plugin that mutates it would affect every other consumer in the session, and the fan-out would still be wrong on the next, larger archive.

## Testing

`tests/zip-bomb.test.ts` builds a 20,010-entry zip and asserts the entry-limit rejection; that is the test that failed on Windows before this change. Its sibling cases cover the post-extraction tar walk. `tests/source-acquisition.test.ts` covers whole-archive installs end to end, including the staging-directory swap and the single-wrapper-directory normalization, so the settle-then-report order is exercised on the success path too.
