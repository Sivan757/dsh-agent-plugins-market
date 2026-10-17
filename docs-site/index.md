---
layout: home

hero:
  name: dsh-agent-plugins-market
  text: Your agent toolkit, inside DeepSeek Harness
  tagline: A one-stop skills, subagent, MCP and LSP manager inside DeepSeek Harness (DSH), compatible with Claude Code, Codex, Cursor, Kimi and other agent plugin layouts.
  actions:
    - theme: brand
      text: Get started
      link: /install
    - theme: alt
      text: User guide
      link: /docs/install
    - theme: alt
      text: GitHub
      link: https://github.com/Sivan757/dsh-agent-plugins-market
    - theme: alt
      text: npm
      link: https://www.npmjs.com/package/dsh-agent-plugins-market

features:
  - icon: 🧩
    title: Any skill repository works
    details: A Git repository holding skills/<name>/SKILL.md is discovered as a suite with no manifest to add.
  - icon: 🔑
    title: MCP OAuth with nothing to declare
    details: A remote MCP server that answers 401 starts RFC 9728 discovery, dynamic client registration and PKCE authorization in your browser. OAuth is on by default.
  - icon: 🎛️
    title: Per-server MCP control
    details: Override a declaration without editing its source, switch one tool off, and set the tool-call and startup timeouts.
  - icon: 📂
    title: Project resources on a switch
    details: Turn on Scan project Agent layouts to read skills, commands, roles, MCP servers and hooks from the project's own directories.
  - icon: 🖥️
    title: Per-workspace control
    details: Each workspace switches the six mounted surfaces, keeps its own filters, and saves a resource-window setup as a favorite.
  - icon: 🌐
    title: Bilingual by default
    details: Descriptions and documents show the original, a translation or both, and stay cached until you clear them.
---

<div class="home-shot">
  <img src="/assets/screenshot-workspace.png" alt="The Agent Plugins workspace inside the DeepSeek Harness Web GUI" />
</div>

<style>
.home-shot { max-width: 1152px; margin: 0 auto; padding: 0 24px 1rem; }
.home-shot img { width: 100%; border: 1px solid var(--vp-c-divider); border-radius: 12px; }
</style>

## What it solves

Add sources and install suites, create your own skills, commands and personas, and keep project-native resources in place. The workspace groups Market, Skills, Commands, Agent personas, MCP services, LSP servers and Hooks into seven tabs.

## Supported plugin layouts

| Layout                                     | Manifest                                                         |
| ------------------------------------------ | ---------------------------------------------------------------- |
| [agent-plugins](https://agent-plugins.org) | `plugin.json`                                                    |
| Claude Code market                         | `.claude-plugin/marketplace.json` + `.claude-plugin/plugin.json` |
| Universal                                  | `.plugin/plugin.json`                                            |
| Cursor                                     | `.cursor-plugin/plugin.json`                                     |
| Kimi                                       | `.kimi-plugin/plugin.json`                                       |
| Codex                                      | `.codex-plugin/plugin.json`                                      |
| Skill collection                           | none (flat `SKILL.md` directories)                               |

## Quick install

In the DSH Web GUI, open **Plugins** in the sidebar, press **Add plugin**, and enter `dsh-agent-plugins-market`. Then restart DSH and open **Settings → Agent Plugins**.

From a terminal instead:

```sh
dsh plugin --profile <name> add dsh-agent-plugins-market
```

Requires Node.js 22 or later and a DSH Web profile with the skill service. The [README](https://github.com/Sivan757/dsh-agent-plugins-market) lists the DSH host packages this plugin declares; feature availability depends on host services. See the [install guide](/install) for details.

## Learn more

- [User guide](/docs/install): installation, sources, storage, MCP, LSP, hooks, translation and settings.
- [Step-by-step install guide](/install)
- [Known compatible plugin marketplaces](/compatible-plugins)
- [FAQ](/faq)
