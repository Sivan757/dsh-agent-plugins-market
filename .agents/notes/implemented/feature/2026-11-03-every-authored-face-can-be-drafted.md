# Agent Note: every authored face can be drafted, by one shared call

Status: implemented

## Problem

Five surfaces hold an authored document — a skill, a command, a role, an output style, and a block for the system prompt — and every one of them opened an editor expecting a person to write it from a blank page. The product knew what the document had to look like (the format is fixed: frontmatter keys, a body addressed to the model) and still asked the person to recall it.

## Decision

- **One draft route, not five.** `POST /api/agent-plugins/ai-draft` takes a face and an intent and answers with the artifact. The client never sends a prompt, a model or a system message, so the deployment's model cannot be used for something the product did not describe.
- **One field component on every face.** `AiDraftField` is the same row everywhere: say what you want, press draft, review the answer in the editor you were already in. It is a suggestion and never a write: nothing saves, and a draft you dislike costs one undo.
- **The model is the deployment's own default.** The plugin resolves it at call time through `agentDefaultModel`, the same selection the harness uses for its auxiliary work. No plugin model choice, no credential, no fallback: a deployment with no default model is told so instead of being handed something it did not choose.
- **The call is shared with translation.** The route resolution, the cheapest-effort choice, the stream and the terminal-failure mapping moved into one module (`market-translation/runtime/host/auxiliary-model-call.ts`) because translation makes the same call for the same reasons; drafting adds only its bounds, its prompt and its answer shape.
- **A limit is a limit.** A provider that answers 429 or a usage-limit message crosses as `ai-provider-limited`, and the field says in the reader's language that the quota ran out and the editor was untouched. A missing model answers 409 with its own sentence.
- **Service configuration is out of scope.** Drafting an MCP or language-server declaration from an intent produces configuration, not prose, and reviewing it is a different task.

## Alternatives considered

- **A per-face prompt and call in each panel.** Rejected: five places to drift, and the format knowledge already lives in one place per face.
- **Run the draft through an agent loop.** Rejected: this is auxiliary work with no session, no tools and no log — an agent turn would make it slower, costlier and harder to bound.
- **Call the provider from the browser.** Rejected: it would put a credential in the page and let any script in the page spend the deployment's quota.
- **Write the shared helper inside market-bundle.** Rejected by the architecture rules: translation may not import bundle, so the helper lives where both can reach it.

## Consequences

- Five faces gained a drafting row without five implementations.
- Each press is one model call on the default route, bounded at 1,500 output tokens and 60 seconds.
- The feature needs a configured default model; without one it states that instead of failing obscurely.

## Verification

- `packages/market-bundle/test/integration/ai-draft-routes.test.ts` (6 tests): a draft names its route, every face gets its own format rules, unknown face/empty intent/over-long intent are refused before the model is called, a missing model is 409, a provider failure is 502, a limit is `ai-provider-limited`, and GET or a cross-origin write is refused.
- `packages/market-ui/test/ai-draft-field.test.ts` (3 tests): the intent is what is sent, the answer reaches the editor with the model named, the button stays disabled with nothing to ask, and a failure appears in the alert row.
- Live in `market-dev`: the row renders in the skills and output-styles editors, the request reaches the deployment's model, and the provider's 429 renders as 模型的用量额度已用尽或被限流… with the editor untouched. A successful draft could not be observed in this session because the deployment's model route is rate-limited; the success path is covered by the route tests and by `createLlmDraftPort` streaming through the same assembler translation already uses.
- Full suite: 2,535 tests pass; gate clean.
