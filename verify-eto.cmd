@echo off
REM ETO verification: quick test to confirm ETO loads via proxy
set ANTHROPIC_BASE_URL=http://127.0.0.1:15721
set ANTHROPIC_API_KEY=PROXY_MANAGED
pi -e eto/extensions/eto.ts --provider anthropic -p "test" > eto-test-output.log 2>&1
find "ETO" eto-test-output.log >nul && (echo PASS & exit /b 0) || (echo FAIL & exit /b 1)
