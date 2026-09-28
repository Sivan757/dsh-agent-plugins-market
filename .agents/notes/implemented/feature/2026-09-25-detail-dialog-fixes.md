# Agent Note: plugin panel entries lose the delete affordance, and detail footers slim down

Status: implemented

## Problem

Four maintainer-reported defects, all verified against the dev tree:

1. PanelResources.remove unlinked files inside a suite checkout for plugin-origin entries — a delete affordance that reaches past suite management (install/uninstall own plugin files).
2. ui/detail.module.css stretched the FIRST footer child across the row (.footer > :first-child { flex: 1 }), which is why lone Close/Done buttons filled the entire footer.
3. The agent-persona detail dialog rendered all routing frontmatter as one unreadable metadata string in a kv label column — model/provider/reasoning effort were effectively invisible.
4. The MCP detail footer carried a whole-server enable switch that duplicated each card's toggle in a read-only detail view.

## Decision

- Deleting a plugin-origin panel entry now throws in PanelResources.remove ("managed by their suite; uninstall instead") and UserPanelSurface offers onDelete only for user-authored entries. Edit and toggle stay available for plugin entries by design: edits pass the realpath containment check, toggles write the user override.
- The first-child stretch rule is deleted, and the filler buttons it justified go with it: SuiteDetail keeps the primary install or the uninstall; UserEntryDetail and the MCP detail drop the ghost close (modal chrome closeLabel + ESC remain); the MCP footer keeps conditional reauthorize plus its result echo and loses the duplicated switch (the card toggle writes the same override).
- Agent-persona details render model/provider/reasoning as their own labeled rows (snake_case preferred, camelCase fallback, 'inherit' as declared), with new bilingual locale keys; remaining metadata keeps one catch-all row with label and value in their proper columns.
- A verification pass added two tests (delete affordance only on user-authored cards; persona routing frontmatter rendered with the catch-all keeping the rest) and fixed a real defect they exposed: the routingRows array emitted unkeyed elements, so the kv helper takes an optional key, and the routing keys are excluded from the catch-all row instead of rendering twice.

## Consequences

- Follow-up: agent personas are the exception to read-only content — their routing frontmatter (model, provider, reasoning effort) is machine-local configuration the user owns. The panel opens a routing-only editor for plugin personas (no body editor), PanelResources.update allowlists exactly those keys for kind agents, and the server rejects any other content change.
- dependency-cruiser / tsc / eslint gates unchanged; suite count unchanged (assertions updated where they tested removed buttons).
- The client-feature isolation rules added in the layout stage are unaffected.

## Verification

- typecheck, eslint, full suite, check:architecture, prettier — green on the committed tree.
