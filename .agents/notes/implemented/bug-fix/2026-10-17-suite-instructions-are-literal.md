# Agent Note: Render suite instruction text as literal prompt text

Status: implemented

## Problem

Installed suites contribute Markdown instruction files through two prompt sections named `agent-plugins:instructions` (`packages/market-runtime/src/runtime/host/scoped-contributors.ts` and `packages/market-runtime/src/runtime/surfaces/project-runtime.ts`). Neither registration set the host's `interpolate` flag, and the host defaults it to `true`: `renderPrompt` replaces every `{{name}}` with a registered variable and throws when the name is unknown (harness `packages/core/system-prompt/src/index.ts`).

The loop registers exactly two variables, `provider` and `model`. A suite that quotes any other brace form — the retired `{{cwd}}` clause is the common one — therefore failed prompt assembly before the model request, and the failure named a section the plugin owns but an expression the plugin never intended.

## Decision

Both registrations pass `interpolate: false`. Suite-authored Markdown is third-party literal text, not a template: the plugin copies it into the prompt and must not interpret it.

## Alternatives considered

- **Register the missing variables.** Rejected: a suite may quote any name, and the plugin cannot enumerate them; a variable it invented would fabricate prompt content the suite never asked for.
- **Escape `{{` before registering.** Rejected: it rewrites third-party text and diverges from what the suite file contains.
- **Leave the default and document the restriction.** Rejected: the failure arrives at request time for text the user already installed, with no action the reader can take.

## Consequences

- A suite file reaches the prompt byte for byte, including any brace form.
- The section renders no variable, so it cannot observe `provider` or `model` through interpolation; a future need for a variable requires an explicit decision here.

## Related decisions

Complements [the cross-release host seam](../architecture/2026-10-16-cross-release-host-seam.md), which keeps host member names tolerant rather than wrapping them.
