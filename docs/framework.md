# ETO 执行框架

> 怎么跑、怎么缝、每一步做什么

---

## 一、运行模式

### 模式 A：Pi TUI + ETO 扩展（日常使用）

```bash
# 启动
pi

# 自动加载：
#   ~/.pi/agent/extensions/eto.ts  → ETO 路由 + 智子
#   @yylan/pi-memory               → 长期记忆

# 使用：
#   直接输入任务，ETO 自动路由
#   /eto_status → 查看当前 Agent 状态（TODO）
#   /eto_profile → 查看 Agent Profile（TODO）
```

流程：

```
用户在 Pi 输入 "帮我研究什么是llm"
  → ETO before_agent_start 钩子触发
    → routeTask("帮我研究什么是llm")
      → LLM 语义路由: research → plan (85%)
    → 注入 ETO 上下文到 system prompt
    → TUI 显示: 📋 ETO: research → plan [llm] 协调员: researcher
  → Pi 正常执行（带 ETO 上下文）
```

### 模式 B：一次执行（脚本/自动化）

```bash
pi -p "帮我写个flask api"          # 带 ETO 路由
pi -e eto/extensions/eto.ts -p "任务"  # 指定扩展
```

### 模式 C：多 Agent A2A（TODO）

```bash
# 启动 Registry
python eto/stitches/comms/a2a.py

# 分别启动 Agent
eto-agent researcher --port 5001
eto-agent coder --port 5002
```

---

## 二、缝合层（每层 < 50 行）

### 当前可用

| 层 | 文件 | 状态 | 怎么用 |
|:---|:-----|:------|:-------|
| 三镜路由 | `eto/extensions/eto.ts` | ✅ 可用 | 自动，Pi 启动即加载 |
| 智子安检 | `eto/extensions/eto.ts` | ✅ 可用 | 自动，拦截危险 bash |
| 共识评分 | `eto/stitches/consensus/vote.py` | 🟡 代码写好了，依赖没装 | `pip install votingai` |
| A2A 通信 | `eto/stitches/comms/a2a.py` | 🟡 代码写好了，依赖没装 | `pip install protolink` |
| 选举 | `eto/stitches/election/elect.py` | ✅ 按匹配度排序选协调员 | 纯 Python，无依赖 |

### 待安装的依赖

```bash
# 先装这些（有网络就行）
pip install protolink        # A2A 通信
pip install votingai         # 共识投票
pip install raft-lite        # 选举（从 stitches/ 源码装）
```

### 缝合原则

```
每层胶水代码 < 50 行
不改上游源码
每层可独立替换（共识不满意就换 LLM Council）
```

---

## 三、一次完整任务的生命周期

```
用户输入 → 
  ① 三镜路由（eto.ts）
     语义路由 → knowledge|code|research|solution
     路由 → direct|plan|consensus
     
  ② direct → Pi 直接回答 ✅
     plan → 继续下面流程
     consensus → 继续下面流程

  ③ 协调员选举（stitches/election）
     按 Profile 匹配度 × 空闲率
     选出临时协调员

  ④ 任务分解（stitches/comms → Maestro / A2A）
     协调员决定谁做什么
     多 Agent 并行执行

  ⑤ 同侪共识（stitches/consensus → VotingAI）
     peer 评分 → ≥0.6 通过 → 执行
     <0.6 → 调整 → 重评（最多 3 轮）

  ⑥ 智子安检（全程）
     veto 模式: 阻止危险操作
     enforcer 模式: 强制按流程走（TODO）

  ⑦ 结果 → Pi 输出 → 用户看到
```

---

## 四、文件清单

```
eto/
  extensions/eto.ts           主逻辑（路由 + 智子 + 共识）
  stitches/
    comms/a2a.py              A2A 通信层
    consensus/vote.py          共识投票层
    election/elect.py          选举层

docs/
  design-spec.md               原始架构设计
  ETO缝合方案对照表.md          缝合方案详情
  retrospective-and-roadmap.md 复盘 + 路线图
  framework.md                 本文（执行框架）
```

---

## 五、Fork 条件（现在还不到时候）

当出现以下任一情况，才需要 Fork：

1. **需要改 Pi 的 TUI** 才能显示 ETO 特有信息
2. **需要改 Pi 的会话存储** 才能实现 TealContext
3. **需要 Pi 没有的内核钩子**

现在 Extension 模式够用。不提前 Fork。
