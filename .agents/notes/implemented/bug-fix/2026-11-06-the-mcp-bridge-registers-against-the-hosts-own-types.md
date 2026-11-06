# Agent Note: the MCP bridge registers against the host's own types

Status: implemented

## Problem

The bridge handed its tools to the host's registry through a hand-written copy of the host's contract: `host-contract.ts` restated `ToolDefinition`, `ToolExecution` and `ToolExecutionResult` field by field, and the registration seam cast the host context to \`{ tools?: { register?: (definition: unknown) => () => void } }\` so the copy would pass.

The host's 0.2.2-rc.1 line widened that contract — the execution context grew the call identity, the parsed arguments and the step admission, and the result became a discriminated union whose failure variant carries no \`value\` — and the hand-written copy stayed behind. A copy of a union is exactly what a compiler cannot check, so the drift surfaced nowhere except the cast that hid it. The plugin shipped types that no longer described what the host hands a tool body.

## Decision

- **The host's shapes are imported type-only.** \`host-contract.ts\` re-exports \`ToolDefinition\`, \`ToolExecution\`, \`ToolExecutionResult\` and \`ToolRunContext\` from \`@deepseek-ai/dsh-tools\` with \`import type\`, which is erased at compile time: the market still loads no second copy of the host runtime, and the compiler now checks every definition the bridge registers against the contract the host enforces.
- **The cast at the registration seam is gone.** \`bridge.ts\` reads \`ctx.tools\` — the host's own typed service — at registration time, and a missing registry still fails with the same explicit error.
- **The bridge's own seam stays hand-written.** \`ToolHost\`, \`McpResult\` and the JSON value vocabulary are the bridge's surface, not the host's; they remain declared here.
- **The runtime behavior is unchanged.** \`finalizeContent\` still returns early on a failed result, public tool names stay \`mcp__<server>__<tool>\`, and the two-phase fetch-then-swap sync is untouched.

## Alternatives considered

- **Refresh the hand-written mirror to match the new union.** Rejected: it would fix today's drift and re-create the condition for the next one — a copy a compiler cannot check against its source.
- **Import the host types as a runtime dependency.** Rejected: the mirror existed so the market never loads a second copy of the host runtime; a type-only import keeps that property while giving up nothing the mirror provided.
- **Keep the cast and add a type test elsewhere.** Rejected: a test asserts what the author remembered; the compiler checks what shipped.

## Consequences

- A host contract change now fails this repository's typecheck instead of surfacing as a silent cast.
- \`@deepseek-ai/dsh-tools\` is a peer the deployment supplies and this repository builds against, so a type-only import adds no install-time weight.
- The bridge's own seam keeps its shape, so a reader of \`host-contract.ts\` sees the host's contract and the bridge's seam distinguished rather than interleaved.
