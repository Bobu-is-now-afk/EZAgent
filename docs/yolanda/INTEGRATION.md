# YOLANDA 模块集成说明

## 独立入口

- 页面：`/yolanda-review`
- 工作流配置器：`/yolanda-builder`
- 页面组件：`components/yolanda-review/review-workbench.tsx`
- 类型与规则：`lib/yolanda-review/`
- 发票执行入口：`/invoice-demo`

`/yolanda-builder` 已由主舞台入口挂载为独立配置组件，但不把财务复核 UI 嵌入配置流程。详见 `WORKFLOW-BUILDER.md`。

## 工作流配置接口

首页将“试用发票整理”与“设计工作流程”分开。前者进入真实发票 Agent，后者进入 Builder；配置完成不等于已经执行。

首页沿用团队最初的居中四卡片工作区视觉，DOM 与键盘阅读顺序固定为：本机 AI 状态、本机 AI 对话、设计工作流程、试用预设工具。首次引导只在浏览器保存版本化的“已处理”标记，不保存聊天内容，也不把进入聊天记作已经完成真实对话。跳过只滚动并聚焦工具入口，不会下载模型、建立计划或运行 Agent。

`WorkflowComparisonBanner` 是 Builder 与发票预设工具共用的纯展示组件。它只读取 locale 与浏览器的可见性／减少动画偏好，使用固定合成资料，不读取工作流、票据、身份或审批状态，不发起模型、业务 API 或外部资源请求。横幅用于说明“资料值可变、模板与规则保持一致”，不能作为真实模型或执行结果的证据。

当前页面不要求注册账户。未来“绑定主机板＋输入 License 解锁”属于发行、设备识别、License 生命周期与服务端验证设计，本轮没有实现；任何本地标记、浏览器储存或前端状态都不能当作 License 安全边界。

`workflow-config.ts` 的 `WorkflowConfig` 是配置、摘要、Prompt、备份和保存数据的唯一来源。宿主不要把派生 Prompt 当成配置或权限载体。

本机接口由 `workflow-storage.ts` 提供：`saveWorkflow`、`listSavedWorkflows`、`getSavedWorkflow`、`saveWorkflowVersion`。当前实现是浏览器 IndexedDB；读取时会通过 `migrateStoredWorkflow` 兼容旧 schema，工具库负责人可以在不改变页面状态模型的情况下提供第二个 adapter，并须保持相同迁移边界。

跨浏览器、跨站点来源或组织共享需要服务端存储，不能把 IndexedDB 描述成企业共享库。宿主若要在首页列出工作流，应读取同一 `listSavedWorkflows` 接口，不另建 localStorage 列表。

首页的引擎状态必须来自真实 capability 检测。没有检测结果时显示“未检查”或“执行能力尚未接入”，不得固定显示 `100% Offline Engine Active`。在 JASON 提供可完成的运行入口前，Builder 不显示“沿用规则”之类会停在提示文字的主操作。

`workflow-preview.ts` 提供普通用户的规则预演。`runWorkflowPreview(config, requestId)` 读取 schema `1.2` 的结构化预演参数，返回绑定 `workflowId + revision + requestId + caseVersion` 的内置案例结果。配置 revision 或案例版本不一致时，调用方必须丢弃旧结果。它不读业务文件、不持久化结果，也不改变运行状态。

`workflow-runner.ts` 保留为开发用结构化资料校验。它不是 OCR 或正式执行器。正式发票执行复用现有 `/api/agent/plans`、`/api/agent/runs` 与确定性工具链。

`workflow-governance.ts` 保存公司、部门、创建者、修改者、时间及最低试跑/编辑角色，并通过 `canWorkflowAction` 判断查看、试跑、创建、编辑、删除和权限管理。当前 `DEMO_WORKFLOW_IDENTITIES` 仅供界面演示。生产宿主必须用可信组织成员、服务端授权和资源级策略替换，且不能相信导入 JSON、IndexedDB 或前端传来的角色。

`workflow-storage.ts` 新增 `deleteSavedWorkflow`，会删除当前浏览器内的最新配置与全部本机版本。生产删除应改为可审计、可恢复的服务端归档/保留流程。

配置状态、能力状态和运行状态分别展示。模型就绪只说明 Planner 可用，不代表任意 Builder 配置可执行。任何模型建议都不能自行开启发送、覆写或额外文件访问。

首页保留完整本机 AI 准备流程；Builder 只显示只读状态与按需展开的准备操作。自动检查使用 `GET /api/local-ai`，不会下载、安装、启动引擎或修改模型选择；下载或启动只可由明确的用户操作触发。

### Builder → 发票 Agent 交接

`workflow-agent-handoff.ts` 是唯一交接适配层。Builder 跳转时 URL 只传 `workflowId` 与 `revision`；Agent 从同一 IndexedDB 读取精确版本。URL 不携带规则或发票正文。找不到版本或版本不一致时拒绝交接，不降级到其他版本。

| Builder 配置 | Agent 参数／行为 | 规则 |
| --- | --- | --- |
| 发票门槛（主要货币单位） | `thresholdMinor` | 转为整数最小货币单位；执行器使用严格大于 `>`，不含相同金额 |
| 单一接受币种 | `currency` | 精确匹配，不换汇 |
| 缺失字段处理 | 固定必填字段验证政策 | 保留记录、空值、来源和检核标记，不编造补全；不能通过 Builder 关闭人工检查 |
| 日期解释 | 未支持 | 明确列为未支持，不静默转换 |
| 自由文本／`recorded-only` | 未支持 | 影响预期结果时阻止“完整工作流”交接 |

交接结果包含工作流 ID、revision、映射参数、未支持要求、阻止原因和用户可读摘要。点击“交给发票 Agent”只导航，不选择资料、不建立计划、更不启动运行。后续顺序固定为：读取精确配置版本 → 重新选择本次资料 → 生成候选计划 → 核对计划差异 → 明确确认 → 创建 Run。

Planner API 仍验证参数范围；Run API 重新验证工具、步骤、参数、验收条件与幂等键。可选 `workflow.origin` 仅记录 Builder 工作流 ID 与 revision，供追溯使用，不是身份、授权或可信确认。来源、门槛、币种、步骤或行为版本变化都会改变确认签名，使旧确认失效。运行快照保存实际执行的 workflow，不会把新配置追溯应用到旧 Run。

完成后的 CSV artifact 带服务端生成的 `summary.rowCount` 与 `summary.reviewCount`。结果页无需先下载即可显示真实摘要；下载后再解析同一 CSV 供逐行核对。旧 artifact 没有 summary 时仍可读取，界面只在实际 CSV 已载入后补显示数量。

## 数据入口

`lib/yolanda-review/types.ts` 定义 `ReviewBatch`、`Evidence`、`ReviewDocument`、`LedgerRow`、`Draft`、`CalculationResult`、`ChangeEvent` 和 `ApprovalSnapshot`。稳定业务 ID 不使用数组序号。

`lib/yolanda-review/adapter.ts` 暴露最小接口：

```ts
interface ReviewAdapter {
  calculate(batch: ReviewBatch, requestId: string): Promise<CalculationResult>
}
```

计算响应必须回传 `batchId + revision + requestId`。reducer 只接收与当前请求三项都一致的响应。JASON 后续可按此接口提供真实批次与计算结果，不需要新增 HTTP API 假设。

当前 `demoAdapter` 明确只处理合成数据。真实 adapter 未连接时，不得静默回退合成结果。工作副本导入检查版本、集合、唯一记录 ID、证据引用、100 条记录上限、2 MB 文件上限和 10,000 字草稿上限；生产接入仍应采用正式 schema validator 并补齐全部字段级限制。

模块边界、状态机不变量和有意保留的最小抽象见 `ARCHITECTURE.md`。接入真实 adapter 时应保持现有接口和三元响应校验，不应把网络、认证或持久化逻辑塞入页面组件。

Logic Pills 的当前接口和产品边界见 `LOGIC-PILLS.md`。首版 Pills 只存在于页面内存并生成可复制文本，不进入工作副本、批准快照或计算 adapter。后续若让 Pill 驱动任务，必须为每个 Preset 提供显式编译器、schema 版本、能力声明和服务端策略复核；禁止把任意提示词直接等同于可安全执行的工具权限。

当前语言状态只存在于页面内存，不写入工作副本或用户偏好。繁中模式采用 `zh-Hant`，只翻译系统文案；来源证据、技术 ID、币种、使用者输入和审计事件保持原值。若宿主需要记忆语言偏好，应由宿主提供可信的 locale，并另行规定持久化与回退策略。

## 身份和策略入口

当前页面可显式切换 `demo-reviewer` / `demo-manager`，仅用于比赛演示。它不是身份认证。真实接入由 SAYA 或宿主传入可信角色并隐藏演示切换。未来任何服务端批准或导出操作必须重新核验身份、版本和权限，不能信任前端 state 或导入 JSON。

固定策略不可由 adapter、证据文本或表单放宽：

- 不发送消息；
- 不覆盖原账本；
- 不访问用户未选择的文件；
- 不做云端回退；
- 不把批准解释为付款、发送授权或专业合规结论。

## 输出

有效经理批准冻结由 reducer 根据当前批次构造的快照；页面不能注入任意批准内容。页面从冻结快照生成：

- `ezagent-<batchId>-v<revision>-review.json`
- `ezagent-<batchId>-v<revision>-results.csv`
- `ezagent-<batchId>-v<revision>-drafts.txt`

CSV 对公式前缀及前导空白/控制字符变体加保护。数值列由严格金额解析结果生成。JSON 保留原始值。批准前只能生成文件名含 `UNAPPROVED` 的工作副本。

## 宿主负责人待办

以下事项需要修改白名单外文件，本分支未实施：

1. 首页“自订工具库”读取 `listSavedWorkflows` 或等价 adapter，并显示同一工作流；
2. 在现有发票 Agent 之外扩展其他行业的正式 adapter 与错误约定；
3. SAYA 本地模型连接、可信身份和固定策略注入；
4. 服务端重新核验身份、版本和操作权限；
5. 根布局 production Analytics 的离线策略；
6. 整机断网、真实文件权限和整应用外联审计；
7. 生产级不可篡改审计、签名与数据保留政策。
8. Logic Pill 持久化、Preset 编译器、模型 adapter、组织模板治理及会员服务。
9. 为正式发行定义主机绑定、License 签发／撤销／迁移及离线宽限政策；不得复用浏览器 localStorage 或前端状态作为授权依据。
10. 为 `receipt.read`、`table.create` 等能力建立正式参数 schema 和试跑协议。
11. 若要保存或共享执行记录，建立与配置版本分离的 run store；不要把运行结果塞回 `WorkflowConfig`。
12. 提供真实 Organization / Department / Membership / Role 数据和服务端资源授权，不复用演示身份。
13. 明确工作流删除、归档、恢复、离职转交和跨部门移交政策。

模块自身没有自动外部请求、CDN、远程字体、遥测、后端或数据库。用户点击本地模型帮助时会主动离开本站，访问 Ollama 官方下载或模型页面；此事实不能扩展为“整个应用完全离线”的声明。
