# Agent Note: Hook detail anatomy and follows-suite rows

Status: implemented

## Problem

The hook detail was one flat key/value list, then the command, then a bare run result. Nothing anchored what the hook is, and the declaration, the command and the run read as one undifferentiated block.

Separately, the market manager's Hooks face published no rows at all for hooks owned by installed suites, while the settings overview published one row per declaration. A globally enabled hook looked missing in the manager, and the two surfaces disagreed about the same declaration.

## Decision

The detail follows the expert-detail anatomy: one status card, then labelled sections.

The status card carries the support, event and matcher tags, then the provenance name, then a state dot with the full command. The overview section is one auto-fitting key/value grid of eight facts: source, event, matcher, timeout, declaration position, kind, suite and run directory. The run section puts the primary test-run button in its heading; its status line reports the exit code, the duration, a synthetic-data marker, a timeout and a truncation, and each stream prints under its own label. A rejected declaration shows the diagnostic section and no run section. The command appears in the status card, and the declaration section below the overview repeats it as that row's clipped preview, since [the declaration JSON block](2026-10-10-hook-detail-declaration-json-block.md).

Host primitives carry the controls: Button, Tag with the success, warning and outline tones, and StateDot. The run result does not reuse the host TerminalBlock, because that component renders the command line again.

Rows carry one new fact. `ExtensionResource.followsSuite` marks a resource that follows its owning suite's selection. `readExtensionInventory` stamps it on every hook row where `exposesIndividualHooks(suite)` is false, in both reads, so the fact does not depend on which surface asked. The manager's inventory searches a dedicated `hookSuites` list (project suites plus installed user-dimension suites plus the @user-hooks suite) instead of widening `projectSuites`, so installed declarations become rows while `projectOwners` and `address()` keep their meaning. `HookResourceCard` tags such a row "follows the suite" and never offers it a switch, `ResourceList` passes no toggle for it, and `resourceSelected` mirrors the owning suite.

## Alternatives considered

- **Reuse the host TerminalBlock for the run result.** Rejected: it renders the command line again, and the command already sits in the status card, so the block would repeat the path the user asked to drop.
- **Keep the flat key/value list and add tags only.** Rejected: the list gives the command and the run result the same weight as the timeout, and the approved anatomy separates the declaration, the command and the outcome.
- **Stamp followsSuite only when the manager asked for the rows.** Rejected: following the suite is a property of the hook, not of the surface that lists it.
- **Widen projectSuites so the manager sees installed suites.** Rejected: projectOwners and address() would then treat installed suites as project-owned, which changes session id propagation for every other row they publish.
- **Give a follows-suite hook its own switch.** Rejected: the documented contract says installed suite hooks follow the suite selection, and a switch that does not gate the runner would lie.

## Consequences

- The declaration reads in one scan: what the hook is, what it says, and what running it produced.
- The command appears in the status card and once more as the declaration row's clipped preview. That second occurrence is deliberate: it is the reference declaration row's own preview, not a second command section.
- The settings overview now carries the same follows-suite tag, which explains why those rows have no switch. Its filter counts stay control-based and do not change.
- The manager's Hooks face lists installed declarations as read-only rows whose state mirrors the owning suite row.

## Testing

`tests/client-hooks-status-panel.test.ts` asserts the overview grid labels, the command occurrence count the dialog rests at, that a rejected declaration offers no run section, and the dry-run body and result. `tests/client-hook-resource-card.test.ts` asserts the follows-suite tag with no switch and that `resourceSelected` mirrors the owning suite. Server tests cover the row source and the stamp.
