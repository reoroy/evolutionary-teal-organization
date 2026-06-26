# Reasonix — 并行会话注册表

> 文件接力协议：Claude Code（计划审计）↔ Reasonix（编码实现）

| 会话 | Agent | 状态 | 焦点 | 最后活跃 |
|:-----|:------|:-----|:-----|:---------|
| main | Claude Code | ACTIVE | 计划/审计/统合 | 2026-06-26 |
| coder | Reasonix | PENDING | P0-3 扩展自动注册 + 清理 | 2026-06-26 |

## 活跃锁

| 路径 | 持有者 | 操作 |
|:-----|:-------|:-----|
| `eto/stitches/` | — | — |
| `eto/extensions/` | — | — |
| `.pi/extensions/` | — | — |
| `pi-ai/dist/providers/anthropic.js` | — | ✅ 已释放 |
| `run-eto.cmd` | Reasonix | 去掉 -p flag 进入 TUI |
| `Makefile` | Reasonix | run-proxy target |
| `verify-eto.cmd` | — | ✅ 已释放 |

## 协议

- **Claude → Reasonix**: `docs/handoffs/reasonix/plan-<任务名>.md`
- **Reasonix → Claude**: `docs/handoffs/reasonix/completion-<任务名>.md`
- 人类触发流转：「去看 docs/handoffs/reasonix/plan-xxx.md」→「审计」
- 改文件前先声明锁（在 INDEX.md 中登记持有者+操作），改完释放
