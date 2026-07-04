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
| `docs/handoffs/reasonix/plan-eto-mcp.md` | Claude Code | 📝 计划就绪 |
| `eto/mcp_server.py` | — | ⏳ Step 1: FastMCP Server |
| `eto/mcp_client.py` | — | ⏳ Step 2: MCP 客户端 |
| `eto/stitches/consensus/vote.py` | — | ⏳ Step 3: 加 mcp provider |
| `.mcp.json` | — | ⏳ Step 4: 注册 ETO MCP Server |
| `eto/bootstrap/config_template.py` | — | ⏳ Step 4: 配置示例 |

## 协议

- **Claude → Reasonix**: `docs/handoffs/reasonix/plan-<任务名>.md`
- **Reasonix → Claude**: `docs/handoffs/reasonix/completion-<任务名>.md`
- 人类触发流转：「去看 docs/handoffs/reasonix/plan-xxx.md」→「审计」
- 改文件前先声明锁（在 INDEX.md 中登记持有者+操作），改完释放
