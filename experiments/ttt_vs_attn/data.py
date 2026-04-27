"""Multi-Query Associative Recall (MQAR) data generator.

Standard formulation (Arora et al., "Zoology"):
  Sequence layout per example:
    [k_1, v_1, k_2, v_2, ..., k_N, v_N, q_1, a_1, q_2, a_2, ..., q_M, a_M]
  Each q_i is sampled (with replacement) from {k_1...k_N}; a_i is the matching v.
  Loss is computed only at "answer" positions (every other token in the query
  block). Everything else is masked out.

We keep keys and values in disjoint id ranges so the model cannot trivially copy.
"""

from __future__ import annotations

import torch


def make_vocab(num_keys: int, num_values: int, num_special: int = 1):
    # ids: [pad=0] [keys: num_keys] [values: num_values]
    key_start = num_special
    val_start = num_special + num_keys
    vocab_size = num_special + num_keys + num_values
    return vocab_size, key_start, val_start


def gen_batch(
    batch_size: int,
    num_kv_pairs: int,
    num_queries: int,
    num_keys: int,
    num_values: int,
    device: str = "cpu",
    generator: torch.Generator | None = None,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Returns (input_ids, target_ids, loss_mask).

    input_ids   : [B, T]   T = 2*num_kv_pairs + 2*num_queries
    target_ids  : [B, T]   shifted: target[t] = input[t+1] (last is pad)
    loss_mask   : [B, T]   1 at positions where the next token is an answer
    """
    assert num_kv_pairs <= num_keys, "need at least num_kv_pairs distinct keys"
    _, key_start, val_start = make_vocab(num_keys, num_values)

    g = generator
    B = batch_size
    N = num_kv_pairs
    M = num_queries

    # Sample N distinct keys per example (without replacement within an example).
    # torch has no batched-randperm, so do it via argsort over random scores.
    key_scores = torch.rand(B, num_keys, generator=g)
    keys = key_scores.argsort(dim=-1)[:, :N] + key_start  # [B, N]

    # Sample N values (with replacement is fine; values can repeat).
    vals = torch.randint(0, num_values, (B, N), generator=g) + val_start  # [B, N]

    # Build the (k,v) prefix block.
    kv_block = torch.empty(B, 2 * N, dtype=torch.long)
    kv_block[:, 0::2] = keys
    kv_block[:, 1::2] = vals

    # Sample queries: pick M indices into [0, N) per example.
    q_idx = torch.randint(0, N, (B, M), generator=g)
    q_keys = torch.gather(keys, 1, q_idx)
    q_vals = torch.gather(vals, 1, q_idx)

    # Query block: [q_1, a_1, q_2, a_2, ...]
    q_block = torch.empty(B, 2 * M, dtype=torch.long)
    q_block[:, 0::2] = q_keys
    q_block[:, 1::2] = q_vals

    full = torch.cat([kv_block, q_block], dim=1)  # [B, T]
    T = full.size(1)

    # Targets are next-token; final position has no target.
    targets = torch.full_like(full, 0)
    targets[:, :-1] = full[:, 1:]

    # Mask: 1 where the *target* is an answer token, else 0.
    # Answer tokens sit at odd positions inside the query block (i.e. positions
    # 2N+1, 2N+3, ...). The corresponding "input" position is 2N, 2N+2, ...
    mask = torch.zeros(B, T, dtype=torch.float32)
    for j in range(M):
        ans_input_pos = 2 * N + 2 * j  # we predict answer from this input pos
        mask[:, ans_input_pos] = 1.0

    if device != "cpu":
        full = full.to(device)
        targets = targets.to(device)
        mask = mask.to(device)
    return full, targets, mask


if __name__ == "__main__":
    torch.manual_seed(0)
    g = torch.Generator().manual_seed(0)
    x, y, m = gen_batch(
        batch_size=2,
        num_kv_pairs=4,
        num_queries=3,
        num_keys=8,
        num_values=8,
        generator=g,
    )
    print("input_ids :", x)
    print("targets   :", y)
    print("loss_mask :", m)
    print("shapes    :", x.shape, y.shape, m.shape)
    # sanity: targets at masked positions should equal a value (>= val_start)
    _, _, val_start = make_vocab(8, 8)
    answered = y[m.bool()]
    print("answers   :", answered.tolist(), "all >= val_start?", bool((answered >= val_start).all()))
