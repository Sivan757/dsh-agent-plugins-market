# Agent Note: 声明宿主支持窗口，而不是 caret 锚点

Status: implemented

## Problem

所有面向消费方的宿主 pin 都带 `^<baseline>`，基线取自当时 `next` dist-tag 指向的版本。prerelease 上的 caret 是锚点而不是契约：`^0.2.1-rc.2` 接受 `0.2.1-rc.2` 及更晚，却拒绝 `0.2.1-rc.1`——宿主前一天刚发布的候选。

宿主会强制执行这份声明。启动时若存在 `engines.dsh` 就只看它，否则逐个检查 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` peers，并允许 prerelease(harness `packages/boot/app-boot/src/plugin-compatibility.ts`)。范围不满足时，插件管理页把该行标为异常，并警告运行可能导致崩溃或数据丢失。2026-10-17 实测：已安装的桌面宿主是 `0.2.1-rc.1`，pin 的 peer 范围是 `^0.2.1-rc.2`，两者不兼容。同一棵树还必须继续在 `0.2.0-rc.2` 上工作，而指向更晚补丁的 caret 永远无法接受它。

## Decision

`scripts/check-host-alignment.mjs` 声明一个支持窗口 `>=0.2.0-rc.2 <0.3.0-0`，每个 peer 与自供 dependency 原样携带它。

- 下界是这份代码能运行的最老宿主版本，只在有意放弃某条线时移动。
- 上界排除下一个大版本及其 prerelease：用 `<0.3.0-0` 而不是 `<0.3.0`。
- `devDependencies` 保留 `next` 通道解析出的精确基线，因为这份镜像是本仓库构建与测试的对象。
- 解析出的基线落在窗口外时门禁失败，于是推进到上界之外的通道会拦住发布，而不是静默钉入一个发布范围本身就拒绝的版本。

## Alternatives considered

- **保留 caret，为每个宿主候选发一次版。** 否决：等于把每个宿主候选变成一次插件发版，而且仍然无法同时支撑两条线。
- **声明 `*` 或 `>=0`。** 否决：它声称支持从未运行过的宿主线，正是门禁要防的失败模式。
- **只依赖 `engines.dsh`。** 否决：宿主把已声明的 `engines.dsh` 当作唯一判据并忽略 peers，而本门禁读的是 peers；加上它会造出第二个门禁无法核对的真相来源。peers 仍是声明的契约。
- **改宽范围但不改门禁。** 否决：下一次 `--fix` 会把窗口写回 caret，因此策略必须落在门禁里，而不是注释里。

## Consequences

- 下界与上界之间的宿主候选无需本仓库发版即可工作，这正是范围的意义。
- 放弃一条宿主线变成对 `HOST_SUPPORT_FLOOR` 的显式编辑，评审可见。
- 跨越 `0.3` 必须移动 `HOST_SUPPORT_CEILING`，否则门禁拒绝对齐。
- 声明的窗口比任何单个已验证宿主更宽：下界由已发布的 `0.2.0-rc.2` 测试结果验证，上界由当前基线验证；其间的版本是声明，不是测试结论。

## Related decisions

部分取代[在发布前把宿主依赖基线锁定到一条发布线](../process/2026-09-11-host-dependency-alignment-gate.md)中的 pin 规则；其检测面、修复机制与三处门禁调用点继续有效。保留[从 prerelease 候选线解析对齐基线](../process/2026-09-23-next-channel-baseline.md)的通道默认值，该决定现在只决定 dev 镜像。
