# Plan: ETO Mesh — 跨 Agent 协作网络

> 创建日期: 2026-07-04 | 来源: Claude Code
> 执行: Reasonix → 审计: Claude Code
> 基线: v0.5.0 (智子 v2)

---

## 现状

ETO 当前架构：

```
Pi (扩展) ──→ ETO ──→ MCP Server (被动等调用)
                │
                └──→ MCP Client (主动调外部)
```

三问题：

| 问题 | 表现 | 根因 |
|:-----|:------|:------|
| **平台锁定** | 只支持 Pi，Claude Code/Reasonix/Hermes 装不了 | eto.ts 是 Pi Extension，无独立入口 |
| **Agent 不感知彼此** | 每个 ETO 实例独立运行 | 无注册表/发现机制 |
| **调度写死** | dispatch 固定 coder/researcher/auditor，无法指定 prompt/skill/tool | 没有调度规范 |

---

## 参考：缝合方案对照表

[`docs/ETO缝合方案对照表.md`](docs/ETO缝合方案对照表.md) 中已验证或待验证的方案：

| 项目 | 用途 | 状态 |
|:-----|:------|:------|
| **ProtoLink (A2A)** | 标准化 Agent 间通信协议 | ✅ 已验证 v0.6.1 |
| **raft-lite** | Raft 协调员选举（替代现有 elect.py） | 📋 待接 |
| **VotingAI** | 多策略共识（替代现有 vote.py） | 📋 待接 |
| **Maestro** | 任务 DAG 分解 | 📋 待评估 |
| **pi-memory / pi-mempalace** | 增强语义记忆 | 📋 待评估 |

---

## 方案

### 四阶段架构

```
Phase 1: Agent Registry + 来源字段
    ↓
Phase 2: 跨平台安装（Claude Code / Reasonix / Hermes）
    ↓
Phase 3: 调度规范（指定 agent + prompt + skill + tool）
    ↓
Phase 4: 分布式共享记忆
```

---

### Phase 1 — Agent Registry + 来源字段

#### 1a. Agent 注册表

`~/.eto/registry.json` — 每个装 ETO 的 Agent 登记自己：

```json
{
  "version": 1,
  "agents": {
    "pi-ws-5090": {
      "id": "pi-ws-5090",
      "platform": "pi",
      "hostname": "ws-5090",
      "mcp_endpoint": "python -m eto.mcp_server",
      "capabilities": ["code", "research", "route", "audit"],
      "status": "online",
      "last_seen": "2026-07-04T12:00:00Z"
    }
  }
}
```

**添加位置**：每次 `before_agent_start` 或 `session_start` 时写入心跳。

**发现机制**：读本地 registry.json + 通过 MCP 轮询已知对端。

**改动文件**：
| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | 注册 + 心跳写入，`/agents` 命令列出已知 Agent |
| — | `~/.eto/registry.json`（新文件，运行时生成） |

#### 1b. guide.json 添加来源字段

当前 `~/.eto/memory/guide.json` 每个 section 缺少 `source`。改为：

```json
{
  "id": "sentinel-v2",
  "title": "智子安检 v2",
  "source": "bootstrap/seed_guide.py / docs/usage.md",
  "body": "..."
}
```

同时每个 section 添加 `tags` 字段用于检索。

**改动文件**：
| 文件 | 改动 |
|:-----|:------|
| `bootstrap/seed_guide.py` | 每个 section 加 `source` + `tags` 字段 |

---

### Phase 2 — 跨平台安装

#### 2a. Claude Code 安装

**方案**：Claude Code 通过 MCP 插件方式接入 ETO Mesh。

```json
// .mcp.json
{
  "mcpServers": {
    "eto-mesh": {
      "command": "python",
      "args": ["-m", "eto.mcp_server"]
    }
  }
}
```

同时写入 CLAUDE.md 注入 ETO 协作上下文。

**安装脚本**：
```bash
# install-eto-claude.sh
# 1. 添加 .mcp.json
# 2. CLAUDE.md 追加 ETO 上下文
# 3. 运行 bootstrap
# 4. 注册到 registry.json
```

#### 2b. Reasonix 安装

**方案**：Reasonix 已通过文件接力协作。新增 MCP 通道使其能主动调 ETO。

Reasonix 侧 `reasonix.json`：
```json
{
  "mcp_servers": [
    { "name": "eto", "command": "python", "args": ["-m", "eto.mcp_server"] }
  ]
}
```

#### 2c. Hermes 安装

**方案**：Hermes（运行在 Linux 192.168.3.54）通过 ETO MCP Server 接入 Mesh。

Hermes 侧配置为 MCP Client，定时心跳到 registry。

#### 2d. 统一安装入口

```bash
pip install eto-mesh  # 任何环境都能装
eto-mesh join         # 加入 Mesh
eto-mesh status       # 查看 Mesh 状态
```

**改动文件**：
| 文件 | 改动 |
|:-----|:------|
| `eto/__main__.py` | 新增 `join` / `status` CLI 子命令 |
| `setup.py` / `pyproject.toml` | 声明 `eto-mesh` 入口点 |

---

### Phase 3 — 调度规范

当 ETO 需要调用另一个 Agent 时，不再是固定 dispatch，而是可配置调度：

```python
dispatch_spec = {
    "target": "hermes-linux",           # 目标 Agent ID
    "system_prompt": "你是一个严格的安全审计员",  # 自定义系统提示
    "skills": ["sentinel-rules", "compliance-check"],  # 加载的技能
    "mcp_tools": ["eto_consensus", "eto_memory_read"], # 暴露的工具
    "response_format": "json",          # 返回格式
    "timeout": 30000,                   # 超时
}
```

**调用流程**：
1. 根据 `target` 查 registry → 获取 MCP endpoint
2. 建立 MCP 连接
3. 注入 `system_prompt` + 加载 skills + 暴露 tools
4. 发送任务，等结果
5. 写审计日志

**改动文件**：
| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/mcp_dispatch.py` | 支持完整 dispatch_spec |
| `eto/extensions/eto.ts` | 路由处接入 dispatch_spec 配置 |
| `eto-config.example.json` | 新增 dispatch_spec 示例 |

---

### Phase 4 — 分布式共享记忆

当前 `~/.eto/shared_memory/` 是单机文件。扩展为 Mesh 内同步：

**方案**：每个 Agent 定期通过 MCP 同步 shared_memory 到已知 peers。

```
Agent A 写入 key X
  → 写本地 ~/.eto/shared_memory/X.json
  → 通过 MCP 广播变更到 Agent B, C
Agent B 收到 → 写本地副本
```

**冲突**：后写入者覆盖（last-write-wins），Phase 4 后可升级为 CRDT。

**改动文件**：
| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/memory/shared_memory.py` | 增加 sync 方法，MCP 广播 |

---

## 借用缝合方案对照表

| 对照表项目 | 用于 Mesh 哪部分 | 优先级 |
|:-----------|:------------------|:-------|
| **ProtoLink (A2A)** | 替代 ad-hoc MCP，标准化 Agent 发现 + 通信 | P1 |
| **raft-lite** | Agent Registry 的 leader 选举（写 registry 需要共识） | P2 |
| **VotingAI** | 共识层增强（多策略投票替代固定评分） | P2 |
| **Maestro** | Mesh 任务分发（跨 Agent DAG 执行） | P3 |
| **pi-mempalace** | 分布式记忆的向量搜索 | P3 |

---

## 改动文件总览

| 文件 | Phase | 改动 |
|:-----|:------|:------|
| `eto/extensions/eto.ts` | P1 | 注册表心跳 `/agents` 命令 |
| `bootstrap/seed_guide.py` | P1 | section 加 `source` + `tags` |
| `eto/__main__.py` | P2 | CLI: `join` / `status` |
| `pyproject.toml` | P2 | `eto-mesh` 入口点 |
| `eto/stitches/mcp_dispatch.py` | P3 | 完整 dispatch_spec 支持 |
| `eto-config.example.json` | P3 | dispatch_spec 示例 |
| `eto/stitches/memory/shared_memory.py` | P4 | MCP 广播同步 |

---

## 验收标准

| # | 检查项 | 方式 |
|---|--------|------|
| M-1 | 两个 ETO 实例互相在 registry 可见 | `pi` → `/agents` 列出对端 |
| M-2 | `guide.json` 每节有 `source` + `tags` | 检查文件 |
| M-3 | Claude Code 装 ETO 后能调 MCP 工具 | `.mcp.json` + eto_consensus 调用 |
| M-4 | dispatch 能指定 target/prompt/skill/tool | 对比配置前后行为 |
| M-5 | Agent A 写共享记忆 → Agent B 读到 | MCP 同步后读取验证 |
| M-6 | 17 测试 PASS | `python eto/stitches/test.py` |

---

## 实施顺序

```
Step 1 → guide.json 加 source + tags             — 5 min
Step 2 → Agent Registry + 心跳 + /agents 命令    — 15 min
Step 3 → eto-mesh CLI (join/status)              — 15 min
Step 4 → dispatch_spec 完整支持                   — 20 min
Step 5 → 跨平台安装文档（Claude/Reasonix/Hermes） — 15 min
Step 6 → 共享记忆 MCP 同步                        — 20 min
```

总计约 90 分钟。
