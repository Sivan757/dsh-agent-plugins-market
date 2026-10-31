# System prompt

English | [简体中文](instructions.zh.md) | [README](../../README.md)

**Guide:** [Install](install.md) · [Sources](sources.md) · [Resources](resources.md) · [Services](services.md) · [Translation](translation.md) · [Settings](settings.md) · [Workspace](workspace.md) · [System prompt](instructions.md)

## What the page shows

The **System prompt** tab lists the `AGENTS.md` files the host injects into the session's system prompt, one card per file that exists, and each card opens that file. Discovery, load order, deduplication and the byte budget all come from the harness package `@deepseek-ai/dsh-agent-instructions`, so the page and the prompt cannot disagree: a row's status comes from the text the model receives.

The page reads the chain for the session's working directory. The settings page renders outside any session, so there it reads the host process working directory and says so in one line under the header. The page does not render the injected text: the file list and the status tags are what it can keep true to the prompt.

## Load order

Two user-global roots come first, then every directory from the project root down to the session directory.

- `$DSH_HOME/AGENTS.md`, the harness home, which is `~/.dsh` unless you set `$DSH_HOME`.
- `$DSH_AGENTS_HOME/AGENTS.md`, the shared agents root, which is `~/.agents` unless you set `$DSH_AGENTS_HOME`.
- For each project directory, in order: `AGENTS.md`, `CLAUDE.md`, `AGENTS.local.md`, `CLAUDE.local.md`.
- The project root is the first directory at or above the session directory that holds a `.git` entry, a directory or the file a linked worktree writes.

## Which file names load

Only `AGENTS.md` loads in the two user-global roots. Neither `CLAUDE.md` nor a local overlay is a candidate there, so the page never offers to create one.

All four names load inside a project directory. A row the page adds for a directory with no instruction file is marked as not created, and creating it is the action that row offers.

## Repeated content

Inside one candidate group, a file whose trimmed content matches an earlier one renders once. The two user-global roots form one group, so an `AGENTS.md` with the same text in both renders once and the harness home wins. Each project directory is its own group, so `AGENTS.local.md` that repeats its sibling `AGENTS.md` is reported as repeated content beside the file that carries it.

## The byte budget

The page reports two caps: 65536 bytes for the whole injected baseline and 1048576 bytes for one file. Both are the values the harness ships and reads a chain under. They are display-only, not settings, because the harness does not export its resolved values. A profile that raises its own `maxBytes` or `maxSourceBytes` makes the page report the shipped numbers, and nothing here can detect that. Stated rather than configurable is the deliberate trade: an independent plugin setting would describe a budget the model never got.

Over the budget, broader files are omitted first and only the most specific file is truncated. A file over the per-file cap never loads at all, and the page names that reason instead of the omission list. A budget of 0 or less switches instruction loading off entirely.

## Status of one row

| Status              | Meaning                                                             |
| ------------------- | ------------------------------------------------------------------- |
| Loaded              | The file's text is in the injected prompt.                          |
| Truncated           | The file is the most specific one, cut to fit the remaining budget. |
| Over budget         | A broader file the budget omitted.                                  |
| Over the file limit | Larger than the 1048576 byte per-file cap, so it never loads.       |
| Repeated content    | The same trimmed text as an earlier file in its group, shown once.  |
| Not injected        | Existing but absent from the prompt for no attributable reason.     |
| Not created         | The file does not exist. Creating it is the offered action.         |

## Creating, editing and deleting

Every action writes one file the chain can load. A request names a scope, a project-relative directory and a candidate file name, never a path, so the page cannot reach a file this session does not inject.

Writes are atomic, they create the parent directory only for a location the chain already lists, and the editor refuses text over the 1048576 byte per-file cap because such a file would never load. The editor counts bytes against both caps as you type.

One file can carry two names on the chain, for example `CLAUDE.md` symlinked to `AGENTS.md`. Deleting either name reports the other one, and whether the deleted entry was a link, so you know what the remaining name still resolves to.

## When the page is unavailable

The harness package is optional. A profile that does not provide `@deepseek-ai/dsh-agent-instructions` gets a notice naming it, not a failed page, and nothing else in the workspace is affected.
