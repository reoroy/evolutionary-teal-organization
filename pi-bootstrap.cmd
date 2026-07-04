@echo off
REM ETO Bootstrap — 一键初始化
cd /d "%~dp0"
python3 -c "import sys; sys.path.insert(0,'.'); from eto.bootstrap import run; import json; r=run(%*); print(json.dumps(r,ensure_ascii=False,indent=2))"
