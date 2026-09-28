# Agent Note: plugin personas expose a routing-only editor

Status: implemented

## Problem

With plugin-origin panel entries made read-only in content, agent personas lost their one machine-local setting: the routing frontmatter (model, provider, reasoning effort) is configuration of the user's machine, not suite-owned text. The pencil was hidden for plugin entries, so routing could no longer be changed after install.

## Decision

Agent personas are the read-only exception, scoped tightly:

- Server: `assertStateFlipOnly` allowlists, for kind 'agents', exactly `model`, `provider`, `reasoning_effort` and its `reasoningEffort` alias — on top of `disabled` (all kinds) and the skills invocation pair. The body must stay byte-identical; any other key added, removed or value-changed is refused.
- Client: a plugin persona's pencil opens the editor in a routing-only shape (EntryEditorModal grows a `routingOnly` prop that hides the text-label row and the raw CodeEditor). The structured `RoleMetadataFields` controls are the only editable surface; the name field never renders in edit mode (pre-existing behavior).
- Plugin skills and commands remain switch-only; user-authored entries keep full editing.

## Consequences

- The raw Markdown body editor never opens for plugin personas, so the body rule cannot be bypassed through the UI.
- `reasoning_effort` is stored canonically; the `reasoningEffort` alias is accepted on input and normalized away.
- The catch-all metadata row excludes the routing keys on agent personas so they do not render twice.

## Verification

- Probe tests: routing-only flip on a plugin persona succeeds and rewrites the registered file; a body edit and a `tools` edit are each rejected with the specific error; the file stays untouched on rejection.
- Affordance matrix: pencil present on plugin persona and user cards, absent on plugin skill/command cards; trash present only on user cards.
- Full suite, typecheck, eslint, architecture gate and prettier green.
