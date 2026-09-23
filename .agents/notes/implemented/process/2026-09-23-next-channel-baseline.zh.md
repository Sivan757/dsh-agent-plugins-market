# Agent Note: 从预发布候选线解析对齐基线

Status: implemented

## Problem

对齐门禁从 `@deepseek-ai/dsh` 的 `latest` dist-tag 解析基线。这个假设如今描述的是家族真实发布流程的反面：发布脚本把每一个 prerelease（含 rc）都打到 `next`（`scripts/release/families.ts` 的 `distTagForVersion`），只有正式版才回指 `latest`。宿主运行 prerelease 线期间，`latest` 指向一条没人安装的旧线。

2026-09-23 实测：`latest` 指向 `0.1.5-rc.3`，而 `next` 指向 `0.1.7-rc.1`——这正是 harness 检出（`dsh-v0.1.7-rc.1`）、本机安装的 CLI、以及本机 profile（`$DSH_HOME/profiles/node_modules`）里全部能力包实际运行的版本。若把插件的 peer 合约对齐到 `latest`，发出的 peer 范围会排除唯一在用的宿主版本——正是这道门禁要防的失效，并且会直接拦住 0.8.0 发布。

被取代的 2026-09-22 决策以当天的证据评判 `next`：`next` 指向 `0.1.5-rc.3`，一条维护方不会发布的 prerelease。家族的发布流程如今表明，当时的评判描述的是一个瞬时状态，而当下的事实是流程规则本身。

## Decision

`scripts/check-host-alignment.mjs` 默认从 `@deepseek-ai/dsh` 的 `next` dist-tag 解析基线；`--channel` 可选其他 tag，`--host-version` 仍可显式钉住基线并跳过 registry。锚点包保持 `@deepseek-ai/dsh`——消费方实际安装的包，也是家族中唯一由自身 tag 追踪发布线的成员；能力包仍只做存活查询、不参与投票，它们的 `latest` tag 依旧是首次发布的占位值。

宿主发布首个正式版时，`latest` 重新变得正确；默认通道将在采纳正式版的同一次变更中移回。

## Alternatives considered

- **留在 `latest`，按 `0.1.5-rc.3` 出 peer。** 否决：peer 范围会排除插件实际运行的每一个宿主，这是门禁本要拦下的缺陷，而且会直接阻塞 0.8.0 发布。
- **在调用点写死 `--host-version 0.1.7-rc.1`。** 否决：它把门禁本应保持最新的值存了下来，理由与 2026-09-22 笔记否决签入基线文件时相同。
- **改用 `alpha` tag。** 否决：`alpha` 指向实验通道（`0.1.7-alpha.2`），领先于负责人实际安装的线；本插件追踪的是候选线，不是实验线。

## Consequences

- 宿主运行 prerelease 线期间，基线跟随消费方实际安装的版本，提交与发布验证的对象就是目标宿主。
- 宿主切出正式版后，`next` 冻结在最后一个 prerelease 上而 `latest` 继续前进；默认通道若留在 `next` 就会落后于已发布线，因此采纳正式宿主的同一次变更必须把默认通道移回 `latest`。
- 门禁在两条通道上都无法区分「有意停住」与「被遗弃的 tag」；registry 只回答已发布的事实。

## Related decisions

在通道问题上完整取代 [resolve the alignment baseline from the latest release line](2026-09-22-latest-release-line-baseline.md)：锚点包解析、两段供给规则、`--fix` 行为与三处门禁调用点全部沿用。它自身曾部分取代 [force the host dependency baseline to one release line before it can ship](2026-09-11-host-dependency-alignment-gate.md)，后者的其余规则继续有效。
