#!/usr/bin/env bash
# ── ETO 一键安装脚本 ──────────────────────────────────────
# 用法: curl -fsSL https://raw.githubusercontent.com/reoroy/... | bash
# 或:  bash scripts/setup.sh

set -e

BOLD='\033[1m'
TEAL='\033[38;5;37m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

echo -e "${TEAL}${BOLD}"
echo "╔══════════════════════════════════════╗"
echo "║            /ETO                      ║"
echo "║    现在，我们是同志了                ║"
echo "║    Now, we are comrades.             ║"
echo "║    architecture > agent              ║"
echo "╚══════════════════════════════════════╝"
echo -e "${RESET}"

# ── 0. 检查依赖 ────────────────────────────────────────
echo -e "${DIM}→ 检查环境...${RESET}"

NEEDS=()
command -v python3 >/dev/null 2>&1 || NEEDS+=("Python 3.10+")
command -v pip3    >/dev/null 2>&1 && PIP_OK=true || NEEDS+=("pip3")
command -v ollama  >/dev/null 2>&1 || NEEDS+=("Ollama (https://ollama.com)")
command -v node    >/dev/null 2>&1 || NEEDS+=("Node.js (https://nodejs.org)")

if [ ${#NEEDS[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠ 请先安装:${RESET}"
    for dep in "${NEEDS[@]}"; do echo "   - $dep"; done
    echo ""
    echo -e "${DIM}安装完依赖后重新运行本脚本。${RESET}"
    exit 1
fi
echo -e "${GREEN}✓${RESET} 环境检查通过"

# ── 1. Python 包 ──────────────────────────────────────
echo -e "${DIM}→ 安装 Python 依赖...${RESET}"
pip3 install -e .
echo -e "${GREEN}✓${RESET} Python 包安装完成"

# ── 2. Ollama 模型 ────────────────────────────────────
echo -e "${DIM}→ 拉取 LLM 模型（首次较慢）...${RESET}"
ollama pull qwen2.5-coder:7b
echo -e "${GREEN}✓${RESET} 模型拉取完成"

# ── 3. 默认配置 ───────────────────────────────────────
echo -e "${DIM}→ 创建默认配置...${RESET}"
mkdir -p ~/.config/eto
if [ ! -f ~/.config/eto/config.yaml ]; then
    cp config.yaml.example ~/.config/eto/config.yaml
    echo -e "${GREEN}✓${RESET} 配置已创建: ~/.config/eto/config.yaml"
else
    echo -e "${DIM}  ↳ 已有配置，跳过${RESET}"
fi

# ── 4. Pi CLI ─────────────────────────────────────────
echo -e "${DIM}→ 安装 Pi CLI（Agent 运行时）...${RESET}"
if command -v npx >/dev/null 2>&1; then
    npm install -g @earendil-works/pi-coding-agent 2>/dev/null || \
        echo -e "${YELLOW}  ⚠ Pi CLI 安装失败，请手动安装: npm install -g @earendil-works/pi-coding-agent${RESET}"
else
    echo -e "${YELLOW}  ⚠ 跳过 Pi CLI（需要 Node.js/npm）${RESET}"
fi

# ── 5. bin/eto 链接 ───────────────────────────────────
echo -e "${DIM}→ 链接 CLI 入口...${RESET}"
mkdir -p ~/.local/bin
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ln -sf "$SCRIPT_DIR/bin/eto" ~/.local/bin/eto
echo -e "${GREEN}✓${RESET} ~/.local/bin/eto 已链接"
echo -e "${DIM}   确保 ~/.local/bin 在 PATH 中${RESET}"

# ── 完成 ──────────────────────────────────────────────
echo ""
echo -e "${TEAL}${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${TEAL}${BOLD}║  ETO 安装完成！                           ║${RESET}"
echo -e "${TEAL}${BOLD}║                                          ║${RESET}"
echo -e "${TEAL}${BOLD}║  ${GREEN}eto${RESET}${TEAL}         启动终端界面                     ║${RESET}"
echo -e "${TEAL}${BOLD}║  ${GREEN}ETO --help${RESET}${TEAL}  CLI 模式                       ║${RESET}"
echo -e "${TEAL}${BOLD}║                                          ║${RESET}"
echo -e "${TEAL}${BOLD}║  同志，后会有期。                         ║${RESET}"
echo -e "${TEAL}${BOLD}╚══════════════════════════════════════════╝${RESET}"
