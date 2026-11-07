# dsh-eto

[ETO](https://github.com/reoroy/evolutionary-teal-organization)（青色组织多 Agent 编排库）的 **DeepSeek Harness 独立插件**。

一个插件给 DSH 四样东西：

- **14 个工具**直接注册在 `ctx.tools` 上（无 `mcp__` 前缀、不经过 MCP 握手）
- **虚拟 provider `eto`**：在模型选择器里选 `eto / eto-consensus`，每轮对话自动跑三源异构融合（本机 Qwen × deepseek-official × qodercn/GLM）
- **侧边栏入口 + 信息面板**：ETO 版本/commit、14 个工具可用状态、最近共识、路由统计
- **设置面板**：仓库/虚拟环境/解释器、工具白名单、`eto_peer_score` 的评分模型、测试连接

## 工具

| 工具 | 用途 |
|---|---|
| `eto_consensus` | 同侪共识评审：评分 → 审议 → 终审 |
| `eto_route` | 三镜路由：knowledge/research/code/solution + direct/plan/consensus |
| `eto_peer_config` | 查看 peer provider 配置 |
| `eto_memory_write` / `eto_memory_read` / `eto_memory_list` | 跨会话共享记忆 |
| `eto_clarify` / `eto_review` / `eto_feedback` | HITL 三 Gate |
| `eto_file_status` / `eto_file_update` / `eto_file_release` | 文件锁（多 agent 协调） |
| `agent_execute` | 把一步任务交给 ETO 配置的 peer provider |
| **`eto_peer_score`** | **用当前会话模型给计划打分**，不依赖 Ollama |

前 13 个是 ETO 自带能力；`eto_peer_score` 是本插件新增——它在 DSH 进程内经 `ctx.llm` 调当前会话的模型，
因此共识评审可以跑在主模型上，而不是 Ollama。

## 安装

```bash
# 1. ETO 本体
git clone https://github.com/reoroy/evolutionary-teal-organization.git ~/src/eto
cd ~/src/eto && python3 -m venv .venv && .venv/bin/pip install -e eto/

# 2. 装插件（desktop profile 必须显式 DSH_HOME，否则会装进 CLI 的隔离 home）
DSH_HOME="$HOME/.dsh" dsh plugin --profile desktop add link:$HOME/src/dsh-eto
```

或用 patch 层（`cordis.patch.yml` 已经是这种形态）：

```yaml
- insert:
    - id: eto
      name: 'dsh-eto'
```

### 从旧的 MCP 桥迁移

旧版经 `@deepseek-ai/dsh-mcp-client` 拉起 node launcher，工具名带 `mcp__eto__` 前缀。
**没有兼容层**：装上本插件后先删掉 profile 里的旧条目

```yaml
# 删掉这一段（desktop 的 cordis.patch.yml 里 id: eto 的 mcp-client 条目）
- id: eto
  name: '@deepseek-ai/dsh-mcp-client'
  config: { serverName: eto, ... }
```

再删 `~/.dsh/eto-plugin/`（旧 launcher 的落地目录）。工具名从 `mcp__eto__eto_route` 变成 `eto_route`，
历史会话里的旧名会得到 "unknown tool"，这是有意的——不做静默别名。

## 配置

全部字段都是 `volatile`，改完即时生效，不用重启插件。

| 字段 | 默认 | 说明 |
|---|---|---|
| `repo` | `$DSH_ETO_REPO` 或 `~/src/eto` | ETO checkout |
| `venv` | `<repo>/.venv` | 虚拟环境 |
| `python` | `<venv>/bin/python`（Windows `Scripts/python.exe`） | 解释器 |
| `enabledTools` | `[]` | 工具白名单；空 = 全部 |
| `toolTimeoutMs` | `180000` | 单次工具调用超时 |
| `peerScoreProvider` / `peerScoreModel` | 空 | `eto_peer_score` 的模型；**两者都填才覆盖**，否则用会话模型 |
| `peerScoreTimeoutMs` | `90000` | 评分调用超时 |
| `envPassthrough` | `[]` | 额外透传给子进程的环境变量名 |

路径支持 `~`。面板只显示 `~` 相对路径，不把本机绝对路径带到页面上。

## 虚拟 provider：把 ETO 当成一个模型来选

选它就像选模型——每轮对话自动跑三源异构融合，不用让模型主动调 `eto_consensus`。

- **provider**：`eto`；**model**：`eto-consensus`
- **每轮**：本机 Qwen（ollama）× `deepseek-official/deepseek-flash` × `qodercn/gfmodel` → 聚合器融合成一段结论
- **流式返回**：符合 DSH 的 llm 契约（`block-start` → `text-delta` → `block-end` → `usage` → `finish`）
- **失败如实报错**：某 peer 掉队会标 `ollama(fallback)` 或 `degraded`，绝不静默回落成单模型
- 融合本身仍在 `eto/stitches/consensus/vote.py`，provider 只是适配层，复用同一条 `runTool({ tool: 'eto_consensus' })` 通道

`ETO 融合（三源评审）` 预设（本插件 bundle patch 里的 `preset-eto-fusion` 声明行）把这个 provider 设为会话默认模型：在**模式选择**里选 `ETO 融合`，进场就自动触发，每轮都跑融合。预设用 `@deepseek-ai/dsh-agent-default-model` 把 `provider: eto, model: eto-consensus` 钉进预设 scope。

探针 `GET /@dsh-eto/api/status` 的 `providers` 字段会列出已注册的虚拟 provider（注册成功时为 `["eto"]`）。

## 工作原理

一次工具调用 = 一个短命子进程：

```
<python> <plugin>/lib/eto_runner.py <tool>   ← 参数走 stdin（JSON）
stdout: __ETO_RESULT__{"ok":true,"result":...}
```

为什么是哨兵行而不是"stdout 就是 JSON"：ETO 的 stitch 会往 stdout 打印日志，直接 `JSON.parse(stdout)` 迟早会炸。

失败分四类，报错信息定位到环节：`usage`（参数缺失/类型错）、`unknown_tool`、`import`（checkout/venv 问题）、`tool`（ETO 自己抛错）。
`timedOut` / `exitCode` / `signal` 三个事实独立上报——子进程吞掉 SIGTERM 后 exit 0 仍然是超时。

## 面板

- **侧边栏 `ETO`**：点开是信息面板（状态卡 / **工作台** / 工具可用性 / 最近共识 + 路由统计）
- **设置 → ETO**：路径、白名单、评分模型、测试连接

### 工作台（v0.2.1）

信息面板顶部的操作区，三个卡片，全部是**秒出、无 LLM 依赖**的白名单工具：

| 卡片 | 输入 | 动作 | 返回 |
|---|---|---|---|
| **任务路由分析** | 任务描述 | `eto_route` | gewu / MODE / 置信度 |
| **指令澄清器** | 要派活的指令 | `eto_clarify` | 是否模糊 + 命中词 + 澄清选项 |
| **共享记忆** | key / value | `eto_memory_write` / `read` / `list` | 跨会话 KV 读写 |

### 开启 ETO 流程（两种方式）

1. **切 preset**：模型选择器选「ETO 编排模式」，新会话即带 ETO 人格与工具用法指引。
2. **子 agent（推荐）**：在任意会话说「派一个 ETO 编排模式的子 agent 来评审 XXX」——
   走内置 `subagent` 工具的 `agentPreset: "eto"`，子 agent 自带 ETO 人格与全部工具。

平时不需要 ETO：工具集已精简为 7 个核心（约 596 tokens），日常对话保持轻量。

### 数据接口（只接受本机或同源请求，且必须带 `x-dsh-eto: 1`）

| 接口 | 用途 |
|---|---|
| `GET /@dsh-eto/api/status` | 状态（5 秒缓存；`?fresh=1` 绕过） |
| `POST /@dsh-eto/api/test` | 实时探测：耗时、路径是否存在、工具可用性 |
| `POST /@dsh-eto/api/run` | **工作台**：白名单工具执行（`eto_route` / `eto_clarify` / `eto_memory_*` / `eto_peer_config` / `eto_file_status`）|

`/api/run` 是显式白名单：会话绑定的重工具（`agent_execute`、`eto_peer_score`）不对面板开放。

## 测试

```bash
cd ~/src/dsh-eto && node --test "tests/*.test.mjs"
```

76 个用例，分六组：工具目录/输出 schema（`catalog`）、子进程边界（`spawn`，含真超时与取消）、
配置解析（`config`）、插件装配与 HTTP 路由（`apply`）、真实 ETO 集成（`integration`，缺 checkout 时跳过）、
`eto_peer_score`（`peer-score`，stub llm）。

## 已知限制

- **每个工具调用起一个 Python 进程**（约 0.2–0.4 秒）。共识评审这类多次 LLM 调用的工具，时间花在 provider 上，不在启动上。
- `eto_consensus` / `agent_execute` 仍走 ETO 自己的 provider 配置（默认 Ollama `localhost:11434`）；只有 `eto_peer_score` 用会话模型。
- 设置面板的持久化依赖 `configForms`：远程（非 loopback）访问时只在本浏览器生效。
- 面板不显示 ETO 的绝对路径，因此"ETO 在哪"只能从设置面板看到（`~` 形式）。
- 工具白名单按名字匹配；写错的名字会在日志里告警，但不会让插件加载失败。

## 路线图

| 里程碑 | 内容 | 状态 |
|---|---|---|
| v0.1.x | MCP 桥（已废弃） | 归档 |
| v0.2.0 | 独立插件：14 工具（无前缀）、信息/设置面板、`eto_peer_score`（会话模型） | ✅ |
| v0.2.1 | 工具精简（14→7）、preset-eto、**工作台**（路由/澄清/记忆）、`/api/run` 白名单路由 | ✅ |
| v0.3.0 | 共识评审 UI（异步 + 进度）+ 集体回顾按钮 + mesh 状态 | 计划 |
| v0.4.0 | Watch/Cron Loop（ETO #28 遗留）、`peer_score` 面板化 | 计划 |
| v0.5.0 | npm 发布、工具按 preset 完全隔离、取消 `link:` 安装（改真实目录复制） | 远期 |

