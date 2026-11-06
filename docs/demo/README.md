# HTML demo：ETO 评审台账

打开 `eto-ledger.html`，双击即可，无外部依赖（内联 CSS/JS，37 KB）。

这是**方案里提议的形态**，不是现有面板。现有面板的截图在 `shots/before-*.png`，用于对照。

## 三个视图

| 视图 | 看什么 |
|:--|:--|
| 台账 | 每条评审一行：结论状态、**用了几个架构（Qwen·GLM…）**、谁掉队、耗时。右栏是详情 —— 分数、**融合结论（synthesis）**、每个 peer 的疑虑与建议、**掉队原因**、原始 JSON |
| 依据 | 8 条实测证据。每张卡底部写了复跑命令或数据文件路径 |
| 触发 | 什么时候该跑共识评审、什么时候明确不该跑 |

## 数据来源（全部真实，没有编造）

| 记录 | 来源 |
|:--|:--|
| r1 `approved 0.75` | 2026-11-06 19:18 本机实跑 `eto_consensus`，56.9s，auditor 因解析失败掉队 |
| r2 `revise 0.50` | 2026-11-06 19:23 本机实跑，76.2s，coder 与 auditor 都 30s 超时 |
| r3 `approved 0.80` | `~/.eto/shared_memory/peer_score:*.json`（18:23 那次，三个 peer 全绿）。**输入没有留存**，所以详情里明确写了这一点 |
| r4 `只有路由` | `~/.eto/shared_memory/flow:last.json`，面板「完整流程」的全生命周期唯一一条记录 |

「依据」页里的 `eto_route` 十条任务对照表，是 2026-11-06 逐个跑 `eto_runner.py eto_route` 的输出。

## 截图

| 文件 | 是什么 |
|:--|:--|
| `shots/before-panel.png` | 现有面板：输入框 + 4 个按钮 + 空时间线（全新浏览器 profile，所以时间线是空的） |
| `shots/before-review-409.png` | 现有面板点「评审」：462ms 返回 409，`panel scoring needs peerScoreProvider and peerScoreModel in the ETO settings page` |
| `shots/after-ledger-r1.png` | 本 demo 的台账 + 详情（r1：一个 peer 掉队） |
| `shots/after-ledger-r2.png` | 本 demo 的 r2：两个 peer 超时，错误原文与代码层原因分两栏 |
| `shots/after-evidence.png` | 本 demo 的「依据」页 |
| `shots/after-trigger.png` | 本 demo 的「触发」页 |
| `shots/ledger-before-fusion.png` | 台账列表 + 详情（补 fusion/synthesis 前：列表行只有「几个 peer 掉队」，无架构、无融合结论） |
| `shots/ledger-after-fusion.png` | 台账列表 + 详情（补 fusion/synthesis 后：列表行显示 `2 架构（Qwen·GLM）`，详情顶部有「融合结论」） |

截图口径：同一台机器、同一浏览器（Chromium headless）、1440×900、深色主题。

## demo 刻意不做的事

- 不显示伪造的阶段进度（ETO 在 `peer_review` 返回前不吐任何阶段信息）
- 不做「导入到对话」（浏览器半区拿不到 host 的 `agents`，已确认必然失败）
- 不把 `eto_route` 包装成有用功能
- 不画一个漂亮的假采纳率 —— 「有用」标记需要人点，没点就是没有数据
