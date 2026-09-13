# Agent Note: mutating routes require the declared wire type

Status: implemented

## Problem

Every mutating route read its string fields through one helper that called `String()` on the parsed body. A request body is arbitrary JSON, so `{"url": {"href": "x"}}` arrived as the string `"[object Object]"` — non-empty, so the `url === ''` check that follows passed, and `POST /sources/add` registered a source whose url was that literal text. `{"branch": {}}`, `{"name": {}}`, and `{"text": {}}` behaved the same way: an entry could be created, replaced, or deleted under a name of literal `[object Object]`, with that text as its file content. Well-shaped bodies were never affected, so nothing in the market page surfaced the coercion.

## Decision

A field a route documents as a string must arrive as a string. `textField(value, label)` throws `` `${label} must be a string` `` for anything else, and every call site keeps its own missing/empty check: an absent field still reads as `""` and still reports `missing …`, so absence and wrong type stay distinguishable. Fields whose absence carries a documented meaning keep it — an omitted `branch` is still no branch, and an omitted `refreshSource` id still means every source — while a value of the wrong type is now rejected instead of quietly taking that same path. The LSP enabled route likewise requires a JSON boolean instead of treating every value except `false` as true.

The coercion survives as `describe()`, used only to render an untrusted value into a diagnostic message, where the coerced text is the point rather than a value.

## Consequences

A malformed body now gets a 400 naming the offending field instead of writing garbage into the profile. This is the pattern the rest of the file already followed — `setEnabled`, `setSurface`, `setMcpOverride`, `mcpReauthorize`, and `setMcpBackend` all test `typeof` — so the coercing helper was the outlier rather than this being a new policy.

The cost is that a caller relying on lenient parsing breaks. Nothing in `src/client/` sends a non-string for these fields; they are all values typed into a form.

## Alternatives considered

**Keep the coercion and tighten only the checks that follow.** A shape check after coercion cannot separate `"[object Object]"` from a legitimate url, so this would need a per-field value grammar for urls, branch names, and entry names. The type check is the check that actually holds.

**Reject the whole body when any field has the wrong type.** The routes report the first offending field by name, which tells the caller which field to fix; a blanket 400 would not.

**Require the declared type only on fields that reach disk.** That is close to what shipped, but the read-only-looking fields (`id` on the enabled route) drive lookups against the same untrusted input, and splitting the helper in two would make the rule harder to state than to apply.

## Testing

`tests/routes.test.ts` posts each wrong-type shape at its route and asserts the named 400 plus an empty store log — no `addSource`, `updateSource`, `refreshSource`, `setLspServerEnabled`, or panel call is reached. It then asserts that absence still reports `missing source url`, and that the same field as a string still reaches the store. Replacing `textField`'s body with `return String(value)` turns the first case back into `ok: true`, which is the failure this note records; restoring the `refreshSource` fallback turns its case into `ok: true` the same way.
