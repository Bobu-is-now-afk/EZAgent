# YOLANDA 模块交接

日期：2026-10-07

## Git

- 规格基线：`3fd2dbfa6f634aa411428a220a81dd994ad416c4`
- 实施分支：`yolanda/review-module-20261003`
- 当前延伸分支：`yolanda/workflow-builder-20261007`
- 当前规则预演分支：`yolanda/workflow-preview-20261007`
- 上游操作：无 push、无 PR、无 merge、无远程设置修改
- 本地提交：见本次最终交付信息和 `git log yolanda/review-module-20261003`
- 提交身份：如仓库未配置身份，使用本次命令级 `Codex <codex@localhost>`，不修改全局设置

## 改动范围

仅包含规格白名单：

- `app/yolanda-review/page.tsx`
- `components/yolanda-review/`
- `lib/yolanda-review/`
- `tests/yolanda-review/`
- `docs/yolanda/`

未修改首页、根布局、全局样式、依赖、锁文件、配置或组员现有代码。

## 已完成

- 合成 8 案例可操作人工复核流程；
- 确定性一对一匹配、排除、阻塞和精确金额规则；
- 单调 revision、旧异步响应拒绝、失败重试；
- operator / manager 演示约束及 reducer 二次检查；
- 整批批准快照、批准失效和历史；
- UNAPPROVED 工作副本及批准 JSON/CSV/TXT 导出；
- TypeScript、规则、build、Edge 实际交互和 390px 布局验证。
- 三轮自审完成：规则/权限、模块边界、竞态与端到端回归。
- 新增 Logic Studio：6 个广泛模板、4 种用户画像、白话拆分、Logic Pill CRUD、提示词预览与复制。
- 新增英文／繁體中文页面级切换及繁中 Prompt；规则测试扩展至 23 项。
- 新增 `/yolanda-builder` 三步工作流配置器；原 `/yolanda-review` 财务示例保持独立。
- 新增统一 `WorkflowConfig`、revision/确认规则、过期候选拒绝和可信导入边界。
- 新增 IndexedDB 保存、列表、读取、版本记录、备份和恢复；工具库入口仍待宿主接入。
- Builder 支持英文／繁體中文系统界面；使用者内容切换语言时保持原文。
- 页面顶部提供本机工作流库；配置可在同一浏览器与同一站点来源重新打开。
- 票据模板提供本机结构化 JSON 试跑、逐笔错误、结果表和安全 CSV 下载；试跑结果不持久化。
- 试跑 adapter 与 UI 解耦；配置变化会清除旧结果，完整执行能力仍诚实标记为未接入。
- 新增每个工作流的本机资产管理界面，显示公司、部门、创建者、修改者、时间和版本。
- 新增员工、组长、部门经理、组织管理员四级演示组织角色，以及查看、试跑、创建、编辑、删除、权限管理六类判断。
- 新增本机删除及版本记录清除；组织管理员可设置最低试跑/编辑角色。
- Builder 普通路径收敛为收据输出示例、三项关键决定、内置规则预演与自动说明卡；JSON 校验移入开发验证折叠区。
- `WorkflowConfig` 升级为 schema `1.1`，加入结构化预演参数、真实来源标签与 `mapped`／`recorded-only` 状态；旧 `1.0` 导入保留规则但清除确认。
- 工作流库默认突出用途、最近修改时间、配置／预演／执行状态和“打开”；组织与权限资料收进管理详情，删除收进折叠菜单。

## 运行与演示

```powershell
pnpm dev --port 3107
```

打开 `http://localhost:3107/yolanda-review`。先在 `EN / 繁中` 间双向切换并检查繁中 Prompt；切换模板和用户画像，用白话生成并编辑 Logic Pills；同步 Finance preset 后确认 assumptions；更正 `rec-002` 金额和 `rec-003` 日期；排除重复、无匹配和 USD 记录；为 `rec-005` 选择候选并填写理由；复核结果和草稿；切换 Demo Manager；批准并下载；再编辑 `rec-008`，观察批准失效。

打开 `http://localhost:3107/yolanda-builder`。从收据示例开始；把日期解释从 `DD/MM/YYYY` 改为 `MM/DD/YYYY`，观察同一个 `09/10/2026` 案例变化；把接受币种改为 `HKD, USD`，观察 USD 案例从待处理变为纳入且不换汇。确认后检查说明卡与参数一致，命名并保存，再从工作流库重新打开。需要开发资料校验时才展开 JSON 区域。

## 下一步

宿主负责人按 `INTEGRATION.md` 接入 JASON 数据、SAYA 本地模型和可信身份。首页入口、根布局 Analytics、服务端授权和整应用断网验收均未在本分支扩展修改。

Builder 的下一步是由主舞台负责人挂载组件，由工具库负责人接入共享保存接口，并由 JASON 按 `INTEGRATION.md` 接收配置 revision 与独立运行参数。当前只可预演三个结构化规则并校验结构化票据 JSON；真实票据文件、OCR、通用 Agent 执行和运行记录持久化仍未接入。3 名陌生用户任务验证也尚未执行。
