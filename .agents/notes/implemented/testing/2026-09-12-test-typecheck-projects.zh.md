# Agent Note: Typecheck the test suites in the project that owns them

Status: implemented

## Problem

`tsconfig.json` 只包含 `src/**/*.ts`（去掉 `src/client/**`），`tsconfig.client.json` 只包含 `src/client/**`，两个项目都没有提到 `tests/`，所以没有任何测试文件进过 TypeScript 程序。`pnpm run typecheck` 在一条断言都没读的情况下通过，而另外两条本可以发现问题的路也一并关着：ESLint 没有开 `parserOptions.project`，vitest 只转译不检查。

因此测试文件可以引用一个不存在的成员、传一个没人读的属性、或者构造一个缺必填字段的 fixture，直到有人在运行时走到那条分支才会暴露。这不是假设。第一个同时覆盖 `src/**` 与 `tests/**` 的项目在 **70 个测试文件中的 22 个里报出 48 条诊断**：

- **14 条是测试验证的东西和它声称验证的不是一回事。** 一个 `MarketService` fake 少了八个接口成员（`serverConfig`、`lspStatus`、`lspServers`、`mcpOverrides`、`saveServerConfig`、`addLspServer`、`setLspServers`、`setLspServerEnabled`）——被测的路由一个都没调用它们，缺口因此不可见。一个凭据解析器被当成裸的 `async () => …` 函数传入，而声明要求的是 `{ resolve }`；一个 `Map` 被传到了声明为 `McpSuiteOverrides`（`Record<string, McpSuiteOverrides[number]>`）的位置：`overrides[serverKey]` 从 `Map` 上读到的永远是 `undefined`，于是这个 stub 以错误的理由表现得像 `{}`。三个 `McpStatusPayload` fixture 漏了 `totals.foreign`，而所有 `Config` 读取都经过 `as Record<string, unknown>`，等于没跟任何东西绑定。
- **3 条是生产类型本身写错了。** `tests/scan-pipeline.test.ts` 构造 `{ source: 'github', repo: 'example/other' }`，而 `src/catalog/scan-resolvers.ts` 里的 `githubRepoUrl` 会读 `record['repo']`——这是 Claude Code marketplace 真实支持的简写，`MarketplaceEntry.source` 却没有声明它。
- **31 条是类型噪音**，与测试证明了什么无关：`strict` 下的 `globalThis.IS_REACT_ACT_ENVIRONMENT`、一个漏写的默认参数、一个没写类型参数的 `querySelectorAll`。

## Decision

测试由**两个**项目检查，它们镜像已发布的拆分，并且都跑在常驻门禁里。

```
tests/  →  tsconfig.test.json         NodeNext · ES2024 · 无 DOM        53 个测试文件
        →  tsconfig.test.client.json  Bundler  · ES2022 + DOM + jsx     17 个测试文件
```

`package.json` 的 `typecheck` 脚本跑全部四个项目，因此 `check:refactor`——以及它背后的 pre-commit 钩子和发布任务——都会检查测试：

```
tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
  && tsc -p tsconfig.test.json --noEmit && tsc -p tsconfig.test.client.json --noEmit
```

**拆分的意义在于边界本身，不在于配置的产物。** 一个服务端测试去碰 `document` 必须失败；如果只用一个项目把 DOM lib 发给所有测试，它就失败不了。第一次运行就证明了这条边界值回票价：`tests/helpers/translate.ts` 从 `src/client/index.js` 导入 `Translate` 类型，这会把 `src/client/**` 拖进任何包含它的程序。该 helper 只被五个客户端测试引用、没有任何服务端测试引用它，所以服务端项目把它排除掉——此后服务端程序里一个 `src/client` 文件都没有。

**归属关系是失败关闭的。** 服务端项目用 `tests/**/*.ts` 做 include，然后按名字排除客户端所属的产物，而不是列出它自己的 53 个文件。新增服务端测试无需登记就会被检查；新增客户端测试会落进服务端项目并在 `document` 上报错，直到有人把它登记进去。显式 include 清单的失败方向恰好相反——新测试不属于任何项目，静默不被检查。

**`tests/globals.d.ts` 是两个项目共读的唯一文件。** 它把 React 自己的测试开关 `IS_REACT_ACT_ENVIRONMENT` 声明一次，取代十处赋值点上的各自处理。`tests/jsdom.d.ts` 只属于客户端：它声明测试真正构造的 `JSDOM` 表面（`new JSDOM(html, { url }).window`、该 window 的 `localStorage`、`close()`），因为 `jsdom` 不带声明，而为单个测试文件往清单里加一个纯类型依赖并不划算。

**有一个生产类型被放宽了。** `MarketplaceEntry.source` 增加 `repo?: string`，因为运行时读它，且已有 fixture 声明它。

## Alternatives considered

**用一个项目同时覆盖 `src/**` 和 `tests/**`。** 配置更少，找到的诊断完全相同——48 条就是这么找出来的。它输在抹掉的边界上：DOM lib 对每个测试可见时，服务端测试可以随手使用 `document` 和 `window` 且照样通过类型检查，而事后没有任何办法判断这是不是有意为之。日后再想找回这条边界，等于要在一个从第一次提交起就宽松的程序里重新给 70 个文件分类。

**安装 `@types/jsdom`。** 这个选择站得住：纯类型、只进 devDependencies，而且是读者在 `jsdom` 依赖旁会预期看到的东西。否决的理由是收益与清单代价不成比例：测试只构造一个 `JSDOM` 实例并读取 `window.localStorage`，手写声明正好覆盖这些而不是 `any`；一旦测试用到更多 jsdom API 就会编译失败，直到声明被补齐——这恰恰是宽松的 `any` 会抹掉的行为。

**单独加一个 `typecheck:tests` 脚本。** 加起来更省事，也更容易被跳过。`check:refactor` 是提交前和打 tag 前真正会跑的门禁，而门禁之外的检查就是没人跑的检查——正是本次改动要消除的那种失败。

**既然项目已经存在，顺手打开类型感知的 ESLint。** `parserOptions.project` 会让 lint 带上类型信息，这是问题陈述的另一半。它是独立的一次改动：它会启用仓库从未跑过的规则，作用于从未按这些规则检查过的代码，硬塞进这里只会让 48 条带类型的发现淹没在一套无关的规则基线里。

## Consequences

48 条诊断全部修好，没有使用 `any`、`as any`、`@ts-ignore`、`@ts-expect-error`，也没有放松 `strict`。两处逃生口保留下来，都很窄：

| 逃生口                                                   | 位置                       | 理由                                                          |
| -------------------------------------------------------- | -------------------------- | ------------------------------------------------------------- |
| `as unknown as Context & { effects: Array<() => void> }` | `tests/mcp-bridge.test.ts` | 只带 `apply` 真正用到的成员的 cordis 假 context，注释已写明。 |
| `declare module 'jsdom'`                                 | `tests/jsdom.d.ts`         | 声明被构造的表面而非 `any`——见上。                            |

`tests/mcp-config.test.ts` 里九处 `as Record<string, unknown>` 已经消失，替换为 `tests/helpers/bridge-config.ts` 中的 `expectTransport`。它是断言函数，因此不需要任何 cast：它保留了这些用例原本就在做的 transport 断言，并把 config 收窄到对应变体，从而把它下面每一次字段读取绑到 bridge 自己的形状上。同一个 helper 也用在了 `tests/mcp-overrides.test.ts`——那里原本把 mount config 读成了**manifest** 的服务端类型，两个类型共享 `url` 和 `headers`，所以转换时一声不吭。

`Simulate` 一并去掉了。用到它的两个测试不再引入 `react-dom/test-utils`，因为 `@types/react-dom` 19 对已安装的 React 18 运行时不导出它——也因为它做的事并不是测试 DOM。`Simulate.change(node, { target: { value } })` 把伪造的 target 赋到合成事件上，再把这个事件直接穿过 React 的派发器；节点的值从未改变，React 的变更检测从未运行，处理器收到的是浏览器永远不会产生的对象。`tests/helpers/dom-events.ts` 通过元素原生的 `value` setter 写入——React 自己的 tracker 拦截的是实例属性，所以直接赋值会让随后的事件看起来「没有变化」——然后派发 React 真正监听的 `input`/`change` 事件。打断这两个处理器会让三个改动前通过的测试失败；改动前的驱动方式也能发现这一点，但除此之外它什么都没有覆盖到 DOM 路径。

`tests/mcp-bridge.test.ts` 中 `httpConfig()` 的返回类型从 `Config` 收窄为 `StreamableHttpConfig`。展开一个联合类型的值会让新增属性成为其他成员的 excess property，这正是相邻两个用例早就带着 `as Config` cast 的原因；该 helper 一直构造的就是 Streamable HTTP 配置，现在只是如实声明。

`Suite.activeSurfaces` 保持可选。它在刚发现的 suite 上确实不存在，在经过投影的 suite 上则一定存在，这由 `CatalogContext.project()` 保证——测试在 `tests/surface-toggles.test.ts` 里通过一个收窄访问器读取它，而不是把生产类型拆成「已发现」与「已投影」两种形状。日后要重新考虑这两种形状的维护者，从这里开始。

## Testing

- `pnpm run typecheck` 跑全部四个项目；`check:refactor` 仍是唯一的本地门禁。
- `tests/` 改动前后都是 70 个文件、502 个测试；新增的两个 `tests/*.d.ts` 不增加测试。
- 每个测试文件都恰好属于一个项目（53 + 17），用 `tsc --listFilesOnly` 断言。
- 边界还从反方向断言过：一个使用 `document` 的探针文件在 `tsconfig.test.json` 下失败，在 `tsconfig.test.client.json` 下通过。
