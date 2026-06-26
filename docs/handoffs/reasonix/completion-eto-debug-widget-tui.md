# Completion: 最小测试——确认 widget 在 TUI 实际渲染

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE — 需用户手动验证
> 日期: 2026-06-25

## 做了什么

**新建 `test-widget.ts`（7 行）→ 验证加载 → 已删除**

```
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setWidget("test", ["✅ Widget 测试"]);
  });
}
```

## 验证结果

| 测试 | 结果 |
|:-----|:------|
| `pi -e test-widget.ts --version` | ✅ 0.79.8（扩展加载无报错） |

## 无法从 CLI 确认 widget 渲染

`setWidget` 在 `runner.js:98` 是空桩 `() => {}`。只有 TUI 交互模式（`interactive-mode.js:1387`）才有真实实现。

**需要用户手动操作：**

```powershell
# 1. 从项目目录启动
pi -e test-widget.ts --provider anthropic
# 进 TUI，看编辑器上方有无 "✅ Widget 测试"
```

如果看到 → setWidget 工作，问题在 `eto.ts` 的 `before_agent_start` 触发时机。
如果没看到 → 查 Pi 版本或 mode 选择逻辑。

## 文件引用

`test-widget.ts` 已删除（用完即焚）。下一步取决于用户观察结果。
