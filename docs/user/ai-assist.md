# AI suggestions

English | [简体中文](ai-assist.zh.md) | [README](../../README.md)

**Guide:** [Install](install.md) · [Sources](sources.md) · [Resources](resources.md) · [Instructions](instructions.md) · [Output styles](output-styles.md) · [Services](services.md) · [Translation](translation.md) · [Settings](settings.md) · [Workspace](workspace.md) · [Agent roles](agent-roles.md) · [Layout coverage](layout-coverage.md)

## What it does

Two surfaces ask a model for a suggestion, and both answer with text you read before anything exists:

| Surface            | What it answers                                                |
| ------------------ | -------------------------------------------------------------- |
| Marketplace header | **Recommend suites to install** for what the workspace is for  |
| Preset manager     | A preset: its name, a reason, and the rows it should switch on |

A connector or a language server that failed has its own action inside its detail dialog: **Explain this failure**. It sends the facts the row already shows, the state, the code, the reason and the attributed causes, and answers with the likeliest cause and one to three steps to try. It cannot retry, restart or edit anything.

The editors for a skill, a shortcut, an expert, an output style or a system-prompt file do not draft for you. A style, a role or a hook is configuration a person owns, and an editor that writes it is not the same feature as a list that narrows itself.

## What the marketplace recommendation does

Say what the workspace is for, and the model picks from the catalogue this deployment already scanned. It never sees the browser's copy of the list, and every id it answers is checked against the catalogue. Applying the answer narrows the list to those suites. Installing stays the per-suite confirmation each card already has.

## What the preset suggestion does

Say what a setup is for, and the model proposes a name, a reason, and a selection drawn from the rows the manager is showing. You see all three before anything exists, and creating it is your press, through the same create path the manager already uses.

A service configuration is not here on purpose. Drafting an MCP or language-server declaration from an intent is a different task with a different review: the answer would be configuration, not prose.

## Which model runs

The deployment's own **default model**, the same one the harness uses for its auxiliary work. The plugin never picks a model of its own and never asks for an API key: if the deployment has no default model yet, the surface answers that it cannot answer instead of falling back to something you did not choose.

The call runs on the plugin's side. Your browser never sees a credential, and the prompt is not something the page can set: you send what you want, not how to ask for it.

## What it is bounded by

- One answer per request, at most 1,500 output tokens, abandoned after 60 seconds.
- The intent is capped at 2,000 characters; a longer one is refused before the model is called.
- The answer arrives in one piece, so you read a finished suggestion rather than watching text arrive.

## When it does not work

A missing default model answers that no model is configured. A provider failure answers with the provider's own message. An answer that picks nothing the surface offered is refused as unusable rather than applied. In every case the list keeps what it showed.

## What it costs

One model call per press, on the model you already pay for. The plugin adds no service, no cache and no background call: nothing runs unless you press the button.
