# 方案：消灭预设里不可见的“配置父级”资源 id

## 缺陷类定义

清单把每条子资源挂在某个父套件 id 下（`suiteResourceId`），勾选子项会隐式写入父级 id，运行时授权与投影都要求父级在场。当父级行因 `configuration` 分类而在所有界面被过滤（不可见、不可直接控制）时，预设数据里就出现一个用户永远看不到、也无法主动选择的强制伴随 id。复制/粘贴预设时它随之扩散。

判定标准（“有卡片才准入”不变量）：一个父级 id 允许出现在 `enabledIds` 中，当且仅当它对应的卡片在某处可渲染、可切换。不满足者必须改为派生态：由子项选中情况在读取时推导，绝不落盘。

## 已证实受影响

### 1. `market:@user-hooks/user-hooks`（用户全局 hooks 配置）

- 合成套件常量：`packages/market-runtime/src/application/panels/user-hooks.ts:17-18`
- hook 行强制携带父级：`packages/market-bundle/src/application/extension-inventory.ts:232`
- 勾选子项自动加父级：`packages/market-ui/src/features/extension-presets/resource.ts:34`
- 授权要求父级在场且可用：`packages/market-runtime/src/application/extension-authorization.ts:5-7`
- 投影按父级过滤整个套件：`packages/market-runtime/src/application/extension-suite-selection.ts:28`
- 卡片被过滤：`packages/market-ui/src/features/extension-presets/ResourceList.tsx:59`
- 复制原样导出：`packages/market-contracts/src/contracts/extension-presets.ts:113-117`

### 2. 项目原生布局套件 `market:native/<dir>-native`（本次检查新发现，同类问题）

`.claude`/`.agents`/`.cursor` 等项目目录按 `packages/market-contracts/src/model/layouts.ts:73-108` 的注册表被扫成合成套件（`packages/market-catalog/src/scanning/native-project.ts:35-95`，`sourceId: 'native'`，id 为 `sanitizeId(dirName + '-native')`，如 `native/agents-native`）。

- 父级行被标记 `configuration: 'project'`：`packages/market-bundle/src/application/extension-inventory.ts:23`（:161、:169 两处写入）
- 卡片同样被过滤，任何界面无法直接切换父级：`packages/market-ui/src/features/extension-presets/ResourceList.tsx:59`
- 项目 skills/commands/agents 子行经 `suiteResourceOwner` 挂到该父级：`packages/market-bundle/src/application/extension-inventory.ts:64-75`、:304-315
- 项目 hooks 子行携带父级：同文件 :232
- 勾选任一子项 → 父级 id 进入 enabledIds：`packages/market-ui/src/features/extension-presets/resource.ts:34`
- 会话投影要求父级在场：`packages/market-runtime/src/application/extension-suite-selection.ts:28`（`selectedSuites` 的候选含项目声明：`packages/market-bundle/src/session-extension.ts:172-181`）
- 更严重：捕获路径也会写入。`initialSelection`（`packages/market-runtime/src/runtime/host/extension-runtime.ts:293-306`）与 `select`/`update` 的重捕获（:363-370、:386-392）按 `available && globalEnabled !== false` 收集行 id，项目父级行（`available: true`、无 `globalEnabled` 字段，见 inventory :184-194）通过过滤，父级 id 直接落进每个新会话的默认选择。即使用户从未勾选任何项目子项，只要仓库有内容目录，`market:native/*` 就已经在选择集里。

## 已确认不受影响（对照）

- `market:@user-mcp/user-mcp`：同为哨兵，但预设只存子项 id，父级在运行时派生（`packages/market-bundle/src/session-extension.ts:180`）——本方案要推广的现成先例。
- `lsp:direct/*`、直连 MCP 行：无父级（inventory :340、:321）。
- 用户自建 skills/commands/agents 行：无 `suiteResourceId`。
- 已安装市场套件的父级：真实卡片、可切换，父级 id 合法。

## 方案（原则：不可见父级一律派生，不落盘）

### A. 授权与投影（runtime，单一事实源）

1. `extension-authorization.ts`：父级缺失时不再直接拒绝；改为“子项在场即视为其配置父级被授予”。保留真实市场套件的父子双重要求。
2. `extension-suite-selection.ts` 的 `projectExtensionSuites`：候选入选条件从 `selected.has(parent)` 扩为 `selected.has(parent) || 该套件任一子项 id 被选中`。子项 id 形态：`skills|commands|agents:<JSON 四元组>`（`packages/market-runtime/src/application/panel-resources.ts:100-102`）、`hooks:<source>/<suite>/...`、`mcp:plugin:<source>/<suite>/...`、`lsp:<source>/<suite>/...`。抽一个 `suiteOwnsResourceId(suite, id)` 判定函数，同时收编 `@user-mcp` 的特判（session-extension.ts:180），三个调用点（session-extension.ts:181、reconciler.ts:385-390、未来新增）一处生效。
3. user-hooks 特殊点：投影还要求 `admitsAnyHook`（extension-suite-selection.ts:48）；父级改为派生后该判定保持不变（仍按至少一条 hook id 命中）。

### B. 清单（bundle）

4. `extension-inventory.ts`：`user-hooks` 哨兵不再发布 market 行（照 :150 对 `@user-mcp` 的 skip），其 hook 行删除 `suiteResourceId`；项目套件父级行保留为内部簿记（`parents` 可用性映射与 owner 标注仍消费它），但打上“不入选择集”的分类。子行继续带 `suiteResourceId` 供 UI 标注与计数，新增判别方式（复用父行的 `configuration` 分类，客户端从 resources 集合可判定）。

### C. 捕获与持久化

5. `extension-runtime.ts` 三处捕获（initialSelection :293-306、select :386-392、update :363-370）过滤掉全部 `configuration !== undefined` 的父级 id。
6. `ExtensionPresetStore.create/update`（`packages/market-runtime/src/application/state/extension-presets.ts:92-109`）写入前剔除配置父级 id；`parseExtensionPresetTransfer`/`serializeExtensionPresetTransfer`（contracts :113-129）同样剔除，旧预设/剪贴板数据在下一次保存或复制时自然脱落。`parseExtensionIds` 的文法（contracts :33）不收紧，旧数据仍可读。

### D. 客户端

7. `resource.ts` 的 `toggleResource`/`resourceSelected`：父级为配置行时不写入、不要求父级在场；`ExtensionPresetEntry.patch`（`ExtensionPresetEntry.tsx:122-136`）的级联不受影响（真实套件才可达该分支）。

### E. 兼容

8. 已存会话快照是设计上的惰性副本，运行时同时接受显式父级与派生父级两种形态，旧快照不需迁移；重新选择后自然换用新形态。

### F. 测试

9. 更新钉死父级 id 的用例（`tests/client-extension-preset-v5.test.ts:486` 的 `HOOKS_PARENT`、`tests/extension-suite-inventory.test.ts:155-196`、`tests/client-hooks-status-panel.test.ts:29-61` 等）；新增回归：复制输出永不含配置父级 id；仅勾选项目子项的预设能投影出对应套件；旧格式预设（含父级）加载、选择、复制各一次后脱落。

## 开放问题（请评审人表态）

1. 项目套件是否需要“父级开、子项全关”的语义？现状父级不可见、无法单独控制，且“父级开 + 零子项”投影出的空套件无任何效果，故方案认为无语义损失。是否有反例？
2. 范围取最小（保留配置父级行作内部簿记）还是彻底（项目父级行也不再发布，children 可用性直接取 candidate 证据）？后者更干净但波及 `parents` 映射与 owner 标注。
3. 旧会话快照的惰性兼容是否可接受，还是需要一次性迁移？
4. `ENTRY_ID` 文法（contracts :33）是否应同步收紧以拒绝新写入的配置父级 id（仅服务端校验层，读取仍放行）？

---

## 评审修订（v2，gpt-astra 静态评审后定稿）

评审结论：有条件支持。全部行号引用核实无误；`@user-mcp` 先例完整（无任何消费者要求其父级显式在场）。两个阻断问题已修订如下。

### 修订 1（对应评审 B1：捕获护卫）

`initialSelection`（`extension-runtime.ts:293-306`）中 `ids` 集合与最终输出同源：若在 `available` 过滤处剔除父级 id，:305 的 `ids.has(row.suiteResourceId)` 会把全部配置 hook 子项丢出默认选择。修法：父级 id 保留进 `ids` 参与护卫判定，仅在最终 `.map(row => row.id)` 输出处剔除配置父级。`select`/`update` 两处捕获（:363-370、:386-392）没有这道护卫，可直接过滤——不要“三处一致”地复制此错误。

### 修订 2（对应评审 B2：执行链授权）

hooks 每条命令执行要求 `isSuiteAllowed(suite)`（`extension-hooks.ts:286`），它来自 `scoped-contributors.ts:130` 的 `allows(agent, suiteId(suite))`；挂载集合按 `scoped-contributors.ts:206` 过滤。A1 必须同时覆盖两种形态：

(a) 资源行本身是配置父级（`configuration !== undefined`）：`extensionResourceEnabled` 改为“任一所属子项 id 被选中即授予”；(b) 子行 `suiteResourceId` 指向配置父级：跳过 `extension-authorization.ts:7` 的行存在性与可用性两半检查（B4 若不发布哨兵行，该查询必落空）。

### 机制描述修正

会话主路径走候选分支：配置父级行在 `extension-inventory.ts:157-161` 或 :165-176 创建，`globalEnabled` 在 :153 算出（对有内容的 native 套件与有效 hooks 的 @user-hooks 为 `true`）；“无 globalEnabled 字段”仅在 legacy 分支 :184-194 成立。两种取值都通过 `!== false`，“父级 id 落进每个新会话默认选择”的结论不变。实现与测试按 `globalEnabled === true` 断言。

### 补充项（非阻断，已采纳）

- 客户端 `globalIds()`（`ExtensionPresetEntry.tsx:71`）同步剔除配置父级，避免草稿计数与服务端保存值不一致（C6 为兜底）。
- `reconciler.project`（`reconciler.ts:385-390`）的 ids 来自 `demandIds` 合成，今天不会产出配置父级 id；`suiteOwnsResourceId` 覆盖它作为防御即可。
- 测试补充：仅含 `hooks:native/*` 子项的会话能投影并执行 hooks（对应 B2）；`extension-acceptance.test.ts:236-259` 钉住的“真实套件父级在场”语义保持不变。
- 文档同 PR：`docs/user/usage.md:25`（预设复制语义）、`docs/developer/design/agent-extension-presets-implementation.md:15`（configuration 行为说明）。

### 开放问题裁定（采纳评审表态）

1. 不需要“父级开、子项全关”语义：空投影套件 `activeSurfaces` 全 false（`extension-suite-selection.ts:51-58`），无挂载、无反例。
2. 取最小形态：彻底形态需重建 `parents` 映射（`extension-inventory.ts:200`，消费点 :315、:332、:356、:377）与 owner 标注，而派生逻辑因旧数据兼容无论如何都要写，只增不减。
3. 惰性兼容：接受。读取端接受显式与派生两种形态，旧 id 下次保存/复制自然脱落，无一次性迁移收益。
4. `ENTRY_ID` 文法不收紧：是否配置父级是数据相关判断，正则不可表达；语义过滤放在捕获与持久化点，读取端保持放行。

### 遗漏排查结论

无遗漏。带 `suiteResourceId` 的行只有四族（hooks :232、面板 :304、MCP :331/:403、LSP :347/:428），父级要么是真实市场卡片，要么是方案已列的两族配置父级。设置页 Hooks 总览只保留 `face === 'hooks'` 行（`session-extension.ts:89`），不受影响。
