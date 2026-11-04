# Agent Note: two AI surfaces, two kinds of detail

Status: implemented

## Problem

Two review points.

1. Every authored editor carried a **Draft with AI** row. A skill, a shortcut, an expert, an output style and a system-prompt file each asked a model to write the artifact before the person had said anything. The editors are where a person states what they want; a model writing there competes with that.
2. A system-prompt file could be opened in the settings page but not in the preset manager, so the same row answered "what is in it" in one place and nothing in the other.

## Decision

- **Drafting is gone from the editors.** `AiDraftField` and the draft/session routes behind it are removed, along with the shared editor's `renderAiSlot` hook. What remains is what the review asked to keep: the marketplace's _Recommend suites to install_, the preset manager's suggestion, and the failure explanation in a service detail dialog. The two suggestion surfaces share one port (`AiPort`) and one answer shape (`AiAnswer`).
- **The manager opens the same instruction detail the page uses.** `ExtensionResourceDetail` loads the chain and renders `InstructionDetail` read-only (no edit, no delete: those stay the page's actions). A row that cannot be loaded still says so instead of opening an empty dialog.

## Alternatives considered

- **Keep drafting on the output-style editor only.** Rejected: the review named the detail pages as a group, and a style is not more deserving of a model-written body than a skill.
- **Delete the AI plumbing entirely.** Rejected: the marketplace recommendation, the preset suggestion and the failure explanation are the two things the review said to keep, and they run on the same port.
- **Give the manager its own instruction viewer.** Rejected: two renderers for one file is the drift this repository keeps removing; the settings dialog is the one place that knows how to read and render these rows, and it takes a read-only flag instead.

## Consequences

- Four AI-draft routes collapse into two, and the `agentsRoot`, session store and catalogue dependencies the session route needed are gone from the AI route's deps.
- A model is asked only about a collection (which suites, which rows) or about a failure, never about prose a person is supposed to author.
- The instruction row reads the same in both surfaces, byte for byte, because it is the same component.

## Verification

- Tests: the remaining AI routes pass (10 tests, preset + diagnosis + install recommendation); the deleted component's test file is gone; the full suite passes at 2,546.
- Gate clean, build clean.
- Browser automation was unavailable this round, so the manager's instruction dialog is covered by its component contract and the shared renderer rather than by a screenshot.
