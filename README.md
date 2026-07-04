# ETO — Evolutionary Teal Organization

> Pi 是 Agent 引擎。ETO 不是另一个引擎——ETO 是让多个引擎协作的制度。v0.1.7 新增 LangGraph 多 Agent 工作流 + Agent 竞标投票 + agentmemory 上下文互通。

ETO 是跑在 [Pi CLI](https://github.com/earendil-works/pi-coding-agent) 上的编排层：三镜路由自动分类任务、同侪共识三阶段评审、智子安检拦截危险操作。

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

Bootstrap 写入 Agent Profile、种子经验、**使用指南（`~/.eto/memory/guide.json`）**、路由配置。

完整使用参考见 [`docs/usage.md`](docs/usage.md)。

### 验证

```bash
python eto/stitches/test.py
# 期望输出: 17 PASS
```

## 跨平台安装

### 前置条件
```bash
pip install -e .          # 安装 eto-mesh CLI
eto-mesh join             # 注册本机
eto-mesh status           # 确认在线
```

### AI 自动安装

把以下提示词发给你的 AI 编码助手（Claude Code / Cursor / Windsurf 等），它会自动配置 MCP：

> 这个项目是 ETO Mesh。添加 ETO MCP Server 到 `.mcp.json`：
> - 命令: `python -m eto.mcp_server`
> - 工作目录: 项目根路径
> - 目的: 提供 eto_consensus / eto_route / eto_memory_write 等工具
>
> 运行以下命令安装并注册：
> ```bash
> pip install git+https://github.com/reoroy/evolutionary-teal-organization.git
> eto-mesh join
> eto-mesh status
> ```

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

### 智子安检 v2 — AgentGuard 级行为规则引擎

可配置规则引擎，拦截危险操作。支持四种规则类型 + 逃生门防循环。

**配置 `~/.pi/eto-sentinel.json`，热重载（对话中输入 `/sentinel-reload`）。**

#### 规则类型

| 类型 | 行为 | 用途 |
|:-----|:------|:------|
| `block` | 关键词匹配→直接拦截 | 禁止高危命令（`rm -rf /`、`dd`、`mkfs`） |
| `confirm` | 弹窗确认+影响预览 | 删除文件、批量编辑前让用户决定 |
| `transform` | 正则替换 prompt 内容 | 自动过滤 emoji、敏感词 |
| `track_turns` | 对话轮数超阈值→注入提醒 | 防止 Agent 跑偏 |

#### 配置示例

```json
{
  "enabled": true,
  "deadlock": {
    "maxBlocksPerRule": 5,
    "escapeAction": "log"
  },
  "rules": [
    {
      "name": "dangerous-bash",
      "enabled": true,
      "priority": 20,
      "type": "block",
      "trigger": "bash",
      "pattern": "rm\\s+-rf|dd\\s+if=|mkfs\\.|format",
      "message": "危险命令已拦截"
    },
    {
      "name": "rm-preview",
      "enabled": true,
      "priority": 10,
      "type": "confirm",
      "trigger": "bash",
      "pattern": "rm\\s+-rf",
      "message": "删除文件，请确认路径"
    },
    {
      "name": "batch-edit-warn",
      "enabled": true,
      "type": "confirm",
      "trigger": "edit",
      "pattern": ".*",
      "message": "批量编辑文件，确认？"
    },
    {
      "name": "no-emoji",
      "enabled": false,
      "type": "transform",
      "from": "[😀-🙏🟡-🫎]",
      "to": ""
    },
    {
      "name": "time-reminder",
      "enabled": false,
      "type": "track_turns",
      "maxTurns": 10,
      "reminder": "已过 10 轮，确认仍在正轨？"
    }
  ]
}
```

#### trigger glob 匹配

`trigger` 支持通配符 `*`，可匹配工具名：

| trigger | 匹配的工具 |
|:--------|:-----------|
| `bash` | 仅 `bash` |
| `write` | `write`、`write_file` |
| `edit` | `edit` |
| `git:*` | `git.push`、`git.commit`、`git.branch` 等所有 git 操作 |
| `*` | 所有工具 |

#### 强化 Confirm + 预览

检测到危险 bash 命令时，自动生成安全预览命令：

| 原始命令 | 预览命令 |
|:---------|:---------|
| `rm -rf /var/log` | `ls -la /var/log \| head -20` |
| `dd if=/dev/zero of=/dev/sda` | `lsblk \| head -10` |
| `rm file.txt` | `ls -la file.txt && wc -c file.txt` |

用户看到影响范围后再决定放行或否决。

#### 逃生门（防循环）

同一规则在同一用户请求内连续拦截 N 次后自动放行：

- 用户发新消息 → 所有拦截计数归零
- 放行时写入审计日志并告知用户
- `maxBlocksPerRule` 默认 5，可在 `deadlock` 段配置

#### 向后兼容

旧格式配置自动迁移到新格式：

```json
{ "trigger": "bash", "pattern": "rm\\s+-rf", "action": "block" }
```
→ 自动映射为 `type: "block"`, 旧 `action: "log"` 映射为 `enabled: false`

---

## ETO Mesh — Agent 协作网络

Agent Registry + 跨平台 CLI + 可配置调度 + 竞标协议 + LangGraph 工作流，让多个 Agent 互相发现、协商和协作。

### Agent Registry

每个运行 ETO 的 Agent 在 `~/.eto/registry.json` 中登记自己：

```json
{
  "version": 1,
  "agents": {
    "pi-ws-5090": {
      "id": "pi-ws-5090", "platform": "pi",
      "hostname": "ws-5090",
      "mcp_endpoint": "python -m eto.mcp_server",
      "capabilities": ["code", "research", "audit"],
      "status": "online",
      "last_seen": "2026-07-04T12:00:00Z"
    }
  }
}
```

**自动维护：** Pi 扩展在 `session_start` 时注册，每次用户消息更新心跳。

### /agents 命令

对话中查看 Mesh 中所有已注册 Agent：

```
📋 Agent Registry (2):
  pi-ws-5090                pi       在线    2026-07-04 12:00:00
  reasonix-alpha            reasonix 在线    2026-07-04 11:58:00
```

### eto-mesh CLI

平台无关的命令行工具，任何环境都可注册和查看：

```bash
eto-mesh join          # 注册本机到 Mesh
eto-mesh status        # 查看所有 Agent（rich 表格）
eto-mesh --help        # 帮助
```

自动检测平台（pi / reasonix / claude），生成 `{platform}-{hostname}` 格式 ID。

### 可配置调度 (dispatch_spec)

调用 MCP Agent 时可指定完整调度规范，不只是传任务文本：

```json
{
  "peers": {
    "hermes": {
      "provider": "mcp",
      "mcp_server": ["python", "-m", "eto.mcp_server"],
      "mcp_tool": "eto_consensus",
      "dispatch_spec": {
        "system_prompt": "你是一个严格的安全审计员",
        "skills": ["sentinel-rules"],
        "mcp_tools": ["eto_consensus", "eto_memory_read"],
        "response_format": "json",
        "timeout": 30000,
        "params": {
          "plan": "删除生产数据库",
          "peers": ["researcher", "coder", "auditor"]
        }
      }
    }
  }
}
```

不配 `dispatch_spec` 时降级为原始行为（只传 task）。

### 竞标协议 (Phase A)

Agent 不再被硬分配，而是收到任务后自评竞标：

```
任务 → 发布 TaskSpec → Agent 自评 fit → 提交标书 → 协调员选标 → 执行
                                                                  ↕ 无人竞标时
                                                           关键词匹配 (fallback)
```

见 [`docs/teal-runtime-arch.md`](docs/teal-runtime-arch.md)。

### LangGraph 工作流 (Phase B)

复杂任务自动拆分为多 Agent 协作流程。Agent 先用 LLM 设计 2-3 种协作方案，各自投票 + 自选配置，然后动态构建 LangGraph 图执行：

```
任务 → generate_proposals() → 2-3 方案
     → vote_on_proposals() → 每个 Agent 独立评分 + 自选 prompt/skills/tools
     → 选标 → build_graph() → LangGraph StateGraph
     → execute_workflow()
       ├── 每步调 dispatch_with_spec
       ├── 条件边（auditor 失败 → 重试）
       ├── 上一步输出注入下一步上下文
       └── 结果写 shared_memory
```

依赖：`langgraph>=0.2.0`

### 时间注入

ETO 在每次路由时注入当前时间（北京时间 Asia/Shanghai），让 Agent 感知时间上下文：

```
当前时间: 2026/7/4 15:30:00
```

路由输出中自动包含时间戳，适用于需要时间感知的任务（日志审计、定时操作、排期计划等）。

### context_block → agentmemory

每次执行前注入的 TealContext 优先从 agentmemory MCP 拉数据（跨 Agent 中央记忆），不可用时降级本地文件：

```
context_block(n=5)
  → agentmemory (memory_recall / memory_smart_search) → 格式化 → prompt 注入
  → fallback: ~/.eto/shared_memory/*.json
```

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
| 智子重载 | `/sentinel-reload`（对话中） |
| 运行统计 | `/metrics`（对话中） |
| 列出 Agent | `/agents`（对话中） |
| ETO 品牌信息 | `/eto`（对话中） |
| ETO Mesh 状态 | `eto-mesh status`（终端） |

### 开发（修改 ETO 自身）

| 操作 | 命令 |
|:-----|:------|
| 测试 | `python eto/stitches/test.py` |
| 使用指南（仓库版） | `docs/usage.md` |
| 发布 | `make release V=v0.x.0` |

### 开发 slash 命令（Claude Code）

| 命令 | 阶段 | 产出 |
|:-----|:------|:------|
| `/plan-eto` | 写 Reasonix plan | `docs/handoffs/reasonix/plan-*.md` |
| `/code-eto` | 触发 Reasonix 实现 | Reasonix 完成回执 |
| `/test-eto` | 跑 pytest + type-check | 测试报告 |
| `/review-eto` | 审计 completion 与 plan 对比 | 审计报告 |
| `/release-eto` | 版本 bump + changelog + tag + push | 发布版本 |

---

## 架构

```
                             ┌──────────────┐
                             │   智子守卫   │
                             └──────┬───────┘
                                    │
          Agent Registry ←── 三镜路由 ──→ 协调员选举 ──→ 同侪共识 ──→ Pi 执行
               │              (按任务    (竞标/匹配)   (peer 评分)    │
               │               分类)                           TealContext
               ↓                                                    │
         eto-mesh CLI ←── dispatch_spec ──→ MCP Agent ←─────────────┘
               │                              │
               ↓                              ↓
         agentmemory ←── context_block ──── agentmemory
```

| 组件 | 位置 | 做的事 |
|:-----|:------|:-------|
| 路由 + 安检 v2 + 入口 | `extensions/eto.ts` | Pi Extension，~820 行 |
| 共识 | `stitches/consensus/vote.py` | 三阶段评分→审议→终审 |
| 选举 | `stitches/election/elect.py` | 匹配度×空闲率推举/竞标选标 |
| 执行 | `stitches/comms/a2a.py` | 多步任务+上下文传递 |
| MCP Server | `mcp_server.py` | FastMCP，暴露 ETO 工具 |
| MCP Client | `mcp_client.py` | 调其他 Agent 的 MCP 工具 |
| Agent Registry | `extensions/eto.ts` | 注册表 + 心跳 + `/agents` |
| Mesh CLI | `cli.py` | `eto-mesh join/status` |
| dispatch_spec | `stitches/mcp_dispatch.py` | `dispatch_with_spec()` |
| 竞标协议 | `stitches/bidding/protocol.py` | `run_bidding()` (Phase A) |
| 共享记忆 | `stitches/memory/shared_memory.py` | KV + agentmemory context_block |

### 原则

- **Pi 有的不写** — TUI、工具调用、会话管理、provider 抽象直接用 Pi 的
- **编排层 < 1000 行** — 超过说明在造轮子
- **每个 Agent 是平等 peer** — 不降级、不设固定层级

---

## 配置

| 文件 | 用途 |
|:-----|:------|
| `~/.pi/eto-config.json` | 路由 provider + peer→provider 映射 + dispatch_spec |
| `~/.pi/eto-sentinel.json` | 智子安检规则 |
| `~/.pi/etoprofiles/profiles.json` | Agent Profile 数据 |
| `~/.eto/registry.json` | Agent 注册表（自动维护） |
| `~/.eto/memory/` | 经验 + 审计日志 + 使用指南 |
| `.mcp.json` | MCP Server 注册 |

---

## 致谢

ETO 使用了以下开源项目：

| 项目 | 用途 | 协议 |
|:-----|:------|:------|
| [LangGraph](https://github.com/langchain-ai/langgraph) | 多 Agent 工作流图编排 | MIT |
| [Pi CLI](https://github.com/earendil-works/pi-coding-agent) | Agent 运行时引擎 | MIT |
| [Rich](https://github.com/Textualize/rich) | 终端表格渲染（eto-mesh status） | MIT |
| [ProtoLink](https://github.com/jtemporal/protollm) | Agent 间通信 | Apache 2.0 |

---

## License

MIT
