# Agent Note: The schema-subset port retired onto the host-published validator

Status: implemented

## Problem

The self-built MCP bridge admitted a server's advertised `outputSchema` through `json-schema-subset.ts`, a narrowed local port of the harness validator. Its written premise was scope, not availability: the upstream validator's 656 lines carry realm-safe JSON intrinsics and full diagnostics, while the bridge needs one decision — may this advertised schema ride a tool registration as structured output. The port kept the contract (closed keyword table, one scalar type, nested structure, unsupported keywords reject) with a conservative structural check.

That framing aged out of the dependency graph, not out of correctness. The port was written 2026-09-01, when `@deepseek-ai/dsh-tools` was not yet a declared dependency; the package entered `dependencies` at the rc.1 alignment. The 2026-09-26 reuse audit then confirmed the validator is published from the package root since rc.2 — `assertSupportedJsonSchema`, `JsonSchemaError` with its `violations` list, and the `JsonSchema*` types — and the host's own `dsh-mcp-client` calls it. A local port of a published host capability is exactly the drift the reuse rule forbids, so the premise had to be re-examined rather than grandfathered.

## Decision

The port is deleted; the bridge imports the host package directly.

`tools.ts` keeps `supportedOutputSchema` and its fallback contract (an advertised schema outside the supported subset degrades to unconstrained JSON — the upstream failure mode), now backed by `assertSupportedJsonSchema` from `@deepseek-ai/dsh-tools`. `host-contract.ts` takes `JsonSchemaNode` from the same package. No dependency line changes: `dsh-tools` was already a `dependencies` entry at the host baseline, so the plan adds nothing to the consumer profile.

The behavioral delta is acceptable because the replacement is a superset on every axis the bridge cares about: the host validator walks nested schemas with the same closed keyword table and rejects what the port rejected, accumulates every violation instead of stopping at the first, and answers the port's two extra guarantees — recursive graphs report `circular` instead of recursing forever, and non-object roots reject. Measured on the installed rc.2 build, not assumed. The old port-specific message text was never a contract: no caller matched on it, and the pin test asserts the error's type and `violations` payload instead.

## Alternatives considered

- Keep the port behind a message-compat shim. Rejected: the messages had no consumer, and compat code for an internal diagnostic is cost without a contract.
- Re-expose host names through a bridge-local re-export module. Rejected for import ergonomics: direct imports state the dependency where it is used, and the reuse manifest row records the decision either way.

## Consequences

The gate now owns the rule, so host-side tightening reaches the bridge through the ordinary dependency-alignment flow instead of leaving a stale copy; 214 lines and their recursive-walk test cases are gone from this repository. The cost is a coupling the port did not have: the pin tests ride the host's error vocabulary (`JsonSchemaError`, `violations`), so an upstream reshape of that contract surfaces here as a test failure to follow rather than a silent continuation — which is the direction a reuse rule wants failures to point.

## Supersession audit

The port's rationale lived in the completion record of [the MCP OAuth relocation plan](../../../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md), not in an active note; that record now names this decision, and no active note is superseded. The plan's remaining seam list (`scrubbedParentEnv`, credential key syntax) stays deliberate ports: the host either does not export them from a consumable subpath or the seam is a vocabulary, not a function. The [reuse manifest](../../../../docs/reference/reuse-manifest.md) row flips from `self-built` to `use-host` in the same change, and the retired-row note records the replacement.

## Testing

Pin tests (tests/mcp-schema-subset.test.ts) hold the upstream admission semantics and the `JsonSchemaError`/`violations` error contract on the installed package; the bridge suite exercises the unsupported-schema fallback end-to-end through `syncTools` (33 tests green), plus typecheck, lint, prettier, the reuse gate, and the full `check:refactor` chain.
