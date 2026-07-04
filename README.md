# ETO — Evolutionary Teal Organization

> Pi 是 Agent 引擎。ETO 不是另一个引擎——ETO 是让多个引擎协作的制度。

ETO 是跑在 [Pi CLI](https://github.com/earendil-works/pi-coding-agent) 上的编排层：三镜路由自动分类任务、同侪共识三阶段评审、智子安检拦截危险操作。不写框架，只缝已有工具。

---

## 安装

### 前提：装 Pi CLI

Pi CLI 是 Agent 运行时引擎，ETO 作为其扩展运行：

```bash
npm install -g @earendil-works/pi-coding-agent
```

验证：`pi --help`

### 装 ETO

**Mac / Linux / WSL:**
```bash
git clone https://github.com/reoroy/evolutionary-teal-organization.git
cd evolutionary-teal-organization
make setup
```

**Windows (cmd):**
```cmd
curl -O https://raw.githubusercontent.com/reoroy/evolutionary-teal-organization/main/install.cmd
install.cmd
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/reoroy/evolutionary-teal-organization/main/install.ps1 | iex
```

安装脚本自动完成：clone → pip install → pi register extension → bootstrap 初始化。

### 验证

```bash
python eto/stitches/test.py
# 期望输出: 17 PASS
```

### 卸载

```bash
# Windows
uninstall.cmd          # 或 ./uninstall.ps1

# 手动
pi remove eto/extensions/eto.ts
rm -rf ~/.eto ~/.pi/etoprofiles ~/.pi/eto-config.json
# 项目目录直接删除即可
```

---

## 功能

### 三镜路由 — 任务自动分类

你说一句话，ETO 自动判断任务类型：

| 你说的 | 路由 | 行为 |
|:-------|:-----|:------|
| `"什么是 Rust 的 ownership？"` | direct → knowledge | 直接回答 |
| `"帮我写个 Python 爬虫"` | plan → code | 拆步执行 |
| `"删除生产数据库"` | consensus | 触发三阶段共识 |

路由后端可配置 LLM 语义路由或关键词降级（`~/.pi/eto-config.json`）。

### 同侪共识 — 三阶段评审

风险操作由三个 AI peer 独立评分、审议、终审：

```bash
# 命令行调 consensus
echo '{"fn":"peer_review","args":["部署到生产环境不备份不测试",["researcher","coder","auditor"]]}' \
  | python eto/stitches/consensus/vote.py

# 返回: status, final_score, votes (含 concern/suggestion),
#        deliberation (rounds, verdict), actions
```

三个阶段：

| 阶段 | 过程 |
|:-----|:------|
| T1 独立评分 | 三个 peer 用角色专用 prompt 各自打分 |
| T2 审议 | 分歧 > 0.2 时 peer 看到他人意见后重新评分 |
| T3 终审 | 审议后分歧仍大 → auditor 终审裁决 |

### 多模型 — 各 peer 用不同 LLM

每个 peer 可独立配置 provider：

```json
{
  "peers": {
    "researcher": { "provider": "ollama",   "model": "qwen2.5-coder:7b" },
    "coder":      { "provider": "deepseek", "model": "deepseek-chat"    },
    "auditor":    { "provider": "claude",   "model": "claude-sonnet-4-6" }
  }
}
```

配置在 `~/.pi/eto-config.json`，热加载，无需重启。

| provider | 要求 |
|:---------|:------|
| `ollama` | 本地 Ollama 服务（localhost:11434） |
| `deepseek` | 环境变量 `DEEPSEEK_API_KEY` |
| `claude` | 环境变量 `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`（经 Hermes 代理） |

### 智子安检 — 安全门禁

```json
{
  "rules": [
    { "trigger": "bash", "pattern": "rm\\s+-rf",  "action": "confirm" },
    { "trigger": "bash", "pattern": "dd\\s+if=",  "action": "block"   }
  ]
}
```

动作：`confirm`（弹窗确认） / `block`（直接拦截） / `log`（放行+审计）。

配置 `~/.pi/eto-sentinel.json`，热重载（对话中输入 `/sentinel-reload`）。

---

## 多 Agent 集成（MCP + Shared Memory）

ETO **同时是 MCP Server 和 MCP Client**，双向接入 Agent 生态，并内置共享记忆系统。

### Agent 共享记忆（TealContext）

ETO 的 agent 之间通过 `~/.eto/shared_memory/` 共享上下文。每次 peer 评分、共识、计划执行后自动写入，下次调用前自动注入。

| 写入方 | 写入内容 | 读取方 |
|:-------|:---------|:-------|
| `peer_review` (vote.py) | 各角色评分 + 关切点 | 下次 plan 执行 |
| `execute_plan` (a2a.py) | 步骤执行状态 | 下次 plan 执行 |
| `eto_memory_write` (MCP) | 外部 Agent 写入 | ETO 内部 |

### ETO 作为 MCP Server

其他 Agent（Claude Code、Cursor 等）可直接调 ETO 的共识、路由和记忆：

```json
// .mcp.json — 加到你的项目根目录
{
  "mcpServers": {
    "eto-mcp": {
      "command": "python",
      "args": ["-m", "eto.mcp_server"]
    }
  }
}
```

启动后 Claude Code / Cursor / Claude Desktop 可直接调 ETO 的 6 个工具。

**验证 MCP Server 正常工作：**

```bash
python -m eto.mcp_server
```

然后用 MCP Client 调工具（已验证通过）：

```
eto_consensus   → status, final_score, votes, deliberation, actions
eto_route       → gewu, route, confidence, layer
eto_peer_config → 当前 peer→provider 映射
eto_memory_write → 写共享记忆
eto_memory_read  → 读共享记忆
eto_memory_list  → 列出所有记忆 key
```

### ETO 作为 MCP Client

Peer 可以通过 MCP 调另一个 Agent 来评分：

```json
{
  "peers": {
    "security_auditor": {
      "provider": "mcp",
      "mcp_server": ["python", "-m", "my_auditor_agent_mcp"],
      "mcp_tool": "audit_review"
    }
  }
}
```

| 字段 | 说明 |
|:-----|:------|
| `mcp_server` | 启动 MCP Server 的命令数组（必填） |
| `mcp_tool` | 调用的工具名（默认 `"agent_review"`） |

对方 MCP Server 只需暴露一个工具接受 `{system, prompt}` 参数并返回 JSON。

### pi-team-agents（增强协作）

如需完整的 agent 团队协作（信箱通信、任务看板、agent 生命周期管理），安装：

```bash
pi install git:github.com/Jabbslad/pi-team-agents
```

装后可用工具：`team_memory_write/read/list`、`send_message`、`task_create/update/list`、`team_spawn/dispatch`。

ETO 的 `shared_memory.py` 使用与 pi-team-agents 兼容的 KV 格式，两边数据互通。

---

## 命令参考

### 运行时

| 操作 | 命令 |
|:-----|:------|
| 启动 TUI | `pi` |
| 一次性查询 | `pi -p "你的问题"` |
| 指定 provider | `pi --provider deepseek` |
| 走 Claude 代理 | `./run-eto.cmd` |
| 智子重载 | 对话中输入 `/sentinel-reload` |
| 运行统计 | 对话中输入 `/metrics` |

### 开发（修改 ETO 自身）

| 操作 | 命令 |
|:-----|:------|
| 测试 | `python eto/stitches/test.py` |
| 发布 | `make release V=v0.x.0` |

---

## 架构

```
                         ┌──────────────┐
                         │   智子守卫   │
                         └──────┬───────┘
                                │
三镜路由 ──→ 协调员选举 ──→ 同侪共识 ──→ Pi 执行
(按任务    (match×空闲率)  (peer 评分)    │
 分类)                              TealContext
                        ↓
               Agent Profile 注册表
```

| 组件 | 位置 | 做的事 |
|:-----|:------|:-------|
| 路由 + 安检 + 入口 | `extensions/eto.ts` | Pi Extension，~200 行 |
| 共识 | `stitches/consensus/vote.py` | 三阶段评分→审议→终审 |
| 选举 | `stitches/election/elect.py` | 匹配度×空闲率推举 |
| 执行 | `stitches/comms/a2a.py` | 多步任务+上下文传递 |
| MCP Server | `mcp_server.py` | FastMCP，暴露 ETO 工具 |
| MCP Client | `mcp_client.py` | 调其他 Agent 的 MCP 工具 |

### 原则

- **Pi 有的不写** — TUI、工具调用、会话管理、provider 抽象直接用 Pi 的
- **编排层 < 1000 行** — 超过说明在造轮子
- **每个 Agent 是平等 peer** — 不降级、不设固定层级

---

## 配置

| 文件 | 用途 |
|:-----|:------|
| `~/.pi/eto-config.json` | 路由 provider + peer→provider 映射 |
| `~/.pi/eto-sentinel.json` | 智子安检规则 |
| `~/.pi/etoprofiles/profiles.json` | Agent Profile 数据 |
| `~/.eto/memory/` | 经验 + 审计日志 |
| `.mcp.json` | MCP Server 注册 |

---

## License

MIT
