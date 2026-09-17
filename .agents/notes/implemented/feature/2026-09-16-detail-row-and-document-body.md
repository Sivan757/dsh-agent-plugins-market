# Agent Note: the detail dialogs' row and document body

Status: implemented

## Problem

The detail dialogs' expanded rows and document bodies did not match the prototype, and the mismatch was structural rather than cosmetic:

1. **The row was the wrong shape.** The prototype's detail row is a three-column band — the name, its one-line summary, and a chevron pinned to the trailing edge — inside one bordered group, with a hover fill, a tinted expanded header, and a body inset behind a hairline. The platform's `DisclosureRow` is a 24px single-line flow row whose chevron _leads_ the title and only appears on hover, and it paints neither a hover nor an expanded background. Styling it from the outside cannot move its chevron, grow its row, or add its backgrounds.
2. **Six surfaces drew it separately.** The suite detail, the user-entry detail, and the LSP detail each assembled their own group and body classes, so the row's width, height, padding, and body background differed between them.
3. **The frontmatter was re-presented, not shown.** `MarkdownDocument` rendered the document's YAML as a definition list under a `元数据` heading, where the prototype shows the block exactly as authored, above the rendered body. The same component backs every editor's preview pane, so the preview disagreed with the file it was previewing.
4. **A detail's overview named the wrong facts.** The user-entry detail showed a `根目录` cell and no last-change cell, where the prototype names the disk path and the file's last modification; its document group was headed `技能` / `命令` / `代理角色` rather than `技能文档` / `命令文档` / `角色定义`.

## Decision

- **One shared row component, `ui/DetailRows.tsx`.** `DetailRows` draws the bordered group frame and `DetailRow` draws the band: `minmax(110px, max-content) · minmax(0, 1fr) · 14px`, 9px/12px padding, mono semibold name, one-line clipped summary, trailing chevron that points right when closed and down when open, `interactive-bg-hover` on hover, `state-business-tertiary` while expanded, and a body at 12px/14px behind a `border-l2` hairline on the hover fill. Its stylesheet carries the prototype's values, so the three call sites cannot drift apart again.
- **The row keeps the prototype's own geometry rather than the platform's.** A 42px three-column band with a trailing chevron is a different control from the platform's 24px flow row; the plugin's dialogs are its own surface, and the prototype is the reference they are reviewed against.
- **`MarkdownDocument` shows the frontmatter as authored.** The verbatim block sits above the rendered body in a mono, bordered, `markdown-code-block` box — the same thing every editor's preview pane now shows, and an honest preview of the file.
- **`frontmatter()` returns the block it matched**, so a consumer can render it without re-parsing the document.
- **A detail's overview names what the prototype names.** The user-entry detail reports the disk path and the entry file's last modification, and its document group is headed per kind. Both timestamps come from the filesystem — the suite detail's from the checkout, the panel entries' from each entry file, stamped in one place as the panel list is assembled.

## Alternatives considered

- **Keeping `DisclosureRow` and layering classes onto it.** Rejected: `rowClassName`, `titleClassName`, and `chevronClassName` reach the row's skin, not its structure. The chevron's leading position, the fixed 24px height, and the missing hover/expanded backgrounds are the component's own decisions, and every one of them is the difference a reviewer sees.
- **Rendering the frontmatter as a YAML tree.** Rejected in favour of the authored block: a tree re-presents the same keys in a shape the file never has, and it hides the comments, quoting, and ordering that are the reason to look at the frontmatter at all.
- **Keeping the `根目录` cell on a user entry and dropping the last-change cell.** Rejected: a user entry's path is the file's own location, which the prototype names as a disk path, and "when did this last change" is the one fact the dialog cannot answer from the card.
- **Hard-coding the relative wording in the dialog.** Rejected: the bucket comes from the host's `relativeTime` helper so two surfaces dating the same file agree, and the words stay in this plugin's dictionary.
- **Statting every entry file on each panel read.** Accepted: the panel list already reads every file's text, so the extra stat is one syscall beside an existing read, and it keeps both origins — user files and suite files — on one code path.

## Risks

- The shared row is the only row shape the details draw, so a future row that needs a leading icon has to extend `DetailRow` rather than compose around it.
- Showing the frontmatter verbatim means a document whose frontmatter is a nested structure no longer gets a folded view; the block is as long as the file's header.
- The panel list now stats every entry file, so a list over an unusually large panel pays one more syscall per entry.

## Verification

- `pnpm run check:refactor` green; `pnpm run test` 82 files / 638 tests green; `pnpm run build` succeeds.
- Isolated-profile walkthrough (`dsh --profile ui-check`, restarted so the new client revision is published): the suite detail's skill row and the user-entry detail's document row both render the tinted header, the trailing chevron, and the inset body, with the frontmatter shown as authored; the user-entry overview reads `来源套件 / 类型 / 磁盘路径 / 最近变更` under a `技能文档` group.
