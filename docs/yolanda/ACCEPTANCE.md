# YOLANDA 模块验收记录

日期：2026-10-07。数据：明确标记的合成批次与工作流配置，不含真实客户记录。

## 环境与命令

- Node.js `v22.23.2`
- pnpm `11.19.0`（项目声明 `pnpm@12.3.4`，本机 Corepack 实际执行版本不同）
- Edge headless：本机已安装版本
- 页面：`http://localhost:3107/yolanda-review`
- 配置器：`http://localhost:3107/yolanda-builder`

执行命令：

```powershell
pnpm exec tsc --noEmit
pnpm exec tsc -p tests/yolanda-review/tsconfig.json
node --test D:\work\scratch-2026-10-05\ezagent-yolanda-tests\tests\yolanda-review\engine.test.js
$env:APPDATA='D:\work\scratch-2026-10-05\ezagent-yolanda-appdata'
$env:NEXT_TELEMETRY_DISABLED='1'
pnpm build
pnpm dev --port 3107
node tests/yolanda-review/browser-smoke.mjs
node tests/yolanda-review/workflow-builder-smoke.mjs
```

首次 `pnpm build` 因 Next.js 在 C 盘用户配置目录执行跨盘 rename 返回 `EXDEV`。将仅构建期 `APPDATA` 指向 D 盘 scratch 后成功。项目文件和配置未因此改变。

## P1–P4

- P1：完成类型、8 个合成案例、精确金额解析、匹配规则、版本状态、竞态检查和规则测试。
- P2：完成独立 route、假设确认、证据只读显示、字段更正、候选匹配、理由与排除操作。
- P3：完成草稿复核、审批快照、批准失效、工作副本、JSON/CSV/TXT 下载。
- P4：完成失败/重试、旧响应拒绝、权限双重检查、响应式布局、键盘焦点和集成文档。

## A01–A18

| 编号 | 结果 | 证据 |
| --- | --- | --- |
| A01 | 通过 | 自动化规则测试；初始页面列出未确认假设。 |
| A02 | 通过 | 浏览器把 `rec-002` 金额从 `865.00` 更正为 `86.50`，revision 增加，原建议仍显示。 |
| A03 | 通过 | 假设表单限制容差 0–100 cents、日期窗口 0–7 days；字段映射和日期格式会实际参与 adapter 校验，不支持的映射/格式明确失败。未声称重新 OCR。 |
| A04 | 通过 | 自动化测试覆盖台账行占用冲突。 |
| A05 | 通过 | 自动化测试确认仅改草稿时数值结果保持、revision 增加、草稿复核清除。 |
| A06 | 通过 | 浏览器批准后再编辑；批准失效，历史保留，正式导出按钮消失。 |
| A07 | 通过 | 自动化 reducer 测试拒绝 requestId 不一致的旧结果。 |
| A08 | 通过 | 浏览器触发明确合成 adapter 失败，旧结果不可用；点击 Retry 后最新版本恢复。 |
| A09 | 通过 | UI 禁用 operator 批准；自动化测试确认 reducer 再次拒绝。 |
| A10 | 通过 | 恶意示例按 `<script>...` 纯文本显示；浏览器流程无发送动作。 |
| A11 | 通过 | 浏览器从批准快照生成 JSON 下载；修改后无法沿用旧批准导出。CSV 含批准 ID、批准 revision、原值和复核值。 |
| A12 | 通过 | 自动化测试覆盖公式前缀、前导空白、引号；JSON 原值不变。 |
| A13 | 通过 | 未保存编辑按区域进入统一 approval blockers；保存其他区域不会误清除；取消恢复已保存值。 |
| A14 | 通过 | 浏览器排除保留理由；自动化测试确认全排除时 included=0 且不可批准。 |
| A15 | 通过 | Edge 实际下载并重新导入 UNAPPROVED 工作副本；深校验引用、ID、金额、日期和长度，且不接纳批准与身份。 |
| A16 | 部分验证 | 模块合成流程只访问 localhost，未新增模块外联。未做整机断网；宿主 Analytics 仍需集成负责人核验。 |
| A17 | 通过 | Edge 在 390px 视口无横向溢出；Tab 产生可聚焦元素；表单有 label，状态有文字。未跑 Lighthouse。 |
| A18 | 通过 | 自动化测试确认事实改变后保留手写草稿并标 stale；页面显示新建议，可采用或继续手写，未解决前阻止批准。 |

自动化结果：规则测试 23/23；TypeScript 检查通过；production build 通过；Edge 完整交互脚本通过。截图、批准下载和工作副本下载保存在 `D:/work/scratch-2026-10-05/ezagent-yolanda-browser/`，属于 disposable 验证产物，不进入 Git。

三轮自审：第一轮修正审批/导出权限、分区脏状态和真实交互语义；第二轮收敛 adapter、状态机、导入边界和导出边界；第三轮补齐真实模式拒绝、导入净化、草稿竞态和浏览器回归。

## Logic Pills 扩展验收

- 通过：财务 assumptions 可同步成日期、字段映射、匹配容差、人工决策和输出五类可编辑 Pills。
- 通过：6 个跨业务模板、5 个分类和 4 种用户画像可实际切换。
- 通过：白话描述按公开的本地规则拆成 Pills；最多 12 条/次、20 条/页面，ID 碰撞有测试。
- 通过：Pill 可新增、删除、修改、启用和停用；提示词只包含启用且非空条目。
- 通过：浏览器实际完成模板切换、白话生成、新增、编辑、删除及财务 Preset 同步。
- 通过：Logic Studio 操作不推进财务 revision，不影响既有 A01–A18 审批流程。
- 边界：没有调用真实模型；Pills 不进入工作副本或批准快照，也不驱动当前计算。

## 中英切换验收

- 通过：页首 `EN / 繁中` 按钮双向切换，页面根节点同步设置 `lang="en"` 或 `lang="zh-Hant"`。
- 通过：繁中覆盖导航、模板分类、用户画像、Preset Pills、提示词结构、财务设定、文件复核和批准区。
- 通过：繁中 Prompt 使用繁体字的角色、目标、执行契约与输出结构。
- 通过：切换语言会翻译系统提供的 Preset 内容；使用者自行修改或生成的 Pill 内容保留原文，避免静默改写。
- 通过：Edge 实际完成英转繁中、繁中转英文、完整审批流程，并在 390px 繁中界面确认无横向溢出。
- 边界：来源证据、技术 ID、币种、使用者输入及既有审计内容不会自动翻译。

## 已知限制

- 使用演示身份和前端 reducer，不构成生产安全边界。
- 没有真实 OCR、模型、认证、消息渠道、付款、账本回写、数据库或后端。
- 状态仅在内存；刷新会丢失未导出的进度。
- Logic Pills 与提示词配置也只在页面内存；尚无保存、共享、发布或会员定制服务。
- 浏览器下载只能确认已生成下载，不能证明用户已保存到预期硬盘位置。
- 工作副本已做深层运行时校验，但仍不替代生产 schema、签名、来源认证和服务端授权。
- 未验证 Lighthouse、屏幕阅读器实测、真实数据、大批次性能、整机断网和宿主 Analytics。

## 工作流配置器验收

| 标准 | 结果 | 证据 |
| --- | --- | --- |
| 页面目的清楚 | 通过 | 首屏只显示“建立工作流程”、一句说明、主输入和三个短示例。 |
| 不看 Prompt 可完成 | 通过 | Prompt 和 JSON 默认位于关闭的“进阶设置”；三步核心流程不依赖它。 |
| 单一配置源 | 通过 | 自动化测试确认规则编辑同时进入 Prompt 与序列化配置；页面摘要读取同一对象。 |
| 关键问题阻止确认 | 通过 | 规则测试拒绝必答问题或待确认推测仍存在的配置。 |
| 重整不覆盖人工修改 | 通过 | 稳定 ID 与 `user-edit` 合并测试保留手写规则和已回答问题。 |
| 保存后刷新恢复 | 通过 | Edge 保存至 IndexedDB，刷新后从“打开本机草稿”恢复名称、revision 和规则。 |
| 未保存状态明确 | 通过 | 名称或规则变化后显示未保存；保存成功才显示本机保存提示。 |
| 模型/执行边界诚实 | 通过 | 页面标记本机规则整理、能力未接入；没有运行或批准按钮。 |
| 非票据场景无财务字段 | 通过 | 自动化测试确认通用场景不包含 currency 或 tolerance。 |
| 主流程无业务审批 | 通过 | `/yolanda-builder` 没有经理切换、票据核对、金额修正或批准导出。 |
| 导入不继承信任 | 通过 | 导入校验后 revision 增加，confirmation 清空，execution 重置为 not-connected。 |
| 文件边界 | 通过 | 新文件仅位于 YOLANDA 白名单；首页、根布局、依赖和配置未修改。 |

新增规则测试 11 项；与原测试合计 34 项。Edge 实际完成规则编辑、关键问题确认、命名保存、刷新恢复、Prompt/JSON 一致性、EN/繁中切换和 390px 布局。截图位于 `D:/work/scratch-2026-10-07/ezagent-yolanda-builder-browser/`，不进入 Git。

工作流配置器已验证 IndexedDB 保存与当前浏览器恢复；未验证跨浏览器同步、工具库挂载、真实本地模型、JASON 试跑 adapter、屏幕阅读器或 Lighthouse。
