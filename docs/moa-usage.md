---
type: usage-guide
title: dsh-moa 用法说明
description: /moa 命令的完整语法、配置项、以及什么时候它会拒绝工作
timestamp: 2026-11-08
version: '@goodandready/dsh-moa@0.2.83'
---

# dsh-moa 用法

## 前置条件（三条，缺一条就跑不通）

| 条件 | 检查方式 |
|:--|:--|
| 插件在 **desktop** profile 的 bundles 里 | `grep moa ~/.dsh/profiles/desktop/package.json` |
| 有 `presets` 配置 | `curl -s localhost:<port>/dsh-moa/status` → `presetsCount ≥ 1` |
| **当前目录是 Git 仓库** | `git rev-parse --git-dir` |

**第三条最容易忘**：没有 Git 就建不了快照，文件提升会被**主动阻断**（这是它的安全设计）。

## 命令语法

```
/moa <prompt>                         用默认 preset
/moa --preset=<name> <prompt>         指定 preset
/moa -p <name> <prompt>               同上，短写
/moa <presetName> <prompt>            preset 名可以直接写在开头
/moa --swarm <prompt>                 蜂群模式（多候选择优）
/moa promote <candidateIndex>         手动提升某个候选（同 run）
/moa promote <runId> <candidateIndex> 跨 run 提升
```

## 一次运行会发生什么

```
1. 澄清问卷（如果 ask_clarifying_questions: true 且你的 prompt 太宽泛）
   → 它会先问你 2–4 个问题，而不是瞎猜

2. 本地预检（local_preflight_check 默认 true）
   → 对候选做 AST / JSON / 括号平衡检查，零 token 消耗

3. 并行生成
   → 每个 reference_model 各写一份到 .moa/candidate-N/ 沙箱
   → 互不污染

4. 安全扫描（红队）
   → SQLi / XSS / 命令注入 / 路径穿越 / ReDoS / 原型污染
   → 发现严重漏洞触发 SECURITY_VETO 否决

5. 事实核验（CoVe）
   → 查代码有没有调用不存在的 API

6. 裁判评审 + 评分
   → 每个候选的每个文件 1–10 分，列优缺点
   → 机器标记 WINNER_CANDIDATE_INDEX: N

7. Git 检查点（需要 dsh-time-machine）
   → 建快照 moa-pre-promotion: candidate-N

8. 提升文件
   → 胜出候选的文件复制到项目根
```

## 当前配置（本机）

```yaml
presets:
  - name: default
    ask_clarifying_questions: true      # 宽泛需求会先问问题
    reference_models:
      - qodercn/gfmodel                 # 智谱 GLM 架构
      - deepseek-official/deepseek-flash  # DeepSeek 架构
    aggregator:
      deepseek-official/deepseek-flash
    max_tokens: 4096
```

**两条参考模型是不同架构**——这是异构有效的必要条件。同架构不同尺寸等于单模型自采样。

## 关键配置项

| 键 | 默认 | 说明 |
|:--|:--|:--|
| `ask_clarifying_questions` | `true` | 宽泛需求先出 2–4 题问卷 |
| `local_preflight_check` | `true` | 本地 AST/JSON 校验，零 token |
| `early_exit_consensus_enabled` | `false` | 候选高度相似时跳过裁判直接提升 |
| `early_exit_threshold` | `0.95` | 提前退出的相似度阈值（0.5–1.0） |
| `reference_temperature` | `0.6` | 参考模型温度（高一点更发散） |
| `aggregator_temperature` | `0.4` | 裁判温度（低一点更稳） |
| `max_tokens` | `4096` | 单次调用上限。**要生成完整文件，给小了会截断** |
| `judge_criteria` | `""` | 附加给裁判的评审准则 |

## 它会**拒绝工作**的三种情况

### 1. 没有 Git 仓库

```
Pre-promotion checkpoint failed for candidate-N in <dir>.
File overwrite blocked to prevent uncheckpointed changes (pass force: true to override).
```

**这是正常行为，不是 bug。** 它宁可失败，也不无备份地覆盖你的文件。

解决：`cd` 到有 git 的目录，或 `force: true`（不建议）。

### 2. 装了但没配 preset

```
presetsCount: 0
```

`/moa` 会走了等于没走。检查 `/dsh-moa/status`。

### 3. 参考模型全部失败

会如实标 degraded，不会假装成功。

## REST 端点（排查用）

```bash
PORT=<DSH 的 web 端口>

curl -s localhost:$PORT/dsh-moa/status      # enabled / defaultPreset / presetsCount
curl -s localhost:$PORT/dsh-moa/presets     # 每个 preset 的参考模型与裁判
curl -s localhost:$PORT/dsh-moa/models      # 可用模型清单（本机 173 个）
curl -s localhost:$PORT/dsh-moa/history     # 运行历史
curl -s localhost:$PORT/dsh-moa/leaderboard # 胜率排行
```

**注意**：`POST /dsh-moa/run` 存在，但**缺会话上下文**——`projectRoot` 会退化成 `process.cwd()`（DSH 启动目录）。
真实使用必须走会话里的 `/moa`，它会取 `session.cwd`。

## 安全须知

| 项 | 说明 |
|:--|:--|
| 一键更新端点 | `/api/dsh-moa/update` 会 spawn `dsh plugin add`。**别点 UI 的更新按钮**，用 CLI 手动更新 |
| 前端注入 | 247KB 的 `client.js` 注入 DSH UI，host 侧已审、前端未逐行审 |
| 首次试用 | 放 `/tmp` 下的临时 git 仓库，别在重要项目里 |

完整审查见 `docs/third-party-plugin-review-moa.md`。

## 和 ETO 的分工

```
决定要不要做  →  ETO（eto_consensus，三源意见）
决定要做之后  →  dsh-moa（并行候选 + 裁判 + 真的写文件）
```
