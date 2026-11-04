---
type: roadmap
title: ETO 实现路线图（缝合方案）
description: 不写框架，只缝已有开源项目——ProtoLink + Nexus + Aegean + Gravity AI + agentmemory
tags: [eto, roadmap, stitching, ponytail]
timestamp: 2026-06-23
---

# ETO 实现路线图（缝合方案）

> **核心理念：** ETO 不写框架，它的"代码"是胶水——把 ProtoLink、Nexus、Aegean、Gravity AI、agentmemory 这些开源项目串起来。
>
> **Ponytail 原则：** 代码量越少越好，不重复造轮子。

---

> ## ⚠️ 实现状态对照（2026-11-03，主干 f6f4883）
>
> 本文档写于 2026-06-23，描述的是**缝合方案的设计意图**。实际落地结果与之有实质出入，阅读时以本节为准：
>
> | 本文档声称 | 实际状态 | 证据 |
> |:-----------|:---------|:-----|
> | ProtoLink / Nexus / Aegean / Gravity AI / SkillSpector 五个库缝合 | **❌ 均未接入——全部自实现**。`grep -rn "protolink\|nexus\|aegean\|gravity\|skillspector" eto/ --include=*.py` 无 import；这五个包也不在 `requirements.txt` / `eto/pyproject.toml` 里。实际代码：Python 约 2,200 行（`eto/`，不含测试）+ TS 扩展 919 行（`extensions/eto.ts`） | `pip show protolink` 不可用；依赖清单见 `eto/pyproject.toml` |
> | 「~90 行胶水代码」 | ❌ 实际 ~3,100 行自实现，超出「编排层 < 1000 行」原则 | `find eto -name "*.py" \| xargs wc -l` |
> | Phase 1「完成」（ProtoLink 安装 / Agent invoke / HTTP Transport / 跨 Agent 通信） | 🔶 **仅占位**：对应的 A2A 能力由自实现的 MCP 通道（`mcp_client.py` / `stitches/comms/a2a.py`）承担，**不是** ProtoLink HTTP Transport，也没有 Agent Card / `POST /tasks/` | `eto/stitches/comms/a2a.py` |
> | Phase 2「进行中」（nexus route / gravity elect / aegean vote） | 🟡 **部分且换实现**：路由（关键词+LLM 降级）、选举、共识均自实现且可用，但分别位于 `extensions/eto.ts`、`stitches/election/elect.py`、`stitches/consensus/vote.py`，未用任何外部库 | 各文件 |
> | 记忆层 agentmemory | 🟡 部分：`context_block` 支持 agentmemory MCP 降级本地 KV（`stitches/memory/shared_memory.py`），非文档描述的 LRU 修剪/聚类 | `shared_memory.py` |
> | 安全层 SkillSpector | ❌ 未接入——智子安检是**自实现规则引擎**（`extensions/eto.ts`），不是 SkillSpector | `eto.ts` |
>
> 逐项状态标注见下文各阶段表格（状态列已按实际代码更新）。

---

## 技术栈分层

```
Pi CLI（入口 — 最后一步的执行器）
  |
  v
+-----------------------------------------+
|         A2A 通信层 (ProtoLink)           |
|  Agent Card · Registry · 发现 · 路由     |
+-----------------------------------------+
|         编排层 (Nexus)                   |
|  Goal -> Task DAG · 3 种路由模式          |
+-----------------------------------------+
|         共识层 (Aegean 投票)              |
|  提案 -> 广播 -> 独立推理 -> 超阈值通过    |
+-----------------------------------------+
|         选举层 (Gravity AI)              |
|  Raft 共识 · 声誉加权选举                 |
+-----------------------------------------+
|         记忆层 (agentmemory)             |
|  共享记忆 · 跨 Session 延续 · LRU 修剪   |
+-----------------------------------------+
|         安全层 (SkillSpector)            |
|  工具越界检测 · 权限控制                 |
+-----------------------------------------+
```

### 为什么每层选这个方案

| 层 | 选型 | 引用 | 为什么不自己写 | 实际落地 |
|:--|:-----|:-----|:--------------|:---------|
| 通信 | **ProtoLink / A2A** | 24K⭐，Google/Linux 基金会 | 自写 Agent 间通信协议是巨大的工程 | ❌ 未接入，自实现 MCP 通道（`mcp_client.py` / `comms/a2a.py`） |
| 路由 | **Nexus** | 6.4K⭐，3 种路由内置 | 自写路由逻辑最后会越来越像 Nexus | ❌ 未接入，自实现（`extensions/eto.ts`，关键词+LLM 降级） |
| 共识 | **Aegean Consensus** | 拜占庭容错 | 共识算法是计算机科学最难的部分之一 | ❌ 未接入，自实现三阶段评分（`consensus/vote.py`） |
| 选举 | **Gravity AI (Raft)** | Raft 是工业标准 | 自写选举最后会越来越像 Raft | ❌ 未接入，自实现占位（`election/elect.py`，无 Raft 语义，见 #29） |
| 记忆 | **agentmemory** | 已在用 | 零额外成本 | 🟡 部分：context_block 可接 agentmemory MCP，降级本地 KV |
| 安全 | **SkillSpector** | 7K⭐，NVIDIA | 安全规则引擎是另一个大工程 | ❌ 未接入，自实现智子规则引擎（`extensions/eto.ts`） |

---

## 阶段总览

| 阶段 | 名称 | 核心交付 | 状态 |
|:-----|:------|:---------|:-----|
| **Phase 1** | A2A 通信层奠基 | ProtoLink HTTP Transport + Registry 验证 | **🔶 名义完成，实现已替换**（自实现 MCP 通道，未接 ProtoLink） |
| **Phase 2** | 编排与共识缝合 | Nexus + Aegean + Gravity AI 三件套 | **🟡 部分完成（全自实现）**——路由/选举/共识可用，未接任何外部库 |
| **Phase 3** | 动态自组织 | 网状协作·弹性 Agent 池·自我修复 | ⬜ 缺失（Registry 心跳已有；其余未实现） |
| **Phase 4** | 进化学习 | 集体回顾·策略调整·成本报告 | **🟡 部分完成**——集体回顾 + 策略权重调整 + Rework/Iteration Loop 已实现（`eto/stitches/reflection.py`）；Watch/Cron 执行器与成本报告仍缺失 |
| **Phase 5** | 理论引擎 | Active Inference · JEPA 集成 | ⬜ 缺失（研究阶段） |

---

## Phase 1：A2A 通信层奠基

> 原验收标记「已通过」，详见 [phase-1-core-loop](phase-1-core-loop.md)。
> **2026-11-03 更正：验收当时的验证对象是独立的 ProtoLink 原型，不在本仓库代码路径里。** 本仓库当前的 Agent 间通信是自实现的 MCP 通道，下表按当前主干 f6f4883 重新标注：

| 里程碑 | 验收 | 状态（当前主干） |
|:-------|:-----|:-----|
| ProtoLink 安装 | `pip install protolink` | ❌ **未接入**——protolink 不在 requirements.txt / eto/pyproject.toml，代码无 import |
| Agent invoke 功能 | `agent.invoke("hello")` 返回结果 | 🟡 换实现——由 `mcp_client.py` 调远端 MCP 工具承担 |
| HTTP Transport | Agent HTTP 启动 + Registry 注册 | 🟡 换实现——MCP stdio 传输 + `~/.eto/registry.json` 本地注册表（`cli.py` / `extensions/eto.ts`），无 HTTP Agent Card |
| 跨 Agent 通信 | Agent A -> B A2A POST /tasks/ | 🟡 换实现——MCP dispatch（`mcp_dispatch.py`），无 A2A 协议 |

---

## Phase 2：编排与共识缝合

> 核心任务。见 [phase-2-governance](phase-2-governance.md)。
> **2026-11-03 更正：下列 5 步中，第 1/2/3 步点名的三个库均未接入——对应能力为自实现。** 实际交付物：
>
> | 计划步骤 | 实际状态 |
> |:---------|:---------|
> | 第 1 步：`pip install nexus` → 调通 route() | ❌ 未接 nexus。自实现路由可用：`extensions/eto.ts`（LLM 语义 + 关键词降级，输出 gewu/route/confidence/coordinator/layer）|
> | 第 2 步：`pip install gravity-ai` → 调通 elect() | ❌ 未接 gravity-ai。自实现占位：`stitches/election/elect.py` 只有「得分 × 随机因子 + sleep + 任期内复用」，无 term/quorum/日志持久化（Raft 语义缺，见 #29）|
> | 第 3 步：`pip install aegean-consensus` → 调通 vote() | ❌ 未接 aegean。自实现三阶段共识可用：`stitches/consensus/vote.py`（T1 独立评分 / T2 审议 / T3 终审，CI 覆盖 MCP peer 路径）|
> | 第 4 步：接 agentmemory（已有） | 🟡 部分：`context_block` 可拉 agentmemory MCP，降级本地 KV（`memory/shared_memory.py`）|
> | 第 5 步：全部串起来 → end-to-end demo | ✅ 可用：`eto/stitches/test.py` 36 项 PASS，CI 5 个 job 全绿 |

```
第 1 步：pip install nexus -> 调通 route()        # 实际：自实现（eto.ts）
第 2 步：pip install gravity-ai -> 调通 elect()   # 实际：自实现占位（elect.py）
第 3 步：pip install aegean-consensus -> 调通 vote()  # 实际：自实现（vote.py）
第 4 步：接 agentmemory（已有）                    # 实际：部分（context_block 降级路径）
第 5 步：全部串起来 -> end-to-end demo             # 实际：可用（test.py，CI 全绿）
```

**关键指标：** 每个 `pip install` 是一个检查点——验证能在 Windows 上正常使用再继续下一步。

---

## Phase 3：动态自组织

> 网状协作。见 [phase-3-routing](phase-3-routing.md)。
> **2026-11-03 状态**：仅第 1 步（Registry 心跳）可用（`extensions/eto.ts` 注册表 + 心跳 + `/agents`）；第 2-6 步 ⬜ 缺失（无 embedding 路由、无并行/管道分叉、选举无历史感知、无超时重路由、无知识蒸馏）。

```
第 1 步：Registry 心跳 -> Agent 上下线自动感知      # ✅ 可用（eto.ts）
第 2 步：Router Adaptive 模式 -> embedding 匹配     # ⬜ 缺失
第 3 步：Parallel + Pipeline -> 分叉执行            # ⬜ 缺失
第 4 步：Gravity AI 接 agentmemory -> 历史感知选举  # ⬜ 缺失（选举本身仅占位）
第 5 步：超时检测 + 自动重路由                      # ⬜ 缺失
第 6 步：知识蒸馏 + 集体回顾                        # 🟡 集体回顾已可用（reflection.py）；知识蒸馏缺失
```

## Phase 4：进化学习

> 系统从自己的执行历史中学习。见 [phase-4-evolution](phase-4-evolution.md)。
> **2026-11-04 状态**：🟡 部分完成——失败聚类、策略权重调整、回顾报告、Rework/Iteration Loop 已实现（`eto/stitches/reflection.py`，权重经 `shared_memory` 被竞标降级路径消费）；规则去活、记忆修剪、成本报告、Watch/Cron 执行器仍缺失。跟踪 issue：#28。

```
第 1 步：agentmemory -> 聚类失败模式                # ✅ 可用（reflection.run_reflection）
第 2 步：策略调整 -> 修改选举/路由权重              # 🟡 竞标 weights 已回读生效（protocol._apply_adjustment）
第 3 步：SkillSpector 规则去活                      # ⬜ 缺失
第 4 步：记忆修剪 -> 回顾报告                       # 🟡 回顾报告已可用，记忆修剪未做
第 5 步：多渠道输出 + 成本报告                      # ⬜ 缺失
```

## Phase 5：理论引擎

> 认知科学集成。见 [phase-5-theory](phase-5-theory.md)。
> **2026-11-03 状态**：⬜ 全部缺失（设计文档层面的探索，见 `docs/alternative-paradigms-to-eto.md`）。

```
第 1 步：agentmemory 加 prediction_error 字段       # ⬜ 缺失
第 2 步：精度自动调整（连续成功/失败 -> 权重变化）   # ⬜ 缺失
第 3 步：软先验推翻（规则可被证据推翻）              # ⬜ 缺失
第 4 步：World Model rollout（潜空间模拟路由）      # ⬜ 缺失
```

---

## 代码量预期

| 方法 | 代码量 | 维护成本 | 鲁棒性 |
|:-----|:------|:---------|:-------|
| 自写框架 | ~1569 行 | 高（全部自己修） | 低（一次没跑过） |
| **缝合方案** | **~90 行胶水代码** | 低（社区维护核心库） | 高（每个库各自有测试） |

> **2026-11-03 实测**：实际走了「自写框架」这条路——Python ~2,200 行（`eto/`，不含测试）+ TS 扩展 919 行，共 ~3,100 行，且 demo（36 项）与 CI（5 job）真实跑过、当前全绿。上表两行的「鲁棒性」列按现实对调了。

---

## 决策记录

> 2026-11-03 更正：下表是**当时的选型意图**。实际落地全部为自实现（见顶部对照表），即「决策」列里规避的方案反而是现状——这是需要正视的偏差，不是既成事实的合规说明。

| 决策 | 选择 | 理由 | 实际 |
|:-----|:------|:------|:-----|
| 通信协议 | A2A (ProtoLink) | 业界标准，不发明协议 | ❌ 未接入，自实现 MCP 通道 |
| 编排引擎 | Nexus | 比自写路由健壮，3 种模式即用 | ❌ 未接入，自实现 |
| 共识协议 | Aegean Consensus | 拜占庭容错，工业级 | ❌ 未接入，自实现 |
| 选举算法 | Gravity AI (Raft) | 比 Jaccard 关键词匹配好得多 | ❌ 未接入，自实现占位（无 Raft 语义） |
| 记忆层 | agentmemory | 已在用，零额外成本 | 🟡 部分（context_block 降级路径） |
| 安全层 | SkillSpector (NVIDIA) | 7K⭐，专业安全规则引擎 | ❌ 未接入，自实现智子规则引擎 |
| Pi CLI 角色 | 最后一步的执行器 | 编排不依赖 Pi，Pi 只做具体工作 | 🟡 部分（Pi 是入口扩展，编排也不独立于 Pi） |
