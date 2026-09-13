# Agent Note: One MCP server identity, not one per session

Status: implemented

## Problem

某个 Cloudflare MCP 服务反复打开浏览器授权页，而那个会话里唯一一条 MCP 记录已经连接、配置里也没声明 `auth`。这是两个互不相干的事实叠加出来的。

**从 harness home 启动的会话有了 project 维度。** `resolveProjectRoot(cwd)` 等于 `<findProjectRoot(cwd)>/.dsh/agent-plugins`，而 `findProjectRoot` 在祖先目录都不含 `.git` 时回退到 cwd 本身。对 `~` 来说，这个路径正好是 user 维度根 `~/.dsh/agent-plugins`。于是该会话把用户自己的 `state.json` 当作 project 状态读取，并通过 `mountProjectMcp` 在 agent 作用域内把每个用户级套件再对齐一遍——对每个用户安装的 MCP 服务多开一条连接。

**project 挂载的名字带上了会话身份。** `McpMountRegistry` 会把名字重新派生为 `deriveServerName(serverName, agent.session.id ?? randomUUID())`。结果超出 32 字符预算，被截断并追加 hash（`cloudflare__cloudfla-a750f72e2d3b`），而服务的 OAuth 凭据记录正是按这个名字做键的。于是每个会话查到的都是一个从未被写过的记录：上一次会话的键下确实存着授权、但没人再读它，服务端再次返回 401，SDK 再次打开回环浏览器。"我每次都认证，它还是要弹"说的就是这个。`.credentials.yaml` 里躺着六条这样的记录——其中三条已完成授权——每条都精确对应一个以 `~` 为根的会话 id。

这个后缀同时让 project 服务在自己的工具名里难以辨认，也让 MCP 状态面板看不见它——面板派生名字时不带这个后缀。

## Decision

**解析到 user 维度的 project 维度不算 project。** 当 `resolveProjectRoot(cwd)` 解析结果等于宿主的 `userRoot` 时，`SnapshotCache.readProjectCatalog` 返回空快照。project 目录的所有消费者——MCP 挂载、命令、hooks、技能、project 角色——从此只看到两个维度之一，不会再看到用户的安装被冠以 project 之名。

**每个 suite/server 一个派生 `serverName`，与维度无关。** `McpMountRegistry` 去掉 `namespace` 构造参数，不再重新派生 project 挂载的名字；`mountProjectMcp` 不再传会话 id。宿主本来就按 agent 保存工具注册：`ToolLayer` 每个作用域一张表，本作用域自己的条目覆盖继承来的条目，全局层的重名报错会指引调用方通过该 agent 的 `ctx` 注册每 agent 变体。因此两个 agent（或一个 project 与 user 维度）依旧可以各自独立挂载同一个 server key——只是现在共用一个稳定的名字。

**状态行如实说明配置看不出来的授权。** 当远端服务的套件没有声明 `auth` 块时，`McpStatusEntry.oauthDefault` 为真，详情弹窗以 `mcpOauthDefault` 渲染。OAuth 默认开启、且只在服务端返回 401 挑战时才动作，所以一份没有 `auth` 键的脱敏配置从来不等于"与授权无关"。

## Alternatives considered

**保留会话后缀，只让 OAuth 用一个与 session 无关的记录键。** 即把凭据键与 `serverName` 分开传给 bridge，让授权跨会话存活、工具名仍按会话区分。否决：这会把一个身份拆成两个必须手工保持同步的名字，仍保留被 hash 截断的工具名，也仍保留这次报障的那个重复连接。

**只跳过重复挂载。** 单加 home 别名这道守卫能止住本次报障，但真正的项目级 OAuth 服务依旧会在每个会话重新授权一次，project 工具名也依旧带 hash。

**按 project 根而不是按会话 id 加命名空间。** 在同一个项目内稳定，但对用户已授权过一次的服务，仍然每个项目分叉一份凭据记录，也仍然要花掉名字预算。

**给 OAuth 记录一个所有服务共用的固定 scope。** 否决：不相干的服务会挤在同一条记录里，而"重新授权"这个操作也无法指名某个服务的授权。

## Consequences

- 同一个 suite/server 的 project 挂载与 user 维度挂载共用一个身份。该 agent 内，作用域注册覆盖全局注册（宿主的既定规则），一份已存授权同时服务两者。
- `~/.dsh/.credentials.yaml` 里遗留的六条会话级记录成为孤儿。挂载重新读取 `mcp-auth/<suite>-<server>`（Cloudflare 即 `mcp-auth/cloudflare-cloudflare`），也就是一直有效的那条记录。
- 以 harness home 为根的会话不再重复挂载任何东西：每个服务一条连接，而不是两条。
- 声明同一个 suite/server 的两个项目现在共用一个名字，靠 agent 作用域而不是名字区分。这是代价所在：用一个不再跨活跃项目唯一的名字，换取可读、稳定的身份。
- 状态面板仍是 user 维度的清单。它显示的名字与那些挂载注册的名字一致，project 维度也不例外。

## Testing

- `tests/native-project-cwd.test.ts` —— home 为 cwd 时 project 目录为空，而 user 目录仍列出该安装；以 `.git` 为根的 cwd 仍解析到自己的维度。
- `tests/project-mcp.test.ts` —— 两个 agent 在同一个派生名下挂载各自的 project 配置；关闭 project 布局时两者都卸载。
- `tests/mcp-status.test.ts` —— 未声明 `auth` 的远端服务带 `oauthDefault`，`stdio` 或已声明的服务不带。
- `tests/client-mcp-detail.test.ts` —— 授权说明只在该行渲染。
