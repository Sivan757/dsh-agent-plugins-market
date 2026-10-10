# Agent Note: Keep extension transactions out of model input

Status: implemented

## Problem

Extension selection commits inject pending and committed envelopes so the host durably records them in agent/inbox/spliced. Letting the claimed copies also become user/message events repeats an opaque placeholder in model input without adding task information.

## Decision

Keep the existing two-phase envelopes, binding schema, agent.inject and flush. In the ready pre-step path, await the next decision and remove only this service’s selection, selection-intent and recovery-wake source kinds from an enter decision’s messages. Preserve all other fields and messages, rejection decisions, and the not-ready requeue path. Replay continues to read inbox splices and historical user-message copies by message identity.

Existing conversation history is not edited. Old visible placeholders remain until normal host history management removes them; new transactions no longer add model-visible copies.

## Alternatives considered

- Delete or merge one phase: rejected; replay uses the pending/committed pair to distinguish acknowledged changes from interrupted transactions.
- Empty the user-message body: rejected; it still creates a model message and may violate adapter constraints.
- Introduce custom persisted events: unnecessary; the host already durably records inbox splices, and custom event replay would add compatibility work.
- Filter by identical text: rejected; source ownership, not user text, identifies an internal transaction.

## Related decisions

Refines the model-input handling of [extension presets](../../proposed/feature/2026-10-05-agent-extension-presets.md); its two-phase persistence and authorization design remain unchanged.

## Verification

Recording-adapter tests check that real user input reaches the model and no new transaction placeholder does, while both binding phases remain durable. Recovery tests cover splice-only logs, fork seeds, lifecycle notifications, pending failures and older logs that also contain model-visible copies. Plugin reload is required to change the running behavior; no host patch or history deletion is involved.
