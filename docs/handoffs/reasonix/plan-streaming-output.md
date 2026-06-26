# Plan: ETO 流式输出——让用户看到路由过程

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P1 — 本场最后一个 plan，收尾用

## 背景

当前用户敲 `eto` 进 TUI 后，ETO 的路由/Plan/共识全部静默运行在 `before_agent_start` hook 里。用户打字 → 等几秒 → 看到回复。完全不知道 ETO 做了什么。

## 需求

加实时输出，让用户看到每一步：

```
你：写个Flask API
     ↓
📋 ETO 分析中...
     ↓
🔍 三镜路由: code → plan  [LLM 0.92]
     ↓
👤 协调员: coder
     ↓
🤝 共识: 通过 (avg 0.85)
     ↓
📝 3 步计划生成中...
     ↓
[正常 Pi 回复]
```

## 实现

在 `eto/extensions/eto.ts` 的 `before_agent_start` hook 中，用 `ctx.ui.notify()` 输出状态：

```typescript
// 当前（静默）
const route = await routeTask(task);

// 改为（每一步都通知）
ctx.ui.notify("📋 ETO 分析中...", "info");
const route = await routeTask(task);
ctx.ui.notify(`🔍 三镜路由: ${route.gewu} → ${route.route} [${route.layer} ${route.confidence}]`, "info");
ctx.ui.notify(`👤 协调员: ${route.coordinator}`, "info");

if (route.route === "plan") {
  ctx.ui.notify(`📝 生成执行计划...`, "info");
  const plan = await execPlan(task, route);
  // 共识结果已包含在 execPlan 中
}
```

### 具体改动点

`eto.ts` 的 4 处加 notify()：

1. `llmRoute()` 返回后 → 输出路由结果
2. `electCoordinator()` 返回后 → 输出协调员
3. `peerConsensus()` 返回后 → 输出共识评分
4. `execPlan()` 前/后 → 输出计划步数

### 测试词

给用户试用的：

| 任务 | 预期路由 |
|:-----|:---------|
| `"什么是青色组织"` | knowledge → direct（知识问答，直达） |
| `"写一个Python文件读写函数"` | code → plan（代码任务，多步计划） |
| `"调研一下TypeScript 5.7新特性"` | research → plan（研究任务） |
| `"删除 /tmp/test 目录的所有文件"` | solution → consensus（高风险，需要共识） |

## 验收

```bash
eto
# → TUI 启动
# 输入 "写一个函数"
# → 看到流式输出每步状态
# → 最后得到回复
```

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | 4 处加 `ctx.ui.notify()` 输出状态 |

## 不做

- ❌ 不改 Python stitcher
- ❌ 不改 Pi 底层
- ❌ 不加外部依赖
