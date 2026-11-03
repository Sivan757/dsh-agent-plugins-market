# Drafting with AI

English | [简体中文](ai-assist.zh.md) | [README](../../README.md)

**Guide:** [Install](install.md) · [Sources](sources.md) · [Resources](resources.md) · [Instructions](instructions.md) · [Output styles](output-styles.md) · [Services](services.md) · [Translation](translation.md) · [Settings](settings.md) · [Workspace](workspace.md) · [Agent roles](agent-roles.md) · [Layout coverage](layout-coverage.md)

## What it does

Every surface that holds an authored document has one extra row above the text: **Draft with AI**. You describe what you want in your own words, the model answers with the artifact, and the artifact lands in the editor you are already looking at.

The draft is a suggestion, not a write. Nothing is saved until you save it, and the text stays editable, so a draft you dislike costs one undo.

## Where it appears

| Surface       | The artifact it drafts                                                    |
| ------------- | ------------------------------------------------------------------------- |
| Skills        | Frontmatter description plus the instructions themselves                  |
| Shortcuts     | A command: description, argument hint, and a body addressing `$ARGUMENTS` |
| Experts       | A role: description plus standing instructions for that role              |
| Output styles | A style: description plus the text that shapes how the model answers      |
| System prompt | A Markdown block for an `AGENTS.md` file                                  |

A service configuration is not here on purpose. Drafting an MCP or language-server declaration from an intent is a different task with a different review: the answer would be configuration, not prose.

## Which model runs

The deployment's own **default model**, the same one the harness uses for its auxiliary work. The plugin never picks a model of its own and never asks for an API key: if the deployment has no default model yet, the row answers that it cannot draft instead of falling back to something you did not choose.

The call runs on the plugin's side. Your browser never sees a credential, and the prompt is not something the page can set: you send what you want, not how to ask for it.

## What it is bounded by

- One artifact per request, at most 1,500 output tokens, abandoned after 60 seconds.
- The intent is capped at 2,000 characters; a longer one is refused before the model is called.
- The answer arrives in one piece, so you review a finished draft rather than watching text arrive.

## When it does not work

A missing default model answers _no model is configured for drafting_. A provider failure answers with the provider's own message. A draft that hits the token cap says so rather than saving a truncated artifact. In every case the editor keeps what you already had.

## What it costs

One model call per press, on the model you already pay for. The plugin adds no service, no cache and no background call: nothing runs unless you press the button.
