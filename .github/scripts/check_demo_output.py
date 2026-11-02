#!/usr/bin/env python3
"""Validate the output of eto/stitches/test.py.

The demo prints one ``PASS <name>`` or ``FAIL <name>`` line per check and exits
non-zero when any check fails. Checking the exit code alone is not enough: a
crash or a silently skipped test must fail CI too, so this script also asserts
the exact number of PASS/FAIL lines.
"""
import argparse
import pathlib
import re
import sys

RESULT_LINE = re.compile(r"^(PASS|FAIL)\s")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=pathlib.Path, help="captured demo output")
    parser.add_argument(
        "--expected-pass",
        type=int,
        default=25,
        help="expected number of PASS lines (default: 25)",
    )
    parser.add_argument(
        "--exit-code",
        type=int,
        default=None,
        help="actual demo exit code; checked to be 0 when provided",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    text = args.output.read_text(encoding="utf-8", errors="replace")
    results = [line for line in text.splitlines() if RESULT_LINE.match(line)]
    passed = sum(line.startswith("PASS ") for line in results)
    failed = sum(line.startswith("FAIL ") for line in results)

    problems = []
    if args.exit_code is not None and args.exit_code != 0:
        problems.append(f"exit code was {args.exit_code}, expected 0")
    if passed != args.expected_pass:
        problems.append(f"expected PASS={args.expected_pass}, got {passed}")
    if failed != 0:
        problems.append(f"expected FAIL=0, got {failed}")
    if len(results) != args.expected_pass:
        problems.append(
            f"expected {args.expected_pass} result lines, got {len(results)}"
        )

    print(f"demo results: {len(results)} checks (PASS={passed}, FAIL={failed})")
    for problem in problems:
        print(f"CHECK FAILED: {problem}", file=sys.stderr)
    if problems:
        return 1
    print(f"CHECK OK: PASS={passed}, FAIL={failed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
