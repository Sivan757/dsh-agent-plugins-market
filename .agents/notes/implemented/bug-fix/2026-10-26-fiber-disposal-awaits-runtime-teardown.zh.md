# Agent Note: 入口插件 fiber 的销毁会等待运行时收尾完成

Status: implemented

## Problem

市集入口从 `apply()` 返回后，它构建的运行时仍在工作。一次 reconcile 排在其后，每个 stdio MCP 挂载都在服务器连接之前创建插件数据根下的 `${PLUGIN_DATA}` 目录，卸载时还会销毁桥接并等待它启动的子进程。生命周期 effect 的销毁函数启动了这些工作就返回：`void runtime.dispose().catch(...)`。于是 Cordis 在运行时仍在读写数据根时就宣告 fiber 已卸载，因为不返回任何东西的销毁函数按定义已经完成。

症状是间歇的，并且落在测试门上而不是用户身上，出现在跑 Windows 的那个 job。`windows` 在 `108b3a6` 上失败两次，run 40271411304（pull_request）与 run 40271047459（push），同一个测试、同一个错误；`cdf8736d` 上同样失败；同一范围内的 `7e8e1eb`、`dc5a9e7`、`dca46d2`、`375524d`、`ded5123`、`e9788490` 都通过。出错的是 `packages/market-bundle/test/integration/host-service-seam.test.ts` 的 `afterEach`：

```text
Error: ENOTEMPTY: directory not empty, rmdir C:\Users\RUNNER~1\AppData\Local\Temp\market-host-service-HDAsRy\agent-plugins
```

`fs.rm` 遍历该临时根时，运行时还在其下写入。Windows 删除仍被句柄打开的文件时只是把它标记为 delete-pending，目录项还会短暂可见，于是 `rmdir` 对一次调用刚清空的目录返回 `ENOTEMPTY`。POSIX 主机立即移除目录项，所以只有一个平台报错，也所以它看起来像平台问题而不是生命周期问题。

失败开始出现时，两个在飞行中的改动放大了这个窗口。PR #131 让销毁过程执行 hook 命令，PR #132 让卸载并行。两者都没有制造该缺陷：这个 fire-and-forget 调用是 2026-10-08 拆分私有域工作区时引入的。

## Decision

入口的生命周期 effect 返回异步销毁函数，并等待运行时的收尾。Cordis 会等待被收集的销毁函数返回的 promise（`Fiber._unload` 逐个 await），因此 fiber 只在挂载全部消失之后才进入已卸载状态。

销毁函数按此顺序执行：置入口自己的 `disposed` 标志，停止 reconcile 调度器（它的标志同步改变，并返回仍在飞行中的那一趟），关闭后台源更新，释放 settings 命名空间与语料缓存状态，等待 `runtime.dispose()`，最后等待调度器那趟仍在跑的 pass。运行时排在调度器 join 之前，好让它自己的停止标志使排队中的 pass 提前退出，而不是阻塞那次 join。

检查后保持同步的三个同级销毁函数是 `MarketSettingsNamespace.dispose()`（释放 watcher）、`SourceAutoUpdater.dispose()`（解除定时器）与 `Catalog.dispose()`（转给翻译缓存与快照缓存，两者各自取消自己的定时器）。

`os.tmpdir()` 下的测试临时根现在统一走 `packages/market-bundle/test/integration/helpers/temp-root.ts` 里的 `removeTempRoot`，它按 `packages/market-translation/test/translation-localizer.test.ts` 已有的做法向 `fs.rm` 传入 `maxRetries: 5, retryDelay: 20`。重试吸收的是已等待收尾之后句柄释放的滞后。它不是让收尾正确的原因：超出 fiber 生命周期的写入者仍会在预算耗尽后失败，而那正是测试应当给出的信号。

## Consequences

profile 重载或宿主关闭现在会等待运行时挂载卸载完成，耗时受各桥接自身关闭路径约束，而不是立即返回。换来的是："已卸载"意味着该插件不能再写入数据根，因此下一个移除该根的调用方，无论是测试收尾、profile 重载还是卸载，都不会与插件竞争。

集成测试的临时根不再依赖 Windows 释放目录项的快慢。未等待的写入者仍算失败：5 次 20 ms 的重试覆盖不了一个永远不会结束的 fiber。

## Alternatives considered

**保留 fire-and-forget 调用，只给收尾加重试。** 重试会吸收这个测试里的竞争，却让数据根的其它所有使用者继续暴露：profile 重载、卸载或宿主关闭仍会在插件还在写入时返回。它还把真实缺陷变成依赖时序的通过，而这正是本记录要防的失败模式。

**在测试的 `afterEach` 里轮询或睡眠，直到目录树不再变化。** 对未指定的写入者等待，无法区分收尾慢和收尾泄漏；而且测试需要的这个顺序属于插件，不属于某一个测试的清理。

**把入口的销毁函数也改成等待每个同级，方法是放宽它们的签名。** 先检查过：settings、自动更新与 catalog 的销毁函数都是同步的，也不留定时器，没有可等待的东西。

**把等待运行时收尾放进 reconcile 调度器的 dispose，让入口保持立即返回。** 调度器并不拥有挂载；fiber 自身的卸载才是 Cordis、测试与 loader 都同意插件已完成的那个点。

## Testing

`host-service-seam.test.ts` 新增 "finishes the runtime teardown before the entry fiber reports unloaded"。该用例用一道闸门把运行时的收尾挂住，并断言两件事：闸门关闭期间入口的 `dispose()` promise 尚未落定；`await entry.dispose()` 之后，收尾在临时数据根下做的写入已经落盘。把销毁函数退回 `void runtime.dispose()` 会在第一条断言上失败，所以造成该间歇失败的那种写法无法通过它。

这个用例抓不到的是：运行时内部本身是 fire-and-forget 的收尾路径，今天包括 `TranslationLocalizer.dispose()` 的 `void this.flush()` 与 `SourceAutoUpdater` 让飞行中的源刷新自行结束；以及已等待收尾之后 Windows 释放句柄的滞后，后者由重试预算吸收而不是证明。
