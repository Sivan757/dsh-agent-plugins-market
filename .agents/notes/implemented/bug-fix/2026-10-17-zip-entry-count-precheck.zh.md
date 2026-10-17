# Agent Note: 在解压之前拒绝超限 zip

Status: implemented

## Problem

`extractZip` 在 fflate 的 `onfile` 回调里计条目数，那条 20,000 条的上限只有在 fflate 走到该条目时才可执行。fflate 解析整包 zip(含中央目录)用的是递归，于是数万个极小成员的 zip 会在单次 `push()` 内把 JavaScript 栈压爆，计数器还来不及拒绝。调用方看到的是 `Maximum call stack size exceeded`，而不是契约承诺的条目超限拒绝，且整个压缩包已被读进内存。

## Decision

`extractZip` 在构造解压流之前先从中央目录结束记录里读出条目数，声明数超过上限时抛出同一条条目超限错误。记录不可读、或计数为 `0xffff`(交由 zip64)时，回落到既有的流式守卫；该守卫保留为「记录低报」情况的判据。

## Alternatives considered

- **手写遍历中央目录计数。** 否决：为一个上界重新实现 zip64 与多磁盘处理，而声明计数已经回答了上限要问的问题。
- **给流加大栈。** 否决：它只是把失败点推到更大的压缩包，而不是加上边界。
- **捕获栈溢出后改写为超限错误。** 否决：它报告的是猜出来的原因，而且仍然把整包留在内存里。

## Consequences

- 超限 zip 在解压前被拒绝，内存占用因此有界。
- 低报条目数的 zip 仍由流式守卫拦下。
- 超限的 zip64 包由流式守卫拒绝，而不是预检查：记录里的 `0xffff` 计数被有意视为未知。

## Related decisions

无。这是[归档扫描器](../../../../packages/market-catalog/src/scanning/archive.ts)内部的局部守卫。
