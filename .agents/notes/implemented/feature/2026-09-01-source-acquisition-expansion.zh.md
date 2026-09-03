# Agent Note: 来源获取扩展——收编、克隆提速与压缩包源

Status: implemented

## Problem

三个用户可见的缺口共享同一根源：来源获取。（1）无法通过 UI 访问 GitHub 的用户（代理受限网络）只能手动 `git clone` 到 `~/.dsh/agent-plugins/.sources/`，但用户维度只扫描 `state.json` 里登记过的 source，这些目录在界面上不可见——而且通过 UI 重新添加同一 URL 会发明一个 `-2` 后缀的 id 并二次克隆，而不是收编现有目录。（2）克隆只是一条裸 `git clone --depth 1`：固定 120 秒超时，无代理、无镜像、无重试，僵死传输不会尽早失败，且 `git pull --ff-only` 对 shallow 仓库不友好。（3）Claude Code 市场支持的获取类型本插件不全具备——最显著的是 `{ source: "archive", url, sha256? }` HTTPS zip 载荷——Codex 则只支持本地路径与 git URL；而本项目的来源模型只有两种 kind（git、local）。

## Decision

一个三 kind 的获取层，`resolveSourceKind` 是唯一权威（显式 `kind` 优先，遗留 `local` 标志映射为 `'local'`，压缩包形态的 URL 推断为 `'archive'`，其余为 `'git'`）：

- **收编（手动克隆修复）。** `addSource` 先检查候选 id 的 checkout 目录：若某目录的 `origin` remote 与输入 URL 在 `canonicalGitUrl` 规范形下相等，则原样登记为 `adopted: true`——不克隆、不改名、不发明 id。`sources/adopt` 显式登记任意未托管的 `.sources/` checkout（非 git 目录落为 `local` 源）。overview 载荷上报 `unmanaged` checkout，客户端渲染收编条。收编源与 local 源是用户拥有的目录：`removeSource` 与 URL 变更永不删除它们。
- **Git 提速。** `GitOptions` 随宿主配置下发：`proxy`（以 `-c http.proxy/https.proxy` 注入）、`insteadOf` URL 重写（镜像加速）、`timeoutMs`、`cloneRetry`（失败自动重试一次，默认开）、`fallbackTarball`（默认关——GitHub 克隆失败后经压缩包管线回退下载 codeload `tar.gz`）。所有触网调用注入 `GIT_HTTP_LOW_SPEED_LIMIT/TIME`，僵死传输尽早失败。更新改用 `fetch --depth 1` + `reset --hard FETCH_HEAD`（shallow 安全、幂等）取代 `git pull --ff-only`，分支从源配置或 checkout 当前分支解析。
- **压缩包源。** `catalog/archive.ts` 经 HTTPS 下载（`allowHttpArchives` 才允许明文 http），256 MiB 上限，校验可选 `sha256`，解压 zip（fflate）或 tar.gz/tar（系统 `tar`），带 zip-slip 防护（条目名校验、zip 不落符号链接、解压后符号链接逃逸巡检），剥掉单层顶层包装目录后换入 `.sources/<id>`。下载摘要即源的锁值（不存在 git HEAD）。刷新即重新下载换入。

状态兼容：`kind`、`sha256`、`adopted` 是 `state.json` 的可选字段；`version` 保持 1。Wire：`SourceOverview` 增加 `kind`/`adopted`，overview 载荷增加可选 `unmanaged`，`sources/adopt` 进入路由表。

## Alternatives considered

- **自动把未托管 checkout 作为临时源扫描**（project 维度式）被推迟：会把垃圾目录与重复仓库在用户无意的情况下推成卡片；显式收编条让发现可见、登记仍是用户决定。
- **`addSource` 的 URL 级去重**（拒绝已注册同 URL）未加入——会改变现存的容忍重复语义；真实场景已由收编覆盖。
- **免依赖的系统 `unzip` 路径**被否决：原生 Windows 无 `unzip` 且旗标不一；fflate 零原生依赖且体积小。tar.gz 复用各目标平台自带的系统 `tar`。
- **压缩包刷新的 ETag/If-None-Match 短路**被推迟：摘要钉已避免钉定源的无效安装，重新下载语义保持简单。

## Risks

- 压缩包下载有 SSRF 邻近风险：默认仅 HTTPS 且 256 MiB 上限兜底，`allowHttpArchives` 是对内网镜像的显式信任决定。
- tarball 回退产出的是非 git checkout；其「锁提交」是 sha256 十六进制而非 commit——下游必须把 `lockCommit` 当不透明令牌（现状已经如此）。
- 更新时的 `reset --hard` 丢弃受管 checkout 的工作树漂移；这对只读输入源是预期语义，但原地改过 checkout 的用户会意外。

## Verification

- `tests/source-acquisition.test.ts`：kind 推断、压缩包 URL 的 id 派生、codeload URL 映射、状态往返、经本地 HTTP 服务器的下载/校验/解压/剥壳/zip-slip/tar.gz 管线、收编列举/幂等收编/git+local 登记/移除保留用户目录。
- `tests/routes.test.ts` 覆盖路由表；`tests/skills-provider.test.ts` 钉住 local 源的持久化形态。
- `pnpm run check:refactor` 与全量 vitest 均绿。
