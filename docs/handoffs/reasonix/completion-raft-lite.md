# Completion: raft-lite + Fable 完善 + CLI 编码

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-04

## 改动

| 项 | 文件 | 改动 |
|:---|:-----|:------|
| raft 选举 | `eto/stitches/election/elect.py` | 重写为 Raft 式：随机超时 + 得分加权投票，非 raft-lite 库（不可安装） |
| Fable 扩充 | `eto/extensions/eto.ts` | `isComplexTask` 加 13 个关键词，不限 code gewu |
| CLI 编码 | `eto/cli.py` | 加 `_USE_EN` 检测，GBK 终端用英文 |
| prompt | `eto/stitches/bidding/protocol.py` | `_extract_json` 已足够健壮 |

## raft-lite 不可用

`pip install raft-lite` 报错（PyPI 无此包）。venders 版缺 `past` 依赖。自实现 Raft 式选举替代。

## 选举变化

```
之前: sorted(score, reverse=True)[0] — 纯排序
之后: 随机超时 + 得分 × 随机因子模拟竞选 → Raft 式
      - leader 复用任期 10s
      - fallback 至得分排序
      - 返回格式不变 + method 字段
```

## 验证

```
Stitcher 17/17 PASS ✅
elect 返回 {leader, all, method} ✅
```
