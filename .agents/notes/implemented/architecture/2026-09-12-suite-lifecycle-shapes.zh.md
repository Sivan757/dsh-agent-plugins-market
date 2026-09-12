# Agent Note: 套件的两种形态：扫描态与投影态

Status: implemented

## Problem

`src/model/types.ts` 里的 `Suite` 同时描述了两件不同的事。

**扫描态**：遍历一个 checkout 产出的东西（`source-catalog.ts`、`scan-resolvers.ts`、`suite-scanner.ts`、`native-project.ts`）。没有安装状态，也没有生效的 surface 集合——`project-native` 除外，它的布局自己描述了这份集合，因为机器上并不存在它的安装条目。

**投影态**：`CatalogContext.project()` 合并持久化安装状态之后返回的东西。它总会赋值 `activeSurfaces`，来源是 `effectiveSurfaces(installed?.surfaces)`、project-native 的覆盖、以及项目维度下的 `lsp: false`。

因为一个类型覆盖了两者，字段只能是可选的，而十一个只会拿到投影态套件的消费方于是都写成 `suite.activeSurfaces?.mcp !== false`。这些条件里每一个在字段缺失时都求值为 **true**：一个没经过 `project()` 就抵达运行时消费方的套件，会静默地挂载它声明的所有 surface，而不是编译失败。可选链是新增代码路径与这个默认值之间唯一的屏障。

## Decision

扫描态成为 `DiscoveredSuite`，除非布局自描述，否则 `activeSurfaces` 不存在。`Suite extends DiscoveredSuite` 把该字段重新声明为必填。`CatalogContext.project()` 是第一个形状到第二个形状的唯一生产者，也是两者唯一的交汇处：

```ts
export interface DiscoveredSuite {
  /* … */ activeSurfaces?: Record<SuiteSurfaceKey, boolean>
}
export interface Suite extends DiscoveredSuite {
  activeSurfaces: Record<SuiteSurfaceKey, boolean>
}
```

窄的那个名字刻意给了投影态。`CONTEXT.md` 把套件定义为带有"身份、元数据、支持的运行时能力，以及**安装状态**"——所以投影态才是这个领域所称的套件，扫描产物是构建它的中间态。这样改动也落在**可能犯错的地方**而不是**会发现错误的地方**：四个扫描生产者与 `project()` 改用新名字，而每个消费方原本就写着 `Suite`，那正是它们需要的契约。

十一处可选链变成普通属性访问。**条件本身一个都没改**——`=== false` 与 `!== false` 原样保留，只去掉了对不可能出现的缺失的处理。

## Alternatives considered

**引入 `ProjectedSuite`，把 `Suite` 留给扫描态。** 这是更直观的读法，但两点否决。它违背术语表——术语表把安装状态放进套件的定义里。而且它把改动量倒过来了：约 26 个消费方文件需要改注解，而不是 20 个生产者侧文件，于是改动最大的地方恰好是最没有信息量的地方。

**用 brand 或可辨识字段**（`kind: 'projected'`）让消费方去 switch。否决：运行时没有任何地方需要按阶段分支，而一个可辨识字段会诱使别人去分支。

**保持字段可选，用文档说明它何时存在。** 这正是代码原来的做法，也是那十一处可选链的来历：一个放在类型该在的位置上的注释。

## Consequences

**边界立刻抓到了一个潜在缺陷。** `tests/real-layouts.test.ts` 用 `as never` 伪造了一个 `Catalog`，把**扫描态**套件交给了消费方，而消费方按投影态读取——现在它在 `src/runtime/project-runtime.ts` 抛错。这正是上面说的"静默挂载全部"失败模式，而由于那个 cast，它一直对 `tsc` 不可见。测试里的 host cast 仍然存在，所以 cast 依然可以藏住这一类错误；不要把类型检查全绿读成"没有任何 cast 藏得住东西"。

**两个合成套件需要一份真实的集合。** `loadUserMcpSuite` 与直连 LSP 的套件字面量是在 `project()` 之外构造的，现在它们带上 `effectiveSurfaces(undefined)`——六个 surface 全开，这与字段缺失时每一处读取所得到的结果按位相同。

**一个测试 helper 复述了规则的一小部分。** `tests/helpers/projected-suite.ts` 为那些直接从扫描驱动消费方的测试提供默认集合，同时保留套件自身的启用状态。把这些测试改走 `project()` 会更忠实，但 `project()` 会依据安装状态重算 `enabled`——没有安装条目时它设为 `enabled: false`，会破坏这些测试存在的意义。helper 里已写明这一点。

**`applyLspOverrides` 与 `buildLspStatus` 保持投影类型**，这是逐个检查调用方之后得出的结论，而不是照着签名做模式匹配：所有调用方传入的都是投影态套件，两个函数又都是保形映射，所以这条契约现在是强制的而非假设的。

## Testing

- `Suite` 不再能从反向赋值：探针确认 `const x: Suite = discovered` 是 TS2322，`discovered.activeSurfaces.mcp` 是 TS18048，而 `Suite → DiscoveredSuite` 仍然可赋值。
- 四个 typecheck 工程、`eslint src tests`、依赖边界巡游全部通过。
- `tests/` 保持 70 个文件、506 个测试不变。
- 有两处测试刻意保留 `activeSurfaces?.`，因为它们的套件来自 `discoverNativeProjectSuites`，属于扫描态。
