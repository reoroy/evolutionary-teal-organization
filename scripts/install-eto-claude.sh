#!/usr/bin/env bash
# Install ETO Mesh for Claude Code
set -euo pipefail

ETO_DIR="${1:-$PWD}"
MCP_JSON="${CLAUDE_MCP_JSON:-$HOME/.claude/.mcp.json}"

echo "=== Installing ETO Mesh for Claude Code ==="
echo "ETO dir: $ETO_DIR"

mkdir -p "$(dirname "$MCP_JSON")"

if [ -f "$MCP_JSON" ]; then
    python3 -c "
import json
p = '$MCP_JSON'
c = json.load(open(p))
c.setdefault('mcpServers', {})['eto-mesh'] = {
    'command': 'python',
    'args': ['-m', 'eto.mcp_server'],
    'cwd': '$ETO_DIR'
}
json.dump(c, open(p, 'w'), indent=2)
print('OK: .mcp.json updated')
"
else
    cat > "$MCP_JSON" <<- JSON
{
  "mcpServers": {
    "eto-mesh": {
      "command": "python",
      "args": ["-m", "eto.mcp_server"],
      "cwd": "$ETO_DIR"
    }
  }
}
JSON
    echo "OK: .mcp.json created"
fi

echo "OK: Registering to mesh..."
python3 -m eto.cli join 2>/dev/null || echo "WARN: eto.cli not found, run 'eto-mesh join' manually"
echo "Done"
