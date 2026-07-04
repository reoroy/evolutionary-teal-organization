# Reasonix — 并行会话注册表

> 文件接力协议：Claude Code（计划审计）↔ Reasonix（编码实现）

| 会话 | Agent | 状态 | 焦点 | 最后活跃 |
|:-----|:------|:-------|:-----|:---------|
| main | Claude Code | ACTIVE | 计划/审计/统合 | 2026-07-02 |
| coder | Reasonix | CLOSED | Phase 2-01: Async Stitcher + Profile | 2026-06-27 |
| coder | Reasonix | CLOSED | Phase 2-02: Decompose + Dispatch | 2026-06-27 |
| coder | Reasonix | CLOSED | Phase 2-03: Synthesis + Guards | 2026-06-27 |

## 活跃锁

| 路径 | 持有者 | 操作 |
|:-----|:-------|:-----|
| `docs/handoffs/reasonix/plan-eto-shared-memory.md` | Claude Code | 📝 计划就绪 |
| `eto/stitches/memory/teal_context.py` | — | ⏳ Step 1: 读写 + context_block |
| `eto/stitches/consensus/vote.py` | — | ⏳ Step 2: 评分/共识后写 context |
| `eto/stitches/comms/a2a.py` | — | ⏳ Step 3: 执行后写 context |
| `eto/extensions/eto.ts` | — | ⏳ Step 4: 注入 context 到 prompt |
| `eto/stitches/test.py` | — | ⏳ Step 5: context 测试 |

## 协议

- **Claude → Reasonix**: `docs/handoffs/reasonix/plan-<任务名>.md`
- **Reasonix → Claude**: `docs/handoffs/reasonix/completion-<任务名>.md`
- 人类触发流转：「去看 docs/handoffs/reasonix/plan-xxx.md」→「审计」
- 改文件前先声明锁（在 INDEX.md 中登记持有者+操作），改完释放
