# Plan: ETO 回复前缀 + 工作总结

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P1

## 需求

1. ETO 路由信息显示在 LLM 的回复里（用户能看到）
2. LLM 回复末尾自动加工作总结

## 方案

不改代码结构——只改 `before_agent_start` 返回的 `systemPrompt` 指令文本。

### 当前做法

routeLines 注入 systemPrompt 开头，但 LLM 不会复述自己的 prompt。用户看不到。

### 改为：指令 LLM 回复时包含路由 + 工作总结

```typescript
// 替换 routeLines 的纯信息格式，改为指令格式
const routeLines = [
  `## ETO 任务分析`,
  `路由: ${route.gewu} → ${route.route}`,
  `协调员: ${route.coordinator}`,
  `信心: ${confidence}%`,
  ``,
  `请按以下格式回复：`,
  `【任务分析】一句话说明你对此任务的路由判断`,
  `【执行】回答任务内容`,
  `【工作总结】任务完成后，用 ====END==== 开头，总结你做了什么、改了哪些文件、结果如何`,
];
```

### 具体改动

在 `eto/extensions/eto.ts` 的 `before_agent_start` handler 中：

**plan 分支**：
```typescript
routeLines.push(
  ``,
  `请每完成一步先输出 >> Step N，最后输出：`,
  `====END====`,
  `工作总结：`,
  `- 目标: ${task}`,
  `- 路由: ${route.gewu} → ${route.route}`,
  `- 完成步骤: [步骤列表]`,
  `- 改动文件: [文件清单]`,
);
```

**direct 分支（简单问答）**：
```typescript
routeLines.push(
  ``,
  `回复格式：`,
  `【路由】一句话说明任务归类`,
  `【回答】你的回答`,
  `====END====`,
);
```

**consensus 分支**：
```typescript
routeLines.push(`需多 Agent 共识审批，请在回复中说明风险点。`);
```

## 验证

```
eto
输入: 写一个Python文件读写函数

LLM 回复应包含：
【路由】代码任务 → plan 路由，协调员 coder
【执行】[代码内容]
====END====
工作总结：
- 目标: 写一个Python文件读写函数
- 完成步骤: 调研需求 → 编写代码 → 审查质量
```

## 不做

- ❌ 不改 Pi 扩展 API（没有 after_agent 钩子，用 prompt 指令模拟）
- ❌ 不改 Python 代码
- ❌ 不新增依赖

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | `before_agent_start` 的 routeLines 尾部追加回复格式指令 + END 格式 |
