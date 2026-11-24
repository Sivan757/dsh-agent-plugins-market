# Agent Note: the composer entry names the preset it selects

Status: implemented

## Problem

The composer's preset entry was an icon whose meaning lived in a tooltip. A reader could not tell a session following a saved preset from one following the global selection without hovering the control, and hovering is exactly what a keyboard-only reader cannot do casually. The row it sits in does not have that problem anywhere else: the permission chip and the model chip both name their current value, so the one control that decides which extensions a session carries was also the one control whose state was invisible.

The icon-only rule for panel headers does not reach this seat. [The header carries icons](../architecture/2026-11-03-the-header-carries-icons.md) governs the nine faces' headers and toolbars, where every entry is an action and a translated word would move the shared header's width and height between languages. The composer's chips are selectors: the host's own permission and model controls there are text chips for the same reason, and this entry is one of that family.

## Decision

- **The entry shows the preset name beside its icon.** The label is the selected preset's name, the global word when the session follows no preset, and the read's own state word (`epNotReady`, `epLoading`, the load failure) until the window answers. A modified selection shows the preset's name; the "modified" suffix stays in the tooltip and the accessible name, because the suffix is a second fact and the row is shared with two other controls.
- **The chip wears the host's own composer chip chrome.** Height 28px, `radius-sm`, 13px/20px at weight 500 in `label-secondary`, the transparent fill with the `interactive-bg-hover` wash, the 14px icon step and the 12px chevron — copied from the host's `InputBar` model select and `PermissionSelect` trigger, which are the two controls beside it. It is a native button for that reason: the `Button` atom's compact metrics (12px, `label-primary`, 10px padding) would need every one of those properties overridden, and the result would be a chip that no longer looks like its neighbours.
- **The width is capped, not fixed.** The label truncates with an ellipsis at a 220px control, the same cap the host's model select carries, so a long preset name cannot push Permissions and Plan out of the row. The full name stays in the tooltip and in `aria-label`.
- **The seat stays the host slot.** `conversation.input.left` is where the entry already lives and where the host renders it after its own mode chips; the name is drawn inside that entry rather than added as a second registration, so the slot keeps one occupant per session and the menu still opens from the same target.

## Alternatives considered

- **Keep the icon and rely on the tooltip.** Rejected: it was the state that needed reading, and a hover is not a reading. The request was to make the active preset visible, not to explain it on demand.
- **Render the name as a separate Tag beside the icon.** Rejected: the trigger is one control that opens the menu; a tag would either be a second hit target with the same menu or dead text next to a working one.
- **Use the shared `Button` atom with the name as its child.** Rejected after reading both: the atom's compact size is 12px on `label-primary`, while every chip in this row is 13/20 medium on `label-secondary`. Overriding all of it leaves a button that only carries the atom's name.
- **Let the entry grow with the name.** Rejected: the composer's left group shares the row with Permissions and Plan, and one long preset name would reflow controls the user did not touch.
- **Show the modified suffix in the chip too.** Rejected: it doubles the label's length for a fact the menu and the tooltip already carry, and the menu's check mark is the place a reader looks for it.

## Consequences

- A session's active preset is legible without interaction, in both the blank-session composer and an ongoing one.
- The entry's width varies with the name up to 220px and then truncates; the tooltip and the accessible name keep the full text.
- `docs/user/settings.md` and its Chinese pair describe the chip instead of the icon button.
- The README's demo recording shows the earlier icon-only entry; the difference is one control's width in the last scenes, and the recording is re-taken when the entry changes shape again.
- The entry renders whenever the setting is on: the published slot contract supplies the session id every session-scoped seat receives, so [the entry-visibility fix](../bug-fix/2026-11-24-the-preset-entry-shows-and-its-suggestions-are-cards.md) removed the guard that hid the entry without one.

## Testing

`e2e/presets.spec.ts` boots a real host, opens a session's composer, reads the entry's accessible name (`Default` in the suite's English locale), opens the preset manager, and drives the suggestion dialog's one stubbed answer. `pnpm run check:quick` and `pnpm run test` pass.

The chip was checked against the host's own permission and model chips: 28px high, the same 13/20 medium secondary text, the same chevron and hover wash.
