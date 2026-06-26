# ETO 项目约定 — 给 Claude 的指令

## 第一性原理：不要造轮子（优先级最高）

> 2026-06-25 复盘教训：ETO 写了 3156 行代码，但 Pi CLI 已有 TUI/Agent 引擎/工具系统/会话管理。正确的架构是 ETO 做薄编排层跑在 Pi CLI 之上，而不是重写整个栈。

**做之前先问：Pi CLI 有没有？**
- TUI → Pi CLI 自带 `pi-tui`，不要写 tui.py
- 工具调用 → Pi CLI 的 `--tools`，不要封装 executor.py
- 会话管理 → Pi CLI 的 JSONL 会话树，不要写 context.py
- Agent 运行时 → `pi` 命令，不要封装 call_pi

**ETO 只写（编排层，总量 < 1000 行）：**
1. ✅ 三镜路由（analyze / router）
2. ✅ 临时协调员选举（election）
3. ✅ 同侪共识（consensus）
4. ✅ 步骤上下文传递（core 中的编排逻辑）

**踩过的坑（不要再犯）：**
- ❌ 自写 TUI — Pi CLI 已有 `pi-tui`
- ❌ 自封装 CLI 调用 — Pi 就是 CLI
- ❌ 自建上下文管理 — Pi 的 JSONL 会话树
- ❌ 自建记忆系统 — 用 agentmemory / pi-memory
- ❌ 自建 embedding/路由 — Pi 的 provider 抽象

## Reasonix 文件接力协议（Claude Code ↔ Reasonix）

与 Reasonix 通过文件系统接力协作：

| 方向 | 路径 | 用途 |
|:-----|:------|:------|
| Claude → Reasonix | `docs/handoffs/reasonix/plan-<任务名>.md` | 计划/实现需求 |
| Reasonix → Claude | `docs/handoffs/reasonix/completion-<任务名>.md` | 实现回执/改动清单 |
| 会话状态 | `docs/handoffs/reasonix/INDEX.md` | 双方活跃文件锁 |

**协作流程：**
1. Claude Code 写 plan → 用户对 Reasonix 说「去看 plan-xxx.md」
2. Reasonix 读 plan → 写代码 → 写 completion 回执
3. 用户对 Claude 说「审计」
4. Claude Code 审计 completion 内容，确认或要求修改

**规则：**
- 改共享文件前先在 INDEX.md 登记锁
- 不改对方正在持有的文件
- 完成回执必须列出改动的文件 + 每处改动的摘要 + 验收证据

## AIMemIndex Protocol (Hermes ↔ Claude Code)

与 Hermes Agent（运行在本地网络的协调节点）之间的跨代理记忆协议。所有协议规则、目录结构和细节见 **AIMemIndex.md**。

### 快速参考

| 方向 | 路径/命令 | 用途 |
|:-----|:------|:------|
| AIMemProtocol → Index | `docs/handoffs/reasonix/plan-<任务名>.md` | 实现需求 |
| Index → AIMemProtocol | `docs/handoffs/reasonix/completion-<任务名>.md` | 实现回执/改动清单 |
| 活跃索引 | `docs/handoffs/reasonix/INDEX.md` | 双方文件锁状态 |

**协作流程：**
1. AIMemProtocol 写 plan → 用户对 Reasonix 说「去看计划」
2. Reasonix 读 plan → 写代码 → 写 completion 回执
3. 用户审计完成，确认或要求修改

**规则：**
- 改共享文件前在 INDEX.md 登记锁
- 不改对方正在持有的文件
- 完成回执必须列出改动的文件 + 每处改动的摘要

### 安装与配置

**安装（一次）:**
```bash
uv tool install git+https://github.com/AnastasiyaW/mclaude.git
cd ~/Claude
source .venv/bin/activate
```

**配置 (`~/.mclaude/config.toml`):**
```toml
[agent]
id = "claude-code"
name = "Claude Code Agent"

[memory]
shared_dir = "~/.mclaude/shared"   # 跨代理共享记忆目录
scope = "local"                     # local / network（网络模式需要额外配置）
```

### 常用命令速查

**会话生命周期：**
- **启动/加载:** `mclaude memory core` — 提取当前会话共享状态
- **保存决策:** `mclaude memory save --scope shared "描述"` — 持久化关键决策
- **锁定资源:** `mclaude lock claim file <路径>` / `mclaude lock release file <路径>`

**Agent ID:** `claude-code`
