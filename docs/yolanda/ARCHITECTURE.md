# YOLANDA 复核模块架构边界

## 深模块分工

- `adapter.ts`：唯一计算适配口。合成模式只处理明确标记的演示批次；真实模式未接入时返回错误，不静默降级。
- `engine.ts`：纯计算与业务规则，包括严格日期/金额解析、日期范围、字段映射、唯一匹配和阻塞项。
- `state.ts`：工作流状态机。集中维护 revision、分区脏状态、异步竞态、复核、批准、撤销和导出权限。
- `working-copy.ts`：不可信 JSON 的导入边界。负责结构校验、引用完整性、大小限制和身份/审计字段净化。
- `export.ts`：只从有效批准快照生成正式输出，并执行 CSV 注入保护。
- `logic-pills.ts`：通用模板、画像、确定性白话拆分和提示词组装。纯函数接口，不访问网络或页面状态。
- `i18n.ts`：英文与繁體中文的静态系统文案及有限运行时状态翻译；不翻译来源证据或使用者内容。
- `logic-pill-studio.tsx`：Logic Pills CRUD 与提示词预览。它不拥有财务计算、批准或真实 Agent 执行权。
- `review-workbench.tsx`：页面编排与本地表单缓冲；不拥有最终权限判断和批准快照构造权。
- `workflow-config.ts`：工作流配置器的单一配置源。集中处理稳定 ID、revision、确认失效、候选合并、摘要、Prompt 和导入净化。
- `workflow-storage.ts`：工作流本机持久化 seam。IndexedDB adapter 同时保存最新配置与版本记录。
- `workflow-builder.tsx`：三步配置页面编排。只通过配置模块修改规则，不维护第二套 Prompt 或执行设置。

## 必须保持的约束

1. 任何事实变化只推进一次 revision；无变化保存不推进 revision。
2. 脏状态按编辑区域隔离；保存一个区域不能清除另一处未保存内容。
3. 计算结果必须同时匹配 `batchId + revision + requestId`。
4. 正式批准、导出和撤销均由 reducer 再次核验经理角色与当前 revision。
5. 导入工作副本永不继承身份或批准；导入历史标为不可信来源。
6. 警告必须有人工理由，未处理草稿或 stale 草稿必须阻止批准。
7. UI 的隐藏/禁用只是体验层，不作为安全边界。
8. Logic Pills 当前只生成提示词；只有已确认的财务 execution settings 驱动现有计算。
9. 语言切换只能改写系统文案；使用者内容、证据、技术 ID 和审计记录必须保持原值。
10. Builder 的摘要、Prompt、高级 JSON、备份和 IndexedDB 数据必须由同一个 `WorkflowConfig` 派生。
11. 配置确认与执行能力是独立状态；保存不代表运行或业务批准。
12. 重新整理需求不得覆盖 `user-edit` 规则；过期 requestId 或来源 revision 的候选不得应用。

## 有意不增加的抽象

财务复核仍只有一个页面编排器和一个计算 adapter。Builder 的 IndexedDB 与未来宿主存储已经形成两个可能变化的实现方向，因此存储 seam 只暴露 save/list/get/version 四项能力。展示层不继续拆成只转发 props 的小文件；高风险版本与导入规则集中在纯配置模块。
