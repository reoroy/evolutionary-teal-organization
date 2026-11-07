---
type: research-design
title: ETO 怎么才算「工作可用」——虚拟 provider / 会诊层 / 角色化子代理 三条路线择一
description: 退后一步判断 ETO 该以什么形态存在于日常工作里，给出单一明确路线与实施清单
timestamp: 2026-11-07
baseline: a77b471
supersedes: 推翻 docs/eto-redesign-v2-2026-11.md 的结论方向（会诊层），保留其事实与证据
---

# ETO 怎么才算「工作可用」（2026-11）

> 基线 `a77b471`（CI 主干，含 #64 预算修复）。本报告只出文档与结论，**未改一行实现代码**。
> 每条调研结论带链接或原文引用；本机可复现的带命令，没实测的标「未实测」。
> 修订 2026-11-07：运营者实测更正——本机 Ollama 不是 DSH provider，路线 C 的「真·不同源」上限由 3 改为 **2 个架构**（DeepSeek + GLM），见 §六。

---

## 一、结论先行

**选路线 C：ETO 从「模型 / 编排层」退位为「角色技能库」——子代理携带专有角色技能与提示词，
不保留融合这一层。**

需要改什么，一句话版：

1. **放弃**虚拟 provider（路线 A）与自动会诊 preset（路线 B）作为 ETO 的默认形态；
2. **把三套 peer 提示词沉淀为角色 skill**，供子代理携带；
3. **把 `eto_consensus` 降格为一个可选、非自动、只做 advise 的会诊原语**，放进技能库，不再是默认路径；
4. **不重写 `vote.py` 的融合算法**（硬约束），评分卡（T1 评分/T2 审议/T3 终审）随融合一起退役。

### 直接回答那个必须回答的问题

> 融合这一层到底带来了什么别处拿不到的东西？

**融合唯一别处拿不到的东西，是「真·不同源」：从不同训练分布采样，让独立错误互相抵消。**
这是 Mixture-of-Agents 的核心假设，Hermes 用两模型 MoA 实测过约 6 分的净增益（见 §三·2、§三·1）。

但这个价值**有条件，而 ETO 在实践里常态不满足这个条件**：

| 状态 | 是否真·不同源 | 依据 |
|:--|:--|:--|
| 三源都活着（本机 Qwen × 云端 DeepSeek × 云端 GLM） | ✅ 是 | `vote.py:28` 三套 provider 配置；issue 已知事实「`distinct_providers=3`」 |
| 任一云端 peer 降级（限流/403/只吐 reasoning） | ❌ 否，退化成「同一本地模型 × 三套 prompt」 | `docs/eto-redesign-v2-2026-11.md` r1/r2 两次实测都掉了 peer；`vote.py` 的回落逻辑 |

而「同一模型 × 三套 persona」**不是独立多样性**。这一点有直接的反证（§三·3）：
[Perspectives Without Independence](https://zenodo.org/records/23072848) 把推理算力归一化后复现，
发现「同一模型多 persona / debate 相对 self-consistency / majority voting 的增益大部分消失，
剩下的大多只是对独立第一轮答案的多数投票」。原文结论：

> a scheme that samples all of its perspectives from one model has to earn the independence it needs.
> … most of the reported gain disappears, and voting over the agents' independent first answers
> accounts for most of what remains; in one replication, self-consistency with nine samples scored
> 88.2 percent on GSM8K against 83.0 for debate at the same count. … the strongest [positive result]
> uses a single model in every role.

换句话说：**ETO 融合的「不同源」只在三源全活时成立；一旦降级（这是它的常态，见已知事实里
云端 provider 的限流/403/只吐 reasoning），它就退化成「单模型自一致性」，而自一致性是主模型
自己采样 N 次就能更便宜拿到的东西，不需要一个会诊层。**

再加三条融合层的固有劣势（都是本仓已实测的事实，非推断）：

- **聚合器比主模型弱**：`vote.py:13` 聚合走本机 `qwen3-8b-arb`。用 8B 去「融合」主模型
  （deepseek-flash 等）的结论，产出的 synthesis 常不如主模型直接读三条原文。
- **每个 peer 是裸 LLM 调用**：无工具、无沙箱、无循环（`vote.py` 的 `_call_*` 全是单次
  prompt→response）。它能给「一句话意见」，不能执行、不能读文件、不能复核自己的话。
- **评分卡对工作无决策价值**：`peer_review` 产出 `score/status/approved/revise`。但会诊要的是
  「建议 + 风险 + 分歧」（`peer_advise` 已给出），分数本身不告诉你该改什么。

**而路线 C 不损失「真·不同源」**：DSH 的 `subagent` 工具本就支持给每个子代理指定不同的
`provider`/`model`（`agentPreset`）。给 coder 子代理 deepseek、auditor 子代理 qodercn/GLM，就是真·不同源，
且附带完整工具循环、沙箱、独立上下文——这些都是融合层永远给不了的。
（⚠️ 运营者 2026-11-07 实测更正：本机 Ollama 未注册成 DSH provider，子代理派不到它；
路线 C 的「真·不同源」当前上限是 **2 个架构 DeepSeek + GLM**，不是 3 个。想上 3 源需先注册本机 Ollama 为 DSH provider，另开 issue。）

所以结论不是「融合没用」，而是：**融合的独特价值（不同源）在路线 C 里用「给子代理指定不同 provider」
就能拿到，而融合层自己却只能在三源全活时才给得出、常态降级成无独特价值的多 persona。**
于是融合这层没有不可替代性，按任务的判定规则，**选 C**。

---

## 二、三条路线的对照表

| 维度 | A 虚拟 provider（现状） | B 模式 / preset（会诊层） | C 子代理携带角色技能（选中） |
|:--|:--|:--|:--|
| 触发方式 | 每轮路由 → direct 或 consensus 融合 | 决策前由主模型「自觉」调 `eto_consensus(mode=advise)` | 主模型派子代理，子代理自带角色 skill + 工具 |
| 可靠性 | 差：会话切模型不重建工具集；长任务被预算卡；每轮多一次 Python 子进程 | 中偏弱：自动触发「没验证过是否真的触发」，靠描述写进 schema 不可靠 | 强：子代理是完整 agent 循环，失败可重试可审计 |
| 成本 | 每轮固定子进程 + 串行 peer 调用（`vote.py:419` 列表推导串行） | 决策前多一次会诊调用，成本可控但触发不可控 | 只在需要时才派；派了就花一次完整循环，但不常派 |
| 失败模式 | 静默降级成「单模型多 persona」；评分卡假绿 | 不触发 = 形同虚设；触发了也可能 degraded 被模型忽略 | 子代理失败可见、可重试；主模型拿不到就继续或换 provider |
| 何时用 | 想要「选个模型」的体验，但不值得 | 想要「自动第二意见」但触发靠不住 | **日常真实工作**：角色化 + 工具 + 沙箱 + 独立上下文 |

### 三条路线怎么落到本仓的现状

| 路线 | 本仓对应实现 | 证据 |
|:--|:--|:--|
| A | `eto/extensions/eto.ts` 的虚拟 provider + `packages/dsh-eto/lib/provider.js` | 已知事实「provider=eto 跑改文件第 2 行→md5 变化」 |
| B | `packages/dsh-eto/cordis.patch.yml` 的 `preset-eto-fusion`（persona 里写触发条件） | 已知事实「#61 改过语义，但没验证过自动触发是否真的触发」 |
| C | DSH 的 `subagent` 工具（`agentPreset`）+ `~/.dsh/skills/` skill 机制 | trigger 原文「已有 subagent 工具支持 agentPreset」；本会话工具面板可见 `subagent` 的 `provider`/`model` 参数 |

---

## 三、调研摘要（4 个项目，各 ≤10 行）

### 1. Hermes MoA 2.0（NousResearch）

- 定位：**虚拟 model provider**。聚合器（aggregator）是「acting model」——它写回复、发工具调用；
  参考模型（references）先跑，只给聚合器当顾问。
- 怎么处理「何时不该融合」：**每 preset 一个开关** `enabled: false` 就关掉 fan-out，聚合器独自当普通模型跑；
  另用 `fanout` 控制节奏（默认 `user_turn`，参考模型每用户轮只 advise 一次，不在每个工具迭代里重跑）。
- 降级：单个参考模型凭据失败**不中止这一轮**，Hermes 把失败写进参考上下文，用还活着的模型继续。
- 关键工程点：MoA「**绝不破坏 prompt cache**」——不重建 system prompt、不中途换工具集，切换成本 = 一次普通 `/model` 切换。
- 成本口径：「你付的是多模型视角的钱，不是破碎 cache 的钱」；聚合器承担几乎全部账单。
- 实测收益：两模型 MoA（opus-4.8 聚合 + gpt-5.5 参考）HermesBench **0.8202**，单跑 opus 0.7607 / gpt-5.5 0.7412，约 **+6 分**。
- 链接：<https://hermes-agent.nousresearch.com/docs/user-guide/features/mixture-of-agents>

**对本 ticket 的意义**：Hermes 是把 MoA 做成「稳定 cache、可开关、可降级」的**正规 provider**。
ETO 的路线 A 恰好踩了它专门规避的坑（切模型重建工具集、每轮子进程）。这证明「虚拟 provider 这条路本身能走通，
但要投入的工程是稳定 cache + 可开关 + 可降级」，而 ETO 没投这笔工程，也不该为单人使用投。

### 2. Mixture-of-Agents（Together AI，arXiv:2406.04692）

- 定位：**分层 MoA**——每层多个 LLM agent，每个 agent 把上一层所有 agent 的输出当辅助信息。
- 实测收益：只用开源模型的 MoA 在 AlpacaEval 2.0 拿 **65.1%**，超 GPT-4 Omni 的 57.5%，并领跑 MT-Bench / FLASK。
- 成本：多层 = 每层 N 次调用，收益靠「跨模型聚合」买来；论文没有否认这是 N× 调用换来的。
- 链接：<https://arxiv.org/abs/2406.04692>

**对本 ticket 的意义**：这是「融合有价值」的正面证据，但它的前提是**跨模型**（不同架构），
且代价是多层调用。ETO 的融合在降级态只剩单模型多 persona，不满足这个前提。

### 3. LLM-as-a-judge / self-consistency 的算力归一化反证（Perspectives Without Independence）

- 定位：对「多 agent debate / 多 persona」的**审计**——把推理算力（调用数 / token / 生成数）归一化后再比。
- 核心论点：多 persona 的「观点多样性」是**关于独立错误的断言**，从单一模型采样全部视角必须自己挣到独立性。
- 复现结果：在 matched calls/tokens 下，debate / persona 相对 self-consistency / majority voting 的增益**大部分消失**；
  「nine-sample self-consistency 88.2% GSM8K vs debate 83.0（同 count）」「最强正结果只用单一模型跑全部角色」。
- 链接：<https://zenodo.org/records/23072848>

**对本 ticket 的意义**：**这是决定性的一条。** ETO 融合的常态（降级态）正是「同一本地模型 × 三套 persona」，
按此论文这不构成独立多样性，剩余收益只是 self-consistency——主模型自己采样就能更便宜地拿到。

### 4. Anthropic / OpenAI 的子代理编排实践

- Anthropic：多 agent 只在**三种情况**稳定优于单 agent——① 上下文污染损害性能；② 任务可并行；
  ③ 专业化改善工具选择或任务聚焦。**除此之外协调成本通常超过收益**；实测多 agent 通常比单 agent
  **多花 3–10× token**（上下文重复 + 协调消息 + 交接摘要）。原话：「start with a single agent」、
  「fold subagents back into the main agent loop」。
- OpenAI：区分两种形态——**Handoffs**（专家接管该分支的回复，控制权转移）vs **Agents as tools**
  （manager 保持控制，把专家当有界能力调用）。会诊/评审属于后者；「让专家真正干活」属于前者。
- 链接：<https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them> ；
  <https://developers.openai.com/api/docs/guides/agents/orchestration>

**对本 ticket 的意义**：ETO 现在的三镜路由 + 共识 + 选举 + 审议的编排，**不属于** Anthropic 列的三种正当场景，
是「3–10× 协调成本没有对应收益」的典型。而「让子代理携带角色真正干活」= OpenAI 的 Handoffs，
正是路线 C 的形态。

---

## 四、实施清单（按优先级；本次不改代码，以下为后续实施步骤）

每条写清「改哪个文件 / 怎么验收」。标注 ⬜ 未做（本报告不实施）。

### P0 —— 把「角色」变成可携带的 skill（路线 C 的实体）

1. **沉淀三套 peer 提示词为角色 skill**（`eto/stitches/consensus/vote.py:16-20` 的 `PEER_SYSTEM_PROMPTS`）。
   - 改哪：新建 `~/.dsh/skills/eto-reviewer/{researcher,coder,auditor}.md`（或一个 SKILL.md 三个 role），
     内容 = 三套 prompt 原文 + 「何时用 / 输出什么」。
   - ⚠️ 角色 skill 里别绑定「本机 Qwen / Ollama」当 provider——子代理只能用 DSH 已注册 provider（见第 2 条）。
   - 验收：`ls ~/.dsh/skills/eto-reviewer/` 见三个角色文件；在 DSH 会话里能 `skill` 加载并让子代理携带。
2. **验证子代理能指定不同 provider**（C 的前提）。✅ 已由运营者实测（2026-11-07）。
   - 改哪：无代码；派两个子代理：`provider=deepseek-official/model=deepseek-flash` 与 `provider=qodercn/model=gfmodel`。
     （本机 Ollama 不是 DSH provider，子代理派不到，别写「auditor 用本机 Qwen」。）
   - 实测结果：两个都成功（`both_ok: true`）、结论不同（`distinct: true`）；`loomy`/`raccoon` 502 只吐 reasoning 不可用。
   - 验收：`distinct provider` 数为 2（DeepSeek + GLM，当前「真·不同源」上限）。

### P1 —— 让会诊「可选、非自动、只 advise」

3. **把 `eto_consensus` 收窄为 `mode=advise` 原语**，去掉评分卡语义。
   - 改哪：`packages/dsh-eto/lib/tools.js`（`eto_consensus` 的 description 改为「需要第二意见时主动调用，
     只给建议/风险/分歧，不打分」）+ `cordis.patch.yml` 的 `enabledTools`。
   - 验收：工具 schema 里不再出现 `final_score`/`approved`/`revise`；`peer_advise` 返回的字段是
     `synthesis/advice/risks/disagreements`。
4. **停用自动触发 preset**：`packages/dsh-eto/cordis.patch.yml` 里 `preset-eto-fusion` 的 persona 触发描述删除或整段移除。
   - 验收：`/model` 或 preset 列表里不再出现「ETO 决策会诊」自动触发；选它不再每轮插会诊指令。

### P2 —— 退役虚拟 provider 与评分卡

5. **虚拟 provider 标记废弃**：`eto/extensions/eto.ts` 与 `packages/dsh-eto/lib/provider.js` 的 provider 入口
   改为「返回一句『ETO 已改为角色技能库，请用 subagent』」或直接移除注册。
   - 验收：`/model` 里选不到 `eto` provider；会话里不再有「切到 eto 模型收不到工具集」的坑。
6. **`vote.py` 评分卡（T1/T2/T3）退役**：保留 `peer_advise`（会诊），删除或不再暴露 `peer_review` 的评分路径。
   - 验收：面板与工具面不再有「评分卡」；台账只记会诊记录（保留 `docs/demo/eto-ledger.html` 的台账形态）。

---

## 五、明确的「不做」清单

| 项 | 为什么不做 |
|:--|:--|
| **重写 `vote.py` 的融合算法** | 任务硬约束明确禁止；且融合的独特价值（不同源）在 C 里用「子代理指定不同 provider」替代，重写是往错的方向投工程 |
| **把 `eto_consensus` 做成自动触发的会诊 preset** | 触发靠「写进工具描述的自觉」不可靠（issue 已知事实「没验证过是否真的触发」）；且 Perspectives 证明收益是 self-consistency，主模型自己采样更便宜 |
| **继续维护三阶段评分卡（T1/T2/T3）** | 分数与 `approved/revise` 对工作无决策价值；会诊要的是建议+风险+分歧，`peer_advise` 已有 |
| **为融合再拉一套云端推理栈** | 继承 `docs/eto-assessment-2026-11.md`：本机 Qwen 已验证可用且免费；云端 peer 常态限流/403 |
| **给面板造假进度条 / 重做「导入到对话」** | 继承 `docs/eto-redesign-v2-2026-11.md`：`peer_review` 返回前不吐阶段信息；浏览器拿不到 host `agents` |
| **把「角色 skill」写成又一套路由/编排框架** | 角色 skill 就是「提示词 + 何时用」，别把它做成第二个 ETO 编排器；需要协调时用 DSH 的 subagent 原语 |

---

## 六、附：本报告怎么来的（证据边界）

- **读到的一手来源**：Hermes MoA 官方文档（curl 全文）、Together MoA 论文摘要（arXiv:2406.04692）、
  Perspectives Without Independence 论文题录与摘要（zenodo 23072848）、Anthropic 多 agent 博客全文、
  OpenAI orchestration 文档。
- **读到的本仓证据**：`eto/stitches/consensus/vote.py`（peer prompt、provider 配置、串行、聚合器、评分卡）、
  `eto/extensions/eto.ts`、`packages/dsh-eto/cordis.patch.yml`（preset-eto-fusion 全文）、
  `docs/eto-assessment-2026-11.md`、`docs/eto-redesign-v2-2026-11.md`（r1/r2 掉 peer 与 56.9s/76.2s 实测）。
- **已由运营者实测**（2026-11-07）：`subagent` 的 provider 指定能力——`deepseek-official` + `qodercn` 两源均可派、结论不同（`distinct: true`）；
  `loomy`/`raccoon` 502（只吐 reasoning 无 text 块）；本机 `ollama` **不是** DSH provider（`vote.py` 直连 HTTP，子代理派不到）。
- **仍未实测**：`preset-eto-fusion` 自动触发是否真的触发（issue 已知事实即「未验证」）。
- **推断的（已标注）**：三条路线的成本/可靠性对照里，B 与 C 的定性判断是推断，非实测；A 的坑是已知事实。
