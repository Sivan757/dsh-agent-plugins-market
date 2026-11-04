# Output styles

English | [简体中文](output-styles.zh.md) | [README](../../README.md)

**Guide:** [Install](install.md) · [Sources](sources.md) · [Resources](resources.md) · [AI suggestions](ai-assist.md) · [Services](services.md) · [Translation](translation.md) · [Settings](settings.md) · [Workspace](workspace.md) · [Instructions](instructions.md) · [Output styles](output-styles.md)

## What an output style is

An output style is a named block of instruction text that changes how the model answers. The **Output styles** tab chooses one per workspace, and the chosen text enters the session prompt as one section.

Exactly one style is selected for a workspace. The default style carries no text, so it injects nothing and is the way to turn styles off.

## What enters the prompt

The section is the style's name on a heading line, then the style text verbatim:

```text
## Output style: concise
Answer first. The first line is the result, the fix, or the direct answer...
```

The heading is part of the text because the host joins prompt sections with a blank line and adds no heading of its own. Without it, two blocks of instructions would run together and a reader of the prompt could not tell where the style starts.

The preview on the page shows this exact text. It is the same function the server uses to build the section, so the preview and the prompt cannot disagree.

## Where styles come from

| Source  | Lives in                                           | Notes                                                                          |
| ------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Yours   | `<Agent layout root>/output-styles/<name>.md`      | Frontmatter `description:` plus the style text. Created and edited in the tab. |
| A suite | `output-styles/<name>.md` inside the suite         | Read-only here; the suite's file is the style.                                 |
| Project | `.claude/output-styles/<name>.md` in the workspace | Nearest directory to the working directory wins. Read-only here.               |

The plugin ships no styles of its own: a style you author is stored as a Markdown file, so it travels with your Agent layout root and any other tool can read it. With nothing selected the prompt carries no output-style section.

## Suite and project styles

A style is a Markdown file wherever it comes from. A suite ships its styles in `output-styles/` (or wherever its manifest's `outputStyles` field points), and this tab reads those files as they are. A workspace can also keep styles in `.claude/output-styles/`: every directory between the session's working directory and the repository root is read, and the definition nearest the working directory wins when two declare the same name. Suite styles appear under **Suites**, project styles under **Project**, and both are read-only here — the file is the source of truth, so edit it where it lives.

Selecting a suite or project style injects its file text exactly as written. When the suite updates the file, the next read carries the new text: there is no captured copy to go stale.

A suite that injects persona text by running a program at session start is not an output style here. That is a SessionStart hook, and the **Hooks** tab lists it with the command it runs.

## Turning a style off

Select **default**. It carries no text, the section renders empty, and the host drops an empty prompt section entirely.

## Notes

- The selection is per workspace, stored beside the other workspace state.
- A style you delete stops injecting; a workspace that had it selected falls back to the default.
- A style name is a file stem: lowercase letters, digits, dot, dash and underscore.
