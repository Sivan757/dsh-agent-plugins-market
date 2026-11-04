# Agent Note: the tab is the system prompt, not "rules"

Status: implemented

## Problem

The settings tab that lists the `AGENTS.md` files was called 规则 / "Rules" on the strength of an information-architecture review, which argued that three user documents already used that word. The owner corrected the premise: those files are injected into the agent's **system prompt**, so "Rules" names a mechanism the product does not have, and the documents — not the tab — were wrong.

## Decision

- **The tab is 系统提示词 / System prompt.** Its subtitle says what it is rather than what it is called: AGENTS.md 注入系统提示词。 / "AGENTS.md files injected into the system prompt."
- **The interior copy follows the tab**: 系统提示词页面不可用 and 读取提示词链失败, instead of the 规则 variants.
- **The documents move with it.** The user page is retitled 系统提示词 / "System prompt", its first paragraph says the files are injected into the session's system prompt, and both README tables name the tab.
- **The persona editor keeps 角色指令.** It was renamed away from 系统提示词 in the same earlier pass, and that part stands: the agent document is not the prompt.

## Alternatives considered

- **Keep 规则 and change the documents instead.** Rejected by the owner: the surface really is the system prompt, so a document calling it "rules" would be describing a product that does not exist.
- **Name the tab 提示词.** Rejected: shorter, but it reads as "prompts" in general, and the surface is specifically the system prompt the session receives.
- **Leave the persona field at 系统提示词.** Rejected: two different objects would share one phrase again, which is the ambiguity this pass removed.

## Consequences

- A reader who knows what a system prompt is finds the page by its real name.
- The two earlier notes that recorded the 规则 naming are cross-linked as superseded in part.

## Verification

- `packages/market-ui/test/client-locales.test.ts` keeps the everyday-name pairs green.
- `pnpm run check:doc-links` resolves every moved link; the bilingual page pair keeps equal line counts (60/60).
- The four typechecks and `check:refactor` pass.
