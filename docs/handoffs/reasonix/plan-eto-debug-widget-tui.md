# Plan: 最小测试——确认 widget 在 TUI 实际渲染

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P1

## 问题

`setWidget` 有实现，路径正确扩展加载，但用户 TUI 中看不到。需要逐步排除。

## 任务

### 1. 写最小测试扩展

在项目根建一个 `test-widget.ts`，只做一件事——在 session_start 时设 widget：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setWidget("test", ["✅ Widget 测试 - 如果你看到这行说明 setWidget 工作"]);
  });
}
```

### 2. 用最小扩展启动 TUI

```powershell
ANTHROPIC_BASE_URL=http://127.0.0.1:15721 ANTHROPIC_API_KEY=PROXY_MANAGED node "$env:APPDATA\npm\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" -e C:\path\to\test-widget.ts --provider anthropic
```

### 3. 观察结果

| 看到 "✅ Widget 测试" | 结论 |
|:----------------------|:------|
| ✅ 看到 | setWidget 工作，问题是 eto.ts 的 `before_agent_start` 触发时机 |
| ❌ 没看到 | Pi 版本/模式问题，查 interactive-mode.js:1387 的 setExtensionWidget |

### 4. 如果 setWidget 工作但 eto.ts 不显示

问题在 `before_agent_start` 的触发时机。方案：

改用 `session_start` 设 widget，路由信息用 `ctx.ui.setStatus()` 更新：

```typescript
pi.on("session_start", async (_event, ctx) => {
  ctx.ui.setWidget("eto-route", ["📋 ETO 待命", "输入任务开始青色组织工作流"]);
});

pi.on("before_agent_start", async (event, ctx) => {
  // ... 路由分析 ...
  ctx.ui.setStatus("eto-route-status", `📋 ETO | ${route.gewu} → ${route.route} | ${route.coordinator}`);
  // widget 保留启动时的信息，setStatus 在 footer 更新
});
```

### 5. 如果 setWidget 完全不工作

查 Pi TUI 是否确实走了 `interactive-mode.js`：

```bash
"node.exe" "$piCli" --version
# 确认版本号
```

检查 `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\modes\interactive\interactive-mode.js` 中 `setExtensionWidget` 的实现。

## 验收

```bash
# 测试通过后
del test-widget.ts
# eto.ts 改动生效
eto
# → widget 可见
```

## 文件引用

| 文件 | 动作 |
|:-----|:------|
| `test-widget.ts` | **新建** — 最小测试，用完即删 |
| `eto/extensions/eto.ts` | 可能改 setWidget 时机或加 setStatus |
