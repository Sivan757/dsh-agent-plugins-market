## Summary / 摘要

<!-- What problem does this PR solve? Keep the change focused. / 这个 PR 解决什么问题？请保持改动聚焦。 -->

## Related issue / 关联 issue

<!-- Link an issue with `Fixes #123`, `Closes #123`, or `Related to #123`. / 使用 `Fixes #123`、`Closes #123` 或 `Related to #123` 关联 issue。 -->

## Change type / 改动类型

- [ ] Bug fix / Bug 修复
- [ ] New feature / 新功能
- [ ] Refactor without behavior change / 不改变行为的重构
- [ ] Documentation or example / 文档或示例
- [ ] Test or fixture / 测试或 fixture
- [ ] Build, packaging, or CI / 构建、打包或 CI
- [ ] Security or dependency update / 安全或依赖更新

## What changed / 改动内容

<!-- Describe the important implementation and user-visible behavior. / 描述重要实现和用户可见行为。 -->

## Validation / 验证方式

<!-- List the exact commands you ran and their outcomes. / 列出实际运行的命令及结果。 -->

```text
pnpm run check:refactor
pnpm run test
pnpm run build
```

## Compatibility and security / 兼容性与安全

<!-- Explain API, persisted state, generated artifacts, performance, or security impact. / 说明 API、持久化状态、构建产物、性能或安全影响。 -->

## Screenshots or recordings / 截图或录屏

<!-- Required for meaningful Web UI changes when useful; write N/A for non-UI changes. / 有意义的 Web UI 改动如有帮助请附截图或录屏；非 UI 改动填写 N/A。 -->

## Checklist / 检查清单

- [ ] I read [CONTRIBUTING.md](CONTRIBUTING.md). / 我已阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。
- [ ] I searched existing issues and PRs. / 我已搜索现有 issue 和 PR。
- [ ] I added or updated tests for behavior changes. / 我已为行为改动新增或更新测试。
- [ ] I updated documentation or explained why it is not needed. / 我已更新文档，或说明无需更新的原因。
- [ ] I ran the relevant local quality gates and recorded them above. / 我已运行相关本地质量门禁，并在上方记录。
- [ ] I checked that no secrets, private URLs, session data, or unredacted logs are included. / 我已确认没有提交秘密信息、私有 URL、会话数据或未脱敏日志。
- [ ] I ran `pnpm run build` when source changes affect published `lib/` or `client/` artifacts. / 源码改动影响发布的 `lib/` 或 `client/` 产物时，我已运行 `pnpm run build`。
- [ ] I understand that CODEOWNERS and required status checks are enforced by repository settings, not by this template alone. / 我了解 CODEOWNERS 和必需状态检查还需要仓库设置配合，本模板本身不会强制合并。
