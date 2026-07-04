"""ETO Config 模板"""
import json

def make_config(provider: str) -> str:
    return json.dumps({
        "router": {
            "provider": provider,
            "models": {
                "deepseek": {"url": "https://api.deepseek.com/v1/chat/completions", "model": "deepseek-chat"},
                "ollama": {"url": "http://localhost:11434/api/chat", "model": "qwen2.5-coder:7b"}
            },
            "fallback": "keyword"
        },
        "peers": {
            "researcher": {"provider": "ollama", "model": "qwen2.5-coder:7b"},
            "coder": {"provider": "ollama", "model": "qwen2.5-coder:7b"},
            "auditor": {"provider": "ollama", "model": "qwen2.5-coder:7b"},
            "终审仲裁者": {"provider": "ollama", "model": "qwen2.5-coder:7b"}
        }
    }, indent=2, ensure_ascii=False)
