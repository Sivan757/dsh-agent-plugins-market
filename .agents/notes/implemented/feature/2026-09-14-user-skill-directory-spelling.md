# Agent Note: The user skills panel publishes on the harness reader's terms

Status: implemented

## Problem

A user skill reaches `~/.agents/skills` in one of two accepted spellings, and the harness's `dsh-skill-filesystem` reader scans that same directory as its `user-agents` root. The panel originally listed only flat `<name>.md` files, so a directory-shaped `<name>/SKILL.md` skill was invisible in the Skills tab: the user count read zero, and no entry could be enabled, disabled, edited, or deleted there.

The same two-reader situation produced three more divergences:

- The panel registered an entry under its file or directory name, while the reader registers the `name` the document declares. One file, two names: the skill appeared twice in a session catalog, and `disabled: true` removed only the panel's copy.
- The panel published a candidate for any document it could read, including one with no frontmatter or a `name` outside the kebab grammar. The reader drops those files with a warning, so the panel advertised skills that load in a market-equipped session and nowhere else.
- Nothing tied the two readers together, so all of it shipped silently.

## Decision

`UserPanelStore` takes the document spellings it serves, most preferred first. The skills panel passes both (`<name>/SKILL.md`, then `<name>.md`); commands and personas stay flat-only. The directory spelling wins when one name exists in both, which is the order the harness reader reaches them in.

Listing, reading, editing, and deleting a directory-shaped skill operate on its `SKILL.md`. Editing keeps the spelling the document was read from. Creating always writes the flat spelling: the panel edits one document per entry, and a directory another tool populated with `references/`, `scripts/`, or persona files is that tool's layout to own. Removing a directory-shaped skill deletes its `SKILL.md` and then the directory only once nothing else is left in it — the plugin deletes the document it serves, never the resources beside it.

An entry's name is the `name` its document declares, which is also the name the harness reader derives from that file. The panel lists, reads, edits, and deletes by that name: a lookup resolves the served paths first and then the declared names of the documents on disk, so a file whose name differs from the name it declares stays addressable. A document the reader would reject is listed under its own document name, because the name it declares is one no registry accepts.

The skills panel publishes only documents that reader accepts from that directory. `skillEntryRejection` mirrors it — strict YAML frontmatter, a non-empty `name` already in kebab-case (no display-name normalization), a non-empty `description`, and a valid invocation policy — and a rejected document stays listed, disabled, with the reason in its `validationError` metadata, the same shape an unparseable frontmatter already produced. Hiding it would leave the user no way to find or fix it.

`UserPanelSkillProvider` sets each candidate's `resourceBase` to the directory holding its document, so a relative `references/…` reference resolves against the skill directory exactly as it does through the harness reader.

Switching a skill off is the harness's own control, not the provider's. The panel's switch writes `disable-model-invocation: true` together with `user-invocable: false` into the document — the one off state every reader of that file agrees on, because the harness parses those keys and its consumer enforces them — and drops the older `disabled` key, so an entry an earlier release disabled migrates on its first switch. The panel reads the pair back as its off state; either key alone is an authoring choice (a user-invocable-only skill, for instance) and stays switched on. Commands and personas keep the `disabled` key their mounts already skip.

## Alternatives considered

**Discover the directory spelling but keep writing flat paths.** Rejected: the first edit through the panel would create a second `<name>.md` beside the directory, leaving two documents for one name and showing the user a different document than the host reader serves.

**Create new skills in the directory spelling too.** Rejected: it spreads every new user skill into a directory the panel gains nothing from, and one document per entry is what this CRUD model edits. Both spellings are accepted input; the flat spelling is what the panel writes.

**Delete a skill directory recursively.** Rejected: `~/.agents` is shared storage and the files beside a `SKILL.md` were laid out by whichever tool created the directory. An irreversible delete from a list row must not reach past the document the panel served.

**Keep the file name and let something downstream de-duplicate.** Rejected: the registry de-duplicates by name, and a file-name candidate is a different name from the declared-name candidate, so nothing downstream can tell that the two describe one file.

**Keep the file name as the entry's identity beside the declared name.** Rejected: two names for one entry left the panel showing a name the model-facing catalog does not contain, and the panel's own controls then acted on a name no session sees.

**Validate with the suite parser.** Rejected: that parser is lenient on purpose — Codex display names normalize into kebab form, and prose fields fall back to a line-based recovery — because the plugin is the only loader of a suite's skills. A panel document in `~/.agents/skills` is also read by the harness, whose rules are stricter, so parity has to come from those rules.

**Drop a rejected document from the listing.** Rejected: the entry would vanish from the only surface that can fix it.

**Rename the document out of the discovery shape (`<name>.md.disabled`), as some skill editors do.** Rejected: it unloads the skill for every tool at once, but it also rewrites the user's layout, disturbs symlinks and external tooling, and needs a restore record — the invocation pair reaches the same outcome wherever the harness enforces it without moving anything.

**Rewrite only the rendered catalog message.** Rejected: hiding the entry from the model's turn catalog leaves the `skill` tool and `/name` still loading it, so the panel would report an off state that is not one.

**Keep the provider-side omission.** Rejected: this is the failure the note exists to fix — a skill the panel omits is still served by the harness reader from the same directory, and the switch then controls nothing.

## Consequences

The Skills tab lists every skill a session can load from `~/.agents/skills`, and its user count matches what is on disk. The panel's enable switch, editor, and delete action now apply to tool-authored skills instead of the harness reader serving them unmanaged.

A name declared differently from its file name no longer duplicates the skill: the panel shows the declared name, which is the name a session sees, and `path` still shows the file it lives in.

A rejected document now appears disabled with its reason rather than as a phantom skill, and its enable switch cannot be turned back on by itself — the rejection is recomputed from the document, so the fix is editing the document.

The panel is deliberately stricter than the suite scan: `name: Presentations` in a suite is normalized and loaded, while the same frontmatter in `~/.agents/skills` is rejected, because the harness reader would drop it.

The switch now stops a skill from loading in every profile, whether the panel or the harness reader serves it. It does not remove the file: other tools still discover the skill, and editing the invocation pair by hand is the same control.

## Testing

`tests/user-panels.test.ts` covers listing, editing, and deleting a directory-shaped skill, removal of a directory that emptying left behind, both-spellings precedence, flat creation, the flat-only panels, the per-spelling `resourceBase`, naming an entry by what its document declares with edit and delete resolving that name back to the file, the invocation pair read as the off state with either key alone staying on, and every rejected-document path (unparseable YAML, display-style name, missing description, missing frontmatter) staying listed and disabled with its reason. `tests/user-panel-surface.test.ts` covers the switch writing that pair and dropping `disabled`, and refusing a document that failed validation. `tests/panel-resources.test.ts` covers the same entry through the name id the HTTP layer addresses.
