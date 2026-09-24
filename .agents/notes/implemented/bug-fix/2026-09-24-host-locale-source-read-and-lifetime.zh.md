# Agent Note: 宿主语言来源读取设置投影，并与安装它的 fiber 同生共死

Status: implemented

## Problem

在桌面端启用市场插件后，宿主进程直接结束：

```
dsh: fatal load failure: Error: cannot get required service "settings" in inactive context
    at readHostLocalePreference (…/dsh-agent-plugins-market/lib/runtime/host-locale.js:85:34)
    at (…/lib/index.js:51:35)
    at readLocalePreference (…/lib/runtime/host-locale.js:60:38)
    at loadHostLocale (…/lib/runtime/host-locale.js:74:38)
    at refreshHostLocale (…/lib/index.js:40:14)
    at Object.apply [as callback] (…/lib/index.js:46:10)
    at async Fiber._reload (…/@deepseek-ai/cordis/lib/index.js:1356:5)
```

桌面端随后弹出启动失败恢复对话框，选择「禁用第三方插件」后，`cordis.patch.yml` 被改名为 `.bak-<时间戳>`，`package.json` 的 bundle 列表被重置，六个 patch 条目与三个 experimental bundle 一起丢失。

入口原本在注入回调的 context 上接语言来源，并把读函数留在模块状态里：

```ts
ctx.inject(['settings'], settingsCtx => {
  setHostLocaleSource(() => readHostLocalePreference(settingsCtx))
  refreshHostLocale()
})
```

模块状态活得比宿主进程里任何 fiber 都久，读函数同样如此。profile 重新加载（安装或启用之后加载器重新激活入口 fiber）会先卸载回调 context 所属的 fiber，然后再次运行 `apply`。新的 `apply` 在重新注册注入之前就刷新语言，于是重载后的第一次读取穿过的是**上一个** fiber 的 context：属性读取沿已卸载的 fiber 向上查找，在它的 `inject` 表里找到 `settings`，背后却没有实现，于是抛出错误。`refreshHostLocale` 只挂了完成回调（`void loadHostLocale().then(…)`），这个失败因此进入 `process.on('unhandledRejection')`，也就是宿主安装的 `installFailLoud`，它写出 `fatal load failure` 并以退出码 1 结束进程。

复查这条读取时，它下面还压着第二个缺陷。`readHostLocalePreference` 调用的是 `settings.get('locale')`，而这条被固定的宿主发布线上没有这个方法：harness `601d6761e4`（2026-09-21，包含在 `dsh-v0.1.7-rc.1` 及之后）把命名空间读取换成配置表单投影，`SettingsForms` 现在只暴露 `configure`、`describe`、`update`、`replace`、`prepareDocument`、`schema`。可选调用 `settings?.get?.(…)` 于是在本插件面向的每一台宿主上都返回 `undefined`，而 `$DSH_HOME/settings.yaml` 这条兜底也是空的：加载器完成之后，`SettingsForms.importLegacyDocument()` 会把该文件改名为 `settings.yaml.imported`。面向宿主的文案对所有语言偏好都停留在中文，而模块文档、开发标准与这份记录都把它写成了可用的设置服务读取。

两个测试用同一种方式漏掉了这两个缺陷。`tests/host-service-seam.test.ts` 挂的是真实 Cordis 树，但它提供的设置服务凭空多了一个 `get(namespace)`；`tests/host-locale.test.ts` 传进去的手工对象带着同一个不存在的方法。测试保持全绿，生产环境什么也读不到。

## Decision

**语言偏好取自设置服务对 `locale` 条目的投影，接线与安装它的 fiber 同生共死。**

`readHostLocalePreference(settings)` 接收服务本身，读取 `settings.describe()`——每个活动 profile 条目的实时配置投影——取其中 `ns === 'locale'` 的条目及其 `value.preference`。这也是 harness 自己的桌面外壳读取该偏好的接口（`apps/desktop/src/welcome-backend.ts` 的 `localePreference`）。`settings/document-updated` 携带同一个命名空间键，所以一次写入就是重读的触发点。

服务通过 `ctx.get('settings')` 从入口自己的 context 解析。服务表只按提供者是否活动作答，与读取方 fiber 的存活状态和拓扑无关，因此这条读取能挺过那次结束宿主的重载。`undefined` 覆盖所有缺失情形——没有设置服务、条目尚未活动、没有写入偏好、值不是字符串——字典据此落到中文。

`setHostLocaleSource(read)` 装上读函数，并返回清除它的清理函数；清除带身份判断：重载时若新读函数已经装上，旧 fiber 的清理不会抹掉新的那份接线。入口把两半注册成同一个 effect，接线因此与安装它的 fiber 存活期一致，`apply` 后续抛错也不会把它留下：

```ts
ctx.effect(() => setHostLocaleSource(() => readHostLocalePreference(ctx.get('settings') as LocaleSettingsSource | undefined)), 'dsh-agent-plugins-market: host locale source')
refreshHostLocale()
ctx.inject(['settings'], () => {
  refreshHostLocale()
})
ctx.effect(
  () =>
    ctx.on('settings/document-updated', ns => {
      if (ns === LOCALE_SETTINGS_ENTRY) refreshHostLocale()
    }),
  'dsh-agent-plugins-market: host locale refresh'
)
```

`readLocalePreference()` 现在是同步函数。解析 `$DSH_HOME/settings.yaml`、`node:fs` 读取与异步包装 `loadHostLocale` 都已删除，因为唯一的来源直接给出值；`refreshHostLocale` 用它绑定字典并使两个技能提供者失效。曾经承载服务实例的注入回调保留为「服务晚于本插件挂载」时的触发点。

`src/runtime/host-locale.ts` 里的 `LocaleSettingsSource` 声明了本模块调用的那段服务接口，紧邻那条说明 harness `601d6761e4` 移除了它要替代的取值方法。

## Alternatives considered

**继续在注入回调的 context 上读，用该回调内部的 effect 负责清理。** 否决：这样修好了先后次序，模块状态里却仍然留着一个捕获的 context，而它被读取时用的属性读取正是抛错的动作。`ctx.get` 从同一张服务表作答，不需要捕获 context，故障类别因此消失，而不是被排进日程。

**保留 `$DSH_HOME/settings.yaml` 兜底。** 否决：该文件在任何被固定的宿主上都不存在，harness 首次启动就把它改名为 `settings.yaml.imported`；那段解析还是在手写一个成熟文档格式的解析器，本仓库明令禁止。投影是唯一能返回值的来源。

**把 `@deepseek-ai/dsh-settings` 声明为 peer 并配精确 dev 镜像，读取类型直接用它的 `SettingsForms`。** 暂缓到版本同步时一并处理：本仓库的宿主 pin 仍在 `^0.1.7-rc.1`，而注册表 `next` 线已是 `0.1.7-rc.2`，`pnpm run check:host-alignment` 在这次改动之前就是红的，此时按任一版本新增一个包都会加深这层漂移。声明是更强的保障，应当与 `pnpm run fix:host-alignment` 一起做；本地接口声明的是同一个 `describe()` 接口，并记下了移除取值方法的那次提交。

**把偏好搬到 `CatalogPorts` 上，像 `downloadRegion` 那样。** 暂缓：这样可以彻底删掉模块状态，代价是 `src/application` 里多一个端口成员、一个默认值和两处调用点。带身份判断的 effect 用更小的改动面关掉了具体的跨代覆盖风险；出现第三个读取方时再改成端口。

**给 `refreshHostLocale` 加失败处理。** 否决：读取改为同步之后已经没有会失败的 promise，处理函数只会掩盖读取不再产生的失败。

## Consequences

重新加载会在第一次读取之前接好来源，语言路径上不再有任何东西属于会被 profile 重载卸载的 fiber，这条路径上的故障不会再次出现。读取返回的是宿主真正持有的偏好，这在被固定的发布线上是此前从未做到的；一次设置写入就能重新绑定字典，不必重载。没有设置服务的宿主保持中文默认值。

每次刷新调用一次 `describe()`，而不是每条译文调用一次：投影会遍历所有活动条目，比它替代的取值方法更重，所以条目改为在设置事件上重新绑定，而应用侧读取（区域判定、MCP 状态）每次调用只经过已接好的读函数一次。删掉文件兜底也删掉了这条路径上最后一个异步步骤，因此意外失败现在表现为插件加载错误，而不是被宿主当成退出原因的未处理 promise 失败。

取代关系：[可选宿主服务一律从服务表读取](2026-09-15-optional-host-services-read-through-the-service-store.md) 拥有服务读取规则，仍然是权威记录。本条记录这条规则在存活期上的一半，以及语言读取所需要的投影；两条记录互不取代。

## Testing

`tests/host-service-seam.test.ts` 挂载真实 Cordis 树，`skills`、`commands`、`settings` 三个服务来自兄弟 fiber，设置服务按被固定宿主的投影形状书写（`describe()` 返回 `locale` 条目）。它覆盖三件事：入口卸载后再次应用仍能读到语言，且整个过程没有未处理的失败；入口卸载时接线被清除；其他条目的 `settings/document-updated` 不触发重读，`locale` 条目自己的变更触发重读。把 `src/` 还原到本条记录取代的那个版本，两个测试文件都会失败，并报出生产环境那条 `cannot get required service "settings" in inactive context`，位置是 `Fiber._reload` 期间的 `apply`。

`tests/host-locale.test.ts` 覆盖投影解析（locale 条目、条目缺失、值不是字符串、没有服务）、未接线时的答案，以及身份判断：旧接线迟到的清理不会移除新装上的读函数。
