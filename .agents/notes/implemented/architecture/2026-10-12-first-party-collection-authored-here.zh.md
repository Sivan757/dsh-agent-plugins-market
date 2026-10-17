# 第一方插件集合在本仓库创作

日期:2026-10-12。类别:architecture。状态:implemented。

## 决策

`dsh-agent-plugins` 集合(`plugin-dev`、`toolkit`、`engineering` 三个套件)迁入本仓库 `plugins/`。独立集合仓库的使命随本次迁移结束;内容树改为在本仓库创作、评审与校验。市场自己的扫描器在同一棵树里守卫集合:`packages/market-catalog/test/first-party-plugins.test.ts` 对每个 `plugins/<name>` 目录跑 `scanSource`,清单偏离内置 schemas 或扫描链产生 note 时直接失败该树。命名空间创作指南并入 `docs/reference/harness-namespace-authoring.md`;集合 README 随 `plugins/` 同住。内容树加入 `.prettierignore` —— 集合内容按创作原样发布,prettier 无权重排散文资产。

预置源契约不变。`preset-source.ts` 依旧把 `dsh-agent-plugins` 注册为指向集合仓库 URL 的 git 源,全新安装的发现路径不变。URL 继续可解析,因为集合仓库保留在 GitHub;发布内容变更现在是本仓库落地后,再向集合仓库推送一次。

## 备选方案

- **git subtree。** 保留一提交双开发,但每次内容变更多一道推送仪式,还需要团队约定 `plugins/` 为何与其他目录行为不同。集合除本插件外没有下游消费方,第二个远端没有承载任何东西。
- **维持两个仓库。** 分离把每次 schema 或规范变更逼成跨仓舞蹈:在这边改 schemas,在那边猜集合影响,靠手工验证。同树校验消掉整类问题。
- **并入 npm 产物。** 预置源按 git 获取;把内容树装进 npm tarball 需要新的自指源类型加存量安装的状态迁移,相比多一次推送没有任何收益。

## 后果

- 仓库根多一个目录条目;根目录放置规则不受影响(内容树不是根文件)。
- 发布集合变更是两次推送:先本仓库,再集合仓库(直到其退役或改作他用)。
- 守卫测试即合规门;它失败的是内容树而非扫描器,扫描器变更若开始拒绝合法集合内容,会在同一提交内暴露。
