# Agent Note: the preset manager's cards carry the panel's facts

Status: implemented

## Problem

The same connector read differently on the two surfaces. The settings list showed 已连接, the endpoint, 工具 4 and, for a failure, 连接超时 · 10.0s; the preset manager showed a raw mount key (`cloudflare__cloudflare`), the transport, and nothing else — no endpoint, no tool count, no state, no reason. A reader deciding what belongs in a preset had to open the other surface to find out what the row actually is.

## Decision

- **The inventory carries the live facts, not just the switchable ones.** `ExtensionResource` gains `runtime` (state, code, reason, causes, mount time) and `transport`, plus `toolCount` where the panel counts tools. The manager draws the same slots the panel draws: display name, body, meta, counts, and a warning line built by the same classifier (`failureGuidanceKey` + `failureCause` + the mount time).
- **The manager's own meaning stays in its own slot.** The rail and the state word keep saying what this surface is about — whether the row is in the preset — because that is the question the modal answers. The live state appears where it cannot be confused with it: as the warning line, in the panel's words.
- **Names are display names.** A suite server mounts as `<suite>__<key>`; the inventory row now carries the key the panel shows, so the two surfaces name the row identically.

## Alternatives considered

- **Replace the manager's state word with the live state.** Rejected: the modal exists to show what a preset contains, and a row that is in the preset but disconnected would then read as if it were excluded.
- **Show both state words as two chips.** Rejected: two badges saying 已启用 and 连接失败 on one card invite the reader to guess which one controls what.
- **Give the manager its own wording for failures.** Rejected: the classifier and its sentences already exist; a second wording is how the two surfaces drifted in the first place.

## Consequences

- A service row reads the same on both surfaces except for the inclusion word, which belongs to this surface.
- A new live fact has one place to be added: the inventory.
- `toolCount`/`runtime` are optional, so faces without a process behind them are unchanged.

## Verification

- Measured in `market-dev`, manager vs settings, connectors face: `cloudflare · 套件 · 已启用 · https://mcp.cloudflare.com/mcp · 工具 4 · streamable-http` against the panel's `cloudflare · 套件 · 已连接 · … · 工具 4 · streamable-http`; the failed row reads `kuboard · … · https://kuboard.platform.zealwon.com/mcp · 工具 0 · streamable-http · 连接超时 · 10.0s` exactly as the panel does.
- The language-engine, skills, output-styles and system-prompt faces were checked the same way: body, counts, scope words and reasons all match their panels.
- The full suite passes (2526) and the gate is clean.
