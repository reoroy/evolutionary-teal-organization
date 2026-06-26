# Completion: ETO Bootable

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE — 待审计
> 日期: 2026-06-25

## 环境差异（重要）

**计划假设 `/tmp/eto-fork/` 存在**，但该 fork 是在 Linux 机器上做的，当前 Windows 5090 机器上没有。实际状况更简单：

- `pi` CLI v0.79.8 已经可直接运行
- Ollama 已运行（qwen2.5-coder:7b, qwen3.6 等多个模型）
- ETO 扩展 `-e eto/extensions/eto.ts` 加载正常
- 本地代理 `127.0.0.1:15721` healthy（已验证）

## 改动清单

| 文件 | 改动 |
|:-----|:------|
| `Makefile` | 加 `run` / `run-proxy` target（Unix），支持 `make run M=hi P=deepseek` |
| `run-eto.cmd` | **新建** — Windows 一键启动脚本，跑 `pi -e eto/extensions/eto.ts --provider ollama` |

## 验证记录

| 测试 | 结果 |
|:-----|:------|
| `pi -e eto/extensions/eto.ts --provider ollama -p "hi"` | ✅ ETO 扩展加载，系统提示注入正确 |
| `pi -e eto/extensions/eto.ts --provider deepseek -p "hi"` | ✅ 代理模式也正常 |
| 代理健康检查 `127.0.0.1:15721/health` | ✅ `{"status":"healthy"}` |
| `.\run-eto.cmd` | ✅ ETO 启动正常，代码助手响应含 ETO 上下文 |

## 启动方式

```bash
# Windows
run-eto.cmd

# Unix / WSL
make run
make run M="写个flask api"
make run-proxy M="hi"        # 走本地代理
```

## 不做的事（按 plan 约定）

- ❌ 没改 Pi 的 provider 抽象层
- ❌ 没加新依赖
- ❌ 没动编译逻辑（没有 fork 可动）

## 请审计

直接跑 `run-eto.cmd` 验证。输出应包含 ETO 路由信息和项目上下文。
