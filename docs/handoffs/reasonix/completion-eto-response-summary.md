# Completion: ETO 回复前缀 + 工作总结

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-25

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | `before_agent_start` 的 routeLines 尾部追加回复格式指令 |

## 三种路由的回复格式

### plan 路由（代码/研究类）
```
## ETO 路由分析
路由: code → plan (keyword, 85%)
协调员: coder
共识: 通过
计划: 3 步

[ETO Plan]
...

回复格式要求：
1. 每完成一步，先输出 >> Step N
2. 全部完成后，输出：
====END====
工作总结：
- 目标: 写一个Python文件读写函数
- 路由: code → plan
- 完成步骤: 调研需求 → 编写代码 → 审查质量
- 改动文件: [列出改动的文件]
- 结果: [总结执行结果]
```

### direct 路由（知识问答）
```
【路由】一句话说明任务归类
【回答】你的回答
====END====
```

### consensus 路由（高风险）
```
【风险点】列出风险
【建议】处理方案
====END====
```

## 请审计

检查 `eto/extensions/eto.ts` 中 before_agent_start 的 routeLines 尾部追加逻辑。
