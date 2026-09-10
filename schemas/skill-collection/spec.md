# Manifest-less skill collection layout

Reference contract for repositories that ship skills without any plugin manifest.

- **Schema:** none, because there is no manifest to validate. The unit of validation is the `SKILL.md` frontmatter, which is parsed by `src/catalog/skills-parse.ts`.
- **Status:** this is a discovery convention of this plugin and of the Agent Skills ecosystem, not a vendor-published plugin format.
- **Evidence:** the shared scanning rules in `src/catalog/scan-resolvers.ts`; upstream Agent Skills documentation at https://code.claude.com/docs/en/skills and https://developers.openai.com/codex/skills.

## Qualification

A source directory qualifies as a manifest-less skill collection only after skill discovery finds at least one skill. It does not qualify from directory shape alone, so an unrelated repository is not scanned as a suite.

## Recognized layouts

| Layout                          | Meaning                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `<root>/SKILL.md`               | Single-skill plugin; the directory is the skill.                              |
| `<root>/skills/<name>/SKILL.md` | Skill collection; each immediate subdirectory with a `SKILL.md` is one skill. |
| `<root>/skills/*.md`            | Flat skill files, when the consumer supports them.                            |

`SKILL.md` frontmatter carries `name` and `description`; user-invocable skills surface as `/` entries in chat, and skills may restrict manual invocation.

## Surfaces

Because there is no manifest, component locations are the shared scanning conventions only: files directly under `agents/*.md` and `commands/*.md`, `hooks/hooks.json` or root `hooks.json` (Claude Code command-hook subset), and MCP files (`mcp.json`, `.mcp.json`, or inline manifest `mcpServers`, which does not exist here). LSP is preview-only because there is no manifest `lspServers` to validate.

## Relationship to other dialects

A repository can be manifest-less and still carry the same component directories as a plugin repository. The difference is identity: without a manifest, the suite name comes from the directory basename and no version, author, or dependency metadata is available. Adding any of the manifests in this directory upgrades the same tree to that dialect without moving files.
