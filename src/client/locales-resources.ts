/**
 * zh/en dictionaries for the project resource window.
 *
 * A separate dictionary module so the window's keys land without touching the
 * main locales.ts (which another work stream holds); index.ts merges both into
 * the one namespace the host binds.
 */

/** Chinese is the source-of-truth key set; English mirrors it one for one. */
export const resourcesZh = {
  resourceWindowTitle: '项目资源',
  resourceWindowSubtitle: '仅本项目生效',
  resourceWindowTabList: '项目资源分区',
  resourceWindowSearchPh: '搜索本项目已安装…',
  resourceWindowEmpty: '没有匹配的已安装条目',
  resourceWindowLoadFailed: '资源清单读取失败',
  resourceWindowToggleEntry: '在本项目中挂载/过滤',
  resourceWindowViewCard: '卡片视图',
  resourceWindowViewList: '列表视图',
  resourceWindowViewGroup: '视图切换',
  resourceWindowFavoritesLabel: '收藏',
  resourceWindowFollowGlobal: '跟随全局',
  resourceWindowSaveFavorite: '＋ 保存当前为收藏',
  resourceWindowFavoriteCrossNote: '收藏跨项目可用',
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
  resourceWindowCountLsp: '代码智能',
  resourceWindowSourceDirect: '直连',
  resourceWindowSourceUser: '用户'
} as const

export type ResourceLocaleKey = keyof typeof resourcesZh

export const resourcesEn: Record<ResourceLocaleKey, string> = {
  resourceWindowTitle: 'Project resources',
  resourceWindowSubtitle: 'This project only',
  resourceWindowTabList: 'Project resource sections',
  resourceWindowSearchPh: 'Search installed in this project…',
  resourceWindowEmpty: 'No installed entries match',
  resourceWindowLoadFailed: 'Failed to load the resource inventory',
  resourceWindowToggleEntry: 'Mount or filter in this project',
  resourceWindowViewCard: 'Card view',
  resourceWindowViewList: 'List view',
  resourceWindowViewGroup: 'View switch',
  resourceWindowFavoritesLabel: 'Favorites',
  resourceWindowFollowGlobal: 'Follow global',
  resourceWindowSaveFavorite: '＋ Save current as favorite',
  resourceWindowFavoriteCrossNote: 'Favorites work across projects',
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
  resourceWindowCountLsp: 'Code intelligence',
  resourceWindowSourceDirect: 'direct',
  resourceWindowSourceUser: 'user'
}
