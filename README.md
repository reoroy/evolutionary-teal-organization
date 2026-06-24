---
type: overview
title: Evolutionary-Teal Organization (ETO)
description: 多 Agent 青色组织架构——用 Dynamic Workflows 模拟青色组织，让 Agent 像生命系统一样自主协作
tags: [multi-agent, teal-organization, orchestration, evolution, self-management]
timestamp: 2026-06-25
resource: https://github.com/reoroy/evolutionary-teal-organization
---

# /ETO — 现在，我们是同志了

> **Evolutionary-Teal Organization** | 青色组织 · 多 Agent 编排架构
>
> `architecture > agent` — `无序 · 三生 · 有机` — `Entropy · Trinity · Organic`

ETO 不是一个传统的 AI Agent 产品。它是一套**关于如何让多个异构 Agent 以青色组织原则协作的架构设计**。

---

## 🦋 青色三原则 × AI Agent 编排

Frédéric Laloux 在《Reinventing Organizations》中定义了青色组织的三根支柱。ETO 将它们翻译为系统架构：

### 1. 自主管理 · Self-Management

**破科层 → 去中心化动态编排**

放弃"一个超级主控 Agent 发号施令"的树状结构。任务到来时，Agent 通过分布式协议动态推举**临时协调员**，任务结束角色自动解散。

```
传统：Master Agent → Sub-Agent → Sub-Agent（树状，单点故障）
青色：Agent A ── Agent B ── Agent C（网状，动态协调）
         ↕        ↕        ↕
       Agent D ── Agent E ── Agent F
```

### 2. 完整性 · Wholeness

**破孤岛 → 共享全局上下文与长期记忆**

不让每个 Agent 只盯着自己的局部片段。构建共享的**TealContext（工作记忆池）**，每个 Agent 执行前先将意图写入公共池，其他 Agent 可"感知"，实现集体心流。

```
传统：每个 Agent 有自己的 prompt，互相看不见
青色：TealContext（全局记忆池）— 所有 Agent 共享上下文、失败教训、决策日志
```

### 3. 进化使命 · Evolutionary Purpose

**破死任务 → 动态目标校准**

不写死最终 KPI，设定**演化方向**。Agent 群体定期进行**集体回顾（Collective Reflection）**，根据环境反馈实时调整子任务优先级，像有机体一样适应变化。

```
传统：System Prompt → 执行 → 结束（线性）
青色：感知环境 → 提议 → 反馈 → 调整 → 执行 → 回顾 → 进化（循环）
```

---

## 🏛️ 架构蓝图

### 核心组件

```
         ┌────────────── TealContext ──────────────┐
         │   全局记忆池 · 活跃提议 · 共识日志       │
         │   （共享上下文，实现"完整性"）             │
         └──────────┬──────────────┬───────────────┘
                    │              │
         ┌──────────┴──────┐ ┌────┴──────────┐
         │   Agent 池       │ │   安全守卫      │
         │                  │ │   （智子）     │
         │ • 自主提议       │ │  仅做否决       │
         │ • 互为同侪       │ │  不干预正向决策  │
         │ • 临时协调员     │ │  防止系统失控   │
         └─────────────────┘ └───────────────┘
```

### 青色决策协议

```
① 谁执行，谁发起提议
    ↓
② 广播给受影响的其他 Agent（同侪反馈）
    ↓
③ 共识过滤：
   - 平均评分 > 0.6 → 执行
   - 有 CRITICAL 否决（安全守卫） → 调整后重提议
   - 超时（10s 无反馈） → 降级本地默认执行
    ↓
④ 执行并记录到 TealContext
    ↓
⑤ 每 N 轮触发集体回顾 → 调整策略权重 → 进化
```

### 临时协调员选举

```
任务到达 → 基于专业匹配度 + 当前空闲率推举"临时组长"
         → 任务结束 → 角色自动解散 → 回归普通 Agent
         → 没有固定 PM，没有永久领导
```

---

## 🌱 进化路径

ETO 的青色组织是终极目标，可阶段性演进：

```
| 阶段         范式          核心特征                    技术实现 |
|:-----|:-----|:------|:------|
| 阶段① 🟤  琥珀色（军队）  固定行为模式、规则驱动          🪄 Fable-5 行为路由 |
|                                                           |
| 阶段② 🟠  橙色（机器）    动态行为拼装、绩效调度           Fable-5 路由 + 三体权重 |
|                                                           |
| 阶段③ 🟢  绿色（家庭）    共识驱动、价值观导向、决策透明    Agent 投票 + 安全守卫 |
|                                                           |
| 阶段④ 🦋  青色（生命系统） 自主管理·完整性·进化使命         TealContext + 共识协议 |
|                           Agent 自组织、自进化               + 集体回顾循环 |
```

---

## 👑 安全守卫：智子

在去中心化青色组织中，需要一个仅做**负向否决、不干预正向决策**的角色：

```
智子的职责：
  ① 检测共识死锁（提议循环超过 3 轮）
  ② 拦截越权行为（Agent 超出其工具权限）
  ③ 熔断超时提议（10s 无响应 → 降级执行）
  ④ 审计决策日志（谁提了议、谁否决了、为什么）

智子的约束：
  ✅ 只否决，不提议
  ✅ 只拦越界，不拦创新
  ❌ 不参与日常决策
  ❌ 不指定谁当协调员
```

详见 [智子 CLI 设计](docs/positioning-and-strategy.md#智子-cli设计目标)。

---

## 🔧 当前实现

| 组件 | 状态 | 说明 |
|:-----|:------|:------|
| **ETO CLI** | ✅ v0.1 | Shell 版，调 Reasonix + Claude Code 干活 |
| **positioning-and-strategy.md** | ✅ 完成 | 竞品分析 + 定位 + 智子设计 |
| **🪄 Fable-5 行为路由** | ✅ 设计完成 | 见 [docs/fable5-behavioral-routing](docs/fable5-behavioral-routing.md) |
| **YMM（大英公务员）** | ✅ 已上线 | 讽刺镜像，证明架构通用性 |
| **智子规则引擎** | ✅ 运行中 | Hermes-Enforcer 20 条规则，待迁移至 CLI |
| **TealContext** | ⏳ 待实现 | 共享记忆池 |
| **共识协议** | ⏳ 待实现 | 同侪反馈 + 动态协调员 |
| **集体回顾循环** | ⏳ 待实现 | 自动策略调整 |

---

## 🚀 快速开始

### 一行安装
```bash
git clone https://github.com/reoroy/evolutionary-teal-organization.git
cd evolutionary-teal-organization
make setup
eto           # 启动终端界面
```

或使用一键脚本：
```bash
curl -fsSL https://raw.githubusercontent.com/reoroy/evolutionary-teal-organization/main/scripts/setup.sh | bash
```

### 手动安装

#### 1. 安装 Python 包
```bash
pip install -e .          # 安装依赖 + 注册 eto 命令
# 或: pip install -r requirements.txt
```

#### 2. 拉取 Ollama 模型
```bash
make models               # 拉取 qwen2.5-coder:7b 等模型
# 或手动: ollama pull qwen2.5-coder:7b
```

#### 3. 配置 MCP 服务（可选）
```bash
cp .mcp.example.json .mcp.json
# 编辑 .mcp.json，填入你自己的 MCP 服务地址
```

#### 4. 安装 Pi CLI（Agent 运行时）
Pi CLI 是 ETO 的 Agent 执行引擎：
```bash
npm install -g @earendil-works/pi-coding-agent
# 或通过 uv: uv tool install @earendil-works/pi-coding-agent
```

#### 5. 链接 CLI 入口
```bash
make bin-link
# 或手动: ln -sf $(pwd)/bin/eto ~/.local/bin/eto
```

#### 6. 启动
```bash
eto                              # 终端界面
ETO --mode research "调研..."    # CLI 模式
python3 src/tui.py               # 或直接跑 Python
```

### 环境要求
- **OS**: Linux / macOS / Windows
- **Python**: 3.10+
- **RAM**: 8GB+（推荐 16GB，用于本地 LLM）
- **Ollama**: [https://ollama.com](https://ollama.com)
- **Node.js**: 可选（Pi CLI 需要）

### 项目结构
```
├── src/           # 运行时代码
│   ├── core.py        # 主循环（三镜/选举/共识/执行）
│   ├── analyze.py     # 三镜路由 + LLM 语义路由器
│   ├── router.py      # 7B LLM 路由分拣器
│   ├── consensus.py   # 同侪共识协议
│   ├── election.py    # 临时协调员选举
│   ├── context.py     # TealContext 共享记忆池
│   ├── executor.py    # Pi CLI 调用器
│   ├── zhizi.py       # 智子规则引擎
│   ├── skill.py       # Skill 加载系统
│   ├── embedding.py   # 嵌入层路由
│   ├── tui.py         # 终端界面（prompt_toolkit）
│   └── agents.yaml    # Agent 池配置
├── docs/          # 架构设计文档
├── .mcp.json      # MCP 服务配置（本地，不提交）
└── README.md
```

## 📚 参考

- [Frédéric Laloux — Reinventing Organizations](https://www.reinventingorganizations.com/)
- [Anthropic — Dynamic Workflows](https://code.claude.com/docs/en/workflows)
- [Claude Code — Orchestrate subagents at scale](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Three Body Problem — 人列计算机](https://en.wikipedia.org/wiki/The_Three-Body_Problem)

---

*ETO — Now, we are comrades. architecture > agent — Entropy · Trinity · Organic*
