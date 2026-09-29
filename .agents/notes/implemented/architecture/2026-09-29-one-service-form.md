# Agent Note: One form for a service, created or edited

Status: implemented

## Problem

The MCP and LSP add dialogs each built their own shell: their own state for the document, the name, validity and the error, their own footer, and their own `ServerConfigEditor` call carrying `createMode: true`. The edit dialogs mounted `ServerConfigDetail`. Two shapes for one form drifted apart in three ways.

**The fields were grouped differently.** `createMode` moved arguments and environment out of the body and into the **Advanced settings** disclosure, so a new service showed a shorter form than the same service showed once it existed, while the edit form's body carried those fields.

**The document was a different shape.** Editing works on the document the specification seats a service in (`mcpServers` plus this client's namespace) and reads the definition back out of it. Creating composed _through_ the same helper with a declaration key that did not exist yet, so the first form edit rewrote the definition as `{"mcpServers":{"":{…}}}`: the JSON view changed shape under the user, and the add route stored that wrapper as the service definition.

**Every change had two homes.** The name field, the empty document, the create action and the field errors were written twice, once per dialog.

## Decision

**One component serves both.** `ServerConfigDetail` gains a `create` mode: no fetch, the name as a field of the form, the kind's empty document as the starting text, and a save that calls the add route with the typed name and the definition. Both add dialogs (`McpAddModal`, `LspAddModal`) are chrome only — title, width, height, the footer's line about what creating does — around the one form; `ServerConfigEditor` loses `createMode` and always groups a server's fields the same way.

**A service with no declaration key has the definition as its document.** In `server-form.ts` an empty `key` means the service does not exist yet: `parseServerDocument` reads the record itself as the definition, and `composeServerDocument` writes the definition back without a wrapper, so the create form and its JSON view describe the same object the add route stores.

**The advanced disclosure belongs to the form view.** Its inputs are views over seats the document and the policy already have, and the JSON view shows the whole document, so the disclosure renders in the form view only. Its timeout drafts also stop blocking a save made from the JSON view, where they are hidden and a refusal would carry no visible reason; switching back to the form re-applies the check.

## Alternatives considered

**Keep two shells and align them by hand.** The cheapest diff, and the one that produced this drift. Rejected: the fields, the empty document, the name field and the create action would still be written twice, and the next change would land in one of them.

**Extract a presentational form and keep two containers.** A `ServerConfigForm` taking text, onChange and nameField with no data access would separate the shared layout from the flows. Rejected: the create flow's only real difference _is_ data access — where the document comes from and where it goes — so the split would move that difference into a second container that repeats the same markup anyway.

**Let creating keep the wrapper and teach the add route to unwrap it.** The route would read the definition out of `mcpServers[<name>]`. Rejected: the add call already carries the name as its own argument, so the wrapper holds nothing, and a route accepting two document shapes is harder to keep honest than a document that is what it says it is.

**Show the timeout rows while creating.** They would need somewhere to be stored: the add route stores a definition, and this client's policy lives in its own per-service store, so those fields would silently drop what the user typed. The two rows appear once the service exists.

## Consequences

- A new service and an existing one show one form in one order; creating adds the name field, because the declaration key comes from it.
- The create form starts from the definition itself, so its form view and its JSON view describe one object, and the add route never receives a wrapper.
- Timeouts are the one block editing shows and creating cannot: the add route stores a definition, and a value with no seat is not offered.
- The LSP add dialog loses its own state, editor call and footer buttons; both panels now open a dialog that differs only in its copy and the action it has the form portal into the footer.

## Testing

- `tests/client-server-config-policy.test.ts` — the new-service dialog shows the fields the edit dialog shows, fetches nothing, gates its create action on a name and a usable document, and posts `{ type: 'stdio', command: … }` under the typed name.
- `tests/client-detail-editors.test.ts` — an editor with no declaration key edits the definition itself and never composes the empty-key wrapper; the advanced disclosure is rendered in the form view only.
- The edit flow's save payloads, the policy round trips and the form/JSON round trips keep their existing coverage unchanged.
