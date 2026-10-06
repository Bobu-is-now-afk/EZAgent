# Logic Pills 与提示词模板

日期：2026-10-06

## 当前能力

`/yolanda-review` 现在同时承担两个明确分离的角色：

1. 财务对账 Preset：现有 assumptions、计算、人工复核、批准和导出流程。
2. 通用 Logic Studio：把白话工作流拆成可编辑的 Prompt Logic Pills，并组合成可复制的提示词。

Logic Pill 包含类型、标题、指令、启用状态和来源。支持新增、删除、修改、启用和停用。类型固定为 Input、Rule、Decision、Output，使不同业务仍能共享最小工作流语言。

内置广泛模板：

- General workflow
- Finance reconciliation
- Invoice process improvement
- User registration
- Operations intake
- Customer support

内置用户画像：First-time builder、Operations owner、Domain specialist、Product team。画像只改变提示词写法和关注点，不模拟真实身份或权限。

页面支持英文与繁體中文。切换语言会重新生成系统提供的模板、画像、Preset Pills 和提示词结构；已经由使用者新增或编辑的 Pill 会保留原文，避免未经确认的自动翻译改变含义。

## 白话生成边界

当前生成器在浏览器本地按换行和标点拆句，并通过公开、确定性的关键词规则分类。它没有调用模型，不理解隐藏意图，也不会执行生成的提示词。页面会明确显示 `Local rules, not AI generation`。

财务 Preset 可以把当前日期范围、字段映射、币种、金额容差和日期窗口同步为 Logic Pills。这是对当前执行配置的可编辑提示层快照；修改 Pill 不会反向改变财务计算。实际计算仍只读取已确认的 `Finance preset settings`。

## 提示词结构

生成结果固定包含：

- Role：按用户画像调整表达和检查重点；
- Goal：用户可编辑目标；
- Logic Pills：仅包含启用且非空的 Pills；
- Execution contract：不编造事实、保留证据、披露不确定性、高风险动作交人工；
- Output：按模板提供结果结构。

提示词是文本资产，不是认证、授权、策略执行或运行成功的证明。复制提示词不会运行 Agent 或发送数据。

## 后续产品化

会员定制模板目前只有清晰标记的禁用入口，没有计费、发布、共享库或个性化服务。产品化前至少需要：

1. 可版本化的模板与 Logic Pill schema；
2. 工作副本持久化、导入校验和迁移策略；
3. 真实模型 adapter 与提示注入评估；
4. 每个 Preset 的 Pill 编译器和执行能力声明；
5. 服务端身份、权限、组织级模板治理和审计；
6. 会员权益、计费和发布流程的独立产品规格。
