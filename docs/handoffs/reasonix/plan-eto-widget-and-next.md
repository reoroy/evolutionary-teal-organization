# Plan: ETO Widget 验证 + 继续开发

> 日期: 2026-06-26
> 来源: [handover-2026-06-26-a.md](../handover-2026-06-26-a.md) P0-1
> 优先级: P0
> 执行端: Claude Code (Windows)

## 一、背景

ETO 核心代码（三镜路由 + Stitcher + 流式输出）已完成并通过测试。唯一 P0 功能问题：`ctx.ui.setWidget()` 在 TUI 中不可见。

**已知事实：**
- `setWidget` 在 Pi v0.79.8 TUI 交互模式有完整实现（`interactive-mode.js:1387`）
- `setWidget` 在 runner 模式（print/non-TUI）是空桩（`runner.js:98`）
- 代码逻辑正确，参数正确
- 最小测试文件 `test-widget.ts` 已就绪
- 用户进入 TUI 的路径是 `eto` → `pi` wrapper

**不知道的：**
- 实际 TUI 中 widget 是否渲染
- `before_agent_start` 触发时机 vs TUI 渲染时机

## 二、Phase 1 — 确认 widget 渲染

用户需执行:

```powershell
cd C:\Users\a7140\Nutstore\1\工坊\项目\evolutionary-teal-organization
pi -e test-widget.ts --provider anthropic
```

进入 TUI 后:
1. **看编辑器上方区域** — widget 默认位置 `aboveEditor`
2. 输入任意 prompt 触发 `session_start`
3. 观察是否显示 "✅ Widget 测试"

**结果映射：**
| 结果 | 含义 | 后续 |
|:-----|:------|:------|
| ✅ 看到 widget | setWidget 没问题，问题在 eto.ts 触发时机 | Phase 2a |
| ❌ 没看到 widget | setWidget 在当前环境下不渲染 | Phase 2b |

## 三、Phase 2a — 修复 eto.ts 触发时机（widget 可用）

如果 widget 能渲染但 eto 不显示，原因是 `before_agent_start` 中调 `setWidget` 时间过早——TUI 渲染还没就绪。

**修复方案：分两步调用 `setWidget`**

1. 在 `session_start` 事件中注册 widget（此时 TUI 已就绪）
2. 在 `before_agent_start` 中更新 widget 内容（复用已注册的 key）

修改 `eto/extensions/eto.ts`:

```typescript
// session_start 中预注册 widget 骨架
pi.on("session_start", async (_event, ctx) => {
  ctx.ui.setWidget("eto-route", ["📋 ETO 等待中..."]);
});

// before_agent_start 中更新内容（同上）
pi.on("before_agent_start", async (event, ctx) => {
  ctx.ui.setWidget("eto-route", undefined);  // 清除旧内容
  // ...原有逻辑...
  ctx.ui.setWidget("eto-route", widgetLines); // 设置新内容
});
```

## 四、Phase 2b — setWidget 不工作（widget 不可用）

改用 `ctx.ui.setStatus()` 作为持久状态显示方案。

`setStatus` 在 footer 区域持久显示，支持 key-value。每个 extension 有独立 key 不冲突。

修改 `eto/extensions/eto.ts`:

```typescript
// 替换所有 setWidget 调用
ctx.ui.setStatus("eto-route", "📋 ETO | code → plan | coder | 85%");
```

## 五、Phase 3 — 后续开发

Widget 确认后，按以下优先级：

### P0-3: ETO 扩展自动注册
确认 `eto` 命令是否正确加载 `eto.ts` 扩展。检查:
- `run-eto.cmd` / `run-eto.ps1` 中 `-e` 参数路径是否正确
- 相对路径 vs 绝对路径

### P1: Stitcher 文档 & 示例
- `eto/stitches/README.md` 补齐 API 文档
- 示例代码

### P1: 清理未跟踪文件
当前未跟踪列表:
- `run-eto.cmd`, `run-eto.ps1` — 启动脚本
- `eto-test-output.log` — 测试日志
- `verify-eto.cmd` — 验证脚本
- `nul` — 残留文件，应删除

## 六、文件引用

| 文件 | 用途 | 可能改动 |
|:-----|:------|:---------|
| `eto/extensions/eto.ts` | 核心扩展 | Widget 触发时机 / setWidget→setStatus |
| `test-widget.ts` | 最小 widget 测试 | 用完可删 |
| `run-eto.ps1` | ETO 启动脚本 | 验证扩展加载路径 |
| `eto/stitches/README.md` | Stitcher 文档 | 补齐 |

## 七、验证

1. 进入 TUI 后故意触发 `before_agent_start`（输入 prompt）
2. 编辑器上方区域出现 widget
3. widget 内容随路由结果变化
