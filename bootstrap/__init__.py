"""ETO Bootstrap Bundle — 新手一键初始化

独立 Python 包，可 pip install -e . 或 python3 -m bootstrap 运行。
不依赖 eto.* 任何模块。
"""
import json
import os
from pathlib import Path


HOME = Path.home()
ETO_DIR = HOME / ".eto"
ETO_MEM_DIR = ETO_DIR / "memory"
ETOPROFILES_DIR = HOME / ".pi" / "etoprofiles"
ETO_CONFIG_PATH = HOME / ".pi" / "eto-config.json"


def run(force: bool = False) -> dict:
    """Bootstrap Bundle 编排入口。

    返回每一步的状态（跳过/已创建），可幂等重复运行。
    """
    steps = []
    ETO_MEM_DIR.mkdir(parents=True, exist_ok=True)
    ETOPROFILES_DIR.mkdir(parents=True, exist_ok=True)
    steps.append({"step": "prepare_dir", "status": "ok"})

    # 1. seed profiles
    from .seed_profiles import init as _seed_profiles
    r = _seed_profiles(str(ETOPROFILES_DIR / "profiles.json"), force=force)
    steps.append(r)

    # 2. seed skills
    from .seed_sample_skills import init as _seed_skills
    r = _seed_skills(force=force)
    steps.append(r)

    # 3. seed feature guide into Pi memory
    from .seed_guide import init as _seed_guide
    r = _seed_guide(force=force)
    steps.append(r)

    # 4. generate eto-config.json if missing or forced
    if force or not ETO_CONFIG_PATH.exists():
        from .config_template import make_config
        provider = "deepseek" if os.environ.get("DEEPSEEK_API_KEY") else "ollama"
        ETO_CONFIG_PATH.write_text(make_config(provider), "utf-8")
        steps.append({"step": "config", "status": "created", "provider": provider})
    else:
        steps.append({"step": "config", "status": "skipped"})

    return {"status": "bootstrap_complete", "steps": steps}
