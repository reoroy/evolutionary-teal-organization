.POSIX:
SHELL = /bin/sh

# ── ETO 一键安装 ──────────────────────────────────────────
# make setup        # 全自动：安装依赖 + 拉模型 + 写配置 + 装 Pi CLI
# make install      # 安装 Python 包
# make models       # 拉取 Ollama 模型
# make config       # 创建默认配置
# make install-pi   # 安装 Pi CLI（Agent 运行时）
# make bin-link     # 把 bin/eto 链接到 PATH

.PHONY: setup install models config install-pi bin-link

# ── 全自动安装 ─────────────────────────────────────────────
setup: install models config install-pi bin-link
	@echo ""
	@echo "╔══════════════════════════════════════════╗"
	@echo "║  ETO 安装完成！                           ║"
	@echo "║                                          ║"
	@echo "║  eto          启动终端界面                ║"
	@echo "║  ETO --help   CLI 模式                   ║"
	@echo "║  同志，后会有期。                         ║"
	@echo "╚══════════════════════════════════════════╝"

# ── Python 包 ────────────────────────────────────────────
install:
	pip install -e .

# ── Ollama 模型 ──────────────────────────────────────────
models:
	@echo "→ 拉取 LLM 模型（首次约 15-30 分钟，按需选择）"
	@echo "   [必选]   qwen2.5-coder:7b   — 语义路由 + 默认执行"
	@echo "   [推荐]   qwen3.5:9b         — 研究员 Agent"
	@echo "   [可选]   gemma3:27b         — 审计 Agent（需 16GB+ RAM）"
	@echo ""
	ollama pull qwen2.5-coder:7b
	ollama pull qwen3.5:9b 2>/dev/null || echo "  ⚠ 跳过 qwen3.5:9b（不存在或已拉取）"
	ollama pull gemma3:27b 2>/dev/null || echo "  ⚠ 跳过 gemma3:27b（不存在或已拉取）"

# ── 默认配置 ────────────────────────────────────────────
config:
	mkdir -p ~/.config/eto
	test -f ~/.config/eto/config.yaml || cp config.yaml.example ~/.config/eto/config.yaml

# ── Pi CLI（Agent 运行时） ────────────────────────────────
install-pi:
	@echo "→ 安装 Pi CLI（ETO 的 Agent 运行时）"
	@if command -v uv >/dev/null 2>&1; then \
		uv tool install @earendil-works/pi-coding-agent; \
	elif command -v npm >/dev/null 2>&1; then \
		npm install -g @earendil-works/pi-coding-agent; \
	else \
		echo "  ⚠ 需要 Node.js (npm) 或 uv 来安装 Pi CLI"; \
		echo "     请先安装 Node.js: https://nodejs.org/"; \
		echo "     或 uv: curl -LsSf https://astral.sh/uv/install.sh | sh"; \
		exit 1; \
	fi

# ── CLI 入口链接 ─────────────────────────────────────────
bin-link:
	mkdir -p ~/.local/bin
	ln -sf $(PWD)/bin/eto ~/.local/bin/eto
	@echo "→ bin/eto 已链接到 ~/.local/bin/eto"
	@echo "   确保 ~/.local/bin 在 PATH 中"
