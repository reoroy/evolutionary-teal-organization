---
type: usage-guide
title: ETO 在日常工作里怎么用（以及什么时候别用）
description: 收敛 ETO 的职责边界——它是「改之前先问三个人」，不是通用模型
timestamp: 2026-11-08
---

# ETO 日常用法

## 一句话

**ETO 是「改之前先问三个人」，不是拿来当日常模型的。**

它最强的地方是**决策前的独立第二意见**；最弱的地方是当成通用对话模型——每轮多一次路由子进程，
收益不抵成本。

## 三种用法

### A. 显式会诊（主力）

场景：**要做一个会改变行为、且不好回退的决定之前**。

```
改配置 / 改数据库 schema / 删除资源 / 对外发布 / 重构跨多个模块
```

怎么用：直接说「用 eto 评审一下这个方案」，我调：

```json
{ "tool": "eto_consensus",
  "args": { "plan": "你打算怎么做的一小段计划（不是整个会话）", "mode": "advise" } }
```

返回：

```json
{ "synthesis": "融合结论",
  "advice": ["各 peer 的建议"],
  "risks": ["风险"],
  "disagreements": ["分歧点"],
  "fusion": { "sources": [...], "distinct_providers": 2 } }
```

**关键**：输入要短。给整段会话，peer 会迷失；给「我打算这么干」的 3–5 行，最有价值。

### B. 三角色 skill（需要独立视角时）

```bash
skill_load("eto-reviewer")
```

三份角色提示词（researcher / coder / auditor），**派给不同 provider** 才有真异构：

| 角色 | provider | 关注 |
|:--|:--|:--|
| researcher | `deepseek-official/deepseek-flash` | 漏洞、证据、被忽略的替代方案 |
| coder | `qodercn/gfmodel` | 实现路径、技术债 |
| auditor | 本机或远端 Ollama | 最坏情况、不可回滚点 |

**实测价值**：这套 skill 在 P1 任务上**拦下过我的一处错误表述**——
我写「停用 preset 的自动触发描述」，auditor 指出真正的触发在 `persona.prefix`、
`description` 只是 UI 文案，按我说的做等于白改。

### C. 在 superagent 里用（让派活判定有第二意见）

SA 的 eval 判定（accept / ignore / reject）目前是单模型。
可以让它在判定前调一次 `eto_consensus(mode="advise")`，看看三个角色怎么说。

**未实施**——需要改 SA 的 eval 逻辑。

## 什么时候**不要**用

| 场景 | 为什么不用 | 用什么 |
|:--|:--|:--|
| 日常问答、闲聊 | 多一次 `eto_route` 子进程，纯浪费 | 直接用模型 |
| 写代码 / 改文件 | `plan` 路由确实能执行了（PR #83），但和直接用模型没区别 | 直接用模型 |
| 需要真的产出文件 | **ETO 只给意见，不动手** | `@goodandready/dsh-moa`（并行候选 + 裁判 + 自动提升） |
| 简单事实查询 | 三份意见对事实问题没有额外价值 | 直接用模型 |

## 一个容易踩的坑

**ETO 的可用性绑定在 `delegateModel` 上。** 它挂掉时：

```
GET /@dsh-eto/api/status → 200
providers: ['eto']       → 正常
problems: []             → 空
```

但每个轮次都失败——**状态页全绿而功能全废**。排查见 `docs/eto-operator-notes.md`。

## 当前 peer 配置（2026-11-08）

| peer | 模型 | 位置 |
|:--|:--|:--|
| researcher | `gemma3:4b` | 局域网 8GB 机器，85 tok/s |
| coder | `qwen3.6-35b-a3b:8g` | 同机器，34.7B MoE 稀疏激活 |
| auditor | `deepseek-official/deepseek-flash` | 云端 |

三者是**不同架构**——这是异构融合有效的前提。
同架构不同尺寸不算异构（依据见 `docs/eto-work-usable-2026-11.md`）。

本机启用远端 peer：

```bash
export ETO_OLLAMA_REMOTE=http://192.168.10.4:11434
```

不设就走本机 `localhost`（CI 与别人的机器因此不会卡住）。

## 和 dsh-moa 的分工

| | ETO | dsh-moa |
|:--|:--|:--|
| 触发 | 选模型 / 显式调用 | `/moa` 斜杠命令 |
| 输出 | **意见**（advise） | **真的写文件** + 自动提升到项目根 |
| 异构 | 三源 peer 投票 | N 候选 + 裁判评选 |
| 安全 | 无 | 红队扫描（SQLi/XSS/注入/路径穿越）+ 事实核验 + 变异测试 |

**一句话**：**ETO 说，dsh-moa 做。** 决定要不要做之前问 ETO，决定要做之后交给 dsh-moa。
