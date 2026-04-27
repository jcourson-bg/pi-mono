# Test-Time Training vs. Attention vs. SSM on MQAR

A small, falsifiable experiment to test the thesis that the next architectural
shift in language modeling is **gradient-based fast-weight memory updates
during inference** (test-time training, TTT) rather than a different attention
variant or yet-another-SSM.

## Hypothesis (falsifiable)

> On Multi-Query Associative Recall (MQAR) — the canonical synthetic stress
> test for in-context memory — a parameter-matched **TTT layer** (memory =
> small neural network whose weights are updated by SGD during the forward
> pass) will match attention as the number of key/value pairs grows, while a
> fixed-state gated linear-attention (GLA, an SSM proxy) will fall behind.

If TTT loses to attention at equal parameters across the regimes we test, the
thesis is wrong for this scale.

## Setup

- 2-block tiny LM (`embed → block × 2 → out_norm → tied head`).
- `d_model = 64`, `n_heads = 4`, learned absolute position embeddings.
- All four mixers slot into the same block; only the mixer differs.
- AdamW, lr=3e-3, batch_size=64, gradient clip = 1.0.

### Mixers

| Mixer        | What it is                                                    | Memory                |
|--------------|---------------------------------------------------------------|-----------------------|
| `attn`       | Causal multi-head attention with RoPE                         | Full KV cache (T·D)   |
| `gla`        | Gated linear attention with per-channel forget gate           | Fixed matrix Dh×Dh    |
| `ttt_linear` | TTT-Linear with input-gated inner LR (closed-form SGD step)   | Linear map W ∈ Dh×Dh, **updated per token** |
| `ttt_mlp`    | TTT-MLP with manual closed-form gradient                      | 2-layer MLP, **updated per token** |

The TTT layers do `W_t = W_{t-1} − η_t ∇L(W_{t-1}; k_t, v_t)` per token,
where `η_t = η_base · σ(W_lr x_t)` is input-dependent so the model can learn
to **not** write at query / answer positions.

### Task: MQAR

Each example is a sequence
```
[k_1, v_1, k_2, v_2, ..., k_N, v_N, q_1, a_1, q_2, a_2, ..., q_M, a_M]
```
where each `q_i` is sampled with replacement from `{k_1...k_N}` and
`a_i` is the matching value. Loss is computed only at answer positions.

### Regimes

| Regime  | N kv-pairs | M queries | key vocab | value vocab | Steps |
|---------|------------|-----------|-----------|-------------|-------|
| easy    | 4          | 4         | 16        | 16          | 3000  |
| medium  | 8          | 8         | 32        | 32          | 4500  |
| hard    | 16         | 8         | 64        | 64          | 6000  |

## What we found

(filled in after the sweep)

## Files

- `data.py` — MQAR generator
- `models.py` — the four mixers + tiny LM
- `train.py` — single-config training loop
- `run_sweep.py` — sweep across regimes / models / seeds
- `results/` — CSV + JSONL of sweep runs (gitignored)

## Reproducing

```bash
pip install torch numpy
cd experiments/ttt_vs_attn
python3 run_sweep.py --seeds 0 1 --outdir results
```
