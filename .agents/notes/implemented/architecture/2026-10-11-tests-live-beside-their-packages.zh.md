# 测试与包同住

日期:2026-10-11。类别:architecture。状态:implemented。

## 决策

全部 vitest 用例从中央 `tests/` 树迁入被测包,落在 `packages/<pkg>/test/`。三条摆放规则:

- **单包用例**放进该包的 `test/`。
- **跨包用例**(213 个中约 125 个)放进 `packages/market-bundle/test/integration/`:bundle 是组合根,集成覆盖属于它装配的组合。服务端共享 helper(`fixture`、`bridge-config`、`projected-suite`)与 fixture 语料(`integration/fixtures/`)同住此处。
- **仓库级用例**(脚本、CI 门、仓库卫生)放进 `packages/market-bundle/test/repo/`;例外是依赖运行时的 `extension-native-skill-shadow`,住在 `packages/market-runtime/test/repo/`。

内置 schemas 库从根目录 `schemas/` 迁入 `packages/market-catalog/schemas/`,因为 market-catalog 是它唯一的代码消费方。npm `files` 清单保持按同一路径发布,打包产物不变。`market-catalog/src/scanning/validate.ts` 的 `schemasDirectory()` 同时解析工作区布局与打包布局。

仅 DOM 的用例经 `tsconfig.test.client.json` 保持独立类型检查通道;`market-ui` 之外需要 jsdom 的用例改用文件内 `@vitest-environment jsdom` 注记,而不是配置排除清单。

## 备选方案

- **保留中央 `tests/` 树。** 拒绝:仓库根是契约层(见 AGENTS.md conventions),300 个文件的中央树掩盖了"哪个行为归哪个包"。根目录 `tests/` 是根清单里最大的非契约项。
- **给每个工作区包独立 vitest 配置并用 `pnpm -r` 跑。** 拒绝:单一串行运行保住了共享 fixture 的串行化保证与约 2.5 秒的墙钟时间;按包运行徒增进程数,换不来隔离。
- **把 fixtures 分进各消费包。** 拒绝:fixture 语料被 15+ 个 bundle 集成用例共享;拆分会 fork 更新脚本写入的副本。

## 后果

- `vitest.config.ts` 收 `packages/*/test/**/*.test.ts`;`pnpm run test:contract` 与 `scripts/update-layout-fixtures.mjs` 指向新路径;eslint 与 dependency-cruiser 的 glob 随树迁移(cruiser 依旧排除 `/test/`)。
- 根目录去掉 `tests/` 与 `schemas/`,根重新只剩契约文件。
- `packages/market-catalog/test/schemas.test.ts` 在新位置守护该库;`compat-report` 脚本经更新后的常量读取库路径。
- 既有失败,与本迁移无关:`zip-bomb.test.ts` 的"rejects a zip exceeding the entry-count limit"在本机默认栈下抛 "Maximum call stack size exceeded" —— 迁移前的 HEAD 基线工作树上复现一致。
