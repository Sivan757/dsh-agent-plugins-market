# Agent Note: the marketplace recommends, and installation stays the reader's step

Status: implemented

## Problem

The marketplace holds about a thousand suites across sources, with search and source filters as the only way in. A reader who knows the goal ("front-end work with review and tests") but not the catalogue had no way to ask for a starting set.

## Decision

- **One action in the market header asks what the workspace is for.** The answer names a small selection with a reason, and applying it narrows the list to those rows; each card keeps its own install action and its confirmation, so no suite is ever installed by the model.
- **The server owns the world.** With `purpose: 'install'`, `POST ai-preset` builds its candidate rows from the catalogue the deployment already scanned; the browser sends only the intent. Every id the model answers is checked against that list, so a hallucinated id is dropped rather than becoming an install.
- **Rows that are already switched on are not candidates.** A suggestion answers what to add, and offering what the workspace already runs would spend the reader's attention on nothing.
- **The suggestion dialog is one shared component.** It serves the preset manager and the marketplace, so it moved to `client/ui/AiSelectionModal.tsx` with a `mode` that changes the question, the copy and what applying does; the two features no longer reach into each other.

## Alternatives considered

- **Have the page post its own rows, as the preset suggestion does.** Rejected after measuring it: a thousand candidate rows cross the host's request body limit, and the browser would own a world the server already has. The first live attempt failed exactly there, as a bare `TypeError: Failed to fetch` with nothing in the server log.
- **Install the recommended suites directly.** Rejected: installing is a network write per suite, and the existing per-suite confirmation is the one place a reader agrees to it.
- **Recommend from the already-enabled rows only.** Rejected: that is the preset suggestion, which the manager already offers; the market's question is what to add.

## Consequences

- The marketplace gained an ask-it capability without a new write path.
- The preset suggestion and the market recommendation share one dialog, one route and one validator; only the world and the applying step differ.
- A large catalogue no longer travels through the browser to reach the model.

## Verification

- Live in `market-dev`: _推荐要安装的套件_ with "前端开发：审查、测试、浏览器调试，外加设计参考" answered 13 rows (code-review, pr-review-toolkit, playwright, chrome-devtools-mcp, figma, superdesign and others); applying narrowed the list to exactly those 13 cards, the banner said "AI 推荐：13 项；逐张卡片确认安装。", and clearing it restored the full list.
- `ai-draft-routes.test.ts` (+2 tests): the install mode reads the catalogue rather than the request, a row that is already on is not offered, and an empty catalogue answers 400.
- Full suite: 2,551 tests pass; gate clean.
