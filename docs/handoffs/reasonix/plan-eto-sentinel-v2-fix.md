# Plan: 智子 v2 审计修复

> 创建日期: 2026-07-04 | 来源: Claude Code 审计
> 基线: `plan-eto-sentinel-v2.md` (已实现) + 审计报告

---

## 缺口 A：逃生门重置机制

**现状：** `checkDeadlock()` 用 `setTimeout` 自减计数器，计划要求"用户发新消息 → 全部计数归零"。

**修改：** 在 `before_agent_start` 中（每次新用户消息入口）重置 `blockCounters`：

```typescript
// eto.ts，before_agent_start 开头
blockCounters.clear();  // 用户新消息 → 逃生门计数归零
```

移除 `setTimeout` 自减逻辑（不再需要）。

**改动文件：** `eto/extensions/eto.ts`，2 行。

---

## 缺口 B：transform 规则挂接

**现状：** `SentinelRule` 接口声明了 `type: "transform"`，但无逻辑处理它。

**方案：** 在 `before_agent_start` 中，加载规则后过滤 `type === "transform"` 的规则，对 `event.prompt` 做正则替换：

```typescript
// before_agent_start 中，prompt 注入前
for (const rule of SENTINEL.rules) {
  if (rule.enabled === false || rule.type !== "transform") continue;
  if (rule.from && event.prompt) {
    event.prompt = event.prompt.replace(new RegExp(rule.from, "g"), rule.to || "");
  }
}
```

**改动文件：** `eto/extensions/eto.ts`，~8 行。

---

## 缺口 C：track_turns 规则挂接

**现状：** `SentinelRule` 接口声明了 `type: "track_turns"`，但无实现。

**方案：** 模块级 turn 计数器，在 `before_agent_start` 中检查：

```typescript
let turnCounter = 0;

// before_agent_start 开头
turnCounter++;

// before_agent_start 尾部，prompt 注入前
for (const rule of SENTINEL.rules) {
  if (rule.enabled === false || rule.type !== "track_turns") continue;
  if (turnCounter >= (rule.maxTurns || 10)) {
    event.prompt = `[智子提醒] ${rule.reminder || "注意轮数"}\n\n` + (event.prompt || "");
    turnCounter = 0; // 重置，避免每轮都提醒
  }
}
```

**改动文件：** `eto/extensions/eto.ts`，~12 行。

---

## 总结

| 缺口 | 改动 | 行数 | 风险 |
|:-----|:------|:-----|:-----|
| A 逃生门重置 | `before_agent_start` 首行 `blockCounters.clear()` | 2 行 | 低 |
| B transform | 注入 prompt 前替换 | 8 行 | 低 |
| C track_turns | 模块级计数器 + 超阈值注入提醒 | 12 行 | 低 |

总计约 22 行改动，单文件。修复后重新跑 17 测试验证回归。
