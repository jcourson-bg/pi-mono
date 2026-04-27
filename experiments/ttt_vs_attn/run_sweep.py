"""Full sweep: each model trained on each regime, with multiple seeds.

Writes a CSV of results to results.csv and prints a summary table.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

import torch

from train import train_one


REGIMES = [
    # (label, N kv pairs, M queries, num_keys, num_values, training steps)
    # MQAR difficulty rises with N and with the value-vocab size.
    ("easy",    4,  4,  16, 16, 1500),
    ("medium",  8,  8,  32, 32, 3000),
    ("hard",   16,  8,  64, 64, 4000),
]
# TTT-MLP is ~3x slower than attention; cap its budget per regime.
STEPS_OVERRIDE = {"ttt_mlp": {"easy": 1200, "medium": 2200, "hard": 3000}}
MODELS = ["attn", "gla", "ttt_linear", "ttt_mlp"]


def main(seeds: list[int], outdir: Path, regime_filter: list[str] | None,
         model_filter: list[str] | None, batch_size: int = 64,
         lr: float = 3e-3) -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    csv_path = outdir / "results.csv"
    json_path = outdir / "results.jsonl"
    with csv_path.open("w", newline="") as cf, json_path.open("w") as jf:
        writer = csv.writer(cf)
        writer.writerow(["model", "regime", "num_kv", "num_q", "seed",
                         "params", "steps", "final_loss", "final_acc",
                         "wall_seconds"])
        for regime in REGIMES:
            label, N, M, NK, NV, steps_default = regime
            if regime_filter and label not in regime_filter:
                continue
            for model in MODELS:
                if model_filter and model not in model_filter:
                    continue
                steps = STEPS_OVERRIDE.get(model, {}).get(label, steps_default)
                for seed in seeds:
                    print(f"\n=== regime={label}  model={model}  seed={seed}  "
                          f"N={N} NK={NK} NV={NV} steps={steps} ===")
                    t0 = time.time()
                    res = train_one(model, N, M, num_keys=NK, num_values=NV,
                                    steps=steps, batch_size=batch_size,
                                    lr=lr, seed=seed)
                    dt = time.time() - t0
                    res["regime"] = label
                    res["seed"] = seed
                    print(f"  -> acc={res['final_acc']*100:.2f}%  "
                          f"loss={res['final_loss']:.4f}  ({dt:.1f}s)")
                    writer.writerow([model, label, N, M, seed,
                                     res["params"], steps,
                                     res["final_loss"], res["final_acc"], dt])
                    cf.flush()
                    jf.write(json.dumps(res, default=float) + "\n")
                    jf.flush()
    print_summary(csv_path)


def print_summary(csv_path: Path) -> None:
    rows = list(csv.DictReader(csv_path.open()))
    if not rows:
        print("(no results)"); return
    # Collate by (regime, model) -> list of accs
    from collections import defaultdict
    bucket = defaultdict(list)
    for r in rows:
        bucket[(r["regime"], r["model"])].append(float(r["final_acc"]))
    regimes = []
    for r in rows:
        if r["regime"] not in regimes:
            regimes.append(r["regime"])
    models = []
    for r in rows:
        if r["model"] not in models:
            models.append(r["model"])
    print("\n=== Summary (mean ± std accuracy on answer tokens) ===")
    header = f"{'regime':10s} | " + " | ".join(f"{m:>16s}" for m in models)
    print(header)
    print("-" * len(header))
    for reg in regimes:
        row = [f"{reg:10s}"]
        for m in models:
            accs = bucket.get((reg, m), [])
            if not accs:
                row.append(f"{'-':>16s}"); continue
            mean = sum(accs) / len(accs)
            if len(accs) > 1:
                var = sum((a - mean) ** 2 for a in accs) / (len(accs) - 1)
                std = var ** 0.5
                row.append(f"{mean*100:6.2f}±{std*100:5.2f}%")
            else:
                row.append(f"{mean*100:13.2f}%")
        print(" | ".join(row))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--seeds", type=int, nargs="+", default=[0, 1])
    p.add_argument("--outdir", default="results")
    p.add_argument("--regimes", nargs="*")
    p.add_argument("--models", nargs="*")
    p.add_argument("--batch_size", type=int, default=64)
    p.add_argument("--lr", type=float, default=3e-3)
    a = p.parse_args()
    main(a.seeds, Path(a.outdir), a.regimes, a.models, a.batch_size, a.lr)
