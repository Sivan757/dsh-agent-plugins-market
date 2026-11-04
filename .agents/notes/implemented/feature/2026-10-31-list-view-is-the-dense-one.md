# Agent Note: the list view is the dense one, in a narrow panel too

Status: implemented

## Problem

A screenshot pass over the nine settings surfaces found the list view failing at its one job. In the narrow settings panel the list branch stacked the card's identity, its source and its description on three lines with the switch spanning them: every row was about **100px** tall, taller than a grid card, and only five rows fit on screen. The grid view, which shows two cards per row, was denser than the view whose whole purpose is dense scanning. The switch also floated alone in its own column, so the row read as three stacked bands with a control beside them.

## Decision

- **Two lines, not three.** The narrow list row puts the name and its source on the first line and the description on the second, with the action cluster spanning both. Measured after the change: rows are **75px** and **seven** fit in the same viewport (was 100px and five).
- **The source shares the identity line.** It is a short technical token (a suite name, a directory), so it belongs beside the name it qualifies rather than on a band of its own.
- **The padding drops from 10px to 8px** with the saved line, so the vertical rhythm matches the grid's 4px gaps.

## Alternatives considered

- **Keep three lines and shorten the description.** Rejected: the description already truncates to one line; the wasted height came from the extra row, not from text.
- **Drop the source from the list view.** Rejected: the suite a skill comes from is the first thing a reader scans when deciding whether to trust it.
- **Make the list a fixed 56px single line.** Rejected at this width: a single line leaves the description with a few characters, which is what the narrow grid branch already decided against.

## Consequences

- The list view is now denser than the grid on every surface, which is what a view switch offers.
- A row's name, its source and its action stay on one line each, so the three columns line up down the list.
- The same rule serves the market, the connector and the language-engine lists.

## Verification

- Measured in `market-dev` against the built bundle, skills list: row height 100px → 75px, rows visible in the dialog 5 → 7; the market list and the connector list read the same 75px with 6 and 5 rows visible.
- `check:css`, the affected panel tests and the full suite pass.
