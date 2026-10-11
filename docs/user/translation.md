# Translation

English | [简体中文](translation.zh.md) | [README](../../README.md)

**Guide:** [Install](install.md) · [Sources](sources.md) · [Resources](resources.md) · [Services](services.md) · [Translation](translation.md) · [Settings](settings.md) · [Workspace](workspace.md)

Turn **Translation** on in the plugin configuration card to read descriptions and document prose in the interface language: Simplified Chinese or English. Chinese defaults to on and English to off; your saved choice takes priority until **Use default** restores the language-derived default. An English interface can translate Chinese text when you enable it. Names and keywords remain unchanged for searching, sorting, copying and invocation.

| Tab            | Description                        |
| -------------- | ---------------------------------- |
| Market         | Suite description                  |
| Skills         | Skill description                  |
| Commands       | Command description                |
| Agent personas | Persona description                |
| MCP services   | One line per tool                  |
| LSP servers    | The entry has no description field |

Translation tries these levels in order, keeping the original readable while work is pending:

1. **Google Translate** — a keyless public endpoint, with a 3-second deadline.
2. **Microsoft Translator** — a keyless public endpoint, with a 15-second deadline.
3. **Your default model** — used when a model route is available, with a 30-second deadline. This can consume your model quota.
4. **The upstream text** — shown when no provider answers. Public endpoints offer no availability guarantee; a failed provider is skipped until translation is re-enabled, the cache is reset, or the process restarts.

Descriptions are requested as their panels or menu candidates are read, not by a startup translation sweep. The slash menu serves current descriptions immediately. While it stays open, it performs up to 40 follow-up reads, at least 1.5 seconds apart, and refreshes changed descriptions without another keystroke. Closing the menu or disabling translation stops those reads. After that limit, later candidate requests can revalidate again. Hosts without the public menu controller update only on subsequent candidate requests.

A skill, command or agent-persona detail opens with its document already expanded. Collapse it from its header, or expand a document row in a Market suite detail, to read it. Icons beside the filename select Original, Translation or Bilingual without collapsing the document. Hover for labels, or use the keyboard to change modes. One shared mode applies to every document, so a click changes them all. Original is the default, and opening a document starts no translation. Translation and Bilingual pair each translated paragraph with its original. During work, a spinner replaces the selected mode icon instead of adding loading text to the body. Unexpanded documents are not pretranslated. Original mode stops further translation reads, but submitted server work can finish.

The controls remain in the document header while that document scrolls. They leave the pinned position at its end and when it closes.

If a read fails or some paragraphs cannot translate, the selected mode icon becomes a warning. Hover for the error, or activate the warning to retry. Retry resets this document’s failure records and permits failed providers again without clearing completed translations. The original and completed paragraphs remain readable. Each translation read has a 15-second deadline, including response-body reading, not a deadline for the whole document.

Documents translate by natural paragraph. Short paragraphs travel whole, and longer paragraphs split only between complete sentences. If one sentence exceeds the safe length, its paragraph stays original and reports failure instead of cutting the sentence. A paragraph appears translated only after all its parts finish, never as half original and half translated. Code, link destinations, math and raw HTML remain untranslated. Bilingual tables show the original table above the translated table.

Translations stay cached locally without expiry and are shared between the user panel and Market detail. Reuse across restarts requires the same document identity, paragraph text, target, provider chain and translation strategy. Inserting or editing a paragraph leaves unchanged neighbors cached. The new document strategy does not reuse old slice caches, so reopening a document incurs a one-time retranslation cost that can consume model quota. Existing description caches remain usable, and source files stay unchanged.

Turning **Translation** off shows the original on every surface, drops queued work and prevents later fallback calls, while keeping completed cache entries. The plugin requests cancellation of active calls, but a remote provider may still finish work it already received. **Reset cache** clears completed entries and invalidates old requests so they cannot refill it; a subsequent enabled read may start fresh work. Re-enabling translation also retries providers that had failed.

The prompts and tool descriptions this plugin injects into a session are not translated: they stay in the language their author wrote them in.
