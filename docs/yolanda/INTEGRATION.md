# YOLANDA 模块集成说明

## 独立入口

- 页面：`/yolanda-review`
- 页面组件：`components/yolanda-review/review-workbench.tsx`
- 类型与规则：`lib/yolanda-review/`
- 当前入口不修改首页、根布局、全局样式或现有组件。

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

1. 首页或导航入口挂载；
2. JASON 真实结果 adapter 与错误约定；
3. SAYA 本地模型连接、可信身份和固定策略注入；
4. 服务端重新核验身份、版本和操作权限；
5. 根布局 production Analytics 的离线策略；
6. 整机断网、真实文件权限和整应用外联审计；
7. 生产级不可篡改审计、签名与数据保留政策。
8. Logic Pill 持久化、Preset 编译器、模型 adapter、组织模板治理及会员服务。

模块自身没有新增外部请求、CDN、远程字体、遥测、后端或数据库。此事实不能扩展为“整个应用完全离线”的声明。
