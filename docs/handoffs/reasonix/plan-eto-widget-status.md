# Plan: ETO 路由持久显示——用 Pi TUI 原生 API

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P1

## 问题

`ctx.ui.notify()` 在 Pi TUI 状态栏一闪而过，用户看不到。
systemPrompt 注入不强制 LLM 按格式回复。
ETO 在工作但用户无感知。

## API 调研结果

Pi ExtensionAPI 有比 notify 更持久的输出方法：

| API | 效果 | 持久性 |
|:----|:------|:-------|
| `ctx.ui.setStatus(key, text)` | 底部状态栏显示文本 | 持续到清除或覆盖 |
| `ctx.ui.setWidget(key, content[])` | 在编辑器上方插入多行文本 | 持续到 `setWidget(key, undefined)` |

## 方案

### 前置：`before_agent_start` 中设置 widget

```typescript
// 清除上次的路由信息
ctx.ui.setWidget("eto-route", undefined);
// 设置当前路由
const routeLines = [
  `📋 ETO | ${route.gewu} → ${route.route} | ${route.coordinator} | ${route.layer} ${confidence}%`,
];
if (route.route === "plan") {
  routeLines.push(`📝 计划: ${stepCount}步 | 共识: ${consensus}`);
}
ctx.ui.setWidget("eto-route", routeLines);
```

### 后置：什么时机清除？

有两种选择：

**A. 不清除（下一个进入自动覆盖）**
Widget 显示上次路由信息，下次用户输入时自动更新。大多数用户场景够用。

**B. 在 `agent_end` 事件中清除**
```
pi.on("agent_end", async (_event, ctx) => {
  ctx.ui.setWidget("eto-route", undefined);
});
```
更干净，但用户可能看不到路由就在 agent_end 时清掉了。

**推荐 A**——只有显示时机，不清除，用户总能看到最新路由。

## 具体改动

1. `eto/extensions/eto.ts` 的 `before_agent_start` handler 中：
   - 开头 `ctx.ui.setWidget("eto-route", undefined)` 清除旧路由
   - 构建 routeLines 数组后 `ctx.ui.setWidget("eto-route", routeLines)` 显示
   - 原来的 `ctx.ui.notify()` 行**保留不动**（作为补充）

2. 可选：加 `agent_end` handler 清除 widget（选 B 时）

## 验证

```bash
eto
# → TUI 启动
# 输入 "写一个函数"
# → 编辑器上方出现：
# 📋 ETO | code → plan | coder | keyword 85%
# 📝 计划: 3步 | 共识: 通过
# → 整段对话期间一直可见

# 输入 "什么是青色组织"
# → 更新为：
# 📋 ETO | knowledge → direct | researcher | keyword 90%
```

## 不做

- ❌ 不改 LLM 回复格式
- ❌ 不改 Pi 底层
- ❌ 不新增依赖

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | `before_agent_start` 加 `setWidget()` 调用 |
