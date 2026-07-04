#!/usr/bin/env bash
# Install ETO Mesh for Reasonix
set -euo pipefail

ETO_DIR="${1:-$PWD}"
REASONIX_MCP_DIR="$HOME/.reasonix/mcp"

echo "=== Installing ETO Mesh for Reasonix ==="
echo "ETO dir: $ETO_DIR"

mkdir -p "$REASONIX_MCP_DIR"

cat > "$REASONIX_MCP_DIR/eto.json" <<- JSON
{
  "name": "eto",
  "command": "python",
  "args": ["-m", "eto.mcp_server"],
  "cwd": "$ETO_DIR",
  "tools": ["eto_consensus", "eto_route", "eto_memory_read", "eto_memory_write"]
}
JSON
echo "OK: Reasonix MCP config written"

echo "OK: Registering to mesh..."
python3 -m eto.cli join 2>/dev/null || echo "WARN: eto.cli not found, run 'eto-mesh join' manually"
echo "Done"
