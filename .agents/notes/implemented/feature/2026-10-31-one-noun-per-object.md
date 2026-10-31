# Agent Note: one noun per object, and tabs that say what they hold

Status: implemented Superseded in part by [the system-prompt note](../bug-fix/2026-10-31-the-tab-is-the-system-prompt.md): the tab is 系统提示词, not 规则. The rest of this note (套件 as the unit, one noun per service, the authoring subtitles) stands.

## Problem

An information-architecture review of the nine sections found the same object under several names, and several tabs named after something else.

- **The installable unit was 插件 on the three surfaces where the reader decides.** The search box, the empty line, the provenance chip and the uninstall dialog all said 插件 (in English, `plugin` and `Plugin` in two different keys), while the rest of the file and all of CONTEXT.md call it a **suite**. At the uninstall confirmation a reader could not tell whether one suite or this whole extension was about to go.
- **The rules tab was called 系统提示词**, a phrase that names two other things on the same row (the persona editor's body field and the output-style injection). Three docs, and the locale file's own comment, already called it 规则.
- **The service tabs used three nouns inside one panel**: 连接器 as the tab, 服务 in the delete dialog and in every status sentence; 语言引擎 as the tab, 语言引擎服务 and 服务器 inside it.
- **The three authoring subtitles restated the card's own provenance chip** ("插件带来的只读，自建的可改") and never said what the tab holds, which is the only place the difference between a skill, a shortcut and an expert can appear.
- **A first run reported a search result for a search nobody made**: an empty market said 没有匹配的插件 while the only way forward was the icon-only refresh.
- **32 keys (64 lines) rendered nowhere**, and the workspace doc described a tab-stow control that is not in the tree.

## Decision

- **套件 is the installable unit, everywhere.** Search placeholder, empty line, uninstall title and description, the provenance chip, the connector kind tag and the output-style source tag all say 套件 / Suite; 插件 stays for this extension itself.
- **The tab is 规则.** Its interior copy follows (规则页面不可用, 读取规则链失败), and the persona editor's body field becomes 角色指令 so one phrase no longer names two controls.
- **One object noun inside each service tab.** The tab stays the collection (连接器 / 语言引擎); the row is an MCP 服务 or a 语言服务器, and the subtitles name the object and what the panel does to it.
- **The authoring subtitles name the object**, not its editability: "模型按需读取的能力说明", "输入 /名称 调用，可带参数", "可委派的子代理角色". The chip already shows where a card came from and the pencil already appears only where editing is allowed.
- **A first run names the action.** An empty market says 还没有套件：点右上角 ↻ 获取列表; a filtered or searched miss keeps 没有匹配的套件. A connector list with no rows on a _successful_ read says 没有连接器, because nothing was searched.
- **Delete what renders nowhere.** The 32 dead keys are gone from both dictionaries, and the workspace doc's stow section is replaced by the ordering behaviour that exists.

## Alternatives considered

- **Keep 插件 for the unit and 套件 for the source.** Rejected: the source page already prints 来源套件 for the source, so 套件 is taken; two nouns for one object is the defect being fixed.
- **Rename the tabs to 规则 and 语言服务器 as well.** Rejected: a tab is a collection, and 语言服务器 (a row) under a tab called 语言引擎 is the distinction the two words should carry. Only the interior copy changed.
- **Restore the tab-stow control the doc describes.** Rejected for now: it needs a new component and its own design pass; the doc now matches the product, and the stow entries can be rebuilt deliberately if the feature is wanted back.

## Consequences

- The word a reader meets in the market is the word the docs, CONTEXT.md and the suite detail already use.
- The rules tab can be found by the name three documents give it.
- Two dead copies of one phrase (系统提示词) no longer label two different controls.
- A first run tells the reader what to press.
- 64 lines of unreachable copy and a doc chapter about a missing control are gone.

## Verification

- Measured in `market-dev` against the built bundle: the tab row reads … 连接器 规则 输出风格 钩子 语言引擎; the market placeholder is 搜索套件…; the skills chip reads 套件; the four subtitles read as decided.
- `packages/market-ui/test/client-locales.test.ts` keeps the everyday-name pairs and the header budget green; the LSP acronym now rides the create action, because the 20-character subtitle cannot carry it.
- The four typechecks, `check:refactor` and the full suite pass.
