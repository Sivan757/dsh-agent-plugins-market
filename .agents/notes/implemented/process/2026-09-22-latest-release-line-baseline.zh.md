# Agent Note: 以 latest 发布线解析对齐基线

Status: implemented

## Problem

门禁原先逐包读取每个已声明能力包的 `next` dist-tag 作为基线，理由是家族发布在 `next` 而 `latest` 落后。这个 tag 一旦 harness 切出 prerelease 就会移动，无论那条 prerelease 是不是本插件该跟的发布线。2026-09-22 当天，家族的 `next` 指向 `0.1.5-rc.3`（已发布到注册表、tarball 可解析），而维护方不会发布这个版本，`@deepseek-ai/dsh` 的 `latest` 仍指向 `0.1.5-rc.2`，harness checkout 及其 tag 也停在 `dsh-v0.1.5-rc.2`。于是门禁拦下了每一次提交，并会在发布时失败，而针对的是一个没人发布的版本。

只切换 channel 也修不好，因为能力包并没有有意义的 `latest`。同一天实测：十三个包（含 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-llm`）是 `0.0.1-rc.1`，`@deepseek-ai/dsh-home-paths` 是 `0.0.1-rc.3`，`@deepseek-ai/dsh-hooks-claude-code` 是 `0.0.1-rc.5`，`@deepseek-ai/dsh-client-store` 是 `0.1.2-alpha.2`。每个包只在首次发布时写过一次 `latest`，此后都迁到 `next`，因此家族在四个占位版本上互相分歧，守护旧解析方式的一致性规则会直接拒绝这个 channel。

## Decision

`scripts/check-host-alignment.mjs` 从 `@deepseek-ai/dsh` 的 `latest` dist-tag 解析基线——它是消费方实际安装的 CLI 包——并要求声明的或引用的每个 `@deepseek-ai/dsh-*` 包都携带这一个版本。默认 channel 由 `next` 改为 `latest`；`--channel` 仍可选择其他 tag，`--host-version` 仍可显式指定基线并跳过注册表。

家族一致性规则被删除。能力包仍会被查询，因此注册表答不出的声明名会明确报错，但它们不再对基线投票：它们的 `latest` 是首次发布的占位值，不是发布事实，只有锚点包能给出已发布的发布线。

## Alternatives considered

- **保留 `next` 并接受 `0.1.5-rc.3`。** 由负责人否决：那条 prerelease 不会被发布，门禁会要求一条没人发布的线，并一直拦住提交直到 tag 再次移动。
- **逐包 `latest`，各投一票。** 否决：实测家族在四个占位版本上分歧，这条规则会把每次运行变成解析失败而不是比较。
- **在三处调用点写死 `--host-version 0.1.5-rc.2`。** 否决：它把门禁本应保持最新的值存了下来，且下次发布要在三处手工修改。当初否决签入基线文件的理由仍然成立。
- **取家族中的最高版本。** 否决：那是从互不相关的 tag 里臆造发布线，还会把插件对齐到一次 `alpha` 发布。

## Consequences

- 基线跟随维护方发布为 `latest` 的版本，因此 `next` 上的 prerelease 不再单独拦住提交或发布。
- 若 `latest` 停止移动，基线就冻结。门禁分不清这是有意暂停还是 tag 被弃用，pin 只在维护方移动 `latest` 时前进。
- 门禁不再发现 `next` 上的部分发布，因为能力包的 tag 之间不再互相比较。某个包与其兄弟包脱节发布时，会在安装或运行阶段暴露。
- `--channel next` 仍可用于对 prerelease 线做一次有意检查，`--host-version` 覆盖离线场景。

## Related decisions

部分取代 [force the host dependency baseline to one release line before it can ship](2026-09-11-host-dependency-alignment-gate.md)：三处门禁、六条规则、两个供给段与 `--fix` 行为继续有效；由哪个 tag 定义基线、能力包是否参与投票，由本篇改定。
