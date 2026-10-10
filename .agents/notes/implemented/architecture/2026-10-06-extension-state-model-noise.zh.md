# Agent Note: 扩展事务不进入模型输入

Status: implemented

## Problem

扩展选择提交通过注入待提交与已提交信封，让宿主在 agent/inbox/spliced 中持久记录它们。若认领副本继续成为 user/message 事件，就会在模型输入中重复不透明占位正文，却不提供任务信息。

## Decision

保留现有两阶段信封、binding schema、agent.inject 和 flush。在已就绪的 pre-step 路径中等待下一层决策，只从 enter 决策的 messages 删除本服务的选择、选择意图与恢复唤醒来源类型。保留其他字段和消息、拒绝决策以及未就绪时的重新排队路径。恢复继续按消息身份读取 inbox splice 和历史 user-message 副本。

不编辑现有对话历史。旧可见占位消息保留，直到宿主正常历史管理移除；新事务不再追加模型可见副本。

## Alternatives considered

- 删除或合并某个阶段：否决，恢复依赖待提交／已提交配对来区分已确认变更与中断事务。
- 清空 user-message 正文：否决，仍会创建模型消息，还可能违反适配器约束。
- 引入自定义持久事件：不需要，宿主已持久记录 inbox splice，自定义事件重放会增加兼容工作。
- 按相同正文过滤：否决，内部事务应按来源归属识别，而不是用户文本。

## Related decisions

细化[扩展预设](../../proposed/feature/2026-10-05-agent-extension-presets.zh.md)的模型输入处理；其两阶段持久化与授权设计不变。

## Verification

录制适配器测试检查真实用户输入能到达模型、新事务占位不会到达，同时两个 binding 阶段仍持久保存。恢复测试覆盖仅 splice 的日志、fork 种子、生命周期通知、待提交失败及同时包含模型副本的旧日志。运行行为变化需重载插件，不修改宿主或删除历史。
