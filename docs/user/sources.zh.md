# 来源

[English](sources.md) | 简体中文 | [README](../../README.zh.md)

**Guide:** [安装](install.md) · [来源](sources.md) · [自建资源](resources.md) · [服务](services.md) · [翻译](translation.md) · [设置](settings.md) · [工作区](workspace.md)

## 配置市场源

有一个来源不需要配置：插件为第一方套件集合仓库预置了一条记录，id 为 `dsh-agent-plugins`。它与其他 Git 来源完全一致——点**刷新**克隆并列出其中的套件，然后在市场页安装、停用或删除。登记本身不发起网络访问，因此刚登记的来源在首次刷新前显示为未克隆；并且与通过配置预置的来源一样，删除它会被下次激活撤销。

其余来源由你自己添加。源持久化在 `~/.dsh/agent-plugins/state.json`，也可用 cordis 配置预置（也是“持久种子”，启动时自动补齐缺失源）：

```yaml
- id: dsh-agent-plugins-market
  config:
    sources:
      - { id: agent-plugins, url: 'https://github.com/Sivan757/agent-plugins.git' }
      - { id: claude-plugins-official, url: 'https://github.com/anthropics/claude-plugins-official' }
      - { id: knowledge-work-plugins, url: 'https://github.com/anthropics/knowledge-work-plugins' }
```

`local: true` 的源直接读取本地目录（实时反映工作树，移除源时不会删除目录）。扫描结果会缓存最多 30 秒，并在安装/启用/面板切换等操作间复用，因此本地源的工作树改动会在下一次缓存刷新时可见（任何源变更、刷新按钮，或 30 秒 TTL 到期）。启动挂载和用户技能枚举只扫描包含已启用安装的源；浏览市场仍发现全部配置源。并发读取共享扫描任务。启动不会拉取 Git 更新；来源刷新需显式触发，除非开启**后台自动更新来源**。`archive` 源下载 HTTPS 压缩包（`.zip` / `.tar.gz` / `.tgz` / `.tar`，256 MiB 上限，可选 `sha256` 完整性校验）并解压为 checkout。

安装、启用与 surface 开关在状态写入后立即返回。随后的挂载（MCP 服务、Hook、命令、LSP 服务）在后台协调，由各状态面板展示结果：慢启动的服务不会把开关一直挂在那里。

## 手动克隆、收编与网络调优

界面上克隆超时？你可以自己把仓库克隆到 checkout 根（`~/.dsh/agent-plugins/.sources/<id>/`）——市场页会在「未登记的本地仓库」中列出它，并提供一键**收编**：原样登记、不重新克隆、不改名；只有你之后删除该源并勾选「同时删除市场目录」时，目录才会被删除。在 UI 里添加 URL 时，若已存在 `origin` 匹配的 checkout，也会自动收编而不是二次克隆。收编源在界面上与普通源完全一致，不带额外徽标。

市场页顶部的源胶囊是等宽网格：默认折到两行、底部渐隐，鼠标悬停或键盘聚焦时以浮层展开，卡片区不会跳动；选中某个源后立即折回。选中的源会移到 `全部` 之后，折叠状态下依然可见，其余源保持 id 顺序。

git/压缩包获取可通过宿主配置调优：

```yaml
- id: dsh-agent-plugins-market
  config:
    git:
      proxy: 'http://127.0.0.1:7890' # 以 git http/https 代理注入
      insteadOf: { 'https://github.com/': 'https://mirror.example/https://github.com/' }
      timeoutMs: 300000 # 每次 git 调用超时（默认 120000）
      cloneRetry: true # 失败自动重试一次（默认开）
      fallbackTarball: false # github.com 克隆失败时回退为 codeload tarball 下载
      allowHttpArchives: false # 允许明文 http 压缩包地址（内网镜像）
```

一个来源可以包含多种布局方言。套件清单与 Marketplace 目录索引遵循[同一布局优先级](https://sivan757.github.io/dsh-agent-plugins-market/compatible-plugins/#shared-layout-precedence)。清单按优先级逐个尝试：读不出或校验不通过的会给出诊断并尝试下一项，全部失败则拒绝该套件。索引扫描采用第一个能产出套件的索引，并按支持的规则补充发现；无效或空索引允许继续尝试后续候选。根 `marketplace.json` 是最后的共享回退。远程引用卡片不能直接安装，需要先添加对应仓库为来源。

`schemas/1.0.0/` 的 schema 内置自 [agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec)，校验时不在线下载。领域用语和开发检查见[领域词汇](../../CONTEXT.md)与[贡献指南](../../.github/CONTRIBUTING.md)。
