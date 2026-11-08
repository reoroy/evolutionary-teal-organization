# ETO 运行须知（运维速查）

## ETO 的可用性绑定在 `delegateModel` 上

ETO 是「会诊层」：`direct` 路由的每一轮都**委托给一个真模型**回答。
这个真模型由 `delegateModel` 决定，**它挂掉，整个 ETO 就不可用**（返回 NULL，不是部分功能缺失）。

### 症状

選 `eto/eto-consensus` 后：
- 普通对话返回空
- 读文件、跑命令全部失败
- 但 `GET /@dsh-eto/api/status` 仍是 200，`providers: ['eto']` 正常

**这个症状很容易误判成插件坏了，实际是委托的模型死了。**

### 排查（一条命令）

```bash
# 先拿当前宿主端口
for p in $(lsof -nP -iTCP -sTCP:LISTEN | grep -i "DeepSeek" | awk '{print $9}' | sed 's/.*://' | sort -u); do
  c=$(curl -sS -m 2 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$p/@dsh-eto/api/status" -H "x-dsh-eto: 1")
  [ "$c" = "200" ] && echo $p
done

# 探测委托模型是否活着
curl -sS -m 40 -X POST "http://127.0.0.1:<端口>/@dsh-eto/api/llm" \
  -H "x-dsh-eto: 1" -H "Content-Type: application/json" \
  -d '{"provider":"qodercn","model":"dfmodel","prompt":"回复两个字：可用","maxTokens":16}'
```

能出 `_text` 才算活。`stream error` 或 `QUOTA/402` 都表示额度耗尽。

### 切换

改 `~/src/dsh-eto/cordis.patch.yml` 的插件 config，然后**重启 DSH**：

```yaml
- id: eto
  name: 'dsh-eto'
  config:
    delegateModel: 'qodercn/dfmodel'          # 免费通道，当前值
    # delegateModel: 'deepseek-official/deepseek-flash'   # 额度恢复后改这个
```

**这是配置文件，host 半不热重载，必须重启。**

## provider 可用性（2026-11-07 实测）

| 模型 | 状态 | 备注 |
|:--|:--|:--|
| `deepseek-official/deepseek-flash` | ❌ 额度耗尽 | **首选**，充值后改回 |
| `qodercn/dfmodel` | ✅ 可用 | 当前在用（免费） |
| `qodercn/gfmodel` | ✅ 可用 | 备选 |
| `deepseek-official/deepseek-v4-pro` | ❌ 禁用 | 一单就把额度烧穿 |
| `loomy/*`、`raccoon/*` | ❌ | 只吐 reasoning，无 text 块 |
| 本机 `ollama` | ⚠️ | **不是 DSH provider**，子代理派不到 |

## 本机 Ollama 不是 DSH provider

`vote.py` 通过 HTTP 直连 `localhost:11434`，从未注册成 DSH provider。
所以：
- 会诊的 peer 能用它（`vote.py` 自己调）
- 但 `agent(provider: 'ollama')` **会失败**

想让子代理也用本机模型，得先把它注册成 DSH provider（未做）。

## 会诊输出形状

`eto_consensus` 默认 `mode="advise"`，返回：

```
advice, disagreements, fusion, mode, risks, synthesis, status, votes
```

**不含** `final_score` / `deliberation`（评分卡形状）。
要旧形状显式传 `mode="review"`。

`lib/eto_runner.py:138` 是函数定义，`:152` 是 `mode = args.get("mode", "advise")`。

## 计划中的推理源（2026-11-08 记录）

操作者提到的三条线，按优先级：

| 来源 | 状态 | 对本项目的价值 |
|:--|:--|:--|
| **硅基流动（SiliconFlow）** | 待充值 | 大量开源模型，便宜。**最适合补「异构融合」** —— Qwen / GLM / DeepSeek 各家都能拿到不同架构 |
| **opencode-go** | 待有额度 | 已在 provider 列表里（`opencode`），额度到位即可直接用 |
| **本机 2070 显卡** | 硬件已有 | **最缺的一块**：本机取之不尽、无额度限制、数据不出本机 |

### 为什么本机 2070 最值得优先

现在三源只剩一源（`qodercn/dfmodel`），异构融合已退化成单模型自评。
而 `vote.py` 的 researcher 原本就走本机 Ollama —— 只要 Ollama 能跑起来，立刻恢复两源。

**当前阻塞**：本机 `ollama/qwen3-8b-arb:latest` 返回 `stream error`，Ollama 服务本身可能没起或模型已卸载。

排查：
```bash
curl -s http://localhost:11434/api/tags
ollama ps
```

2070 是 8GB 显存：7B–8B q4 可跑（现在用的 `qwen3-8b-arb` 正好这个量级），14B 勉强，不适合 32B+。

### 硅基流动接入要点

1. 凭据写进 `~/.dsh/.credentials.yaml`
2. `siliconflow` 需要新注册为 DSH provider（当前列表里没有）
3. 接通判据：`POST /@dsh-eto/api/llm` 能出 `_text`

**给 `vote.py` 选 peer 的原则**：三个 peer 必须**不同架构**（一个 Qwen、一个 GLM、一个 DeepSeek 系），
同架构不同尺寸不算异构 —— 依据见 `docs/eto-work-usable-2026-11.md`。

### opencode-go 注意

`opencode` 已在 provider 列表里。但要确认它有没有**不同架构**的模型
（若全是 DeepSeek 系，对异构融合没有帮助）。
