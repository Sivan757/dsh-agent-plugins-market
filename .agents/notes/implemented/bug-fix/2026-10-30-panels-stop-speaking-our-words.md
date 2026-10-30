# Agent Note: the panels stop speaking our words

Status: implemented

## Problem

A review of the settings surfaces against a non-developer reader found three kinds of defect, all of the same family: the interface said what the implementation did rather than what the reader needs.

1. **Six classes with no rules.** The instructions panel applied `empty`, `error`, `notice`, `unavailable`, `unavailableTitle` and `unavailableBody`; none existed in its stylesheet, so the loading line, the read failure and the whole "page unavailable" card rendered with browser defaults — an `h3` carrying its own margins inside a panel that insets everything else.
2. **English mode spoke Chinese.** The tab rail's two step buttons built their accessible names by appending a literal "向前一个" / "向后一个" to the localized list label, so a screen reader in English announced "Agent Plugins · 向前一个", and the strings existed in no dictionary.
3. **Our words in the reader's way.** A language server read `已挂载` / "Mounted" in its status pill; a service's name field was `挂载名` / "Mount name"; a conflict badge said `接缝冲突` / "Seam conflict"; the restart tooltip explained how the host notices a dead process; the output-styles subtitle repeated the tab's own name; and the skills, shortcuts and experts descriptions restated their tab instead of saying what a reader cannot see from it (which entries are editable).

## Decision

- **A class the panel applies has a rule in its own stylesheet.** The six missing rules are added, mirroring the output-styles panel's `empty`/`error`/`notice`, plus a bordered card for the unavailable state. A test now reads both files and fails on any applied class without a rule, so the next one cannot be forgotten silently.
- **The rail takes its step labels as props.** `TabRail` receives `stepPreviousLabel`/`stepNextLabel`; both call sites pass them from the translator, and the two strings live in the dictionaries.
- **User-facing text names the state, not the mechanism.** `运行中`/"Running" replaces the mount word in the status pill; `服务名`/"Service name" replaces the mount-name label; `配置冲突`/"Config conflict" replaces the seam word on the conflict badge and the upgrade banner describes a conflicting hand-added configuration instead of "a layer claiming the same seam".
- **A tooltip keeps the outcome and drops the internals.** The restart hint is one sentence: it restarts this server now.
- **A panel description says what the tab cannot.** The three list panels now state which entries are editable instead of repeating their own tab name.

## Alternatives considered

- **Leave the mechanism words in tooltips, where developers read them.** Rejected: the tooltips sit on buttons a non-developer presses, and the same sentence is the only explanation available there.
- **Keep the status pill as "mounted" and explain it in the detail.** Rejected: the pill is the first thing scanned, and the detail already explains the reason when something is wrong.
- **Translate the step labels inside TabRail with its own translator.** Rejected: the rail is deliberately translator-free; passing two strings keeps it that way and keeps the dictionaries the single source.

## Consequences

- The unavailable card, the loading line and the read failure now sit inside the panel's own spacing instead of the browser's.
- A screen reader in English hears English step buttons.
- Anyone upgrading with a hand-added LSP configuration reads a conflict they can understand rather than a seam they cannot.

## Verification

- `packages/market-ui/test/client-instructions-panel.test.ts` fails when the panel applies a class its stylesheet does not define.
- `packages/market-ui/test/tab-rail-drag.test.ts` passes the two labels and still finds the step buttons by their accessible names.
- `pnpm run check:css`, the four typechecks and the full suite stay green.
- In the `market-dev` profile against the built bundle the three rewritten panel descriptions render (技能, 快捷指令, 专家), and the language-engine panel keeps its own subtitle.
