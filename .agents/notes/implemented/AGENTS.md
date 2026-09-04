# AGENTS.md — Implemented Agent Notes

These Agent Notes describe shipped decisions. Follow the [Agent Note format](../README.md#the-file-format).

## Keep an implemented Agent Note current with what actually shipped

Keep paths, symbols, defaults, and mechanisms current in the same change that alters them. Rewrite stale facts in place; do not append change history.

When a shipped note is unlikely to guide future work, archive its complete English/Chinese pair through the `dsh-archive-agent-notes` workflow instead of continuing to maintain it.

### This is not a license to rewrite the _decision_

Update factual realization in place. A reversal of the decision or its rationale requires a new Agent Note and cross-link; a fully superseded old note may be deleted only through the consolidation rule in the [Agent Note rules](../README.md).
