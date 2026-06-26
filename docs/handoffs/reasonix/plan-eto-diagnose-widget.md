# Plan: 诊断 widget 为什么不显示

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P1

## 问题

`ctx.ui.setWidget("eto-route", [...])` 代码已写入 `eto.ts`，但用户 Pi TUI 中看不到 widget。

## 需要诊断的方向

### 1. setWidget 在 Pi v0.79.8 是否真的实现？

检查 Pi 的 TUI 实现代码：

```bash
grep -rn "setWidget" /c/Users/a7140/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/ | head -20
```

types.d.ts 里有接口定义，但实际的 TUI 交互模式实现文件里有没有 `setWidget` 的代码体？

### 2. 如果是 stub（空实现）

如果 `setWidget` 只是定义了接口但没实现（noop），那方案就是：

**备选方案：`setStatus`**

```typescript
ctx.ui.setStatus("eto-route", "📋 ETO | code → plan | coder | 85%");
```

`setStatus` 在 footer 区域持久显示，每个 extension 有不同的 key，互不覆盖。

### 3. 验证扩展是否加载

写一个最小测试扩展，只含一行 `setWidget`，确认是 widget 问题还是扩展加载问题：

```typescript
// test-widget.ts
export default function(pi) {
  pi.on("before_agent_start", async (_event, ctx) => {
    ctx.ui.setWidget("test", ["✅ Widget 测试"]);
  });
}
```

用 `pi -e test-widget.ts` 加载，看 widget 出不出现。

## 修复

根据诊断结果选方案：

| 发现 | 修复 |
|:-----|:------|
| setWidget 空实现 → 改用 setStatus | 改 eto.ts：`setWidget` → `setStatus` |
| 扩展能加载但不是 eto.ts | 检查 eto.ts 编译/语法错误 |
| setWidget 部分模式可用 | 仅在 TUI 模式调用，print 模式回退 |

## 不做

- ❌ 不改 Pi 源码
- ❌ 不添加外部依赖

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | 可能改 setWidget → setStatus |
