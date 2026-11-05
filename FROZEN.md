# ETO 稳定版固化记录

## 冻结点

- commit: `cd44276` (feat(reflection): 集体回顾 + Loop FR-E1/FR-E2, PR #36)
- 冻结时间: 2026-11-04（第二次固化）
- demo: **83 PASS / 0 FAIL / exit 0**
- CI: 9 检查全绿（GitHub Actions）
- venv: `~/src/eto/.venv`（Python 3.14）

## 已验证入口

| 命令 | 功能 | 验证 |
|---|---|---|
| `.venv/bin/eto-mcp-server` | MCP stdio server，13 个工具 | initialize 握手 ✓ |
| `.venv/bin/eto-mesh` | `eto.cli:main`（join/status） | 装入 ✓ |
| `.venv/bin/eto-bootstrap` | 写 profiles.json / seeds | 装入 ✓ |

## 13 个 MCP 工具

eto_consensus（共识评分）、eto_route（三镜路由）、eto_peer_config、eto_memory_write/read/list（共享记忆）、eto_clarify / eto_review / eto_feedback（HITL 三 Gate）、eto_file_status/update/release（文件锁）、agent_execute（跨 agent 执行）

## 本轮修复的 11 个 issue（全部合并验证）

| # | 内容 | PR |
|---|---|---|
| #12 | P0-2 安装链路 | #19 |
| #13 | P0-3 LangGraph 假成功 | #22 |
| #14 | P0-4 共享记忆断链 | #17 |
| #15 | P0-5 vote.py 缺 Path | #20 |
| #16 | P0-6 Feedback Gate 空操作 | #18 |
| #23 | CI 检查项文档 | #24 |
| #25 | 文档对齐（✅🟡⬜🔶 标注） | #31 |
| #26 | 三体权重与 MODE 路由 | #32 |
| #27 | 权限绑定与任务预算 | #33 |
| #29 | 选举 Raft 语义 | #34 |
| #30 | 置信度学习 | #35 |

## 待办

- ~~#28 Loop~~ ✅ 已合入本冻结点（Rework + Iteration 可用；Watch/Cron 如实标注缺失）
- Roadmap 标注「未接入」的外部库（protolink 等）为有意自实现，非缺陷

## 回滚方式

```bash
cd ~/src/eto && git checkout ba1a72b
rm -rf .venv && python3 -m venv .venv && .venv/bin/pip install -e eto/
```
