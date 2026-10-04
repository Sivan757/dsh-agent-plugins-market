/**
 * zh/en dictionaries for the project resource window.
 *
 * A separate dictionary module so the window's keys land without touching the
 * main locales.ts (which another work stream holds); index.ts merges both into
 * the one namespace the host binds. The six face tabs read the main
 * dictionary's workspaceTab* words so the window names each surface exactly
 * as the settings page does; this module carries only the window's own keys.
 */

/** Chinese is the source-of-truth key set; English mirrors it one for one. */
export const resourcesZh = {
  resourceWindowTitle: '市场',
  resourceWindowTabList: '项目资源分区',
  resourceWindowSearchPh: '搜索本项目已安装…',
  resourceWindowEmpty: '没有匹配的已安装条目',
  resourceWindowLoadFailed: '资源清单读取失败',
  resourceWindowLoading: '加载中…',
  resourceWindowFilterAll: '全部',
  resourceWindowFilterOn: '已启用',
  resourceWindowFilterOff: '已过滤',
  resourceWindowToggleEntry: '在本项目中挂载/过滤',
  resourceWindowViewCard: '切换到卡片视图',
  resourceWindowViewList: '切换到列表视图',
  resourceWindowView: '查看详情',
  resourceWindowFollowGlobal: '跟随全局',
  resourceWindowSaveFavorite: '保存当前为收藏',
  resourceWindowDeleteFavorite: '删除收藏',
  resourceWindowApplyFavoriteDone: '已套用收藏「{name}」',
  resourceWindowSaveFavoriteDone: '已保存收藏「{name}」（跨项目可用）',
  resourceWindowDeleteFavoriteDone: '已删除收藏「{name}」',
  resourceWindowNameDialogToken: '收藏名称',
  resourceWindowNameDialogTitle: '保存当前为收藏',
  resourceWindowNameDialogHint: '收藏保存六面开关与条目过滤的完整快照，可在任何项目套用。',
  resourceWindowNameDialogCancel: '取消',
  resourceWindowNameDialogConfirm: '保存',
  resourceWindowNameDefault: '我的常用 {n}',
  resourceWindowOpen: '打开项目资源窗口',
  resourceWindowClose: '关闭',
  resourceWindowCountSkills: '技能',
  resourceWindowCountMcp: '连接器',
  resourceWindowCountHooks: 'Hooks',
  resourceWindowCountCommands: '快捷指令',
  resourceWindowCountAgents: '专家',
  resourceWindowCountLsp: '语言引擎',
  resourceWindowSourceDirect: '直连',
  resourceWindowSourceUser: '用户'
} as const

export type ResourceLocaleKey = keyof typeof resourcesZh

export const resourcesEn: Record<ResourceLocaleKey, string> = {
  resourceWindowTitle: 'Market',
  resourceWindowTabList: 'Project resource sections',
  resourceWindowSearchPh: 'Search installed in this project…',
  resourceWindowEmpty: 'No installed entries match',
  resourceWindowLoadFailed: 'Failed to load the resource inventory',
  resourceWindowLoading: 'Loading…',
  resourceWindowFilterAll: 'All',
  resourceWindowFilterOn: 'Enabled',
  resourceWindowFilterOff: 'Filtered',
  resourceWindowToggleEntry: 'Mount or filter in this project',
  resourceWindowViewCard: 'Switch to card view',
  resourceWindowViewList: 'Switch to list view',
  resourceWindowView: 'View details',
  resourceWindowFollowGlobal: 'Follow global',
  resourceWindowSaveFavorite: 'Save current as favorite',
  resourceWindowDeleteFavorite: 'Delete favorite',
  resourceWindowApplyFavoriteDone: 'Applied favorite "{name}"',
  resourceWindowSaveFavoriteDone: 'Saved favorite "{name}" (works across projects)',
  resourceWindowDeleteFavoriteDone: 'Deleted favorite "{name}"',
  resourceWindowNameDialogToken: 'Favorite name',
  resourceWindowNameDialogTitle: 'Save current as favorite',
  resourceWindowNameDialogHint: 'A favorite stores the complete snapshot of the six switches and entry filters, applicable in any project.',
  resourceWindowNameDialogCancel: 'Cancel',
  resourceWindowNameDialogConfirm: 'Save',
  resourceWindowNameDefault: 'My setup {n}',
  resourceWindowOpen: 'Open the project resources window',
  resourceWindowClose: 'Close',
  resourceWindowCountSkills: 'Skills',
  resourceWindowCountMcp: 'Connectors',
  resourceWindowCountHooks: 'Hooks',
  resourceWindowCountCommands: 'Shortcuts',
  resourceWindowCountAgents: 'Experts',
  resourceWindowCountLsp: 'Language Engine',
  resourceWindowSourceDirect: 'direct',
  resourceWindowSourceUser: 'user'
}
