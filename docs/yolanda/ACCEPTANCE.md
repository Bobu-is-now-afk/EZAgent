# YOLANDA 模块验收记录

日期：2026-10-03。数据：明确标记的合成批次，不含真实客户记录。

## 环境与命令

- Node.js `v22.23.2`
- pnpm `11.19.0`（项目声明 `pnpm@12.3.4`，本机 Corepack 实际执行版本不同）
- Edge headless：本机已安装版本
- 页面：`http://localhost:3107/yolanda-review`

执行命令：

```powershell
pnpm exec tsc --noEmit
pnpm exec tsc -p tests/yolanda-review/tsconfig.json
node --test D:\work\scratch-2026-10-03\ezagent-yolanda-tests\tests\yolanda-review\engine.test.js
$env:APPDATA='D:\work\scratch-2026-10-03\ezagent-yolanda-appdata'
$env:NEXT_TELEMETRY_DISABLED='1'
pnpm build
pnpm dev --port 3107
node tests/yolanda-review/browser-smoke.mjs
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
| A03 | 通过 | 假设表单限制容差 0–100 cents、日期窗口 0–7 days，字段映射重复时报错；保存触发重算。未声称重新 OCR。 |
| A04 | 通过 | 自动化测试覆盖台账行占用冲突。 |
| A05 | 通过 | 自动化测试确认仅改草稿时数值结果保持、revision 增加、草稿复核清除。 |
| A06 | 通过 | 浏览器批准 v8 后编辑为 v9；批准失效，历史保留，正式导出按钮消失。 |
| A07 | 通过 | 自动化 reducer 测试拒绝 requestId 不一致的旧结果。 |
| A08 | 通过 | 浏览器触发明确合成 adapter 失败，旧结果不可用；点击 Retry 后最新版本恢复。 |
| A09 | 通过 | UI 禁用 operator 批准；自动化测试确认 reducer 再次拒绝。 |
| A10 | 通过 | 恶意示例按 `<script>...` 纯文本显示；浏览器流程无发送动作。 |
| A11 | 通过 | 浏览器从批准 v8 生成 JSON 下载，再修改到 v9；v9 无法沿用 v8 导出。 |
| A12 | 通过 | 自动化测试覆盖公式前缀、前导空白、引号；JSON 原值不变。 |
| A13 | 通过 | 未保存编辑和硬阻塞均进入统一 approval blockers；取消恢复已保存值。 |
| A14 | 通过 | 浏览器排除保留理由；自动化测试确认全排除时 included=0 且不可批准。 |
| A15 | 通过 | 工作副本可下载/导入，导入时不接纳批准和身份。导入流程未纳入当前 Edge 自动脚本。 |
| A16 | 部分验证 | 模块合成流程只访问 localhost，未新增模块外联。未做整机断网；宿主 Analytics 仍需集成负责人核验。 |
| A17 | 通过 | Edge 在 390px 视口无横向溢出；Tab 产生可聚焦元素；表单有 label，状态有文字。未跑 Lighthouse。 |
| A18 | 通过 | 自动化测试确认事实改变后保留手写草稿并标 stale，阻止批准。 |

自动化结果：规则测试 9/9；TypeScript 检查通过；production build 通过；Edge 完整交互脚本通过。截图与批准下载保存在 `D:/work/scratch-2026-10-03/ezagent-yolanda-browser/`，属于 disposable 验证产物，不进入 Git。

## 已知限制

- 使用演示身份和前端 reducer，不构成生产安全边界。
- 没有真实 OCR、模型、认证、消息渠道、付款、账本回写、数据库或后端。
- 状态仅在内存；刷新会丢失未导出的进度。
- 浏览器下载只能确认已生成下载，不能证明用户已保存到预期硬盘位置。
- 工作副本校验是最小入口校验，不替代生产 schema validator。
- 未验证 Lighthouse、屏幕阅读器实测、真实数据、大批次性能、整机断网和宿主 Analytics。
