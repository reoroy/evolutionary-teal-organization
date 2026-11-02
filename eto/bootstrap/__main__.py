"""ETO Bootstrap __main__ — pi-bootstrap 入口"""
import json, sys
from pathlib import Path

# Add project root to path so eto.bootstrap is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from eto.bootstrap import run


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    result = run(force=args.force)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
