@echo off
set ANTHROPIC_BASE_URL=http://127.0.0.1:15721
set ANTHROPIC_API_KEY=PROXY_MANAGED
pi -e eto/extensions/eto.ts --provider anthropic
