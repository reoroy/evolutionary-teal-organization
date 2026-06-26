# Completion: ETO Widget 修复 + Phase 3

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-26

## Widget 验证结果

**`pi -e test-widget.ts --provider anthropic`** → "✅ Widget 测试" 在编辑器上方可见 ✅

结论：setWidget 工作正常。问题出在 `eto.ts` 的触发时机——`before_agent_start` 调用 setWidget 时 TUI 尚未就绪。

## 修复：分两段注册

| 事件 | widget 内容 |
|:-----|:------------|
| `session_start`（TUI 已就绪） | `📋 ETO 等待中...`（预注册） |
| `before_agent_start`（收到任务） | 清除旧 → 设置路由 widget（3 分支） |

改动文件：`eto/extensions/eto.ts` — `session_start` handler 加 1 行 `setWidget`

## 清理

`test-widget.ts` 已删除（用完即焚）。

## 后续 P0-3

按计划下一步是 ETO 扩展自动注册和清理。需要我做就写 plan 来。

## 请审计

1. 确认 `eto` 回车进 TUI 后编辑器上方显示 "📋 ETO 等待中..."
2. 输入任务后 widget 更新为 `📋 ETO | code → plan | coder | keyword 85%`
3. `test-widget.ts` 已不在
