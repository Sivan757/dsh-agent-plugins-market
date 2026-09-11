# Agent Note: README information structure

Status: implemented

## Problem

The README accumulated implementation details and repeated onboarding material while its Claude Code-only title no longer described the workspace. Several runtime and configuration instructions also lagged behind the source.

## Decision

The English and Chinese READMEs lead with user outcomes, then quick start, everyday use, compatibility boundaries, troubleshooting and documentation links. Layout dialect support and runtime surface support are separate tables. Detailed configuration lives in paired usage guides; directly related website claims follow the same implementation facts.

The repository-versus-release notice is omitted from the README, the usage guides and the documentation site at the user's request, and the README uses a Playwright capture of the running six-tab plugin workspace. Its capability matrix separates documented upstream conventions from this plugin's implementation, checked against vendor documentation and the source on 2026-09-08; the Codex MCP row names the documented `mcpServers` wrapper and the Universal row cites the OpenHands SDK. Dependency declarations are not presented as a tested minimum host version. The shared SVG icon is a four-tile pinwheel mark generated with `gpt-image-2` (kie.ai) and vectorized to a two-colour SVG for both README and browser favicon use.

The supersession check found no active note owning README organization. Existing source acquisition, cache and workspace decisions remain active and unchanged. [User-facing copy omits decisions and unrequested hints](2026-09-11-user-facing-copy-omits-decisions.md) later generalized the stance behind the omitted release notice to every user-facing surface, partially superseding this note's copy rule while its structure decisions stay active; both notes remain cross-linked.

## Alternatives considered

**Keep expanding the feature list.** Rejected because it mixes first-use instructions with implementation reference material and duplicates the FAQ.

**Keep the comparison table on the landing page.** Rejected because claims about other projects need separate ongoing verification and do not help complete the primary installation path.

## Consequences

The README is shorter and detailed configuration remains reachable. Usage guides and website pages still require synchronization when behavior changes. The screenshot captures the local running interface; it does not verify all runtime capabilities. A verified host-version matrix is not supplied by this documentation change.
