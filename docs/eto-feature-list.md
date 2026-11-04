---
title: ETO 统一特性清单（v2.0）
description: 合并用户 35 特性 + Agent 49 特性的权威统一版本
features: 58
status: authoritative
---

# 🦋 ETO 统一特性清单

> 共 **58 个特性**，按 8 个维度组织。每个特性有稳定 ID `ETO-0XX`，供跨文档引用。
>
> **实现状态口径**（与 README「现状对照」一致）：本表只描述特性与优先级，不代表已实现。
> 截至 2026-11-04，第八节中 ETO-056/058/059（集体回顾、策略权重更新、回顾报告）与
> ETO-060/061（Rework、Iteration Loop）已可用（`eto/stitches/reflection.py`）；
> ETO-062/063（Watch/Cron Loop）**仅有意图检测，执行器未实现**。

---

## 一、🚪 入口与路由（Entry & Routing）

| ID | 特性 | 说明 | 优先级 | 来源 |
|:---|:-----|:------|:-------|:-----|
| ETO-001 | **智子入口** | 所有任务的统一入口 `eto <task>`，不走"聊到哪算哪" | 🔴 P0 | UF1 |
| ETO-002 | **三镜分拣** | 格物镜(产出形态)→析理镜(使用方)→合验镜(定制程度) | 🔴 P0 | UF2 = MF26 |
| ETO-003 | **三体赋权** | 理体(逻辑/推理/代码)→实体(事实/数据/搜索)→得体(审美/创意/文化) | 🔴 P0 | UF3 = MF27 |
| ETO-004 | **智能路由** | direct(单步)/plan(多步)/consensus(多方决策) 三种路由模式 | 🔴 P0 | UF4, 替代旧 MF33 |
| ETO-005 | **ROUTE 分流** | 根据三镜+三体输出判断走 direct/plan/consensus 哪条路 | 🔴 P0 | MF33 升级 |
| ETO-006 | **置信度学习** | 通政司每次输出附加置信度，历史数据自动修正 | 🟠 P1 | MF29 |
| ETO-007 | **三体周期** | 稳定纪/恒纪元/乱纪元/广播纪元 → 路由行为自适应 | 🟡 P2 | MF28 |
| ETO-008 | **Loop 检测** | 通政司自动检测 Rework/Iteration/Watch/Cron 循环意图 | 🟠 P1 | MF34 |

---

## 二、🦋 青色组织（Teal Organization）

| ID | 特性 | 说明 | 优先级 | 来源 |
|:---|:-----|:------|:-------|:-----|
| ETO-009 | **自主管理** | Agent 是 peer 不是 worker。层级不固定，决策权在干活的人手里 | 🔴 P0 | UF5 |
| ETO-010 | **Agent 池管理** | 可配置 Agent 集合，每 Agent 有 specialty/tools/max_concurrency | 🔴 P0 | MF9 |
| ETO-011 | **临时协调员选举** | `match_score(Agent, task) × (1 - busy_ratio)` 动态推举 | 🔴 P0 | UF9 = MF10 |
| ETO-012 | **match_score 计算** | 基于 specialty 语义匹配 + 历史成功率评分 | 🔴 P0 | MF11 |
| ETO-013 | **busy_ratio 追踪** | 实时负载 = 运行中任务数 / max_concurrency | 🟠 P1 | MF12 |
| ETO-014 | **完整性** | Peer Agent 可调用全部工具，不预设角色限制 | 🔴 P0 | UF6 |
| ETO-015 | **协调员 Plan 起草** | 当选协调员输出动态执行方案（steps + assigned_to） | 🔴 P0 | MF13 = UF24 |
| ETO-016 | **青色共识协议** | 提议→广播→评分(>0.6)→执行/递归，无 CRITICAL 才通过 | 🔴 P0 | UF8 = MF14 |
| ETO-017 | **同侪反馈调整** | reflect(feedbacks) → 调整 plan → 重提议（最多 3 轮） | 🔴 P0 | MF15 |
| ETO-018 | **超时降级** | 10s 无响应→自动默认执行，不让治理层成为瓶颈 | 🟠 P1 | UF18 = MF16 |
| ETO-019 | **死锁防护** | 同一提议循环 3 轮 → 标记死锁 → 建议人工介入 | 🟠 P1 | MF17 |
| ETO-020 | **探索奖励** | 10% 概率随机选非最优路由，结果记入学习 | 🟡 P2 | MF18 |
| ETO-021 | **进化使命** | 集体回顾机制，系统持续自我调整 | 🔴 P0 | UF7 = MF35 |

---

## 三、🧠 记忆与知识（Memory & Knowledge）

| ID | 特性 | 说明 | 优先级 | 来源 |
|:---|:-----|:------|:-------|:-----|
| ETO-022 | **TealContext 共享记忆池** | global_memory + active_proposals + consensus_log | 🔴 P0 | MF1 |
| ETO-023 | **统一记忆 API** | `perceive()/record()/query()` 统一接口 | 🔴 P0 | MF4 = UF10 |
| ETO-024 | **三层统一记忆** | agentmemory(独享) + gbrain(共享) + AIMemory(工作台) 统一寻址 | 🟠 P1 | UF10 扩展 |
| ETO-025 | **跨平台统一记忆** | Pi / Claude Code / 自定义 Agent 共享同一记忆层 | 🟡 P2 | MF5 |
| ETO-026 | **TealContext 持久化** | 跨会话记忆，JSON（初期）→ Mem0（稳定后） | 🔴 P0 | MF2 = UF12 |
| ETO-027 | **会话延续** | 跨会话状态恢复，不在新会话里从零开始 | 🟠 P1 | UF12 |
| ETO-028 | **记忆路由** | 自动判断新信息走哪个存储层：临时→agentmemory，长期→gbrain，交接→AIMemory | 🟠 P1 | UF14 🔥新 |
| ETO-029 | **知识蒸馏** | 从对话中自动提炼可复用的决策框架/思维模式，生成 skill | 🟠 P1 | UF13 🔥新 |
| ETO-030 | **时间注入** | 每轮自动注入当前时间/时区/日期上下文，防止 Agent 时间感知漂移 | 🟠 P1 | UF11 = MF6 |
| ETO-031 | **记忆修剪** | 过时/低相关度记忆自动清理（LRU/relevance） | 🟠 P1 | MF3 |
| ETO-032 | **gbrain 知识图谱** | 结构化实体/关系存储 | 🟡 P2 | MF8 |
| ETO-033 | **精度加权感知** | 三镜各维度附加精度，高精度主导更新 | 🟠 P1 | MF7 |

---

## 四、👑 治理与安全（Governance / 智子）

| ID | 特性 | 说明 | 优先级 | 来源 |
|:---|:-----|:------|:-------|:-----|
| ETO-034 | **智子规则引擎** | YAML 规则配置，热重载，类型：pre/post/consensus | 🔴 P0 | UF15 = MF19 |
| ETO-035 | **否决不提议** | 智子只拦越界不拦创新，超出范围不替 Agent 做决定 | 🔴 P0 | UF17 |
| ETO-036 | **智子规则动作** | veto(拦截) / warn(警告) / log(记录) 三种动作 | 🔴 P0 | MF20 |
| ETO-037 | **智子审计日志** | 所有 Agent 调用记录 JSON Lines 可查 | 🔴 P0 | UF16 = MF21 |
| ETO-038 | **成本防火墙** | 单次任务预算上限、token 告警、模型自动降级 | 🟠 P1 | UF19 扩展 |
| ETO-039 | **角色权限绑定** | Agent 级别 `--tools` / `--exclude-tools` 白名单 | 🟠 P1 | MF23 |
| ETO-040 | **超时降级** | 超时 10s → 默认执行（与 ETO-018 同源，治理层视角） | 🟠 P1 | UF18 |
| ETO-041 | **智子 CLI (qsh)** | `rule list/add/test` + `audit` + `stop` + `permit` + `budget` | 🟠 P1 | MF22 |
| ETO-042 | **智子软先验进化** | 硬规则不可违背，软先验可被集体回顾的证据推翻 | 🟡 P2 | MF25 |

---

## 五、🤝 Agent 协作（Agent Collaboration）

| ID | 特性 | 说明 | 优先级 | 来源 |
|:---|:-----|:------|:-------|:-----|
| ETO-043 | **Peer 注册与发现** | Agent 动态加入/离开，可查询"现在谁在线" | 🟠 P1 | UF20 🔥新 |
| ETO-044 | **跨 Agent 上下文桥接** | Hermes ↔ Claude Code ↔ Reasonix → AIMemory 传递工作上下文 | 🟡 P2 | UF21 🔥新 |
| ETO-045 | **多 Agent 并行** | 子任务分布式执行，结果汇总 | 🟠 P1 | UF22 |
| ETO-046 | **Agent 调度** | 按能力匹配度 × 负载 × 成本 × 历史表现综合评分路由 | 🟠 P1 | UF23 |
| ETO-047 | **执行计划生成** | `eto plan <goal>` → 自动分解步骤 → 分配 Agent → 绑定资源 | 🔴 P0 | UF24 = MF13 |

---

## 六、🏗️ Pi 架构（Pi Architecture）

| ID | 特性 | 说明 | 优先级 | 来源 |
|:---|:-----|:------|:-------|:-----|
| ETO-048 | **CLI 命令体系** | `eto 智子 / eto 做 / eto ask / eto run / eto qsh / eto peer / eto propose` | 🔴 P0 | UF25 |
| ETO-049 | **Pi Extension** | ETO 是 Pi 的一个扩展，不是独立框架 | 🟠 P1 | UF26 🔥新 |
| ETO-050 | **MCP 兼容层** | 通过 `pi-mcp-adapter` 对接任何 MCP 工具 | 🟡 P2 | UF27 🔥新 |
| ETO-051 | **模块化** | 智子/共识/治理/知识库 各为独立模块，可单独升级 | 🟠 P1 | UF28 |
| ETO-052 | **技能仓库** | ETO 自身也是 skill，可安装/升级/回滚 | 🟡 P2 | UF34 🔥新 |

---

## 七、📡 平台与渠道（Platform & Channels）

| ID | 特性 | 说明 | 优先级 | 来源 |
|:---|:-----|:------|:-------|:-----|
| ETO-053 | **多渠道输出** | QQ/微信/Telegram/B站 等统一路由 | 🟡 P2 | UF29 🔥新 |
| ETO-054 | **定时任务编排** | 早报/晚报/精读 等 cron 任务的统一管理入口 | 🟠 P1 | UF30 = MF42 |
| ETO-055 | **推送路由** | 低频重要→微信，高频提醒→QQ，按策略自动分流 | 🟡 P2 | UF31 🔥新 |

---

## 八、🔄 进化与反馈（Evolution & Feedback）

| ID | 特性 | 说明 | 优先级 | 来源 |
|:---|:-----|:------|:-------|:-----|
| ETO-056 | **集体回顾** | 定期分析失败模式，更新策略权重（记忆修剪未做） | 🔴 P0 | UF32 = MF35 |
| ETO-057 | **自动学习** | 被纠正/踩坑 → 自动记教训 → 重复 3 次升永久规则 | 🟠 P1 | UF33 扩展 |
| ETO-058 | **策略权重更新** | Agent match_score、三体权重、路由偏好自动调整 | 🟠 P1 | MF36 |
| ETO-059 | **回顾报告** | 输出结构化报告（发现 + 调整 + 建议） | 🟡 P2 | MF38 |
| ETO-060 | **Rework Loop** | 整轮失败 → 带失败原因重跑（与 step 级 retry 分层） | 🟠 P1 | MF39 |
| ETO-061 | **Iteration Loop** | 轮间结果可比、收敛即停；失败轮不算收敛 | 🟡 P2 | MF40 |
| ETO-062 | **Watch Loop** | 外部信号触发（文件变化/API/时间）→ 跑 Pipeline | 🟡 P2 | MF41 |
| ETO-063 | **Cron Loop** | cron 表达式注册定时任务 | 🟡 P2 | MF42 |
| ETO-064 | **成本报告** | 自动化 token 消费分析，按 Agent/任务/时段 出具报告 | 🟡 P2 | UF35 扩展 |
| ETO-065 | **Active Inference** | 自由能最小化：预测误差驱动系统进化 | ⭐ 远期 | MF43 |
| ETO-066 | **World Model / JEPA** | 潜空间 rollout 代替真实执行 | ⭐ 远期 | MF44 |

---

## 🛠️ 开发纪律（Development Skills）

| ID | 特性 | 说明 | 状态 |
|:---|:-----|:------|:------|
| ETO-D01 | **TDD-AI** | 没测试不写代码，红-绿-重构循环 | ✅ 已装 |
| ETO-D02 | **Millstone** | 写完必须有人审 | ✅ 已装 |
| ETO-D03 | **Planwright** | 先想清楚再动手 | ✅ 已装 |
| ETO-D04 | **Trammel** | 知道代码怎么拼 | ✅ 已装 |
| ETO-D05 | **Compound Agent** | 全流程+失败记忆+自动回滚 | ✅ 已装 |

---

## 存量变更记录

| 旧 ID（之前清单） | 新 ID（本清单） | 变更 |
|:-----------------|:---------------|:------|
| MF1-MF44 | ETO-001 起 | 重新编号，按用户 8 维度归组 |
| — | ETO-024,028,029,043,044,049,050,052,053,055 | 🔥 新增（来自用户清单） |
| — | ETO-064 | 成本报告（UF35 扩展） |
| ETO-001 智子入口 | 拆为 ETO-001 + ETO-048 + ETO-049 | 入口+CLI+Pi Extension 三独立特性 |
| MF33 ROUTE分流 | ETO-004 + ETO-005 | direct/plan/consensus 新模式 |
| MF45-49 | ETO-D01~D05 | 移入独立"开发纪律"区 |
