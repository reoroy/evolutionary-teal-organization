# Empty States (ES) Test — ETO 空状态验证

> 目的: 确认 ETO 在所有"空/未配置/不可用"场景下不崩溃、不报错、优雅降级。
> 每个场景对应一个 pytest case，见 test_empty_states.py。
> 更新: 2026-07-02

## 场景矩阵

| # | 场景 | 触发方式 | 预期 | 对应函数 |
|---|------|----------|------|---------|
| ES-1 | skills.jsonl 不存在 | 删 ~/.eto/memory/skills.jsonl | matchSkillsForRoute 返回 [] | `test_es1_skills_missing` |
| ES-2 | profiles.json 不存在 | 删 ~/.pi/etoprofiles/profiles.json | loadProfiles fallback 到硬编码 | `test_es2_profiles_missing` |
| ES-3 | metrics.jsonl 不存在 | 删 ~/.eto/memory/metrics.jsonl | /metrics 提示不可用 | `test_es3_metrics_missing` |
| ES-4 | 无任务时 widget | 首次启动无历史 | 显示 "ETO 等待中..." | `test_es4_widget_empty` |
| ES-5 | LLM + keyword 都失败 | provider=deepseek + 删 API key | fallback 到 code/direct | `test_es5_llm_keyword_fail` |
| ES-6 | 历史任务为空 | never called | widget 正常 | `test_es6_history_empty` |
| ES-7 | peers 列表为空 | registry 无注册 | 返回 {} 不 crash | `test_es7_peers_empty` |
| ES-8 | eto-config.json 不存在 | 删 ~/.pi/eto-config.json | loadRouterConfig 用默认值 | `test_es8_config_missing` |
| ES-9 | Ollama 不通但 config 设了 ollama | provider=ollama + kill Ollama | keyword fallback 不 crash | `test_es9_ollama_down` |
| ES-10 | DEEPSEEK_API_KEY 未设置 | unset env | callDeepSeek 返回 null | `test_es10_key_missing` |
| ES-11 | onboarding.json 不存在 | 首次运行 | loadOnboarding fallback | `test_es11_onboarding_missing` |
| ES-12 | sentinel.json 不存在 | 删 ~/.pi/eto-sentinel.json | checkSentinel 用默认规则 | `test_es12_sentinel_missing` |
