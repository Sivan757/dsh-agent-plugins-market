# Agent Note: 入口插件 fiber 的销毁会等待它启动的每一次收尾

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

出口上的每个销毁函数都遵循同一条规则：必须同步停止的立即停止，并把它启动的那件工作的 promise 返回给调用方。等待它的调用方因此知道不会再有写入到来。

入口的生命周期 effect 把这条规则用在四件事上。置自己的 `disposed` 标志，停止 reconcile 调度器（标志同步改变，并返回仍在飞行中的那一趟），关闭后台源更新（同步解除，并返回已经在刷新的那一趟），释放 settings 命名空间，然后依次等待运行时的收尾、catalog 的收尾、调度器那趟 pass 与源更新那趟 pass。运行时排在最前，好让它自己的停止标志使排队中的 reconcile 提前退出，而不是让调度器的 join 等它。

这份清单背后有三个写入者，各自把 promise 交给上一层：

- `ReconcileScheduler.dispose()` 返回它在飞行中的那一趟。那一趟会创建每个 stdio 挂载的 `${PLUGIN_DATA}` 目录并挂载服务器。
- `Catalog.dispose()` 等待 `TranslationService.dispose()`，后者等待 `TranslationLocalizer.dispose()`，而它返回 `flush()`。只要一次完成的 provider 调用把缓存标脏，这次 flush 就会在插件数据根下写 `translation-cache.json`。`SnapshotCache.dispose()` 保持同步：它只清除 keep-warm 定时器。
- `SourceAutoUpdater.dispose()` 返回它发现仍在运行的刷新那一趟。那一趟会在 `<userRoot>/agent-plugins/.sources` 下克隆源检出并提交状态，所以先宣告已卸载的 fiber 会让它继续写在那里。

只有 `MarketSettingsNamespace.dispose()` 保持同步且无可返回：它释放 watcher，也不安排任何东西。

`os.tmpdir()` 下的测试临时根现在统一走 `packages/market-bundle/test/integration/helpers/temp-root.ts` 里的 `removeTempRoot`，它按 `packages/market-translation/test/translation-localizer.test.ts` 已有的做法向 `fs.rm` 传入 `maxRetries: 5, retryDelay: 20`。重试吸收的是已等待收尾之后句柄释放的滞后。它不是让收尾正确的原因：超出 fiber 生命周期的写入者仍会在预算耗尽后失败，而那正是测试应当给出的信号。

## Consequences

profile 重载或宿主关闭现在会等待运行时挂载卸载完成，耗时受各桥接自身关闭路径约束，而不是立即返回。换来的是："已卸载"意味着该插件不能再写入数据根或用户根，因此下一个移除其中任一目录的调用方，无论是测试收尾、profile 重载还是卸载，都不会与插件竞争。

本地化器与源更新器自己的调用方也一起改变了。`TranslationService.dispose()` 与 `Catalog.dispose()` 返回 promise，所以每个销毁 catalog 的调用方都会等待它；入口的收尾用 `ctx.logger` 报告失败的那一个，并继续排空其余，与它报告运行时收尾失败的方式相同。`SourceAutoUpdater.dispose()` 的定时器解除仍然同步，因此不等待地停掉更新器仍然能停掉 tick；新增的只是对在飞行中那一趟的 join。

集成测试的临时根不再依赖 Windows 释放目录项的快慢。未等待的写入者仍算失败：5 次 20 ms 的重试覆盖不了一个永远不会结束的 fiber。

## Alternatives considered

**保留 fire-and-forget 调用，只给收尾加重试。** 重试会吸收这个测试里的竞争，却让数据根的其它所有使用者继续暴露：profile 重载、卸载或宿主关闭仍会在插件还在写入时返回。它还把真实缺陷变成依赖时序的通过，而这正是本记录要防的失败模式。

**在测试的 `afterEach` 里轮询或睡眠，直到目录树不再变化。** 对未指定的写入者等待，无法区分收尾慢和收尾泄漏；而且测试需要的这个顺序属于插件，不属于某一个测试的清理。

**把入口的销毁函数也改成等待每个同级，方法是放宽它们的签名。** 在弄清真正启动异步写入的两个之后，由后续改动完成：本地化器的 flush 与源更新器在飞行中的刷新。settings 命名空间没有可等待的东西，因此保持同步。

**因为写入罕见，就让本地化器与源更新器保持 fire-and-forget。** 它们恰好只在卸载时有一次调用或一次 tick 正在飞行中时才触发，而那正是收尾最可能与它们竞争的时机：一个翻译过的测试、一次发生在后台刷新期间的 profile 重载。罕见正是这种竞争表现为间歇而不是可复现的原因。

**把等待运行时收尾放进 reconcile 调度器的 dispose，让入口保持立即返回。** 调度器并不拥有挂载；fiber 自身的卸载才是 Cordis、测试与 loader 都同意插件已完成的那个点。

## Testing

四个用例钉住这条规则，做法都是把工作挂在闸门后面，并断言闸门关闭期间调用方尚未落定。每一个都观察到在移除等待后失败、恢复后通过。

- `host-service-seam.test.ts` 的 "finishes the runtime teardown before the entry fiber reports unloaded" 挂住 `RuntimeReconciler.prototype.dispose`。把入口的销毁函数退回 `void runtime.dispose()` 会让它失败。
- `host-service-seam.test.ts` 的 "finishes the catalog teardown before the entry fiber reports unloaded" 挂住 `Catalog.prototype.dispose`。把入口那一行退回 `void catalog.dispose()` 会让它失败，这证明的是接线，而不只是 catalog 自己的 promise。
- `translation-dispose.test.ts` 的 "settles only after the cache write it started landed" 替换 `saveTranslationCache` 并把它挂住。把 `TranslationLocalizer.dispose()` 退回 `void this.flush()` 会让它失败。同文件的第二个用例钉住干净的本地化器根本不写缓存文件，因此第一个用例不是靠一次本来就会发生的写入通过的。
- `source-auto-update.test.ts` 的 "settles only after the pass already running finished its write" 挂住一趟刷新，并同时断言定时器已停止。把 `SourceAutoUpdater.dispose()` 退回成 void 解除会让它失败。

每个用例都用 `Promise.resolve(调用方())` 读取闸门，因此不返回任何东西的销毁函数按"返回即完成"处理，而不是在 `undefined.then` 上抛错。

这些用例抓不到的是：在销毁已经落定之后才落地的一次翻译。`TranslationLocalizer` 会通过 `scheduleFlush` 的已销毁分支立即写入这样的答案，这是刻意的设计，好让已经付费的 provider 调用不会因卸载而丢失；没有任何所有者能等待在其收尾返回之后才开始的工作。因此剩下的未受观察的写入者是"卸载之后才完成的 provider 调用"，它属于该设计选择的性质，而不是某个销毁函数的性质。同样无法在此证明的是：已等待收尾之后 Windows 释放句柄的滞后，后者由重试预算吸收而不是证明。
