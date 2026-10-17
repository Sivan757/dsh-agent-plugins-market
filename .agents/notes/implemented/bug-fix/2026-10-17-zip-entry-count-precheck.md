# Agent Note: Refuse an oversized zip before decompressing it

Status: implemented

## Problem

`extractZip` counted entries inside fflate's `onfile` callback, where the 20,000-entry limit is enforceable only once fflate reaches that entry. fflate parses a whole-archive zip — including its central directory — recursively, so a zip of tens of thousands of tiny members overflowed the JavaScript stack inside a single `push()` before the counter could reject it. The caller saw `Maximum call stack size exceeded` instead of the entry-limit refusal the contract promises, and the archive had already been read into memory.

## Decision

`extractZip` reads the entry count from the end-of-central-directory record before it constructs the unzip stream, and throws the same entry-limit error when the declared count exceeds the cap. An unreadable record, or a `0xffff` count that defers to zip64, falls through to the existing streaming guard, which stays in place as the authority on a record that understates the archive.

## Alternatives considered

- **Count entries by walking the central directory by hand.** Rejected: it re-implements zip64 and multi-disk handling for one bound, and the declared count answers the question the cap asks.
- **Raise the stack size for the stream.** Rejected: it moves the failure to a larger archive instead of bounding it.
- **Catch the overflow and rethrow the limit error.** Rejected: it reports a guessed cause and still spends the whole archive in memory.

## Consequences

- An oversized zip is refused before decompression, so memory use stays bounded.
- A zip whose record understates its entries still meets the streaming guard.
- zip64 archives over the cap are refused by the streaming guard, not by the pre-check: the record's `0xffff` count is treated as unknown on purpose.

## Related decisions

None. This is a local guard inside [the archive scanner](../../../../packages/market-catalog/src/scanning/archive.ts).
