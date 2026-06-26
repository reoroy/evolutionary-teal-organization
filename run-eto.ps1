#!/usr/bin/env pwsh
# ETO launcher (PowerShell)
# Enters Pi TUI with ETO extension + local proxy
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:15721"
$env:ANTHROPIC_API_KEY = "PROXY_MANAGED"
pi -e eto/extensions/eto.ts --provider anthropic
