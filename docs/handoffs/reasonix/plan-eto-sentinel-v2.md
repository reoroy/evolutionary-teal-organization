# Plan: 智子 v2 — AgentGuard 级行为规则引擎

> 创建日期: 2026-07-04 | 来源: Claude Code
> 执行: Reasonix → 审计: Claude Code

---

## 现状

当前智子（sentinel）在 `eto.ts` 中，约 100 行。三个问题：

| 问题 | 表现 | 根因 |
|:-----|:------|:------|
| **拦截范围窄** | 只检查 bash 和 write_file，git/edit/grep 等工具不检 | 只配了 `trigger: "bash" | "write_file"` |
| **弱确认** | 只有简单 block/confirm，用户看不到影响范围就盲目决定 | 没有预览 + 强化弹窗 |
| **死循环打转** | 规则拦截后 agent 重试 → 再拦截 → 无限循环 | 没有拦截计数 + 逃生门 |

参考 [agent-guardrails](https://github.com/reoroy/agent-guardrails)（工具调用层行为规则引擎），用其规则模型重写智子。

---

## 方案

### 规则类型

| 类型 | 行为 |
|:-----|:------|
| `block` | 关键词匹配→直接拦截 |
| `confirm` | 弹出带预览的确认窗口，用户决定 |
| `transform` | 正则替换输出 |
| `track_turns` | 对话轮数超阈值→注入提醒 |

### 逃生门（防循环核心）

用户回复消息 → 重置所有规则块计数。逃生门只在**同一个用户请求内**连续触发：

```
用户: 删掉 /var/log
  Agent: rm -rf /var/log → 智子拦截 ×1
  Agent: rm -rf /var/log → 智子拦截 ×2
  Agent: rm -rf /var/log → 智子拦截 ×3 (逃生门触发) → 放行但记录
用户: 你为什么不删？
  → 块计数重置 (新用户消息)
```

逃生门参数（`~/.pi/eto-sentinel.json`）：

```json
{
  "deadlock": {
    "maxBlocksPerRequest": 3,
    "escapeAction": "log"
  }
}
```

- `maxBlocksPerRequest`: 同一次用户请求内，同一规则连续拦截 N 次后逃生（默认 3）
- 用户发新消息 → 全部计数归零
- 逃生时写一条审计日志 + 在 block message 里告知"已自动放行"

### 强化 Confirm（A+B 方案）

拦截时展示：

```
╔══ 智子安检 ═══════════════════════╗
║  [危险操作] rm -rf /var/log       ║
║                                    ║
║  规则: dangerous-bash (已拦 2 次)  ║
║                                    ║
║  影响预览:                         ║
║    /var/log/syslog  (1.2GB)       ║
║    /var/log/auth.log (800MB)      ║
║    ...共 23 个文件                ║
║                                    ║
║  [放行]  [否决]                   ║
╚════════════════════════════════════╝
```

实现：检测到危险 bash 命令时，自动生成一条安全预览命令执行，把结果塞进 confirm 对话框。

| 原始命令 | 预览命令 |
|:---------|:---------|
| `rm -rf /var/log` | `ls -la /var/log \| head -20` |
| `dd if=/dev/zero of=/dev/sda` | `lsblk \| head -10` |
| `rm file.txt` | `ls -la file.txt && wc -c file.txt` |

预览命令只在 `action: "confirm"` 时自动生成，`action: "block"` 不预览。

### 逃生门触发时的提示

```typescript
if (checkDeadlock(rule.name)) {
  return { block: true, reason: `[智子] ${rule.name}: 已拦 ${count} 次，自动放行。如需永久放行请修改 sentinel 配置。` };
  // 实际放行（不堵死）
}
```

### 新 SentinelRule 接口

```typescript
interface SentinelRule {
  name: string;
  enabled?: boolean;
  priority?: number;           // 高优先级先检查，默认 0
  type: "block" | "confirm" | "transform" | "track_turns";

  // block / confirm 用
  trigger?: string;            // 工具名或工具名 glob: "bash", "write", "edit", "git:*"
  pattern?: string;            // 匹配正则（对 args 或 command）

  // confirm 用
  message?: string;

  // transform 用
  from?: string;               // 正则
  to?: string;                 // 替换文本

  // track_turns 用
  maxTurns?: number;
  reminder?: string;
}
```

### 改动文件

| 文件 | 改动 |
|:------|:------|
| `eto/extensions/eto.ts` | 重写 sentinel 段（接口+检查+逃生门） |
| `.pi/eto-sentinel.json` | 更新配置示例 |

### eto.ts 改动要点

```typescript
// 逃生门状态
const blockCounters = new Map<string, number>();

function checkDeadlock(ruleName: string): boolean {
  const count = blockCounters.get(ruleName) || 0;
  if (count >= (SENTINEL.deadlock?.maxBlocksPerRule ?? 5)) {
    logSentinel(ruleName + "-escape", `blocked ${count}x, auto-escaped`);
    return true; // 放行
  }
  blockCounters.set(ruleName, count + 1);
  setTimeout(() => blockCounters.set(ruleName, Math.max(0, (blockCounters.get(ruleName) || 1) - 1)),
    SENTINEL.deadlock?.autoResetMs ?? 300000);
  return false;
}

async function checkSentinel(event: any, ctx: any): Promise<{ block: true; reason: string } | null> {
  if (!SENTINEL.enabled) return null;

  // 按优先级排序 rule
  const rules = [...SENTINEL.rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (!rule.type) continue;

    if (rule.type === "block" || rule.type === "confirm") {
      // 匹配工具名 (支持 glob: "git:*")
      if (rule.trigger && !matchToolName(event.toolName, rule.trigger)) continue;
      // 匹配命令/参数
      const input = JSON.stringify(event.input || "").toLowerCase();
      if (rule.pattern && !new RegExp(rule.pattern, "i").test(input)) continue;

      // 逃生门检查
      if (checkDeadlock(rule.name)) return null;

      if (rule.type === "block") { ... return { block: true, reason: ... }; }
      if (rule.type === "confirm") { ... }
    }

    if (rule.type === "confirm") {
      // 预览命令 + 强化弹窗确认
      const previewCmd = generatePreview(event.input?.command || "");
      let preview = "";
      if (previewCmd) {
        try { preview = execSync(previewCmd, { timeout: 5000, encoding: "utf-8" }).trim(); } catch {}
      }
      const blockCount = blockCounters.get(rule.name) || 0;
      const ok = await ctx.ui.confirm("⛔ 智子安检",
        `[${rule.name}] (已拦 ${blockCount} 次)\n` +
        (preview ? `影响预览:\n${preview.slice(0, 300)}` : ""));
      return ok ? null : { block: true, reason: rule.message || rule.name };
    }
  }

  // 检查 rateLimit (保留)
  ...
}
```

### `tool_call` 钩子改动

当前 `pi.on("tool_call", ...)` 只有 3 行：

```typescript
pi.on("tool_call", async (event, ctx) => {
  const result = await checkSentinel(event, ctx);
  if (result) return result;
});
```

```typescript
pi.on("tool_call", async (event, ctx) => {
  // 每次 tool_call 重置逃生门计数（新请求/新工具=新对话）
  const result = await checkSentinel(event, ctx);
  if (result) return result;
});
```

还要在 `transform_llm_output` 位置（`before_agent_start` 或 `context_updated` 钩子）加 transform 规则检查。

实际上 Pi 没有 transform 钩子，transform 可以在 `before_agent_start` 中对 `event.prompt` 做替换。

### 新配置格式

`.pi/eto-sentinel.json` 新增字段大幅扩展：

```json
{
  "enabled": true,
  "deadlock": {
    "maxBlocksPerRule": 5,
    "escapeAction": "log",
    "autoResetMs": 300000
  },
  "rules": [
    {
      "name": "dangerous-bash",
      "enabled": true,
      "priority": 20,
      "type": "block",
      "trigger": "bash",
      "pattern": "rm\\s+-rf|dd\\s+if=|mkfs\\.|format",
      "message": "危险命令已拦截"
    },
    {
      "name": "rm-preview",
      "enabled": true,
      "priority": 10,
      "type": "confirm",
      "trigger": "bash",
      "pattern": "rm\\s+-rf",
      "message": "删除文件，请确认路径"
    },
    {
      "name": "no-emoji",
      "enabled": false,
      "type": "transform",
      "from": "[😀-🙏🟡-🫎]",
      "to": ""
    },
    {
      "name": "batch-edit-warn",
      "enabled": true,
      "type": "confirm",
      "trigger": "edit",
      "pattern": ".*",
      "message": "批量编辑文件，确认？"
    },
    {
      "name": "time-reminder",
      "enabled": false,
      "type": "track_turns",
      "maxTurns": 10,
      "reminder": "已过 10 轮，确认仍在正轨？"
    }
  ],
  "logFile": "~/.eto/sentinel-log.jsonl",
  "rateLimit": {
    "windowMs": 60000,
    "maxPerWindow": 10,
    "action": "block"
  }
}
```

### 向后兼容

旧的 `{trigger, pattern, action: "block"|"confirm"|"log"}` 格式自动映射到新格式：

```
trigger: "bash"      → type: "block"|"confirm", trigger: "bash"
trigger: "write_file" → type: "block"|"confirm", trigger: "write"
action: "log"        → type: "block", enabled: false (只记录)
```

在 `loadSentinelConfig()` 中做迁移。

---

### 验收标准

| # | 检查项 | 验证方式 |
|---|--------|----------|
| SV2-1 | 旧格式配置兼容 | 旧 `.pi/eto-sentinel.json` 加载不报错 |
| SV2-2 | 新规则类型生效 | block/confirm/transform/track_turns 都触发 |
| SV2-3 | 逃生门生效 | 同一规则连拦 N 次后放行 |
| SV2-4 | 触发范围扩展 | bash/write/edit/git 等工具名 glob 匹配 |
| SV2-5 | 优先级生效 | 高 priority 规则先检查 |
| SV2-6 | 全部测试 PASS | `python eto/stitches/test.py` 17/17 |

---

### 实施顺序

```
Step 1 → 新接口 + 配置加载（含向后兼容）        — 5 min
Step 2 → 检查逻辑：block/confirm/transform/track_turns — 10 min
Step 3 → 逃生门（deadlock escape）               — 5 min
Step 4 → 工具历史记录 + transform (简化)         — 5 min
Step 5 → 配置示例更新 + 测试验证                  — 5 min
```

总计约 30 分钟。
