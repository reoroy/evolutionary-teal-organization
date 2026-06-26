# ETO Stitches — 胶水代码层

> 不写框架，只缝已有的开源项目。每层胶水代码 < 50 行。

## 当前架构

```
eto/stitches/
├── comms/a2a.py          多步任务执行（@本地 Ollama）
├── consensus/vote.py     同侪共识评分（@本地 Ollama）
├── election/elect.py     协调员选举（按分数排序）
├── __init__.py           暴露包版本
└── test.py               集成测试
```

## 各层说明

| 脚本 | 功能 | 依赖 |
|:-----|:-----|:------|
| `comms/a2a.py` | 接收任务 + 步骤列表，每步调 Ollama 执行，上一步输出传下一步 | Ollama (`qwen2.5-coder:7b`) |
| `consensus/vote.py` | 多位 peer 对 plan 独立评分，返回平均分和审查意见 | Ollama (`qwen2.5-coder:7b`) |
| `election/elect.py` | 候选人按分数降序排序，选最高分 | 纯 Python，无外部依赖 |

## 调用方式（stdin/stdout）

所有 stitch 统一用 stdin JSON 调用，stdout JSON 返回：

```bash
echo '{"fn":"elect","args":[[["r",0.9],["c",0.5]]]}' | python election/elect.py
# → {"leader": "r", "all": [["r", 0.9], ["c", 0.5]]}
```

错误时返回 `{"_error": true, "message": "..."}`，不会崩溃。

## 运行测试

```bash
cd eto/stitches && python test.py
```

## 设计原则

1. 胶水代码 < 50 行/层
2. 不改上游源码
3. 每层可独立替换
4. 无外部依赖（Ollama 运行时除外）
