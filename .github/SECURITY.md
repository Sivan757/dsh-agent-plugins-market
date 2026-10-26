# Security Policy / 安全政策

## Supported versions / 支持版本

Security fixes are prioritized for the `main` branch and the latest published release.

安全修复优先覆盖 `main` 分支和最新发布版本。

| Version or branch / 版本或分支 | Security support / 安全支持                                   |
| ------------------------------ | ------------------------------------------------------------- |
| `main`                         | Supported / 支持                                              |
| Latest published release       | Supported / 支持                                              |
| Older releases                 | Best effort only; please upgrade first / 仅尽力支持，请先升级 |

## Reporting a vulnerability / 报告漏洞

**Please do not open a public issue for a security vulnerability.** Use GitHub's private reporting flow:

**请不要在公开 issue 中报告安全漏洞。** 请使用 GitHub 私密报告流程：

[Report a vulnerability privately / 私密报告漏洞](https://github.com/Sivan757/dsh-agent-plugins-market/security/advisories/new)

If private vulnerability reporting is unavailable, send a private message to [@Sivan757](https://github.com/Sivan757) on GitHub and state that the message is a security report. Do not include secrets in the first message unless they are essential and have been redacted where possible.

如果私密漏洞报告功能不可用，请在 GitHub 私下联系 [@Sivan757](https://github.com/Sivan757)，并注明这是安全报告。除非确有必要，不要在首条消息中包含秘密信息；如必须提供，请尽可能先脱敏。

Please include as much of the following as you can safely share:

请尽可能安全地提供以下信息：

- A short description and the affected component or route / 简短描述，以及受影响的组件或路由
- Impact and an assessment of exploitability / 影响范围与可利用性评估
- A minimal reproduction or proof of concept / 最小复现步骤或概念验证
- Affected version, commit, or configuration / 受影响的版本、提交或配置
- Runtime and operating-system information / 运行时与操作系统信息
- Suggested mitigation or patch, if available / 如有可行方案，请提供缓解措施或补丁建议

Before sending logs, remove tokens, cookies, private URLs, local paths, session content, and any other confidential data.

发送日志前，请删除 token、cookie、私有 URL、本地路径、会话内容和其他机密数据。

## Response process / 处理流程

- We aim to acknowledge a report within seven calendar days when practical.
- Maintainers will validate the report, assess severity, coordinate a fix, and communicate next steps through the private channel.
- Disclosure timing is coordinated with the reporter. Please do not publish details until a fix or mitigation is available.
- The reporter will be credited in release notes only with explicit permission.

- 在条件允许时，我们会争取在七个自然日内确认收到报告。
- 维护者会验证报告、评估严重性、协调修复，并通过私密渠道沟通后续步骤。
- 披露时间会与报告者协调；在修复或缓解措施可用前，请不要公开细节。
- 只有在获得明确许可后，才会在发布说明中致谢报告者。

## Accepted dependency risk / 已接受的依赖风险

One open Dependabot alert is accepted, not fixed.

有一条 Dependabot 告警属于已接受风险，不修复。

| Advisory                                  | Required fix | Accepted at | Why                                                           |
| ----------------------------------------- | ------------ | ----------- | ------------------------------------------------------------- |
| zod high severity, versions below `4.6.6` | `4.6.6`      | `4.4.3`     | The host pins zod exactly, and one physical copy is required. |

The DeepSeek Harness host family declares zod `4.4.3` exactly. Measured with `npm view <package>@0.2.1-rc.3 dependencies.zod` on 2026-10-26, every one of these packages reports `4.4.3`: `@deepseek-ai/dsh-agent-loop`, `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-session-projection`, `@deepseek-ai/dsh-client-ui-plugin-manager`, and `@deepseek-ai/dsh-experimental-agent-team`.

DeepSeek Harness 宿主系列把 zod 精确锁定在 `4.4.3`。2026-10-26 用 `npm view <package>@0.2.1-rc.3 dependencies.zod` 实测，以下每个包都报告 `4.4.3`：`@deepseek-ai/dsh-agent-loop`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-session-projection`、`@deepseek-ai/dsh-client-ui-plugin-manager`、`@deepseek-ai/dsh-experimental-agent-team`。

`pnpm-workspace.yaml` overrides zod to `4.4.3` on purpose. A plugin schema crosses into the host's `ProjectionDefinition`. A second physical zod copy makes the host's `ZodType` nominal, so the plugin's schema stops matching it.

`pnpm-workspace.yaml` 有意把 zod override 为 `4.4.3`。插件 schema 会进入宿主的 `ProjectionDefinition`；第二份 zod 副本会让宿主的 `ZodType` 变成名义类型，插件 schema 将不再匹配。

Raising this override to `4.6.6` breaks the host contract described above. Closing the alert needs a host release that moves the whole family to `4.6.6`, not a change in this repository.

把该 override 提到 `4.6.6` 会破坏上述宿主契约。关闭这条告警需要宿主发布、把整个系列移到 `4.6.6`，而不是在本仓库改。

## Security scope / 安全范围

Reports are especially valuable for issues involving source checkout isolation, path traversal, manifest parsing, HTTP route authorization, hook or MCP mounting, dependency supply chain risks, credential exposure, or generated release artifacts. Third-party marketplace content may be untrusted; review it before enabling a suite.

涉及源 checkout 隔离、路径穿越、清单解析、HTTP 路由授权、hook 或 MCP 挂载、依赖供应链风险、凭据泄露或发布构建产物的问题尤其值得报告。第三方市场内容可能不受信任；启用套件前请先审阅。

For non-sensitive bugs and hardening suggestions, use the normal [bug report form](https://github.com/Sivan757/dsh-agent-plugins-market/issues/new?template=bug_report.yml) after removing sensitive details.

对于非敏感 bug 和加固建议，请在删除敏感细节后使用普通的[问题报告表单](https://github.com/Sivan757/dsh-agent-plugins-market/issues/new?template=bug_report.yml)。
