# Agent Note: 钩子详情解剖与跟随套件行

Status: implemented

## Problem

钩子详情原本是一串扁平的键值，再接命令、再接一段裸的运行结果。没有任何东西锚定这个钩子是什么，声明、命令与运行读起来是一整块。

另一处不一致：管理窗的 Hooks 页对已安装套件拥有的钩子一行都不发布，而设置页概览每个声明发布一行。全局启用着的钩子看起来在管理窗里消失了，两个面对同一条声明给出不同结论。

## Decision

详情改用专家详情解剖：一张状态卡，之后是带标题的分区。

状态卡放支持情况、事件与匹配条件三个标签，接着来源名，再接着一个状态点加完整命令。概览区是一个自动适配的键值网格，装八个事实：来源、事件、匹配条件、超时、声明位置、类型、来源套件与运行目录。运行区把主按钮「试运行」放在标题旁边；状态行给出退出码、耗时、合成数据标记、超时与截断，两路输出各自带标签。被校验拒绝的声明只显示诊断分区，不显示运行区。命令出现在状态卡里；自[声明 JSON 块](2026-10-10-hook-detail-declaration-json-block.zh.md)之后，概览下方的声明分区再以该行被裁剪的预览重复它一次。

控件都用宿主原语：Button、Tag（success / warning / outline 三种色调）与 StateDot。运行结果没有复用宿主的 TerminalBlock，因为那个组件会把命令行再渲染一遍。

行上多了一个事实。`ExtensionResource.followsSuite` 表示该资源跟随所属套件的选择。`readExtensionInventory` 对 `exposesIndividualHooks(suite)` 为假的每条钩子行打上它，两次读取都打，因此这个事实不取决于哪个界面在问。管理窗的 inventory 改为搜索专门的 `hookSuites` 列表（项目套件 + 已安装的用户维度套件 + @user-hooks 套件），而不是放宽 `projectSuites`，这样已安装声明会成行，而 `projectOwners` 与 `address()` 保持原意。`HookResourceCard` 给这类行标注「跟随套件」并且永不给它开关，`ResourceList` 不为它传 toggle，`resourceSelected` 改为镜像所属套件。

## Alternatives considered

- **运行结果复用宿主 TerminalBlock。** 否决：它会把命令行再渲染一遍，而命令已经在状态卡里，那样就重复了用户要求去掉的路径。
- **保留扁平键值列表，只加标签。** 否决：列表让命令与运行结果和超时同权，而确认过的解剖要把声明、命令与结果分开。
- **只在管理窗请求行时才打 followsSuite。** 否决：跟随套件是钩子的属性，不是列它的界面的属性。
- **放宽 projectSuites 让管理窗看到已安装套件。** 否决：那样 projectOwners 与 address() 会把已安装套件当成项目所有，改变它们发布的其他行的会话 id 传递。
- **给跟随套件行一个独立开关。** 否决：文档契约写明已安装套件的 hook 跟随套件选择，一个不会真正门控运行器的开关是在骗人。

## Consequences

- 一眼读完声明：这个钩子是什么、它写了什么、运行它产出了什么。
- 命令出现在状态卡里，并以声明行被裁剪的预览再出现一次。这第二次出现是有意的：它是参考声明行自己的预览，不是第二个命令分区。
- 设置页现在也带同一个「跟随套件」标签，解释了这些行为什么没有开关。它的过滤计数仍按 `control` 计算，没有变化。
- 管理窗的 Hooks 页把已安装声明列成只读行，其选中状态镜像所属套件行。

## Testing

`tests/client-hooks-status-panel.test.ts` 断言概览网格的标签、对话框静止时的命令出现次数、被拒绝声明不提供运行区，以及试运行的请求体与结果。`tests/client-hook-resource-card.test.ts` 断言「跟随套件」标签且没有开关，并断言 `resourceSelected` 镜像所属套件。服务端测试覆盖行来源与标记。
