# Reasonix — 并行会话注册表

> 文件接力协议：Claude Code（计划审计）↔ Reasonix（编码实现）

| 会话 | Agent | 状态 | 焦点 | 最后活跃 |
|:-----|:------|:-------|:-----|:---------|
| main | Claude Code | ACTIVE | 计划/审计/统合 | 2026-07-04 |
| coder | Reasonix | CLOSED | Step 3: eto-mesh CLI | 2026-07-04 |
| coder | Reasonix | CLOSED | Phase 2-01: Async Stitcher + Profile | 2026-06-27 |
| coder | Reasonix | CLOSED | Phase 2-02: Decompose + Dispatch | 2026-06-27 |
| coder | Reasonix | CLOSED | Phase 2-03: Synthesis + Guards | 2026-06-27 |

## 活跃锁

| 路径 | 持有者 | 操作 |
|:-----|:-------|:-----|
| `docs/handoffs/reasonix/plan-teal-runtime-phase-a.md` | Claude Code | 📝 计划就绪 |
| `eto/cli.py` | — | ✅ Step 3 完成 (Reasonix) |
| `eto/stitches/mcp_dispatch.py` | — | ✅ Step 4 fix 完成 (Reasonix) |
| `scripts/install-eto-*.sh` | — | ✅ Step 5 完成 (Reasonix) |
| `eto/extensions/eto.ts` | Reasonix | 🔒 接入竞标逻辑 |
| `eto/mcp_server.py` | — | ✅ Step 5 完成 |
| `eto/stitches/bidding/protocol.py` | Reasonix | 🔒 新建：竞标层 |

## 协议

- **Claude → Reasonix**: `docs/handoffs/reasonix/plan-<任务名>.md`
- **Reasonix → Claude**: `docs/handoffs/reasonix/completion-<任务名>.md`
- 人类触发流转：「去看 docs/handoffs/reasonix/plan-xxx.md」→「审计」
- 改文件前先声明锁（在 INDEX.md 中登记持有者+操作），改完释放
