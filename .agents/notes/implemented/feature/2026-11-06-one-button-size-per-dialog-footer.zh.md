# Agent Note: one button size per dialog footer

Status: implemented

## Problem

对话框页脚的操作行里，28px 的控件和 36px 的控件混在一起，按钮因此对不齐。

宿主的 `Button` 有两个尺寸：`md` 高 36px、字号 14px、圆角 `--dsw-radius-md`；`sm` 高 28px、字号 12px、圆角 `--dsw-radius-sm`。有两个页脚各选了一种：

| 页脚                                          | 改之前的这一行                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `features/instructions/InstructionDetail.tsx` | 删除（`ghost`，`sm`，28px）· 编辑（`primary`，`sm`，28px）· 完成（`ghost`，默认 `md`，36px） |
| `features/lsp/LspStatusPanel.tsx`             | 复制诊断（`ghost`，`sm`，28px）· 完成（`ghost`，默认 `md`，36px）                            |

第三个页脚——`features/extension-presets/ExtensionPresetEntry.tsx` 里的预设管理器——两个按钮都写了 `sm`：它自己这一行是齐的，却是整个插件里唯一一个几何与别的对话框都不一样的页脚。

起因是两处 `size: 'sm'`，加到页脚上时没有把整行当作一行来看。负责人拍下了指令文件那个对话框——删除 | 编辑 | 完成——并报「有些编辑页的按钮对不齐」。读者看到的是一个小按钮挨着一个高按钮，这一行的基线就断了。

## Decision

- **对话框页脚的操作行只有一个尺寸。** 页脚是一行平级的控件，不是混着不同重量的工具条：读者要按的是其中一个，而它们是被当作一组读的。
- **全屋尺寸是 `md`。** 它是宿主的默认值，插件里其他每一个页脚本来就在用它，而页脚这一行正是插件里唯一放着整字标签、而不是行内小动作的地方。量下来，三个 `md` 按钮组成的那一行在指令对话框里高 36px，而那是一个高 800px 的 `size: 'lg'` 对话框：这一行放得下，还有富余；编辑那个 primary 按钮在 36px 下依然读得出是主动作。
- **页脚不写尺寸。** 全屋尺寸就是宿主的默认值，所以页脚里的按钮根本不传 `size`。写 `size: 'md'` 等于把默认值已经说过的话再说一遍，还把下一个读者的选择（小一号、或者大一号）放在离规则一步远的地方。
- **正文里的紧凑控件照旧。** `size: 'sm'` 对正文里的行内小动作是合适的：凭据字段、服务配置编辑器、用户条目的 hero 删除按钮、卡片的主操作、诊断块、翻译重试、MCP 详情的恢复动作簇、设置卡片、Hook 新建对话框里的 AI 起草按钮，以及语言引擎面板的接缝横幅与重启条，都保留它。这条规则说的是页脚那一行，不是每一个按钮。

### 审计

插件里每一个页脚，以及它现在用的尺寸：

| 页脚                                                                        | 按钮                 | 尺寸 |
| --------------------------------------------------------------------------- | -------------------- | ---- |
| `ui/AiSelectionModal.tsx`                                                   | 取消, 生成           | md   |
| `ui/HookDetailModal.tsx`                                                    | 关闭                 | md   |
| `ui/panel.tsx`（条目编辑器）                                                | 取消, 保存           | md   |
| `ui/panel.tsx`（确认框）                                                    | 取消, 确认           | md   |
| `ui/ServerConfigModal.tsx`                                                  | 取消                 | md   |
| `ui/ServerConfigDetail.tsx`（传送到同一框架里的保存按钮）                   | 保存                 | md   |
| `features/instructions/InstructionsPanel.tsx`（编辑器）                     | 删除, 取消, 保存     | md   |
| `features/instructions/InstructionDetail.tsx`                               | 删除, 编辑, 完成     | md   |
| `features/output-styles/OutputStylesPanel.tsx`（编辑器）                    | 取消, 保存           | md   |
| `features/output-styles/OutputStylesPanel.tsx`（详情）                      | 编辑, 删除, 选用     | md   |
| `features/lsp/LspStatusPanel.tsx`                                           | 复制诊断, 完成       | md   |
| `features/hooks/HookCreateModal.tsx`                                        | 取消, 保存           | md   |
| `features/market/SuiteDetail.tsx`                                           | 安装 / 卸载          | md   |
| `features/market/SourceEditorModal.tsx`                                     | 移除来源, 取消, 保存 | md   |
| `features/market/MarketSection.tsx`                                         | 取消, 确认删除       | md   |
| `features/market/InstallConfirmModal.tsx`                                   | 取消, 确认安装       | md   |
| `features/extension-presets/ExtensionPresetEntry.tsx`（管理器）             | 设为默认, 保存       | md   |
| `features/extension-presets/ExtensionPresetEntry.tsx`（改名、删除、剪贴板） | 各一个按钮           | md   |
| `workspace/ExtensionResourceDetail.tsx`                                     | 一个开关，没有按钮   | —    |

## Alternatives considered

- **把整行改成 `sm`。** 否决：`md` 那一行放得下它所在的对话框——指令对话框的页脚行在一个高 800px 的 `lg` 对话框里高 36px，三个按钮各宽 56px——而 `sm` 会把插件换成相反的全屋尺寸，那个尺寸恰好是宿主的默认值与其他每一个页脚都拒绝的那个。
- **把完成改成 `sm`，去迁就那两个小按钮。** 否决：完成在其他每一个对话框里都是宿主的默认尺寸；在两个对话框里把它缩小，就把这两个变成了异类，而读者也就失去了那个告诉他「这个对话框的主动作在别处」的整字关闭控件。
- **只修负责人拍的那一个对话框。** 否决：语言引擎的详情带着同一个毛病，预设管理器的页脚带着同一个偏差。
- **给插件自己的外壳加第三种、更小的页脚尺寸。** 否决：宿主 Button 只有两个尺寸，插件并不自己实现它。页脚统一成一个尺寸，是「两个里选哪个」的规则，不是第三个控件。

## Consequences

- 指令文件对话框的页脚是一行三个 36px 的按钮，语言引擎详情的是两个。这一行读起来就是一行。
- 预设管理器的页脚与别的对话框一致了，读者在对话框之间走动时不会再遇到一套新几何。
- 两个按钮长了 8px，一行页脚长了 8px。对话框的正文是宿主的滚动区域，它把这 8px 还回来，不会裁掉内容。
- 正文里的紧凑控件没动，所以页脚那一行以外的任何控件形状都没变。
- 想要紧凑的页脚，现在必须在这一行的每个按钮上写出来，源码守卫会因此失败。

## Verification

- `packages/market-ui/test/dialog-footer-size.test.ts` 渲染指令文件对话框与语言引擎对话框，断言页脚行里的每一个按钮都带着宿主的 `md` 尺寸类；它还读插件源码，任何页脚表达式自己声明尺寸时测试就失败，连「在生成套件详情那一行的辅助函数里加尺寸」也算。这条守卫对着改动前的源码验过：它把这条记录改动的三个文件都标了出来。
- 现场测量：在 `market-demo` profile 的 Agent 扩展 → 系统提示词标签页，打开 `~/.dsh/AGENTS.md` 那一行：

  | 按钮 | 改之前                     | 改之后                     |
  | ---- | -------------------------- | -------------------------- |
  | 删除 | 28px，字号 12px，圆角 8px  | 36px，字号 14px，圆角 12px |
  | 编辑 | 28px，字号 12px，圆角 8px  | 36px，字号 14px，圆角 12px |
  | 完成 | 36px，字号 14px，圆角 12px | 36px，字号 14px，圆角 12px |

  三个按钮现在落在同一个盒子里（top 890，bottom 926），页脚行本身高 36px。

- `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check` 与 `pnpm run test` 全绿。

这条记录补上的对话框外壳，见[一套卡片解剖那条记录](2026-09-14-workspace-card-anatomy-and-host-affordances.md)与[对话框外壳那条记录](../bug-fix/2026-09-29-dialog-chrome-and-mode-switch.md)；两者都没有记录页脚的按钮尺寸，所以没有任何决定被取代。
