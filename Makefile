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

# ── 一键运行 ──────────────────────────────────────────────
# make run              # TUI 交互式（Ollama 本地模型）
# make run M=hi         # 一次性 prompt
# make run-proxy        # TUI 交互式（走代理）
# make run-proxy M=hi   # 一次性 prompt
.PHONY: run run-proxy

RUN_CMD = pi -e ./eto/extensions/eto.ts
RUN_PROVIDER ?= ollama
RUN_MODEL ?= qwen2.5-coder:7b

# Ollama 模式: Pi + ETO 扩展 + Ollama provider
# 不传 -p 时进入 TUI 交互模式，传 M= 时做一次性查询
run:
ifdef M
	$(RUN_CMD) --provider $(RUN_PROVIDER) --model $(RUN_MODEL) -p "$(M)"
else
	$(RUN_CMD) --provider $(RUN_PROVIDER) --model $(RUN_MODEL)
endif

# ── 安装 ──────────────────────────────────────────────────
# Windows: install.cmd
# Unix/WSL: make setup
.PHONY: setup install-py bootstrap

setup: install-py bootstrap
	@echo "✅ ETO 就绪，敲 eto 启动"

install-py:
	pip install -e eto/

bootstrap:
	python3 -c "import sys; sys.path.insert(0,'.'); from eto.bootstrap import run; run()"

# ── 发布流水线 ──────────────────────────────────────────────
# make release V=v0.4.0    → 完整发布流程（指定版本）
# make release             → 显示当前版本并提示指定
.PHONY: release changelog verify-install

VERSION := $(shell grep '^version = ' pyproject.toml | head -1 | sed 's/version = "\(.*\)"/\1/')

release: check-clean
ifndef V
	@echo "==> ETO Release"
	@echo "  当前版本: $(VERSION)"
	@echo "  用法: make release V=v0.x.0"
	@echo "  ──────────────────────────────"
	@echo "  步骤:"
	@echo "    1. make changelog    — 查看上次发布至今的改动"
	@echo "    2. make bump V=...   — 更新版本号 + 打 tag + 推送"
	@echo "    3. make verify-install — 验证安装"
	@exit 0
endif
	@echo "==> ETO Release $(V)"
	$(MAKE) changelog
	$(MAKE) bump
	$(MAKE) verify-install
	@echo "✅ 发布完成: $(V)"

# 提取上次 tag 至今的 git log
.PHONY: changelog
changelog:
	@echo ""
	@echo "── Changelog ──"
	LAST_TAG=$$(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD); \
	echo "从 $$LAST_TAG 到 HEAD:"; \
	git log --oneline $$LAST_TAG..HEAD 2>/dev/null || git log --oneline
	@echo "───────────────"

# 版本号更新 + tag + push（需手动确认）
.PHONY: bump
bump: check-clean
	@echo "更新版本号..."
	@echo "  当前: $(VERSION)"
	@echo "  目标: $(V)"
	@echo "  按回车继续，Ctrl+C 取消..."; read _
	# 更新 pyproject.toml
	sed -i 's/^version = ".*"/version = "$(subst v,,$(V))"/' pyproject.toml
	# 更新 package.json
	node -e "const p=require('./package.json'); p.version='$(subst v,,$(V))'; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2)+'\n')" 2>/dev/null || true
	git add pyproject.toml package.json
	git commit -m "chore: bump version to $(subst v,,$(V))"
	git tag $(V)
	git push origin main --tags
	@echo "✅ 版本 $(V) 已推送"

# 验证安装
.PHONY: verify-install
verify-install:
	@echo ""
	@echo "── 验证安装 ──"
	pip install -e eto/ 2>/dev/null && echo "✅ pip install OK" || echo "⚠ pip install 失败"
	# 检查关键文件存在
	test -f eto/extensions/eto.ts && echo "✅ eto.ts OK" || echo "⚠ eto.ts 缺失"
	test -f eto/bootstrap/__init__.py && echo "✅ bootstrap OK" || echo "⚠ bootstrap 缺失"
	test -d eto/stitches && echo "✅ stitches OK" || echo "⚠ stitches 缺失"
	@echo "──────────────"

.PHONY: check-clean
check-clean:
	@if git status --porcelain 2>/dev/null | grep -q .; then \
		echo "⚠ 工作区有未提交改动，先 git commit 再执行"; \
		exit 1; \
	fi
