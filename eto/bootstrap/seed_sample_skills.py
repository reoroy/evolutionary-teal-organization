"""Seed sample skills — 空种子（Onboarding 引导用户创建真实经验）"""
from pathlib import Path

SEED = []

def init(force: bool = False) -> dict:
    p = Path.home() / ".eto" / "memory" / "skills.jsonl"
    if p.exists() and not force:
        return {"step": "skills", "status": "skipped"}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("", "utf-8")
    return {"step": "skills", "status": "ok", "count": 0}
