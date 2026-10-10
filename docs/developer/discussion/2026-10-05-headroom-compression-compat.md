# Headroom (context compression) against dsh — feasibility, limits, and the integration paths

Measured 2026-10-05 against headroom `0.39.1` (upstream `main` @ `1cf4966`, clone removed after the probe) and the DeepSeek Harness checkout `~/workspace/deepseek-harness` @ `c55d6205ff`. Host facts were read from source; headroom facts were read from source and then executed.

## Summary

Headroom is a local context-compression layer for coding agents: a library, an HTTP proxy, an MCP server, a hooks plugin, and a `wrap` command. It is a generic Anthropic- and OpenAI-compatible intermediary, so a dsh Session can use it today with **no change to the host and no change to this plugin** — by pointing the conversation endpoint at the proxy. What does not exist is a `headroom wrap dsh`: headroom's wrap targets are a hard-coded registry, and dsh is not in it.

Three integration paths exist, in increasing cost:

1. **Transparent proxy (works today).** Set `DEEPSEEK_BASE_URL=http://127.0.0.1:<port>` before launching dsh and run `headroom proxy --anthropic-api-url https://api.deepseek.com/anthropic`. Compression applies to the whole request; nothing in dsh changes. The endpoint can only come from the inherited environment, so this is a launcher concern, not a plugin setting.
2. **What our plugin can install (partial).** The suite our market already discovers from headroom — the Claude Code hooks plugin — mounts and runs, but its hooks are a no-op under dsh, and `hooks.json` alone is not installable: the plugin directory must also ship `.claude-plugin/plugin.json`. What is genuinely deliverable today is headroom's **MCP server**, as an ordinary stdio `mcp.json` entry.
3. **What needs an upstream change.** `headroom wrap dsh`, a dsh entry in `headroom init`, or the wrap-target registry itself. All of it belongs in headroom's repository, not ours.

## What headroom is

| Surface          | What it does                                                              | Reference                                                     |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Library          | `compress(messages)` in Python or TypeScript, in-process                  | upstream README                                               |
| Proxy            | `headroom proxy --port 8787`, any Anthropic/OpenAI-compatible client      | upstream README, `docs/content/docs/proxy.mdx`                |
| `wrap <tool>`    | Starts the proxy, sets the tool's base-URL env vars, launches it          | `headroom/cli/wrap.py`, `headroom/providers/wrap_registry.py` |
| MCP server       | `headroom_compress`, `headroom_retrieve`, `headroom_stats` over stdio     | `headroom/cli/mcp.py`, `server.json`                          |
| Hooks plugin     | Claude Code / Copilot CLI plugin that starts the runtime at session start | `plugins/headroom-agent-hooks/hooks/hooks.json`               |
| `headroom learn` | Mines failed sessions and writes corrections into agent instruction files | `headroom/learn/`                                             |

## Question 1 — does headroom support this tool?

**No dedicated support, and no mention of dsh anywhere in the repository.** Headroom's `wrap` registry and `init` targets are closed sets:

- `headroom wrap --help` lists 19 targets (claude, codex, copilot, vscode, vscode-claude, aider, openclaude, vibe, grok, grok-build, cursor, cline, continue, goose, openhands, openclaw, opencode, omp, zcode). `headroom wrap dsh` fails with `Error: No such command 'dsh'.`
- `_SUPPORTED_TARGETS = ("claude", "copilot", "codex", "openclaw")` in `headroom/cli/init.py`.
- `WrapTarget` is a frozen dataclass in a hard-coded dict; there is no user-side registry file, and no documented way to add a target. The one third-party seam, the `headroom.cli_extension` entry-point group, hands out the root `click.Group` but nothing documents or tests reaching `wrap`.

**Generic support is real, though.** The proxy is designed for exactly this case, and DeepSeek is already in its data: `--openai-api-url https://api.deepseek.com/v1` is the documented OpenCode + DeepSeek recipe, `headroom/pricing/deepseek_tiers.py` carries DeepSeek's peak/off-peak rate card, and `tests/test_proxy/test_cc_switch_reconciler.py` uses `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` as its example third-party gateway, asserting the token and model survive verbatim.

## Question 2 — how far does it go with dsh today?

Measured on a live chain: dsh-shaped requests → `headroom proxy` → a local recorder standing in for the upstream.

**The wire contract holds.**

| Property | Result |
| --- | --- |
| Path | dsh calls `<base>/v1/messages`; the proxy serves it at its root and forwards `base.rstrip("/") + path`. dsh never calls `count_tokens`, so the proxy needs no such route |
| Auth | `x-api-key` is forwarded verbatim; the proxy never requires, reads, or replaces it, and needs no key of its own |
| Headers | `anthropic-version`, `anthropic-beta`, `content-type`, `accept` survive; betas are merged session-sticky |
| Streaming | SSE passes through; a 688-byte event stream came back byte-intact |
| Tools | `tools` arrays, `tool_use`/`tool_result` blocks, and the `model` id pass through unchanged |
| License | Compression is not paid-gated; the license reporter exists only when `HEADROOM_LICENSE` and `HEADROOM_USAGE_REPORTING=1` are both set, and it fails open |
| Fidelity | `retry-after` and `request-id`/`x-request-id` drive dsh's backoff and error identity, so the hop must not drop them; SSE frames must stay unbuffered and keep `event:` equal to the JSON `type` |

**Compression actually fires — and the mode decides how much.**

`--mode cache` (the default) freezes the leading two thirds of the message list to protect the provider's KV-cache prefix. `--mode token` trades that cache protection for compression. Same conversation, same content, one big JSON tool result in the live tail:

| Mode           | Upstream received         | Pipeline                                                                    |
| -------------- | ------------------------- | --------------------------------------------------------------------------- |
| `--mode cache` | 690,806 bytes (unchanged) | `frozen=2`, `saved 0`                                                       |
| `--mode token` | 345,902 bytes (half)      | `1 compressed (tool:mixed:0.47)`, `272,887 → 113,162 tokens`, 159,725 saved |

The same content carried in an **older, non-frozen** message compresses under **both** modes: the default configuration reached `1 compressed (tool:mixed:0.47)`, `206,778 → 113,209 tokens` (`saved 97476` in `~/.headroom/savings_events.jsonl`). The OpenAI path behaves identically (`--openai-api-url`, `/v1/chat/completions`: `200,535 → 103,060 tokens` in token mode).

Two limits the probe exposed, both worth knowing before promising savings:

- **Headroom does not recognise dsh's tool names.** Its verbatim protection for file reads is keyed on Claude Code names (`Read`/`Glob`); dsh's tool names never match it, so no dsh tool result gets that protection.
- **The first request of a process can be slow.** Cold-start work (tokenizer download, Kompress model prefetch) put `compression_first_stage` at 10.0s and then 20.1s on the first two requests of a fresh `HEADROOM_HOME`; the second of those hit headroom's 20-second compressor deadline and kept the remainder verbatim. Warm requests ran in 0.5–1.1s. A large tool result can therefore delay a turn on a cold proxy.

**The MCP server works on its own terms.** `headroom mcp serve` answered `initialize` (protocol `2025-06-18`, `serverInfo: headroom 1.30.0`) and listed exactly three tools over stdio: `headroom_compress` (input `content`), `headroom_retrieve` (input `hash`), `headroom_stats` (no input). It is **not** a substitute for the proxy: nothing in it touches the host's own conversation, and the model has to call the tools.

## Question 3 — how much can our plugin deliver without touching the host?

Our scanner already reads this repository. `docs/reference/compat-report.md` pins `headroomlabs-ai/headroom` as the GitHub Copilot sample: the Copilot marketplace is valid but shadowed, and the winning suite is `headroom` from `plugins/headroom-agent-hooks/.claude-plugin/plugin.json` — a `claude-code` suite with **hooks 2, everything else 0**. Re-running the shipped scanner over a staged copy of those manifests reproduces exactly that: one suite, `hooks: {SessionStart: startup|resume, PreToolUse: Bash|PowerShell}`, both running `headroom init hook ensure`.

**That suite mounts, and does nothing useful.** `SessionStart` and `PreToolUse` are both in the bridge's seven-event whitelist, and `startup|resume` and `Bash` both match dsh's matcher semantics. But `headroom init hook ensure` resolves a headroom _install manifest_ and starts the detached proxy behind it; with no manifest it returns silently and exits 0. Installing this suite into dsh therefore buys a 60-second-timeout hook that starts nothing.

**The installable prerequisite is easy to miss.** A hooks-only plugin directory is invisible to the scanner: `collectRoots` accepts a marketplace entry only when it has a suite manifest, skill files, or an inline declaration, and `hooks/` is none of those. A plugin directory must also ship `.claude-plugin/plugin.json` — which headroom's does. Strip that manifest and the whole repository scans to zero suites.

**What our plugin can install today, end to end:**

| Piece                 | Deliverable       | Note                                                                                                                             |
| --------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| headroom MCP server   | Yes               | One stdio `mcp.json` entry running the `uvx --from 'headroom-ai[mcp]' headroom mcp serve` contract from headroom's `server.json` |
| headroom hooks plugin | Mounts, no effect | Needs `.claude-plugin/plugin.json`; `init hook ensure` starts nothing without a manifest                                         |
| Prompt compression    | No                | No plugin seam reaches the request; the only route is the base URL                                                               |
| `headroom wrap dsh`   | No                | Belongs to headroom; see Question 4                                                                                              |

## Question 4 — the paths to real support

**Path A — point the endpoint at the proxy (no code anywhere).**

```sh
uv tool install --python 3.13 "headroom-ai[proxy]"
headroom proxy --port 8787 --mode token --anthropic-api-url https://api.deepseek.com/anthropic
# in the shell that launches dsh:
export DEEPSEEK_BASE_URL=http://127.0.0.1:8787
```

Why the environment variable and not a setting: `DEEPSEEK_BASE_URL` is **bootstrap-only**. Both the invocation directory's `.env` and `$DSH_HOME/.env` refuse it by name, and a plugin cannot add a layer to the launch snapshot. The equivalent user-facing surface is the Models page, whose Base URL field writes an explicit `baseURL` into the profile's settings — a user decision, not something this plugin should make. Note that `--mode token` is required for the savings in the table above; the default `cache` mode protects the provider prefix instead.

One hop detail remains unexercised: dsh also calls `<base>/v1/files` for image offload (`files-api.ts` builds it from the same `<base>/v1` root), and the probe only exercised `/v1/messages`. Headroom's catch-all route should forward it to the same upstream base, but that path was not measured.

**Path B — ask headroom to ship a `dsh` target.** The honest framing for an upstream issue or pull request: dsh is an Anthropic-Messages client that reads `DEEPSEEK_BASE_URL`, so a `WrapTarget` needs one entry — binary `dsh`, `EnvVar("DEEPSEEK_BASE_URL", "anthropic")` — and nothing else. Two dsh-specific details belong in the report: dsh uses the **Files API** at `<base>/v1/files` for image offload, so the upstream base must serve it as well as `/v1/messages`; and dsh's tool names are not Claude Code's, so `CodeCompressor`-style verbatim protection for file reads will not trigger.

**Path C — in-process compression inside dsh: not available.** The loop builds its request, deep-freezes it, and a `prepend:true` global invariant rejects any divergence from the durable session derivation; the `llm/stream` waterfall can observe and route but not rewrite a loop-built request. The host's own precedent for shrinking model-visible content is _surface replacement_ — the tool-result pruner appends replacement `tool/result` events — which a plugin could imitate for tool results only. Whole-prompt compression stays out of process.

## Alternatives considered

- **Installing headroom's MCP server as a compression strategy.** It gives the model `headroom_compress`/`headroom_retrieve`, which is a tool the model must choose to call, not a reduction of what dsh sends. It complements the proxy; it does not replace it.
- **Adding a dsh dialect to our scanner for headroom.** The repository already scans correctly through the Claude Code and Copilot dialects. A new dialect would not make the hooks plugin useful, and the proxy path never enters our catalog at all.
- **Writing `DEEPSEEK_BASE_URL` from the plugin.** The host treats that name as bootstrap-only for a reason: a clone-supplied `.env` must not choose where every request goes. A plugin doing it indirectly would defeat that rule.

## Reproducing the probe

```sh
headroom proxy --port 8899 --anthropic-api-url http://127.0.0.1:8898   # recorder upstream
python3 /tmp/hr-probe/client6.py 8899                                  # dsh-shaped request
grep -E "content_router:|Transform content_router" ~/.headroom/logs/proxy-8899.log
tail -1 ~/.headroom/savings_events.jsonl
```

The probe scripts are under `/tmp/hr-probe`; headroom's own state (logs, CCR store, savings ledger) is under `~/.headroom`.
