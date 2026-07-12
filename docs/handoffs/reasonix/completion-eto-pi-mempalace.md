# Completion: pi-mempalace — 跨 Agent 中央记忆

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-12

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/memory/mempalace.py` | **新建** — 向量+时序 KV，write/read/search/context_block |
| `eto/stitches/memory/shared_memory.py` | `context_block()` 优先 mempalace |
| `eto/stitches/test.py` | 新增 2 条测试 |

## 功能

- `write(key, value, author)` — 写记忆（SHA256 hash 文件名）
- `read(key)` — 读记忆
- `search(query, top_n)` — 关键词匹配 + 时间衰减排序
- `context_block(n)` — 返回最近 n 条格式化上下文

## 优先级

```
context_block()
  ├── mempalace (优先)
  ├── agentmemory MCP (降级)
  └── 本地 shared_memory JSON (最后)
```
