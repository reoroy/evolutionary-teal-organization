# Completion: ETO Mesh Step 2 — Agent Registry + 心跳 + /agents 命令

> 实现日期: 2026-07-04 | 实现者: Reasonix Code
> 源 Plan: `docs/handoffs/reasonix/plan-eto-mesh-step2.md`

---

## 改动清单

**文件**: `eto/extensions/eto.ts`

### 1. Agent Registry 函数段 (新增 ~50 行)

在 `三、Plan 执行器` 与 `四、Pi 扩展入口` 之间插入以下函数：

| 函数 | 职责 |
|:-----|:------|
| `REGISTRY_PATH()` | 返回 `~/.eto/registry.json` 路径，自动创建目录 |
| `generateAgentId()` | 生成 `pi-<hostname>` 格式 ID |
| `loadRegistry()` | 读取 registry.json，文件不存在返回空结构 |
| `saveRegistry(reg)` | 写入 registry.json |
| `registerSelf()` | 写入完整 Agent entry（id/platform/hostname/capabilities/status/last_seen） |
| `heartbeat()` | 更新 `last_seen` + `status`，不存在则创建 |

### 2. session_start → registerSelf() (第 620 行)

在非首次分支的 `ctx.ui.setWidget(...)` 之后添加 `registerSelf();`，确保每次会话启动注册身份。

### 3. /agents 命令 (第 660–677 行)

在 `/metrics` 之后、`before_agent_start` 之前注册：

- 列出 registry 中所有 Agent
- 状态判定：`last_seen` < 120 秒 → "在线"，否则 "离线"
- 输出格式：ID(22) platform(8) 状态(6) last_seen

### 4. before_agent_start → heartbeat() (第 680 行)

在 `blockCounters.clear()` 之后、`turnCounter++` 之前添加 `heartbeat();`，每次用户消息更新心跳时间戳。

---

## 验收指引

| # | 检查项 | 验证方法 |
|---|--------|---------|
| R-1 | `session_start` 后 `~/.eto/registry.json` 存在 | `cat ~/.eto/registry.json` |
| R-2 | Agent ID 格式 `pi-<hostname>` | 检查 id 字段 |
| R-3 | `/agents` 输出表格格式 | 运行 `/agents` |
| R-4 | 发第二条消息后 `last_seen` 更新 | `diff` 两次 registry.json |
| R-5 | 现有命令不受影响 | 各跑一次 `/eto`, `/metrics`, `/sentinel-reload` |

---

## 未改动

- ❌ `registry.py` — HTTP 版暂不集成（按计划）
- ❌ 其他命令 (`/eto`, `/sentinel-reload`, `/metrics`) — 不变
- ❌ 其他文件 — 仅修改 `eto/extensions/eto.ts`
