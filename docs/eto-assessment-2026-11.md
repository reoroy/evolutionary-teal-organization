---
type: assessment
title: ETO 项目 + dsh-eto 插件整体评估
description: 给运营者的能力现状、可靠性风险、使用手册与改进优先级
timestamp: 2026-11-05
baseline: 58e924d
---

# ETO 整体评估（2026-11-05）

> 基线：主干 `58e924d`（CI success）。本报告由本地排查写成，每条结论带证据。
> 结论先行：**核心骨架可用，共识评审刚从「假成功」修成「真可用」，但还有一批同类静默退化未清理；
> 面板形态已定，工具隔离与 P1-1 不建议做。**

---

## 一、三句话摘要

1. **能用**：demo 83 PASS/0 FAIL 的历史基线、14 个工具、面板工作台、GitHub 派活闭环都跑通过；
   共识评审改走本机 Ollama 后已能给出真实评分与意见（`final_score 0.758`，三个 peer 各有 concern/suggestion）。
2. **最大的剩余风险不是缺功能，是「静默降级」**：全仓还有 **20+ 处 `except: pass` / 返回默认值**，
   其中至少 4 处会让「没做」看起来像「做了」（见第二节，带行号）。
3. **别再为省额度反复切 provider**：本机 `qwen3-8b-arb` 已验证可用且免费；写文档/评估不派工单，
   只有改代码才派 superagent。

---

## 二、能力现状表

标注：✅可用 / 🟡部分 / 🔶占位 / ⬜缺失 / ⏸废弃

| 能力 | 状态 | 证据 |
|:--|:--|:--|
| 三阶段共识评审（T1评分/T2审议/T3终审） | ✅ | `eto/stitches/consensus/vote.py:220` `peer_review`；实测 `status=approved, final_score=0.758` |
| 共识的**静默失败防护** | ✅ | `vote.py` `_provider_error`/`_parse_provider_error`、`_score_single` 的 `provider_error` 分支、`peer_review` 的 `degraded` 分支（PR #46） |
| 三镜路由 / MODE / 三体权重 | ✅ | `eto/extensions/mode-routing.mjs`（PR #32）；`eto_route` 实测 254ms 返回 gewu/MODE |
| 权限绑定 + 任务预算 | ✅ | `eto/stitches/governance/{permit,budget}.py`（PR #33），158 行测试 |
| 选举 Raft（term/quorum/持久化/busy_ratio） | ✅ | `eto/stitches/election/elect.py`（PR #34），跨进程持久化有测试 |
| 置信度学习（历史回读降权） | ✅ | `eto/extensions/confidence-learning.mjs`（PR #35），`/routing-reset` 可回滚 |
| 共享记忆（三级降级） | ✅ | `eto/stitches/memory/shared_memory.py:160`；`eto_memory_write/read` 面板实测闭环 |
| HITL 三 Gate（clarify/review/feedback） | ✅ | `eto/stitches/quality/*.py`；工具 `eto_clarify` 实测 29ms 正确识别「弄一下」为模糊 |
| 文件锁（status/update/release） | ✅ | `shared_memory.py`；已从面板白名单撤下但工具仍可用 |
| Loop：Rework + Iteration | ✅ | `eto/stitches/reflection.py`（PR #36） |
| Loop：Watch / Cron | ⬜ | README 标注缺失；`grep -rn "Watch Loop\|Cron" eto/` 无实现 |
| `agent_execute`（MCP 跨 agent 执行） | ✅ | `eto/mcp_server.py:112`；PR #46 后能识别 provider 错误标记并转 `status=failed` |
| `eto_peer_score`（会话模型评分） | ✅ | `packages/dsh-eto/lib/tools.js:313` `resolveScoreRoute`；不依赖 Ollama |
| 面板工作台（单页 + 历史 + 异步评审） | ✅ | `packages/dsh-eto/lib/client.js` `InfoPage`；`lib/index.js` `/review` 三端点 |
| 面板「导入到对话」 | ⏸ | **已删除**（必然失败，见第四节）。改为「复制 JSON」 |
| 工具按 preset 隔离 | ⬜ | `enabledTools` 是全局配置；`ctx.tools.restrict()` 未做（见第五节「不要做」） |
| Roadmap 声称的 5 个外部库缝合 | ⬜ | 全部自实现；`docs/implementation-roadmap.md` 状态对照表已如实标注 |

**README 状态标记统计**：✅33 / 🟡2 / 🔶1 / ⬜4 —— 文档与代码基本一致。

---

## 三、可靠性风险清单（按「会不会让人误判」排序）

### P0 级：看起来成功、实际没做

本轮已修掉 4 处（PR #46），但**同类模式在其它 stitch 里仍在**：

| 位置 | 现状 | 会不会误判 |
|:--|:--|:--|
| `eto/stitches/bidding/workflow.py:166` | `except: return 0.5`（`_similarity`） | ⚠️ 相似度退化成 0.5，Iteration 的收敛判断可能基于假相似度 |
| `eto/stitches/bidding/protocol.py:53` | `except: return ""`（LLM 自评 fit） | ⚠️ 竞标分数为空但流程继续 |
| `eto/stitches/consensus/vote.py:184` | `return ""`（`_extract_json` 解析失败） | ✅ 已被 `_score_single` 的新分支拦住，不再退化 |
| `eto/stitches/consensus/vote.py:206,210,267,366` | `except: pass`（记忆写回 / 审议 / 终审） | 🟡 不影响主结论，但失败无痕 |
| `eto/stitches/memory/shared_memory.py:50,142,157,167` | `except: pass` | 🟡 记忆降级静默；mempalace→agentmemory→本地文件的降级是**设计行为**，但无日志 |
| `eto/stitches/memory/mempalace.py:47,75` | `except: pass` / `return ""` | 🟡 同上 |
| `eto/stitches/comms/a2a.py:66` | `except: pass` | 🟡 A2A 通信失败无痕 |
| `eto/stitches/registry.py:74` | `except: return []` | 🟡 注册表读失败 → 空列表，可能被当成「没有 agent」 |
| `eto/stitches/profile_editor.py:78` | `except: pass` | 🟢 低风险 |

**判读**：真正需要优先处理的是 `workflow.py:166` 和 `protocol.py:53` —— 它们直接参与「任务该派给谁 / 是否收敛」的判断，
和 P0-1 是同一类问题。其余是降级路径，建议加 `logger.warning` 而非改成抛错。

### P1 级：环境依赖导致的「测试假绿」

**实测发现**：`eto/stitches/test.py` 的 smoke 用例（`test.py:29` 调 `peer_review(["x","y"])`）
有 10 秒硬超时。Ollama **没跑**时这些用例秒过（因为静默失败）—— 这就是之前「83 PASS」的真相之一；
Ollama **跑起来**后，本机 `qwen3-8b-arb`（8B）单 peer 需 30-60 秒，测试反而超时失败。

> 证据：`/tmp/v1.log` 单 peer 真实耗时 75s（含启动），输出 `status=approved, score=0.85` 带真实 concern。

**建议**：把 smoke 用例改成 mock provider，真实链路测试单独标 `@slow` 并放宽超时。否则「测试绿」不代表功能对。

### P2 级：provider 依赖与额度

| 依赖 | 现状 | 表现 |
|:--|:--|:--|
| Ollama `qwen3-8b-arb` | 已 launchd 持久化，免费 | ✅ 共识评审真可用 |
| 云端 provider | qodercn/buddy/trae/raccoon/codearts 都撞过限流或 403 | ❌ 不建议作为默认 |
| `eto_peer_score` | 走 DSH 会话模型 | ✅ 不依赖 Ollama，但受会话 provider 额度影响 |

**省钱结论**：共识评审走本机；文档/评估不派工单；只有改代码才派 superagent，且一次说清。

### P3 级：DSH 插件的已知边界

- client 有 HMR，**host 代码改动必须重启 DSH**（`lib/index.js` / `tools.js`）
- `link:` 安装（symlink）在 desktop profile 里能工作，但官方文档不建议长期用（应真实目录复制）
- `/api/run` 是白名单（8 工具），会话绑定的重工具不对面板开放 —— 这是**有意设计**
- 面板评审要求设置页钉住 `peerScoreProvider/Model`，否则返回 409 明确拒绝（不静默降级）

---

## 四、使用者手册（三个角色）

### 角色 A：只想要一个评估结论

**最省事**：DSH 侧栏 → ETO 面板 → 写方案 → 点「完整流程」。

但要会看结果：
- `status: approved/revise` + 三个 peer 各有非空 `concern`/`suggestion` → **真评审**
- `status: degraded` + `final_score: null` → **provider 挂了**，先查 Ollama（`curl localhost:11434/api/tags`）
- 三个 `score: 0.5` 且 concern 全空 → **旧版假成功**，升级到 `58e924d` 之后就不会再出现

历史时间线每条可展开、可「↻ 重跑」、可「复制 JSON」粘到对话里继续。

### 角色 B：在对话里用 ETO

| 你说 | 走哪个工具 | 可靠吗 |
|:--|:--|:--|
| 「让几个 peer 评审下这个方案」 | `eto_consensus` | ✅ 现在会诚实报 degraded |
| 「这个任务该怎么路由」 | `eto_route` | ✅ 纯函数，秒出 |
| 「这计划靠谱吗，打个分」 | `eto_peer_score` | ✅ 走会话模型，不依赖 Ollama |
| 「记住 XXX」/「之前记的 XXX」 | `eto_memory_write/read` | ✅ 面板实测闭环 |
| 「这个指令是不是太模糊」 | `eto_clarify` | ✅ 关键词命中，秒出 |

**别信**：`agent_execute` 在工作流里的空输出（已在 PR #46 修，但其它 stitch 仍有同类）。

### 角色 C：派 superagent 干活

GitHub 开 issue / 评论，`@Roy-superagent`，写清三点：改哪里、范围、验收标准。

```
在 reoroy/evolutionary-teal-organization 的 README.md 补一段安装说明，只改这一处。
@Roy-superagent
```

流程：accept → 工单 → 分支 → PR（带 `Closes #N`）→ CI 9 检查 → **等你合并（不自动合并）**
→ issue 自动关闭 → 飞书通知。

**会失败的情况**：
| 现象 | 原因 |
|:--|:--|
| 无判定 | 没 @Roy-superagent，或 sender 不在白名单 |
| 卡 queued | 闲时调度（工作日北京 9-12、14-18 排队） |
| failed + 额度 | provider 限流，换一个 |
| eval timeout | 评估会话模型不可用，重建 orchestrator 会话 |

查状态：`~/Nutstore Files/工作库/DeepSeek harness/19-superagent-ops/scripts/` 下的
`sa-status.sh` / `sa-tickets.sh` / `sa-decisions.sh`。

---

## 五、改进优先级

| 序 | 项 | 影响面 | 改动量 | 风险 | 理由 |
|:--|:--|:--|:--|:--|:--|
| 1 | **修 `workflow.py:166` 与 `protocol.py:53` 的静默默认值** | 高（影响派活与收敛判断） | 小（两处） | 低 | 与 P0-1 同源，是最后两处会让人误判的地方 |
| 2 | **测试 smoke 改 mock + 真实链路标 @slow** | 中（否则「绿」不可信） | 中 | 低 | 本地模型跑起来后暴露的硬约束 |
| 3 | 其余 `except: pass` 补 `logger.warning` | 中 | 小（20 处） | 低 | 降级可保留，但要留痕 |
| 4 | Watch/Cron Loop | 中（补齐 Roadmap） | 大 | 中 | 需要定时触发与文件/PR 监听，先确认是否真有人用 |
| 5 | `peer_score` 面板化 / 评审结果对比 | 低 | 中 | 低 | 锦上添花 |
| 6 | npm 发布 + 取消 `link:` | 低（分发） | 中 | 中 | 单人使用不急 |

### 明确的「不要做」

| 项 | 为什么不做 |
|:--|:--|
| **P1-1「导入到对话」重做** | 面板在浏览器半区，拿不到 host 的 `agents` 服务（`dsh-client-ui-chat` 里 `createSession`/`'agents'` 各 0 次）。要做必须新增 client↔host 专用 RPC，成本高收益低。**「复制 JSON」已够用**，按钮已删。 |
| **P2 工具按 preset 完全隔离** | `ctx.tools.restrict()` 可行但要加 `agent/created` 监听，且当前 `enabledTools` 已裁到 7 个（约 596 tokens）。**开销已经很小，隔离的收益不抵复杂度**。 |
| **给面板造假进度条** | ETO 的 `peer_review` 在返回前不吐任何阶段信息；显示「2/3 步」是编的。现在异步轮询只显示真实数据（已用时 + 已返回 peer 数），保持。 |
| **为共识评审再拉一套云端推理栈** | 本机 `qwen3-8b-arb` 已验证可用且免费；再起一个 provider 是重复造轮子 + 花钱。 |
| **继续把报告/文档任务派给 superagent** | 一个文档任务要消耗判定/执行/汇报三次 LLM 调用。额度紧张时直接本地写。 |

---

## 六、当前部署速查

| 项 | 值 |
|:--|:--|
| 主干 | `58e924d`，CI success |
| ETO 稳定版 | demo 83 PASS 的历史基线（**本地模型启动后 smoke 会超时，见 P1**） |
| Ollama | launchd `com.royd.ollama`，模型 `qwen3-8b-arb:latest` |
| 共识默认模型 | `ETO_OLLAMA_MODEL` 可覆盖，默认 `qwen3-8b-arb:latest` |
| 插件 | `packages/dsh-eto` v0.2.1，14 工具（全局白名单 7 个） |
| superagent | 已停（不自动拉起），避免烧额度 |
| 面板 | 单页工作台 + 历史时间线 + 异步评审 + 取消 |
| 运营者手册 | `packages/dsh-eto/README-operator.md` |

---

## 附：本报告怎么来的

- 能力现状：逐个读 `eto/stitches/` 与 `packages/dsh-eto/lib/`，跑 `eto_route` / `eto_clarify` / `eto_memory_*` / `eto_consensus` 实测
- 静默风险：`grep -rnE "except:\s*(pass|return)|except Exception:\s*pass" eto/ --include=*.py`
- 假成功修复验证：关 Ollama 跑 runner → `status=degraded`；开 Ollama 跑 runner → `approved` 带真实 concern
- 测试约束：单 peer 真实耗时实测 75s，对比 `test.py:15` 的 10s 硬超时
- 全部命令与输出都在本机可复跑，未依赖任何云端模型
