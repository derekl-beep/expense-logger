#!/usr/bin/env python
"""Prints a breakdown of usage_events — which tools/commands/UI actions
actually get used, and which chat messages came from a chip/slash command
vs freeform typing. Run periodically (e.g. monthly) to inform keep/cut
decisions instead of guessing. Usage:

    uv run python scripts/usage_report.py            # all-time
    uv run python scripts/usage_report.py --since 2026-06-01
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from agent.db import get_usage_summary  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", help="ISO date (e.g. 2026-06-01) — only include events on/after this date")
    args = parser.parse_args()

    rows = get_usage_summary(since=args.since)
    if not rows:
        print("No usage events recorded" + (f" since {args.since}" if args.since else "") + ".")
        return

    total = sum(r["count"] for r in rows)
    print(f"{'EVENT':<28} {'SOURCE':<32} {'COUNT':>6}   %")
    print("-" * 72)
    for r in rows:
        pct = 100 * r["count"] / total
        source = r["source"] or "(direct)"
        print(f"{r['event_name']:<28} {source:<32} {r['count']:>6}   {pct:4.1f}%")
    print("-" * 72)
    print(f"{'TOTAL':<61} {total:>6}")


if __name__ == "__main__":
    main()
