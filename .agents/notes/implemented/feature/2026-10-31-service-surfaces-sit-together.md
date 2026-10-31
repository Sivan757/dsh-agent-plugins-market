# Agent Note: the service surfaces sit together, and the rules page says what it read

Status: implemented

## Problem

Two findings from the information-architecture review needed more than a rename.

**The two service surfaces answered the same question from opposite ends of the row.** 连接器 and 语言引擎 both report what is mounted and why it failed, and share the 需处理 / 已禁用 vocabulary, yet 规则, 输出风格 and 钩子 sat between them. The README table printed the version-1 order, which was neither the rendered order nor the default.

**The rules page promised a chain it could not show.** Its subtitle said "the AGENTS.md chain this session injects", but the settings page renders outside any session: the route answers for the host process working directory. The line that says so already existed (`instructionsSessionHint`) and was pinned absent by a test, and the user doc described a preview and a byte budget the page does not render.

## Decision

- **Language Engine moves next to Connectors.** `WORKSPACE_TAB_KEYS` is now market, skills, personas, commands, mcp, lsp, instructions, outputStyles, hooks. The README tables and every test that enumerates the row follow.
- **A stored order still belonging to an earlier default migrates.** `TAB_LAYOUT_VERSION` becomes 3 and `LEGACY_DISPLAY_ORDERS` keeps both earlier sequences: a document whose order equals one of them is a default nobody edited, so it moves to the new one; an order someone arranged by hand survives untouched.
- **The rules page names the directory it read.** When no session is named it renders one line under the header: 未指定会话，显示宿主进程工作目录下的链条. The test that pinned the line absent now pins it present, and a second case pins its absence when a session is given.
- **The doc describes the page that exists.** The instructions page keeps the harness facts (load order, file names, deduplication, budget) and now states what the panel shows: the files, their status tags, the scope line, and no injected text.

## Alternatives considered

- **Reorder only for new workspaces.** Rejected: the stored order already carries a version, and a default nobody edited is exactly what the migration is for; leaving it would have meant the two service surfaces sit together only for new projects.
- **Centre the service tabs in the row.** Rejected: the market is the home tab and the authoring tabs are the entry points for making something; the service tabs belong after them, not in the middle.
- **Bring back the preview and the budget bar to match the doc.** Rejected: the panel deliberately renders no injected text (one test names that), because the text the model receives is not what the panel reads; the doc was the wrong side of the mismatch.

## Consequences

- The two status surfaces are adjacent, and the section that follows 语言引擎 is 规则 rather than another service.
- An untouched layout from version 1 or 2 moves to the new order on upgrade; a hand-arranged one does not.
- A reader on the rules page learns which directory the list came from, and the user doc no longer promises a preview.

## Verification

- Measured in `market-dev`: the rail reads 市场 技能 专家 快捷指令 连接器 语言引擎 规则 输出风格 钩子; the rules tab shows 注入的 AGENTS.md 文件链。 with 未指定会话，显示宿主进程工作目录下的链条。 above one card reading ~/.dsh/AGENTS.md, 已加载, 6880 字节.
- `packages/market-bundle/test/integration/tab-layout-service.test.ts` covers the round trip, the version-3 document, the partial-order completion and both concurrent writes; `tab-layout-routes.test.ts` covers the served layout.
- `packages/market-ui/test/client-instructions-panel.test.ts` pins the scope line with and without a session.
- The four typechecks, `check:refactor` and the full suite pass.
