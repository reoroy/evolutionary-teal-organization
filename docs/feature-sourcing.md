# ETO 功能来源对照表

> 每个特性对应哪个开源项目、怎么集成、几行胶水。
> 原则：ETO 只缝不造，胶水代码总量 < 500 行。

---

## 一、功能全景

### P0（必须）

| 功能 | 开源项目 | 集成方式 | 胶水 |
|:-----|:---------|:---------|:-----|
| 三镜路由 | **eto.ts**（自制）+ **Maestro** | Pi before_agent_start 钩子注入 | ~130行 |
| Agent Profile | **eto.ts**（自制） | 注册表 + 路由匹配 | ~50行 |
| 能力不丢失 | **ProtoLink** A2A | Agent → Agent 直接传递，不走 subagent | 0行（架构原则） |
| 协调员选举 | **eto.ts**（自制）| 匹配度×空闲率，Fork 后考虑 raft-like 协议 | ~30行 |
| 共识协议 | **VotingAI** ✅已装 | `pip install votingai`，Fork 后集成 | ~30行 |
| 流程按需生成 | **eto.ts** + Maestro | 路由层根据任务特征动态组装拓扑 | ~50行 |
| 智子规则引擎 | **Hermes enforcer** | 已在用（Linux）+ Pi tool_call 钩子 | 0行 |
| 否决不提议 | Pi `tool_call` hook | `pi.on("tool_call")` 拦截 | ~10行 |
| Enforcer 模式 | Pi `tool_call` hook | 强制 reroute 走预设流程 | ~30行 |
| 自动时间注入 | **eto.ts** | 每次 before_agent_start 注入 | ~5行 |
| CLI 命令体系 | **Pi CLI** | 直接 `pi` 命令，ETO 是扩展不另起 CLI | 0行 |
| 集体回顾 | **eto.ts**（自制）| 定期分析失败模式，`agent-learn` 包不存活 | ~50行 |

### P1（重要）

| 功能 | 开源项目 | 集成方式 | 胶水 |
|:-----|:---------|:---------|:-----|
| 置信度学习 | **eto.ts**（自制）| 从失败轨迹自动发现技能，`evoskill` 包不存活 | ~30行 |
| Loop 检测 | **eto.ts**（自制） | 识别循环模式，触发不同流程 | ~20行 |
| 超时降级 | **eto.ts**（自制） | 超时自动执行/标记死锁 | ~15行 |
| 探索奖励 | **eto.ts**（自制） | 10% 概率随机选非最优路由 | ~10行 |
| 三层记忆 | **@yylan/pi-memory** ⚠️ | `pi install npm:@yylan/pi-memory`，Windows 下 sharp 装不上 | ~20行 |
| 知识蒸馏 | **eto.ts**（自制）| 对话→自动提炼 skill，`auto-skill` 包不存活 | ~30行 |
| 审计日志 | **Pi JSONL 会话树** | Pi 内置 | 0行 |
| 成本防火墙 | **Fractal Agent Governance** | 预算上限、token 告警、模型降级 | ~30行 |
| Peer 注册发现 | **ProtoLink Registry** | Agent 动态加入/离开 A2A 网络 | ~20行 |
| 多 Agent 并行 | **Maestro** DAG | 并行调度独立任务 | ~30行 |
| Goal/Loop | **Ralph** / **Loom** | Plan→Build→Verify→Repair 循环 | ~30行 |
| 定时任务 | **Murmur** / **pi-schedule-prompt** | cron 表达式 + Pi 心跳 | ~20行 |

### P2（锦上添花）

| 功能 | 开源项目 | 集成方式 | 胶水 |
|:-----|:---------|:---------|:-----|
| 进化使命 | **GenericAgent** / **DeepResearchAgent** | 自我进化的技能树 | ~40行 |
| 跨 Agent 桥接 | **AI-Connect** / **OpenClaw Protocol Bridge** | MCP ↔ A2A 跨协议通信 | ~30行 |
| MCP 兼容 | **Pi 内置** + **@aiwerk/mcp-bridge** | Pi 已有 MCP 支持，bridge 做多路复用 | 0行 |
| 多渠道输出 | **KAOS** / **open-strix** | QQ/微信/Telegram 统一路由 | ~40行 |
| 四种 Loop | **eto.ts**（自制） | Rework/Iteration/Watch/Cron | ~50行 |
| Active Inference | 暂无成熟项目 | 理论研究阶段 | — |

---

## 二、已缝合（代码已写）

```
eto/stitches/
├── comms/a2a.py          → ProtoLink     🧩 已装包待集成 ~47行（当前直调 Ollama）
├── consensus/vote.py     → VotingAI      🧩 已装包待集成 ~32行（当前直调 Ollama）
└── election/elect.py     ✅ 简单排序，无外部依赖
```

## 三、待依赖安装

```bash
pip install protolink votingai
# raft-lite ❌ 不存在 | agent-learn ❌ 不存在 | evoskill ❌ 不存在
# @yylan/pi-memory ⚠️ Windows sharp 装不上，Fork 后集成
```

## 四、不缝的（直接用 Pi 内置）

| 功能 | Pi 的什么 | 说明 |
|:-----|:----------|:------|
| TUI | `pi-tui` | 全屏终端界面 |
| 工具调用 | `--tools read,write,bash,edit` | 直接传参 |
| 会话管理 | JSONL 会话树 | 自动管理 |
| 提供商抽象 | `pi-ai` | 15+ LLM 提供商 |
| MCP | 内建 MCP 支持 | `mcp.json` 配置 |

---

## 五、仍然空白的（需要 ETO 自制）

这些是 ETO 独有的编排逻辑，没有现成开源项目：

| 功能 | 难度 | 说明 |
|:-----|:-----|:------|
| 三镜路由（格物/析理/合验） | 小 | eto.ts 已实现 |
| Agent Profile 注册表 | 中 | 按 specialty/style/ICP/MCP 匹配 |
| 能力不丢失架构 | 中 | 设计模式，A2A 传递完整上下文 |
| Enforcer 模式 | 小 | 智子的 force 模式 |

总共自制代码预计：**~300 行**，且大部分已写完。
