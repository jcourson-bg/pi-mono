"""Train one (model, regime) configuration on MQAR and report answer-token
accuracy on a fresh held-out batch.

Usage:
    python3 train.py --model attn --num_kv 32 --num_q 16 --steps 1500
"""

from __future__ import annotations

import argparse
import time

import torch
import torch.nn.functional as F

import data as D
import models as M


def evaluate(model, vocab_size, num_kv, num_q, num_keys, num_values,
             eval_batches=8, batch_size=64, device="cpu") -> tuple[float, float]:
    """Returns (loss, accuracy) at answer positions only."""
    model.eval()
    g = torch.Generator().manual_seed(99991)
    total_loss = 0.0
    total_correct = 0
    total_count = 0
    with torch.no_grad():
        for _ in range(eval_batches):
            x, y, m = D.gen_batch(batch_size, num_kv, num_q, num_keys, num_values,
                                  device=device, generator=g)
            logits = model(x)
            log_probs = F.log_softmax(logits, dim=-1)
            tgt_lp = log_probs.gather(-1, y.unsqueeze(-1)).squeeze(-1)
            loss_per = -(tgt_lp * m)
            denom = m.sum().clamp(min=1.0)
            total_loss += (loss_per.sum() / denom).item() * denom.item()
            preds = logits.argmax(dim=-1)
            correct = ((preds == y) & m.bool()).sum().item()
            total_correct += correct
            total_count += int(m.sum().item())
    model.train()
    return total_loss / max(1, total_count), total_correct / max(1, total_count)


def train_one(model_name: str, num_kv: int, num_q: int, num_keys: int = 64,
              num_values: int = 64, d_model: int = 64, n_heads: int = 4,
              steps: int = 1500, batch_size: int = 64, lr: float = 3e-3,
              eval_every: int = 200, seed: int = 0, log_fn=print) -> dict:
    torch.manual_seed(seed)
    g = torch.Generator().manual_seed(seed + 1)
    vocab_size, _, _ = D.make_vocab(num_keys, num_values)
    model = M.build(model_name, vocab_size, d_model=d_model, n_heads=n_heads)
    n_params = M.count_params(model)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, betas=(0.9, 0.95), weight_decay=0.01)
    log_fn(f"  [{model_name}] params={n_params:,} regime: N={num_kv} M={num_q}")
    history = []
    t0 = time.time()
    for step in range(1, steps + 1):
        x, y, mask = D.gen_batch(batch_size, num_kv, num_q, num_keys, num_values,
                                 generator=g)
        logits = model(x)
        log_probs = F.log_softmax(logits, dim=-1)
        tgt_lp = log_probs.gather(-1, y.unsqueeze(-1)).squeeze(-1)
        loss = -(tgt_lp * mask).sum() / mask.sum().clamp(min=1.0)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        if step % eval_every == 0 or step == steps:
            ev_loss, ev_acc = evaluate(model, vocab_size, num_kv, num_q,
                                       num_keys, num_values, eval_batches=4,
                                       batch_size=batch_size)
            history.append((step, loss.item(), ev_loss, ev_acc))
            log_fn(f"    step {step:5d}  train_loss {loss.item():.4f}  "
                   f"eval_loss {ev_loss:.4f}  eval_acc {ev_acc*100:5.2f}%")
    dt = time.time() - t0
    final_loss, final_acc = evaluate(model, vocab_size, num_kv, num_q,
                                     num_keys, num_values, eval_batches=8,
                                     batch_size=batch_size)
    log_fn(f"  [{model_name}] DONE in {dt:.1f}s  final eval acc={final_acc*100:.2f}%")
    return {
        "model": model_name,
        "num_kv": num_kv,
        "num_q": num_q,
        "num_keys": num_keys,
        "num_values": num_values,
        "params": n_params,
        "steps": steps,
        "batch_size": batch_size,
        "history": history,
        "final_loss": final_loss,
        "final_acc": final_acc,
        "wall_seconds": dt,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True, choices=["attn", "gla", "ttt_linear", "ttt_mlp"])
    p.add_argument("--num_kv", type=int, default=8)
    p.add_argument("--num_q", type=int, default=8)
    p.add_argument("--num_keys", type=int, default=64)
    p.add_argument("--num_values", type=int, default=64)
    p.add_argument("--d_model", type=int, default=64)
    p.add_argument("--n_heads", type=int, default=4)
    p.add_argument("--steps", type=int, default=1500)
    p.add_argument("--batch_size", type=int, default=64)
    p.add_argument("--lr", type=float, default=3e-3)
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()
    out = train_one(args.model, args.num_kv, args.num_q, args.num_keys,
                    args.num_values, args.d_model, args.n_heads, args.steps,
                    args.batch_size, args.lr, seed=args.seed)
    print("RESULT:", out["final_acc"], out["final_loss"])
