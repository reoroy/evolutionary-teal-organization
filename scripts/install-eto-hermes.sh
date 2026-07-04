#!/usr/bin/env bash
# Install ETO Mesh for Hermes (Linux 192.168.3.54)
set -euo pipefail

ETO_DIR="${1:-$PWD}"
HERMES_MCP_DIR="$HOME/.hermes/mcp"

echo "=== Installing ETO Mesh for Hermes ==="
echo "ETO dir: $ETO_DIR"

mkdir -p "$HERMES_MCP_DIR"

cat > "$HERMES_MCP_DIR/eto.json" <<- JSON
{
  "name": "eto",
  "command": "python",
  "args": ["-m", "eto.mcp_server"],
  "cwd": "$ETO_DIR",
  "heartbeat_interval": 60
}
JSON
echo "OK: Hermes MCP config written"

echo "OK: Registering to mesh..."
python3 -m eto.cli join 2>/dev/null || echo "WARN: eto.cli not found, run 'eto-mesh join' manually"
echo "Done"
