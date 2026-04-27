"""Summarize results.csv into a human-readable table + verdict."""

from __future__ import annotations

import argparse
import csv
import math
from collections import defaultdict
from pathlib import Path


def load(csv_path: Path):
    rows = []
    with csv_path.open() as f:
        for r in csv.DictReader(f):
            r["final_acc"] = float(r["final_acc"])
            r["final_loss"] = float(r["final_loss"])
            r["wall_seconds"] = float(r["wall_seconds"])
            r["params"] = int(r["params"])
            r["num_kv"] = int(r["num_kv"])
            rows.append(r)
    return rows


def regime_order(rows):
    out = []
    for r in rows:
        if r["regime"] not in out:
            out.append(r["regime"])
    return out


def model_order(rows):
    pref = ["attn", "gla", "ttt_linear", "ttt_mlp"]
    seen = {r["model"] for r in rows}
    return [m for m in pref if m in seen] + [m for m in seen - set(pref)]


def fmt_pct(mean, std=None):
    if std is None:
        return f"{mean*100:6.2f}%"
    return f"{mean*100:5.2f}±{std*100:4.2f}%"


def summarize(csv_path: Path) -> str:
    rows = load(csv_path)
    if not rows:
        return "(no rows)"
    regimes = regime_order(rows)
    models = model_order(rows)
    bucket = defaultdict(list)
    for r in rows:
        bucket[(r["regime"], r["model"])].append(r["final_acc"])

    lines = []
    lines.append("Final answer-token accuracy (mean ± std across seeds)")
    lines.append("")
    header = f"| {'regime':<8} | " + " | ".join(f"{m:>13s}" for m in models) + " |"
    lines.append(header)
    lines.append("|" + "-" * 9 + "|" + "|".join("-" * 15 for _ in models) + "|")
    for reg in regimes:
        cells = [f"{reg:<8s}"]
        for m in models:
            accs = bucket.get((reg, m), [])
            if not accs:
                cells.append(f"{'-':>13s}")
                continue
            mean = sum(accs) / len(accs)
            if len(accs) > 1:
                var = sum((a - mean) ** 2 for a in accs) / (len(accs) - 1)
                std = math.sqrt(var)
                cells.append(fmt_pct(mean, std))
            else:
                cells.append(fmt_pct(mean))
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")
    lines.append("Param counts:")
    for m in models:
        ps = {r["params"] for r in rows if r["model"] == m}
        lines.append(f"  {m:>13s}: " + ", ".join(f"{p:,}" for p in sorted(ps)))
    lines.append("")
    lines.append("Wall-clock (seconds, summed over all runs):")
    for m in models:
        total = sum(r["wall_seconds"] for r in rows if r["model"] == m)
        lines.append(f"  {m:>13s}: {total:7.1f} s")
    return "\n".join(lines)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--csv", default="results/results.csv")
    a = p.parse_args()
    print(summarize(Path(a.csv)))
