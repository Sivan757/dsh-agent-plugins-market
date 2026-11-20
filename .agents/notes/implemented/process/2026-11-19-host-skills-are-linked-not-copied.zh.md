# Agent Note: 用链接消费宿主 skills，而不是复刻

Status: implemented

## Problem

本仓库在 `.agents/skills/` 下带着两份宿主 skill 的复刻：`market-pre-push-checks` 是宿主 `dsh-pre-push-checks` 的改写，取自宿主 2026-09-12 的状态；`market-release` 是本仓库自己的发版流程手册的入口。复刻就是快照，仓库里没有任何东西察觉快照过期，而且它同时朝两个方向过期：

1. **宿主动了。** 2026-09-12 到 2026-11-17 之间，宿主的 `dsh-pre-push-checks` 增加了用户可见 UI 的评审规则、仓库脚本类型的规则和 Vitest 过滤参数的写法，宿主的 skill 集合也从 12 个涨到 22 个。复刻一份都没跟。
2. **本仓库动了。** 复刻的证据表还在把 `src/**`、`tests/**`、`tests/<area>.test.ts` 当作推送前的覆盖面，而 2026-10-11 测试迁到各自包旁边之后这些路径就已经不存在了。一份点名了不存在文件的 skill，读起来和点名了存在文件的 skill 一模一样。

两种漂移都没有被察觉。`check:refactor` 读的是代码树，而代码树本身是自洽的——过期的 skill 文件和当期的 skill 文件长得一样。

## Decision

本仓库不再自带任何 skill。`.agents/skills` 是指向宿主 skills 目录的链接，宿主 skill 的正文一个字都不在这里复制。

**链接。** `scripts/host-skills.mjs link` 按 `--source`、`DSH_HOST_SKILLS_DIR`、harness checkout（`~/workspace/deepseek-harness/.agents/skills`）、`dsh-workflow` 插件包（`~/workspace/agent-plugins/plugins/dsh-workflow/skills`）、以及 marketplace 状态里已安装的那份插件包（`~/.dsh/agent-plugins/.sources/`，给没有克隆宿主仓库的机器）的顺序解析宿主目录，把 `.agents/skills` 指向它。`prepare` 每次安装都跑一次链接，和注册 git hooks 同一套机制，因此新克隆和既有 checkout 落到同一状态。链接进 `.gitignore`：它指向的是这台机器上的一个路径，不是本仓库的一个事实。

**事实留在这里。** 宿主 skill 承载方法，承载不了本仓库的覆盖面。推送前的证据表搬进了 [AGENTS.md](../../../../AGENTS.md)，它点名的命令与路径和仓库真实的那一份只差一次编辑；发版流程本来就由 `Releases are workflow-owned` 这条约定和[流程手册](../../../../docs/developer/release/release-process.md)承载。

**门禁。** `check:host-skills` 在 `.agents/skills` 又出现文件时失败——这是关于仓库而不是关于机器的唯一一种漂移——并报告路由表里宿主已经不再发布的 skill。链接缺失或指空只算警告，下一次安装就修好。这条检查并入 `check:refactor`，于是复刻一旦回来，CI 就失败关闭。

## Alternatives considered

- **留着复刻，手工跟着刷新。** 本仓库之前就是这么做的，也正是它同时产生了上面两种漂移：宿主什么时候动，没有任何东西会说；本仓库自己的路径什么时候从复刻底下消失，也没有任何东西会说。
- **把宿主正文收进来，用清单重新生成。** 宿主的 skill 是按 harness 仓库写的——`pnpm run change-scope`、`pnpm run doc-sync`、`gh stack sync`、`apps/cli/tests/profiles/`——逐字复制会带进本仓库没有的命令；而一张替换清单只是把搬运的活换成第二份需要同步的文件。
- **只靠宿主插件投递，不做链接。** `dsh-workflow` 插件是这些 skill 的投递通道，但它不是每个 profile 都装了——默认 profile 只挂 base bundle——所以完全依赖它的仓库会在没装插件的机器上失去工作流 skill。链接让 skill 从项目根可达，插件那套集合也只差一个 `DSH_HOST_SKILLS_DIR`。
- **把宿主整个 skills 目录复制进仓库。** 那是一份面积更大的 vendored 快照，照样需要刷新流程。

## Consequences

- 本仓库的会话现在看到的是宿主当前的 skill——默认从 harness checkout 取 22 个——而不是两份停在九月的改写。
- 上游新增的 skill 在下一次 `pnpm install` 后就出现在这里，本仓库不需要任何改动。
- 本仓库自己的工作流事实住在 AGENTS.md 里，证据表和它点名的代码不会无声地各走各的。
- 链接是机器本地的：机器上没有宿主副本的贡献者拿不到 skill，拿到的是一条警告，不是失败的门禁；从 marketplace 装过工作流包的机器则从 marketplace 状态里取到那一份。
- 路由表里仍然写着 `dsh-doc`（插件包给文档 skill 的名字），而 harness checkout 发布的是 `dsh-doc-writing`。那段区块归插件的 `init-routing` 命令所有，所以检查只报告不匹配，不去改一块别人生成的区块。
