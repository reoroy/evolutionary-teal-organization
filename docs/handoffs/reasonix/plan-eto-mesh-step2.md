# Plan: ETO Mesh Step 2 — Agent Registry + 心跳 + /agents 命令

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 基线: v0.5.0 (智子 v2)
> 父 Plan: `plan-eto-mesh.md` (Phase 1b)

---

## 现状

ETO 当前在 `eto/extensions/eto.ts` 中已有三镜路由、智子 v2、同侪共识等功能，但缺以下能力：

| 缺口 | 影响 |
|:-----|:------|
| Agent 不自知 | 当前 ETO 实例不知道自己是谁，不写入持久化身份 |
| 无法发现对端 | 没有 `/agents` 命令查看已知 Agent |
| 无心跳 | 即使将来有 Mesh，也无法判断 Agent 是否存活 |

已有基础设施：
- `eto/stitches/registry.py` — 一个 HTTP 版本的 Peer Registry server（实验性，未集成到 eto.ts）
- `~/.pi/eto-config.json` — 现有配置文件中 `peers` 段

---

## 方案

### 总览

在 `eto/extensions/eto.ts` 中添加文件级 Agent Registry：
1. 每次 `session_start` → `registerSelf()` 写入 `~/.eto/registry.json`
2. 每次 `before_agent_start` → `heartbeat()` 更新 `last_seen`
3. `pi` → `/agents` 命令列出本地 registry 中所有 Agent

```
session_start ──→ registerSelf() ──→ write ~/.eto/registry.json
                                              │
before_agent_start ──→ heartbeat() ──────────→ update last_seen
                                              │
/agents ──→ loadRegistry() ──→ display table
```

### 1. Registry 数据结构

`~/.eto/registry.json` (运行时自动维护，不提交到 git)：

```json
{
  "version": 1,
  "agents": {
    "pi-ws-5090": {
      "id": "pi-ws-5090",
      "platform": "pi",
      "hostname": "ws-5090",
      "mcp_endpoint": "python -m eto.mcp_server",
      "capabilities": ["code", "research", "audit"],
      "status": "online",
      "last_seen": "2026-07-04T12:00:00Z"
    }
  }
}
```

字段说明：

| 字段 | 值 | 说明 |
|:-----|:---|:------|
| `id` | `pi-<hostname>` | 自动生成，全局唯一 |
| `platform` | `"pi"` | 当前固定 pi，后续扩展 claude/reasonix/hermes |
| `hostname` | `os.hostname()` | 机器名 |
| `mcp_endpoint` | `"python -m eto.mcp_server"` | MCP Server 入口 |
| `capabilities` | `["code", "research", "audit"]` | 与现有 Agent Profile 对应 |
| `status` | `"online"` | 始终 online，离线用 `last_seen` 推断 |
| `last_seen` | ISO 8601 | 每次心跳更新 |

### 2. Agent ID 生成规则

```typescript
`pi-${require("os").hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-")}`
```

示例：`pi-ws-5090`, `pi-thinkpad-x1`

### 3. 注册时机

**session_start**（非首次）：
- 调用 `registerSelf()` — 写入完整 Agent entry

**before_agent_start**（每次用户发消息）：
- 调用 `heartbeat()` — 如果已存在则只更新 `last_seen` + `status`，否则创建新 entry

### 4. /agents 命令

在现有命令区域注册 `/agents`：

```
📋 Agent Registry (1):
  pi-ws-5090              pi       在线    2026-07-04 12:00:00
```

列格式：`ID（padEnd 22） platform（padEnd 8） 状态（padEnd 6） last_seen（去 T）`

状态判定：`last_seen` 距离现在 < 120 秒 → "在线"，否则 "离线"（为将来多 Agent 准备）。

---

## 改动文件

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | 新增以下内容（~60 行） |

### 具体插入位置

**A) Agent Registry 函数段（~40 行）**

在 `Plan 执行器` 函数（`executePlanViaMaestro` 之后，`// 四、Pi 扩展入口` 之前）插入：

```typescript
// ═══════════════════════════════════════════════════
//  Agent Registry — 本地注册 + 心跳
// ═══════════════════════════════════════════════════

const REGISTRY_PATH = () => {
  const dir = join(require("os").homedir(), ".eto");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "registry.json");
};

function generateAgentId(): string {
  return `pi-${require("os").hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

function loadRegistry(): { version: number; agents: Record<string, any> } {
  try { return JSON.parse(readFileSync(REGISTRY_PATH(), "utf-8")); }
  catch { return { version: 1, agents: {} }; }
}

function saveRegistry(reg: any): void {
  writeFileSync(REGISTRY_PATH(), JSON.stringify(reg, null, 2), "utf-8");
}

function registerSelf(): void {
  const reg = loadRegistry();
  const id = generateAgentId();
  reg.agents[id] = {
    id,
    platform: "pi",
    hostname: require("os").hostname(),
    mcp_endpoint: "python -m eto.mcp_server",
    capabilities: ["code", "research", "audit"],
    status: "online",
    last_seen: new Date().toISOString(),
  };
  saveRegistry(reg);
}

function heartbeat(): void {
  const reg = loadRegistry();
  const id = generateAgentId();
  if (reg.agents[id]) {
    reg.agents[id].last_seen = new Date().toISOString();
    reg.agents[id].status = "online";
  } else {
    // 首次写入
    registerSelf();
  }
  saveRegistry(reg);
}
```

**B) session_start 添加 registerSelf (1 行)**

在 `session_start` handler 的「非首次」分支末尾（`ctx.ui.setWidget("eto-route", [...])` 之后，`});` 之前）：

```typescript
registerSelf();
```

**C) /agents 命令注册（~18 行）**

在 `/metrics` 命令之后、`before_agent_start` 之前注册：

```typescript
pi.registerCommand("agents", {
  description: "列出所有已注册 Agent 及其状态",
  handler: async (_args, ctx) => {
    const reg = loadRegistry();
    const agents = Object.values(reg.agents);
    if (agents.length === 0) {
      ctx.ui.notify("没有已注册的 Agent", "info");
      return;
    }
    const now = new Date();
    const lines = agents.map((a: any) => {
      const lastSeen = new Date(a.last_seen);
      const diffMs = now.getTime() - lastSeen.getTime();
      const status = diffMs < 120000 ? "在线" : "离线";
      return `  ${(a.id || "?").padEnd(22)} ${(a.platform || "?").padEnd(8)} ${status.padEnd(6)} ${a.last_seen.slice(0, 19).replace("T", " ")}`;
    });
    ctx.ui.notify(`📋 Agent Registry (${agents.length}):\n${lines.join("\n")}`, "info");
  },
});
```

**D) before_agent_start 添加 heartbeat (1 行)**

在 `before_agent_start` handler 第一行 `blockCounters.clear()` 之后、`turnCounter++` 之后：

```typescript
heartbeat();
```

**不要额外改动：**
- ❌ 不要改 `registry.py`（那是未来的 HTTP 版，暂不集成）
- ❌ 不要新建文件
- ❌ 不要改其他命令 (eto, sentinel-reload, metrics)

---

## 验证

在 Pi CLI 中执行：

```bash
# 1. 启动 Pi 发送消息（触发 session_start + registerSelf）
pi --no-extensions -e eto/extensions/eto.ts -p "hello"
# → 应看到 ETO 路由输出，registry.json 已写入

# 2. 检查 registry 文件
cat ~/.eto/registry.json
# → {"version":1,"agents":{"pi-<hostname>":{...}}}

# 3. /agents 命令
pi
> /agents
# → 📋 Agent Registry (1):
#    pi-<hostname>    pi    在线    <时间>

# 4. 再次发消息触发心跳
pi --no-extensions -e eto/extensions/eto.ts -p "test"
# → last_seen 已更新
```

---

## 验收标准

| # | 检查项 | 方法 |
|---|--------|------|
| R-1 | `session_start` 后 `~/.eto/registry.json` 存在且有正确内容 | cat 检查 |
| R-2 | Agent ID 格式为 `pi-<hostname>` | 检查 id 字段 |
| R-3 | `/agents` 输出表格格式，包含 id/platform/status/last_seen | 运行 `/agents` |
| R-4 | 发第二条消息后 `last_seen` 更新 | diff registry.json |
| R-5 | 现有 `17/17` stitch 测试不破坏 | `python eto/stitches/test.py` |
| R-6 | 已有命令不受影响 (`/eto`, `/metrics`, `/sentinel-reload`) | 各跑一次 |
