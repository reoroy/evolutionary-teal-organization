# Plan: 路由信息显示在对话区

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P1

## 问题

`ctx.ui.notify()` 在 TUI 中只在底部状态栏一闪而过，用户看不到 ETO 路由过程。扩展确实加载了，但用户以为没效果。

## 方案

在 `before_agent_start` hook 返回的 `systemPrompt` 中，把路由信息以可见文本注入。**不是改 notify()，而是加一段文本**，让 Pi 在对话区展示：

```typescript
// 当前（纯 notify，用户看不到）
ctx.ui.notify("🔍 三镜路由: code → plan [keyword 85%]", "info");

// 改为：在 systemPrompt 中加入可见路由摘要
const routeHeader = [
  "📋 ETO 分析中...",
  `🔍 三镜路由: ${route.gewu} → ${route.route} [${route.layer} ${confidence}%]`,
  `👤 协调员: ${route.coordinator}`,
].join("\n");

return {
  systemPrompt: `${routeHeader}\n\n${event.systemPrompt || ""}${planSuffix}`,
};
```

这样路由信息会出现在**对话上下文中**，TUI 用户能看到。

## 具体改动

### 1. `eto/extensions/eto.ts` — `before_agent_start`

把当前 notify() + systemPrompt 拼接逻辑改为：

```typescript
// 构建路由摘要（始终可见）
const routeLines = [
  "📋 ETO 分析中...",
  `🔍 三镜路由: ${route.gewu} → ${route.route} [${route.layer} ${confidence}%]`,
  `👤 协调员: ${route.coordinator}`,
];

if (route.route === "plan" && plan) {
  // plan 模式：注入完整计划
  const planSummary = parsePlanSummary(plan); // 提取共识+步数
  routeLines.push(`🤝 共识: ${planSummary.consensus}`);
  routeLines.push(`📝 ${planSummary.steps} 步计划生成`);
  routeLines.push(""); // 空行
  routeLines.push(`[ETO Plan]\n${plan}`);
  return {
    systemPrompt: routeLines.join("\n") + "\n\n" + (event.systemPrompt || ""),
  };
}

if (route.route === "consensus") {
  routeLines.push("🤝 需多 Agent 共识审批");
}

return {
  systemPrompt: routeLines.join("\n") + "\n\n" + (event.systemPrompt || ""),
};
```

注意：notify() 可以**保留**（作为 TUI 状态栏的实时反馈），但用户依赖的是对话区的前缀文本。

### 2. notify 保留但不作为唯一渠道

原有的 `ctx.ui.notify()` 行不动——TUI 状态栏和对话区各显示一份。

## 验证

```bash
eto
# 输入 "写一个Python文件"
# → 对话区第一行就是：
# 📋 ETO 分析中...
# 🔍 三镜路由: code → plan [keyword 85%]
# 👤 协调员: coder
# 🤝 共识: 通过
# 📝 3 步计划生成
```

## 不做

- ❌ 不改 notify 本身的实现
- ❌ 不改 Pi 底层
- ❌ 不新增依赖

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | `before_agent_start` 的 return 逻辑，构建可见路由摘要 |
