---
type: status-report
title: ETO 可用性状态与回落链（2026-11-08）
description: ETO 现已可正常使用；记录回落链的设计、实测证据，以及一处未解决的可见性缺陷
timestamp: 2026-11-08
---

# ETO 状态报告（2026-11-08）

## 结论：**ETO 可以正常使用**

实测三项能力，全部通过：

| 能力 | 验证 | 结果 |
|:--|:--|:--|
| 普通对话 | 问「为什么同一模型跑多角色投票收益会消失」 | ✅ 答出「能降方差、不能降偏差，错误高度相关」 |
| 读代码 + 定位 | 要求报告 `eto_runner.py` 的 mode 默认值与行号 | ✅ 准确给出 `"advise"` 与函数位置 |
| 会诊模式 | 不传 mode 调用 `eto_consensus` | ✅ 返回 `synthesis/advice/risks/disagreements`，无 `final_score` |
| 真实工作流 | 给一个带缺陷的 `cart.py`，要求找出并修好 | ✅ md5 变化、12→78 行、`total([0.1]*10)` 从 `0.9999…` 修正为 `1.00` |

## 当前 provider 实况

| 模型 | 状态 |
|:--|:--|
| `deepseek-official/deepseek-flash` | ❌ 额度耗尽（`stream error`） |
| `qodercn/dfmodel` | ✅ 可用（**当前实际在用**） |
| `qodercn/gfmodel` | ✅ 可用 |
| `deepseek-official/deepseek-v4-pro` | ❌ 禁用——实测一单就能烧穿额度 |
| `loomy/*`、`raccoon/*` | ❌ 只吐 reasoning，无 text 块 |
| 本机 `ollama` | ❌ `stream error`（且**不是 DSH provider**，子代理派不到） |

## 回落链（本次新增）

### 为什么需要

`delegateModel` 原本只指向一个模型。它挂掉后：

```
GET /@dsh-eto/api/status → 200
providers: ['eto']       → 正常
problems: []             → 空
```

但每个 `direct` / `plan` 轮次都失败——**ETO 完全不可用而状态页全绿**。这是最难查的一类故障。

### 设计

```yaml
delegateModel: 'deepseek-official/deepseek-flash,qodercn/dfmodel,qodercn/gfmodel'
```

- 按序尝试，第一个能产出正文的胜出
- **只在正文未产出时**才切下一个（已提交的答案不重问，避免重复输出）
- 全部失败时给出每个模型的原因

### 实测证据

`ETO_DEBUG_DELEGATE=1` 的逐路由追踪（`~/.eto/delegate-trace.log`）：

```
flash    committed=false pending=0  failed={"message":"stream error"}
flash    committed=false pending=0  failed={"message":"stream error"}
dfmodel  committed=true  pending=0  failed=null
```

**链首失败 → 自动跳过 → 次选成功。** 回落链按设计工作。

## 一处未解决的缺陷（诚实记录）

**回落提示无法显示在回复里。**

设计上应在回复开头标注「（N 个委托模型不可用，已回落到 …）」。实现后追踪日志证明回落发生，
但提示不出现在最终回复中。

排查结论：harness 产出的 stream 里只有 `block-start` / `block-end`，
**`text-delta` 全部不见**——它在 `text-delta` 上附加任何前缀都不会进入最终显示。
把提示折进首个 delta、或改成尾部注记，都不生效。

**当前替代手段**：需要确认「到底哪个模型答的」时，设 `ETO_DEBUG_DELEGATE=1` 重启，
读 `~/.eto/delegate-trace.log`。

**这不是功能缺陷**——回落本身正确，只是缺可见性。

## 运维速查

完整排查手册见 `~/.eto/README.md` 与 `docs/eto-operator-notes.md`。要点：

1. ETO 不可用时，先探 `delegateModel` 链上的每个模型是否活着（`POST /@dsh-eto/api/llm`）
2. 状态页全绿**不代表** ETO 可用——委托模型死掉不影响插件自检
3. 改 `cordis.patch.yml` 后**必须重启 DSH**（host 半不热重载）
