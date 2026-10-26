# Output styles

English | [简体中文](output-styles.zh.md) | [README](../../README.md)

**Guide:** [Install](install.md) · [Sources](sources.md) · [Resources](resources.md) · [Services](services.md) · [Translation](translation.md) · [Settings](settings.md) · [Workspace](workspace.md) · [Instructions](instructions.md) · [Output styles](output-styles.md)

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

| Source   | Lives in                                                     | Notes                                                                          |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Built-in | `plugins/output-styles/styles/` in this repository           | Three styles: default, explanatory, concise. Shipped with the plugin.          |
| Yours    | `<Agent layout root>/output-styles/<name>.md`                | Frontmatter `description:` plus the style text. Created and edited in the tab. |
| A suite  | A market suite that prints its text from a SessionStart hook | Captured once, explicitly, then stored as text.                                |

A built-in style needs no capture. A style you author is stored as a Markdown file, so it travels with your Agent layout root and any other tool can read it.

## Suite styles and the capture

A Claude Code output-style plugin delivers its text by running a program at session start. This plugin does not run that program while you are reading the page. The tab lists the suite, and **Capture text** runs its declared SessionStart hook once, in your home directory, under a fixed timeout and output cap. The text it prints is what the prompt receives afterwards.

Capturing is a separate action because running a suite's program is a side effect, and because the text that shapes every answer should be something a person has read first. The preview shows the captured text before the style can be selected.

The capture is bound to a fingerprint of the suite's declaration, its version and the hook command. If the suite changes, the row reports the capture as out of date, stops injecting it, and offers to capture again. Text from a version nobody approved never reaches the prompt.

## Turning a style off

Select **default**. It carries no text, the section renders empty, and the host drops an empty prompt section entirely.

## Notes

- The selection is per workspace, stored beside the other workspace state.
- A style you delete stops injecting; a workspace that had it selected falls back to the default.
- A style name is a file stem: lowercase letters, digits, dot, dash and underscore.
