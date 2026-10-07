# YOLANDA 工作流配置器

日期：2026-10-07

## 产品边界

`/yolanda-builder` 用于创建、确认和保存可复用的工作流配置。它不运行 Agent，不处理真实票据，不批准业务结果，也不发送消息或覆写文件。原 `/yolanda-review` 财务复核与审批示例继续独立存在。

配置流程只有三个步骤：

1. 描述重复工作，或从少量示例开始。
2. 按“使用资料、提取内容、处理方式、遇到问题、输出结果”确认或修改规则。
3. 命名并保存到浏览器 IndexedDB；工具库入口尚未接入。

当前“整理成步骤”使用公开、确定性的本地规则。页面明确说明它不是模型理解。SAYA 接入真实本地模型前，不得把候选配置描述成 AI 已经理解或可以执行。

## 单一配置源

`lib/yolanda-review/workflow-config.ts` 定义 `WorkflowConfig`。配置包含 schema、ID、revision、名称、目标、模板、输入、规则、待确认问题、输出、确认版本、所需能力和执行能力状态。

页面摘要、完整提示词、高级配置 JSON、备份文件、IndexedDB 记录和交接数据都只从该配置派生。提示词不是第二份配置，也不授予工具权限。

规则变化推进 revision 并清除确认；无变化保存不推进 revision。名称变化推进 revision，但可继承同一组已确认行为规则的确认状态。重新整理需求时，`user-edit` 条目与已回答问题按稳定 ID 保留。候选结果只有在 requestId 与来源 revision 仍匹配时才能应用。

## 本机保存接口

`lib/yolanda-review/workflow-storage.ts` 暴露：

- `saveWorkflow(config)`；
- `listSavedWorkflows()`；
- `getSavedWorkflow(workflowId)`；
- `saveWorkflowVersion(config)`。

当前 adapter 使用 IndexedDB 的 `workflows` 与 `workflowVersions` 两个 object stores，分别保存最新版本和版本记录。只保存配置和必要元数据，不保存票据正文、密钥或可信身份。

配置导入限制为 256 KB、50 条规则和 20 个待确认问题。导入时校验 schema、稳定 ID、集合归属和字段长度，并清除配置确认和执行能力信任。导入不会执行工作。

## 交接责任

- JASON：定义并确认 `requiredCapabilities` 对应的真实执行参数和试跑响应。
- SAYA：把需求文本送入本地模型，返回候选 `WorkflowConfig` 与待确认问题；宿主仍需执行版本和策略检查。
- 工具库负责人：通过保存接口列出和打开配置；不要复制页面内部 state 或解析提示词反推配置。

首版票据示例声明 `receipt.read` 与 `table.create`，但执行状态固定为 `not-connected`。其他自由文本场景可以保存草稿，不显示可以试跑。
