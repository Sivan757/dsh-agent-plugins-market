---
name: market-pre-push-checks
description: Use before pushing, merging, or claiming a green tree in dsh-agent-plugins-market, to select the smallest checks that cover the outgoing diff instead of reflexively running the full suite.
---

# Market Pre-Push Checks

Run evidence matched to the outgoing diff once, then report only the commands run. CI owns exhaustive coverage; the full `pnpm run test` locally is reserved for release verification (see [market-release](../market-release/SKILL.md)) and repository-wide changes.

## Steps

1. **Scope the diff.** `git status --short --branch` and `git diff <base> --stat`; the surface list is the completion criterion for this step.
2. **Map surface to evidence** and run the union once:

| Outgoing surface                     | Evidence                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/**` or `tests/**`               | `check:refactor` + the vitest files mirroring the touched areas (`tests/<area>.test.ts`) |
| `src/client/**` or `locales.ts`      | above + every `tests/client-*.test.ts`                                                   |
| `schemas/**`                         | above + `tests/mcp-config.test.ts` + `tests/lsp-spec.test.ts`                            |
| `docs/**`, `README*`, `docs-site/**` | `format:check` (and `docs-site` build when its sources changed)                          |
| `package.json` / lockfile            | `pnpm install --frozen-lockfile` + `check:refactor`                                      |

3. **Re-verify after fixes.** Any fix reruns the same command set that failed, nothing more.
4. **Green tree.** `format:check` covers files eslint does not (docs, HTML, fixtures) — include it whenever non-TS files moved, then report the evidence list with the push proposal.
