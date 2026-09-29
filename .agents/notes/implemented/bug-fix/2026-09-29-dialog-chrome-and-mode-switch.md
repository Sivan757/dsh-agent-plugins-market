# Agent Note: The service editor's dialog chrome after the control migration

Status: implemented

## Problem

Two defects showed up in the new-service dialog.

**The form/JSON switch drew its indicator away from the selected segment.** The convergence onto the host control kept passing `formCss.seg` in `className`, and `.seg` is the hand-rolled track written for the transport group: `display: inline-flex`, `gap: 2px`, `padding: 2px`, a 1px border, plus `button` rules for its own buttons. The host control is `inline-grid` with `grid-auto-columns: 1fr`, `padding: 4px`, and an absolutely positioned indicator whose width and offset are arithmetic on exactly those numbers (`(100% - 8px - 2px * (count - 1)) / count`, `translateX(index * (100% + 2px))`). The override left both segments content-sized inside a stretched track while the indicator kept computing half the track, so it sat hundreds of pixels from the label it belonged to. `.seg button` also outranked the host's `.tab` rule on specificity (0,1,1 against 0,1,0), replacing the platform's 28px tabs with the hand-rolled 24px ones.

**The title sat 32px above the first control.** The host Modal gives its content box a 20px top margin because its design assumes a description sentence under the title, on top of the header's own 12px padding. Every dialog the market opens through `DetailModal` carries no description, so the two stacked into a hole the height of a control row.

## Decision

**A host-drawn control receives layout classes only.** `SegmentedControl` keeps its own track, tab and indicator geometry; the editor passes `formCss.segSelf`, whose single declaration is `align-self: flex-start`, so the control holds its content width inside the column form instead of being stretched across it. The `.seg` track stays with the two controls it was written for — the MCP transport selector and the workspace editor's view switch — both hand-rolled `aria-pressed` groups rather than tablists.

**A description-less dialog clears the host body margin.** `DetailModal` adds `compactTop` whenever `description` is absent, and `detail.module.css` zeroes the host body's `margin-top` through the same `[class*='content'] > [class*='body']` selector the workspace editors use in `panel.module.css`. The title then keeps the header's own 12px above the first control. A dialog that does pass a description keeps the host spacing.

## Alternatives considered

**Keep `.seg` and restyle the host internals until they match it.** The indicator's arithmetic, the tab height and the font size would all have to be re-stated, and one class would mean two different controls. Rejected: the tablist over one panel and the `aria-pressed` value group are different semantics, and the platform already owns the first one's look; a later host change to that geometry would land on the market's copy first.

**Let the host control stretch and align its segments to halves.** The track would match the transport selector's, and the indicator would be correct again — at the cost of a 592px two-way switch, which no other platform surface shows for a two-option view switch.

**Draw our own dialog header to control the gap.** `headless` would hand us the title row, the close button and the accessibility wiring the host already ships. Rejected: a spacing rule does not justify re-implementing dialog chrome for six dialogs.

**Change the shared chrome's dialog gap instead of the body margin.** The host's `.dialog` gap sits between the content and the footer, not under the title, so it cannot produce the reported hole; tightening it would silently retune every market dialog's footer spacing.

## Consequences

- The mode switch is a compact, platform-drawn track: equal-width segments, the indicator over the selected label, 28px tabs.
- A market dialog without a description opens with 12px between the title and its first control; one that passes a description keeps the host's 20px body margin.
- The market's dialogs now deviate from the host chrome on that one rule through a structural selector a host restructure would break silently — the exposure the workspace editors already carry.

## Testing

- Geometry measured in a reproduction page loading the host's `Modal.module.css` and `SegmentedControl.module.css` (0.2.0-rc.1) plus this repository's `detail.module.css` and `form.module.css`: before, a 592px track carried a 290px indicator over a 44px tab; after, a 145px track carries a 67px indicator exactly over a 67px tab, and the title-to-control gap measures 14px against 34px.
- `tests/client-detail-editors.test.ts` and `tests/client-server-config-policy.test.ts` — the switch still drives the same document in both directions.
- Neither fix is visible to a jsdom test: client tests here stub CSS modules to `{}`, so the classes under test never reach the DOM.

## Related

[One form shape and one top gap for the workspace editors](../feature/2026-09-16-workspace-document-editor-single-view.md) owns the description-less top-gap rule this note extends to the shared dialog chrome.
