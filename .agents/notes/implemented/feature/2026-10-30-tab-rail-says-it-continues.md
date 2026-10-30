# Agent Note: the tab rail says it continues without a hover

Status: implemented

## Problem

Nine settings surfaces rarely fit one row, and the rail's two affordances were invisible at rest. The step chevron waited for the pointer, so a row that ran past the edge looked like a row that simply ended. The edge fade was worse: it ramped from `interactive-bg-hover`, the same 6-8% wash the track itself carries, so it painted the track's own colour over the track and left the clipped letters fully readable. A screenshot at 560px showed text cut mid-glyph with no signal that anything continued.

## Decision

- **The clipped edge dissolves through a mask on the row, not a coloured band.** `TabRail` measures its edges already, so it now writes a `mask-image` that fades the last 40px of content to transparent. A mask involves no colour, so it works in either theme and over any panel surface; a band had to guess the surface and, with the wash it was given, guessed "invisible".
- **The chevron stays visible while its side is clipped.** It only exists when content hides behind that edge, so it is a fact rather than noise: a reader learns the row continues without moving the pointer. Hover still brightens it, and focus draws the business ring.
- **The affordance is per side.** Both are masked when the row is scrolled to the middle, only the left when it reaches the end, only the right at the start.
- **The row measures again after the frame and after the fonts.** A dialog that mounts its content while the layout is still settling reports a row that fits, and the resize observer can run in that same frame: the first real host session showed a hard clip with no dissolve and no chevron until something scrolled the rail. One frame later, and once the fonts are in, the same measurement runs again, so the affordance matches the row the reader sees.

## Alternatives considered

- **Keep the colour band and fix its colour.** Rejected: the band has to match whatever surface the panel sits on, and the rail's own wash makes every candidate slightly wrong; the first attempt with `bg-layer-1` painted a light strip across a panel whose surface was the page.
- **Scroll shadows instead of a mask.** Rejected: the same colour problem, and a shadow reads as depth rather than "more content".
- **Show the chevron only on hover but widen the fade.** Rejected: the fade was the part that did not work; the chevron is the click target and costs nothing at rest.

## Consequences

- The last visible tab is deliberately half-legible: the mask covers it exactly as far as content continues.
- `mask-image` with the `-webkit-` prefix is the one API here; both are long-standing in the browsers the host supports.
- The stylesheet no longer carries the two fade classes, so the rail has one edge treatment instead of two.

## Verification

- `packages/market-ui/test/tab-rail-drag.test.ts` asserts the rail carries a mask gradient at a clipped edge, that the stylesheet no longer holds fade rules, that the step chevron has no zero-opacity start, and that a row which only overflows after the first frame still gets its mask and chevron.
- The `market-dev` profile served the built bundle in the real host: opening settings on Agent 扩展 showed the right dissolve and the right chevron immediately, where the previous build showed a hard clip.
- The preview harness renders nine tabs at 560px and 760px: at 560 the last tab dissolves into the surface, at 760 nothing fades because nothing hides.
