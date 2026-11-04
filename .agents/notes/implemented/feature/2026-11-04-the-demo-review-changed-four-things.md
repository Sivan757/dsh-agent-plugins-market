# Agent Note: the four things the demo review changed

Status: implemented

## Problem

The demo profile produced a review with four points, each visible in a screenshot: the AI assist was a one-shot row when the reader expected a session they could steer and re-model; the filter strip did not offer all three conditions on every face; the hook face had no way to configure anything; and the preset manager carried explainer paragraphs, a half-empty tab rail, and two pages telling different stories about the same output style.

## Decision

- **A draft can become a session.** `POST ai-session` writes the task as a session's first message and answers with its id and workspace. The reader opens that session, edits the requirement, switches the model the way they would for any session, and sends. The inline draft stays for the quick case; the session is the path for iterating.
- **The filter strip keeps every declared cut.** A cut nothing falls into is still a question the reader learned to ask, and hiding it made the faces disagree about their own grammar. The hooks face gained the pair (its rows can be a suite's or the reader's own hooks.json), the language-engine face gained the toolbar it never rendered, and the output-style face shows 用户 at zero until a person writes one.
- **A hook can be configured, with AI filling the form.** `POST user-hooks/draft` proposes an event and a command, `POST user-hooks/save` appends the entry to the reader's own `~/.agents/hooks/hooks.json`. The append merges into whatever shape the file already has and refuses an exact duplicate; the form stays editable, so the model is an assistant rather than the author.
- **The manager stopped explaining itself.** Both static paragraphs are gone, the modal subtitle with them, and the tab rail shares its spare width so a short row fills the strip. The output-style card no longer shows the SessionStart hint: it shows the same sentence the manager shows for the same condition (uncaptured text injects nothing).

## Alternatives considered

- **Keep the assist inline only.** Rejected by the review: adjusting a requirement and changing the model are the two things a reader does most, and neither is possible in a one-shot row.
- **Have the plugin open the session in the GUI.** Rejected: the plugin cannot command the host shell's selection. The session is created and announced, and the note names the workspace it is listed under, which is the honest version of "it is open".
- **Write hooks.json by rewriting it from a model-produced document.** Rejected: the file is the reader's, so the writer appends one entry and merges by shape. A model that re-emits the file would drop comments and hand-written lines.
- **Keep the cuts filtered by count.** Rejected by the review: it made two faces disagree about whether the third condition exists at all.

## Consequences

- Two new routes and one new contract file; the hook writer is the only place this plugin appends to a document the reader owns.
- A session created from the plugin carries the workspace the server runs in (or the live session's workspace when the panel has one), and its id is minted per creation, so a second draft never overwrites the first transcript.
- The manager is shorter by two paragraphs and its tab rail no longer stops half way.

## Verification

- Live in `market-demo` (a profile linked to this checkout, its own default model):
  - every one of the eight named faces shows three conditions (技能 158/158/0, 快捷指令 22/21/1, 连接器 5/2/3, 语言引擎 1/1/0, 输出风格 1/1/0, 钩子 1/1/0, 系统提示词 1/项目0/用户级1);
  - a hook drafted from "每次我用 Bash 修改文件后，运行一次 prettier" came back as `PostToolUse` + `git diff --name-only --diff-filter=ACM | xargs -r npx prettier --write`, saved into `~/.agents/hooks/hooks.json`, and the 用户 cut then read 1;
  - the assist route answered in 18 ms and 143 ms with two distinct `session-<uuid>` ids, each session carrying the task as its first message;
  - the preset manager renders no explainer paragraph, and its tab rail's tabs fill the row (730 px of tabs in a 752 px rail);
  - the output-style card shows 未捕获 + the capture action + the manager's own sentence, and no SessionStart hint.
- Full suite: 2,559 tests pass; gate clean.
- Cleaned up after the review: the test hook file and the probe sessions were removed, so the reader's own data is exactly as it was.
