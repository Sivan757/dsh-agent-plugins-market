# Agent Note: 测试套件同时跑在 Windows 上

Status: implemented

## Problem

仓库里所有门禁都只跑 `ubuntu-latest`，因此没有人观察 `node:path` 中依赖宿主的那一半。依赖分隔符的缺陷就这样无声地进入评审：issue #50 背后的包含性守卫用宿主分隔符比较路径，在 Windows 上拒绝了每一个本地 marketplace 条目，而任何一次 Linux 运行都不可能暴露它。

加上这个 job 之后，又找出了同一类问题——这次出现在测试而非产品里。四个套件把临时根建在字面量 `/tmp` 下（在 Windows 上那是当前盘符上的 `\tmp`，并不存在，于是 `mkdtemp` 在任何断言运行之前就以 `ENOENT` 失败）。另外五处断言的是产品原生构造出来的路径的 POSIX 写法（`'/tmp/my-suite/data'` 对 `D:\tmp\my-suite\data`）、一条 POSIX 风格的 manifest 路径正则，以及一个只属于 POSIX 的文件权限。

## Decision

`.github/workflows/windows.yml` 在 `windows-latest` 上跑整套测试：安装，然后 `pnpm run test`，其 `pretest` 钩子会一并带上类型检查与 lint。触发条件是推送到 `main` 与 `dev`、指向这两者的 PR，以及 `workflow_dispatch`。

那些此前只在一个宿主上运行过的套件，现在改为按宿主路径规则推导断言，而不是把路径写死：临时根来自 `os.tmpdir()`，期望路径用 `join`/`resolve` 构造，唯一那处权限断言则明确声明它只属于 POSIX——Windows 上 `chmod` 只切换只读属性，权限位是 `0o666`。

## Consequences

分隔符或大小写假设现在会在它真正出错的那个平台上、在评审之前失败。代价是每次推送到集成分支、每个 PR 多一次安装加一次套件运行。

文件权限是 Windows 完全无法观察的唯一一项保证；它保持 POSIX 门控，而不是被削弱成一个到处都能通过、却什么都没检查的断言。

## Alternatives considered

**只跑 Windows 子集而不是整套。** 更便宜，但子集本身就是在猜平台假设会藏在哪儿：第一次全量运行里九个失败中有六个落在这样的子集本会覆盖的路径处理套件之外。

**保留 `/tmp` 字面量，在 job 里创建 `C:\tmp`。** 这能让测试通过，却没让它们可移植——下一个临时目录约定不同的宿主会再次把它们弄坏——而 `os.tmpdir()` 本来就是表达这件事的 API。

**在断言内部归一化分隔符。** 比较前把两侧折叠成 `/` 会掩盖产品真正产生的那个写法，而那恰恰是值得看见的东西。

## Testing

这个 job 本身就是它的测试：对上面列出的每一个 `/tmp` 根与 POSIX 断言，它都会在 `windows-latest` 上失败——每一处都是这样被发现的。`tests/paths.test.ts` 让分隔符规则本身在每个宿主上都被覆盖，因此即使某次改动只在 Linux 上被执行，win32 行为也仍然被钉住。
