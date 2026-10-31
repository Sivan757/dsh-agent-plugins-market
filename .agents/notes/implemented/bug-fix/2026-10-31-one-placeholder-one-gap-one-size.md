# Agent Note: one placeholder, one gap, one type size per role

Status: implemented

## Problem

A spacing audit of the twenty stylesheets behind the settings surfaces found the same role drawn differently in each surface that needed it, and one dead rule left behind by a rewrite.

- **Four empty placeholders.** The shared list's `.empty` was 16px, left aligned; the instructions and output-styles panels were 24px centred; the market's error fallback was 48px at 13px. An empty tab and an empty list looked like two products.
- **The hook summary box had drifted.** The hook detail drew its summary card at 14px/18px with a 12px radius and an 8px tag gap, where the market and connector details draw the same box at 12px/14px with a 10px radius and a 7px gap.
- **Two gaps for one row.** The narrow grid set 4px card-to-card under a comment that said "one rhythm, not two", while the list branch kept 6px at every width: switching the view moved the cards 2px apart.
- **The only sub-11px type in the package.** Six connector tool-table rules sat at 10px, where the same secondary line is 11px everywhere else.
- **A section title outside the shared rhythm.** The output-styles preview title was 12px sentence case with its margin above, where every other detail section uses the shared block head (11px, uppercase, margin below).
- **A dead title rule** stayed behind after the switch to the shared head.

## Decision

- **The panel owns the empty placeholder.** `panel.module.css .empty` (24px 12px, centred, 12px) is what a surface with nothing to show renders, and the shared list's own `.empty` takes the same values. The instructions, output-styles, market and suite-detail copies are gone; their local rules are deleted.
- **One summary box, one tag gap.** The hook detail uses 12px/14px with a 10px radius and a 7px tag gap, the same numbers the market and connector details use.
- **One card gap in both views.** 4px, the value the narrow grid already documented.
- **11px for a secondary line.** The six connector rules move up.
- **The output-styles preview title renders the shared block head** instead of a rule of its own, and its local rule is deleted.

## Alternatives considered

- **Consolidate every value into a token layer.** Rejected for now: the host defines no spacing or type tokens (its design platform is 383 colour declarations), so a local token layer would be this plugin inventing a scale nobody else follows. Naming the shared classes is the cheaper step that removes the copies.
- **Leave the market's 48px error fallback as its own size.** Rejected: an error line and an empty line are the same placeholder; the error already carries its own colour through the message.
- **Keep 10px for the tool table because it is denser.** Rejected: 10px is below every other secondary line, and the table has room at 11px.

## Consequences

- An empty tab and an empty list now look the same, and one class decides it.
- The hook detail's summary box matches the two other details.
- Switching grid/list no longer changes the vertical rhythm.
- Four local rules and one dead title rule are gone; the placeholder is one rule in one file.

## Verification

- Measured in `market-dev` after a rebuild: the empty placeholder renders `24px 12px`, centred, 12px, 65px tall; the collection's gap is 4px in the grid view and 4px after switching to the list view.
- `pnpm run check:css` still reports every class referenced or recorded; the four typechecks, the affected panel tests and the full suite pass.
