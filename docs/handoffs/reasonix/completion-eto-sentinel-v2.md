# Completion: 智子 v2 — AgentGuard 级规则引擎

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-04

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | 重写 sentinel 段：新接口 + 逃生门 + 强化 confirm + 向后兼容 |
| `.pi/eto-sentinel.json` | 新配置格式含 deadlock + 规则示例 |

## 新特性

| 特性 | 说明 |
|:-----|:------|
| 规则类型 | block / confirm / transform / track_turns |
| 逃生门 | 同规则连拦 N 次后自动放行，用户新消息重置 |
| 优先级 | 高 priority 规则先检查 |
| trigger glob | `bash`, `write`, `edit`, `git:*` 均支持 |
| 强化 confirm | 自动生成预览命令（rm→ls, dd→lsblk） |
| 向后兼容 | 旧 `{trigger,pattern,action}` 自动映射到新格式 |

## 验证

```
Stitcher test: 17/17 PASS ✅
```

## Pi 0.80.3 兼容性

自动加载扩展在 0.80.3 下可能需重新 `pi install`。快速验证：

```bash
pi --no-extensions -e eto/extensions/eto.ts -p "hi"
# → 应返回【路由】格式的回复
```
