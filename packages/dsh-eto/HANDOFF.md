# 交接：dsh-eto 插件当前状态与待评估问题

> 写于 2026-11-05。这份文件是给评审者（superagent）的输入，不是最终文档。

## 这是什么

`dsh-eto` 是 DeepSeek Harness 插件，把 ETO 的 13 个能力挂成模型工具 + 一个侧栏工作台面板。
安装方式 `link:` 到 `~/src/dsh-eto`，已装进 desktop profile 的 bundles。

## 已完成（✅ 实测通过）

| 项 | 证据 |
|:--|:--|
| 13 个无前缀工具注册（`eto_consensus` 等） | `GET /@dsh-eto/api/status` → `registered: 7`（白名单裁剪后）|
| 工具精简 14→7（1115→596 tokens） | `cordis.patch.yml` 的 `enabledTools` |
| `eto_peer_score` 用会话模型（不依赖 Ollama） | `lib/tools.js:314` `resolveScoreRoute` |
| 面板单页工作台（输入框 + 4 动作 + 历史时间线） | `lib/client.js` `InfoPage` |
| 历史持久化 localStorage（最近 50 条，可重跑） | `dsh-eto:history` |
| 导入到对话（`agents.createSession`） | ⚠️ 未实机验证，见下 |
| `/api/run` 白名单路由 | 8 个工具，`eto_consensus` 已加入 |
| 64 个测试 | `node --test tests/*.mjs` 全过 |

## 待评估的问题（请重点给方案）

### P0-1 共识评审是「假成功」

`eto_consensus` 的 4 个 peer 全部走 Ollama（`localhost:11434`，模型 `qwen2.5-coder:7b`）。
**本机 Ollama 没运行**时，`_call_provider` 静默返回空串 → 评分退化为默认 0.5 →
面板显示「评审完成」，但每个 peer 的 `concern` / `suggestion` 都是空。

实测输出：
```json
{"status":"revise","final_score":0.333,
 "votes":[{"peer":"researcher","score":0.5,"concern":"","suggestion":""}, ...]}
```

**候选方案**：
- A. 启动 Ollama（贴合原设计，但要常驻服务 + 7B 模型慢）
- B. 让共识评审走 `eto_peer_score`（DSH 会话模型）—— 沿用 `resolveScoreRoute` 的思路
- C. 仅探测 + 明示失败（不解决能力，只避免误导）

### P0-2 `eto_consensus` 很慢且阻塞

面板点击后是同步等待（已设 180s 超时）。用户看不到进度，超时就整条失败。
**候选**：改异步任务 + 轮询进度；或流式返回每个 peer 的分数。

### P1-1 「导入到对话」未实机验证

```js
await agents.createSession({ initialMessage: text })
```
`createSession` 的签名是从 `app.asar` 逆推的，**没有实机验证过**。
点按钮可能直接抛错（会显示「导入失败：…」）。

### P1-2 面板信息密度与布局

当前是「一个输入框 + 一排按钮 + 时间线」。已知不足：
- 评审进度不可见
- 历史条目不分组、无筛选
- 记忆浏览被我从面板移除了（只在工具里），可能需要一个抽屉

### P2 工具白名单与 preset 的关系

`enabledTools` 是全局配置（7 个）。`preset-eto`（ETO 编排模式）已建，但**没有真正做工具隔离** ——
切到其它 preset 的会话依然能看到这 7 个工具，只是有 persona 引导。
真正的隔离需要把工具挂到 preset 层（`agent.cordis.yml` 的 plugins），
或用 `dsh-agent-preset` 的 scoped 机制。**请评估可行性与代价**。

## 代码入口

| 文件 | 职责 |
|:--|:--|
| `lib/index.js` | host 侧：工具注册、`/api/status`、`/api/test`、`/api/run` |
| `lib/tools.js` | 14 个工具定义（schema + output + render）、`resolveScoreRoute` |
| `lib/spawn.js` | 子进程边界：超时、取消、错误分类 |
| `lib/eto_runner.py` | Python 侧单进程入口，`__ETO_RESULT__` 哨兵协议 |
| `lib/client.js` | client 侧：侧栏入口、工作台面板、设置面板 |
| `cordis.patch.yml` | bundle 声明（`enabledTools` 白名单） |

## 请评估并给出

1. **P0-1 / P0-2 的实现方案**（选哪个、为什么、改动落在哪个文件）
2. **P1-2 的面板信息架构**（是否需要改布局，改成什么样）
3. **P2 的工具隔离可行性**（preset 层挂载 vs scoped 机制，代价多大）
4. **一份给运营者看的 README**（怎么用、什么场景用什么）
