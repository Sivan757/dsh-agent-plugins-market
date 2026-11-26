# Agent Note: Dialog frames by task, not one uniform size

Status: implemented

## Problem

The market's dialogs had three widths and one way to answer height: the dialog was as tall as its content. That works for a detail page and fails for a flow whose content changes while it is open. The suggestion dialog was the clearest failure: before an answer it held one input field in an 880px window, and when the answer arrived it grew to fit the cards; editing the purpose cleared the answer and shrank it again. The reader saw the window move under them, the input spanned the whole 880px, and the empty state read as a broken form.

Two smaller exceptions pointed at the same gap. The preset manager was a hard-coded 800x800 frame, outside the width scale, and the server editor fixed its height to a share of the overlay (80%), a size that followed the viewport rather than the task. A single uniform form size, the earlier direction, could not serve a one-field suggestion and a long editor at once.

## Decision

- **Three widths stay the primary scale.** `sm` 460 for a confirmation, `md` 640 for a form or a suggestion, `lg` 880 for a detail or an editor. The market's dialogs keep one chrome: header, scrolling body, sticky footer.
- **Height becomes a tier too, and a fixed tier owns the frame.** `auto` follows the content. `short` 480, `regular` 640 and `frame` 800 fix the dialog's height, capped by the viewport; the content fills the frame and scrolling happens inside it. A fixed tier exists for content that arrives, changes, or gets cleared while the dialog is open.
- **The preset manager stops being an off-scale exception.** It is `lg` plus `frame`: 880px wide, 800px tall, and the details it opens ride that frame instead of choosing their own size.
- **The suggestion dialog is `md` plus `short`.** The purpose field spans a 640px dialog instead of the viewport, and the reserved rows area holds its place before the answer: it shows one line about what will land there, the same 640x480 frame stays when the answer arrives or is cleared, and the list takes the space the frame leaves instead of a guessed pixel height.
- **Editors pick the frame their work needs.** The server editor is `md` plus `regular`; ordinary detail and editor dialogs keep `lg` plus `auto`.

## Alternatives considered

- **One uniform form size.** Rejected by direction: a one-field suggestion and a JSON editor share the form mechanics but not the room they need, and a uniform height either wastes space or clips the editor.
- **Keep auto height and scroll the viewport.** Rejected: the window still moves when the answer arrives, which is the defect being fixed.
- **Give every dialog a fixed height.** Rejected: a two-line detail dialog would carry a frame sized for an editor, and empty space is a cost, not a feature.
- **Keep the preset manager's 800x800 special case.** Rejected: a frame outside the width scale is the inconsistency the tier system exists to remove, and its nested details can ride the `lg`/`frame` pair instead.

## Consequences

- A dialog declares two facts now: its width tier and how it answers height. New dialogs pick from the scale instead of inventing a size.
- The suggestion's reserved rows area is stable from the first paint, and a long answer scrolls inside it rather than resizing the dialog.
- Fixed frames need the content to fill them; `DetailModal` marks them with `fixedHeight`, and a form inside one grows to take the room its frame leaves.
- The preset manager and the details it opens share one 880x800 frame; a nested detail can no longer choose a different width.
- The 80%-of-overlay height is gone: a fixed tier is a size, not a share of whatever the reader's window happens to be.
