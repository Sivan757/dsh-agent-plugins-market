# Agent Note: 测试进类型检查、lint 进类型感知、检查放在开发停下的地方

Status: implemented

## Problem

`tsconfig.json` 只包含 `src/**/*.ts`（去掉 `src/client/**`），`tsconfig.client.json` 只包含 `src/client/**`，两个项目都没有提到 `tests/`，所以没有任何测试文件进过 TypeScript 程序。`pnpm run typecheck` 在一条断言都没读的情况下通过，ESLint 没有类型信息，vitest 只转译不检查。

因此测试文件可以引用一个不存在的成员、传一个没人读的属性、或者构造一个缺必填字段的 fixture，直到有人在运行时走到那条分支才会暴露。这不是假设。第一个同时覆盖 `src/**` 与 `tests/**` 的项目在 **70 个测试文件中的 22 个里报出 48 条诊断**：

- **14 条是测试验证的东西和它声称验证的不是一回事。** 一个 `MarketService` fake 少了八个接口成员（`serverConfig`、`lspStatus`、`lspServers`、`mcpOverrides`、`saveServerConfig`、`addLspServer`、`setLspServers`、`setLspServerEnabled`）——被测的路由一个都没调用它们，缺口因此不可见。一个凭据解析器被当成裸的 `async () => …` 函数传入，而声明要求的是 `{ resolve }`；一个 `Map` 被传到了声明为 `McpSuiteOverrides` 的位置：`overrides[serverKey]` 从 `Map` 上读到的永远是 `undefined`，于是这个 stub 以错误的理由表现得像 `{}`。四个 `McpStatusPayload` fixture 漏了 `totals.foreign`。
- **3 条是生产类型本身写错了。** `tests/scan-pipeline.test.ts` 构造 `{ source: 'github', repo: 'example/other' }`，而 `src/catalog/scan-resolvers.ts` 里的 `githubRepoUrl` 会读 `record['repo']`——这是 Claude Code marketplace 真实支持的简写，`MarketplaceEntry.source` 却没有声明它。
- **31 条是类型噪音**，与测试证明了什么无关：`strict` 下的 `globalThis.IS_REACT_ACT_ENVIRONMENT`、一个漏写的默认参数、一个没写类型参数的 `querySelectorAll`。

同一个缺口还有另一半。类型感知规则需要知道文件归属哪个程序，而在没有工程覆盖 `tests/` 时，带类型的 ESLint 规则集根本用不了——不只是测试，`src/` 也一样，因为配置是共用的。会推理类型的规则从来没在这个仓库跑过。

而且除非有人记得手动执行，这些检查一条都不会跑：整套质量保障只是一个你必须主动调用的脚本。

## Decision

**两个项目负责测试，镜像已发布的拆分。**

```
tests/  →  tsconfig.test.json         NodeNext · ES2024 · 无 DOM        53 个测试文件
        →  tsconfig.test.client.json  Bundler  · ES2022 + DOM + jsx    17 个测试文件
```

`package.json` 的 `typecheck` 跑全部四个工程。**拆分本身就是目的，不是配置的副产物**：服务端测试一旦去碰 `document` 就必须失败，而一个把所有测试都丢进 DOM 环境的工程做不到这一点。第一次运行就证明了边界有用——`tests/helpers/translate.ts` 从 `src/client/index.js` 引了一个类型，把整个 `src/client/**` 拖进了包含它的任何程序；该 helper 被 5 个客户端测试引用、没有任何服务端测试引用它，排除之后服务端程序里一个 `src/client` 文件都不剩。

**归属是失败关闭的。** 服务端工程用 `tests/**/*.ts` 加上按名字排除客户端产物，而不是列出自己的 53 个文件。新增服务端测试无需登记即被检查；新增客户端测试会落进服务端工程并在 `document` 上报错，直到有人把它列进客户端工程。显式 include 列表的失败方向正好相反——新增测试不属于任何工程，静默不被检查。

**lint 改为类型感知。** `eslint.config.mjs` 把解析器指向四个工程并打开推荐的 type-checked 规则集。四个工程一起列出而不是逐个指定，是因为 `src/client/**` 必然同时出现在两个工程里：`tsconfig.test.client.json` 必须包含它，CSS 模块的环境声明才能进入客户端测试程序；`tsconfig.client.json` 则拥有它作为发布构建的归属。`@typescript-eslint/require-await` 关闭，理由写在配置里：它报的每一处都是已声明 async 接缝的实现——端口、provider 或测试 mock——那里的 `async` 是形态而不是笔误。

**检查放在开发本来就会停下的地方。** `check:quick` 即 typecheck + lint，周围的路径都调用它：

| 路径                      | 触发                                                 |
| ------------------------- | ---------------------------------------------------- |
| `pnpm run test`           | `pretest` → `check:quick`                            |
| `pnpm run build`          | `prebuild` → `typecheck`                             |
| `git commit`              | 宿主对齐 + `check:quick` + `format:check`            |
| `pnpm run check:refactor` | `check:quick` + `format:check` + 契约测试 + 依赖边界 |
| 发布 tag（CI）            | `check:refactor`，随后是完整测试套件                 |

测试或构建就是开发者本来就会停下的地方；只有主动调用才跑的检查，正是本次要消除的失败模式。

## Alternatives considered

**用一个工程同时覆盖 `src/**` 与 `tests/**`。** 配置更少，也能找到同样的 48 条诊断——它们本来就是这样发现的。它输在抹掉了边界：DOM lib 对所有测试可见时，服务端测试可以随手用 `document` 和 `window` 而照样通过类型检查，事后没人能判断那是不是有意为之。之后再想找回边界，就得在一个自首次提交起就宽松的程序里重新给 70 个文件分类。

**安装 `@types/jsdom`。** 站得住：纯类型、只进 devDependencies，也是读者在 `jsdom` 依赖旁会预期看到的东西。否决理由是收益与清单代价不成比例：测试只构造一个 `JSDOM` 实例并读取 `window.localStorage`，`tests/jsdom.d.ts` 正好声明这些而不是 `any`；一旦测试用到更多 jsdom API 就会编译失败，直到声明被补齐——这恰恰是宽松的 `any` 会抹掉的行为。

**单独的 `typecheck:tests` 脚本。** 加起来更省事，也更容易被跳过。`check:refactor` 才是提交前与打 tag 前真正会跑的关卡，关卡之外的检查等于没人跑的检查。

**把类型感知规则作为独立改动先落地，之后再修它们报出的问题。** 这是最初的排序，实际执行时没能成立：在测试工程存在之前这些规则根本跑不起来，而一旦存在，待修的问题就在同一批文件里。排序想换取的"可评审性"以另一种方式保留了——配置改动是一个提交，382 处修复按所涉文件分成三个提交。

**让 `pretest` 跑完整的 `check:refactor`。** 否决：格式检查和依赖边界巡游比测试套件本身还慢，而且与开发者当前的循环无关。

## Consequences

48 条诊断在没有 `any`、`as any`、`@ts-ignore`、`@ts-expect-error`、也没有放松 `strict` 的前提下修完。两处逃生舱保留，都很窄：

| 逃生舱                                                   | 位置                       | 理由                                                  |
| -------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
| `as unknown as Context & { effects: Array<() => void> }` | `tests/mcp-bridge.test.ts` | 只带 `apply` 所用成员的 cordis 假上下文；注释已说明。 |
| `declare module 'jsdom'`                                 | `tests/jsdom.d.ts`         | 声明被构造的表面而非 `any`——见上。                    |

打开类型感知规则后共报出 **555 处、涉及 148 个文件**；关掉 `require-await` 后是 **382 处、75 个文件**（`src/` 77 处，测试 305 处）。没有新增任何行内 disable，也没有误报。其中大多数是冗余断言与未加类型的 fake，规则真正换来的东西是：

- **每个写路由都在用 `String()` 强转不可信 JSON。** `{"url": {"href": "x"}}` 会注册一个 url 为字面量 `"[object Object]"` 的来源，`{"id": {}}` 能通过 `id === ''` 检查并抵达注册表。这批规则带来的 `typeof` 收窄覆盖了行为不变的那些位置；把字段读进持久状态的位置现在改为严格校验——见[路由字段类型决策](../bug-fix/2026-09-12-route-field-types.md)。
- **一个被丢掉的 rejection。** `src/runtime/project-runtime.ts` 里的 `mounts.get(agent)?.refresh()` 可能 reject——它的队列主体会重读项目目录——而宿主派发 `agent/session-start` 时不等待监听器，因此每次会话启动都可能产生未处理的 rejection。现在它会像相邻两个处理器一样记录警告。
- **一个声称了不存在否定的测试名。** 是打开类型感知规则这个动作，促使人足够仔细地读那个文件从而发现它。 **四个工程现在都让索引访问返回 `T | undefined`。** 正是这一点让 lint 阶段删掉的那一百余处非空断言看起来无害：`arr[0]` 的类型是 `T`，所以 `arr[0]!` 什么都没守住，而缺失的元素会以 `undefined` 抵达后续代码、编译器一言不发。开启该标志共报出 **269 处——`src/` 32 处、测试 237 处**。`src/` 现在不含任何非空断言；测试里每个 fixture 取值都经过具名守卫（`tests/helpers/fixture.ts`），fixture 不对时会说出它期望什么。**没有任何 fixture 真的缺东西**——守卫全部成立——因此标志暴露的是未经证实的前提，而不是活着的缺陷。唯一一处"缺失值被静默吸收而非失败"的地方是遗留 page mode 的 CSS 类查找；它现在发出警告且不赋类名，而不是赋字面量字符串 "undefined"。

- **该标志管不到可选属性上的断言。** `mcp?:` 字段上的 `suite.mcp!.servers` 与 `arr[0]!` 是两类东西，转换后 `src/` 里还剩十二处。它们都不是靠断言而是靠把保证变成结构性的来消除的——把值提到 `const`（参数属性的收窄在回调里会失效），或收窄产出函数的返回类型。`src/` 里没有 `!`，是因为代码本身持有该值，而不是因为该标志检查过。

- **还有四处测试名声称了断言没覆盖的东西。** 上面读文件的过程把它们翻了出来；现在每一处要么有断言支撑，要么改名到实际成立的说法。`lsp-mounts` 承诺"移除已有挂载"，但只数了 apply 次数——而它当时想用的那个共享 `disposed` 布尔量，capability seam 也会置位，所以它本来就分不清 provider 挂载和 seam；现在它记录每个 handle 被 dispose 时带的 config，并在 provider 的 disposer 被去掉时失败。`mcp-mounts` 用"disabled 或 uninstalled"描述一个两个分支都在调 `reconcile([])` 的用例，还改动了一个这条路径根本不读的 `enabled` 标志；现在它覆盖注册表真正拥有的判断——套件仍在列表里但 `activeSurfaces.hooks` 关闭时会失去它的 bridge。`mcp-config` 说"两个来源永不碰撞"，却对 server name 断言了相反的事实——它按设计就与来源无关，好让注册表跳过重复项；只有注册表 key 与 `PLUGIN_DATA` 目录是按来源区分的。`real-layouts` 把 detail 的命令数与套件自己的资源列表配对——那是拿构建器比它自己的输入，且对不声明命令的方言就是 `0 === 0`；现在断言逐行名字、内容非空，且每个声明路径都存在于 fixture 快照中。

`Simulate` 随测试修复一起消失了。两个用到它的测试不再引入 `react-dom/test-utils`，因为 `@types/react-dom` 19 对应已安装的 React 18 运行时不导出它——也因为它做的事并不是测试 DOM。`Simulate.change(node, { target: { value } })` 把伪造的 target 挂到合成事件上并直接穿过 React 的 dispatcher 派发；节点的值从未改变，React 的变更检测从未运行，处理器收到的是浏览器永远不会产生的对象。`tests/helpers/dom-events.ts` 走元素原生的 `value` setter——React 自己的 tracker 拦截实例属性，所以直接赋值会让随后的事件看起来"没有变化"——然后派发 React 监听的 `input`/`change` 事件。把两个处理器改坏会让 3 个原本通过的测试失败。

有两个类型层面的模式值得记住，因为它们会复现：

- vitest 4 把 `expect.objectContaining` / `arrayContaining` / `stringContaining` / `any` 的类型标成 `any`，所以只要它们被**赋值**（对象字面量属性或提升的 const），`no-unsafe-assignment` 就会报；作为直接实参传入则不会。修法是把匹配器移进实参位置（`toHaveProperty(path, expect.anything())`），而不是加 cast；提升成 `const` 与 `satisfies` 都仍然会报。
- `no-base-to-string` 对裸 `unknown` 不报，只有当某个守卫（`?? ''`、`!== undefined`）把 `unknown` 收窄成 `{}` 之后才报。因此无 cast 的修法需要真正的 `typeof` 收窄，或者一个参数本身是 `unknown` 的 helper。

本 note 此前称"暂不拆分"的投影边界（`Suite.activeSurfaces` 可选）现在已是独立类型——见[套件生命周期决策](../architecture/2026-09-12-suite-lifecycle-shapes.zh.md)。

## Testing

- `pnpm run typecheck` 跑全部四个工程；两道关卡是 `check:quick` 与 `check:refactor`。四个工程都开启 `noUncheckedIndexedAccess`，因此发布代码与测试两侧的索引访问都是 `T | undefined`。
- `tests/` 在 lint 修复前后都是 70 个文件、506 个测试。
- 每个测试文件恰好属于一个工程（53 + 17），用 `tsc --listFilesOnly` 断言。
- 边界从另一侧也被断言：一个使用 `document` 的探针文件在 `tsconfig.test.json` 下失败、在 `tsconfig.test.client.json` 下通过。
- 门禁本身做过反证：从某个 `McpStatusPayload` fixture 里删掉 `foreign`，`pnpm run typecheck` 退出码为 2。
