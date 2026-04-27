# Results: Test-Time Training vs. Attention vs. SSM on MQAR

## TL;DR

> The hypothesis that a **TTT layer** (gradient-based fast-weight memory
> updated during the forward pass) matches attention as the number of
> key/value pairs grows is **NOT supported** at the scale we tested.
>
> At N=4 kv-pairs, TTT-Linear reaches **100%** answer-token accuracy,
> matching attention; at N=8 it fails to leave the random-guessing
> plateau (**~18%**) within compute budgets that suffice for attention
> (**~100%**). A fixed-state gated linear attention (GLA) baseline
> behaves the same as TTT-Linear at N=8 and worse at N=4 (35%).
>
> So at this scale, the empirically observed ordering is
> `attention > {TTT-Linear, GLA}` once the task gets non-trivial.

The full thesis from the prior message — "the next breakthrough is making
the forward pass an optimization loop over a fast-weight memory" — is not
*disproven* in general by these results (we ran tiny models on CPU, not
real LMs), but the simplest, most cited form of the TTT primitive does not
beat attention here even on the canonical synthetic benchmark.

## Setup recap

- 2-block tiny LM, `d_model=64`, `n_heads=4`, tied head weights.
- All four mixers go through the same `_Block`; only the mixer differs.
- AdamW, lr=3e-3, batch_size=64, gradient clip=1.0.
- Position info via RoPE applied inside every mixer's q/k.

| Mixer       | Memory                              | Update rule                                   |
|-------------|-------------------------------------|-----------------------------------------------|
| `attn`      | KV cache (T·D per head)             | softmax(QK^T)V                                |
| `gla`       | matrix S ∈ R[Dh,Dh] per head        | S ← diag(g_t) S + k_t v_t^T                   |
| `ttt_linear`| matrix W ∈ R[Dh,Dh] per head        | W ← W − η_t (W k_t − v_t) k_t^T (input-gated) |
| `ttt_mlp`   | 2-layer MLP, ~ same size            | one-step SGD on \|\|f_W(k) − v\|\|² per token |

`ttt_mlp` did not converge in this single-CPU implementation (one inner
SGD step per token, matching the simplest formulation in the literature).
The full TTT paper does multi-step / chunked inner updates which we did
not replicate. We therefore exclude it from the headline comparison.

## Main result

Single seed, single-CPU, parameter-matched at `d_model=64`:

| Regime  | N kv | NK / NV | Steps | `attn`     | `gla`      | `ttt_linear` |
|---------|------|---------|-------|------------|------------|--------------|
| easy    | 4    | 16 / 16 | 3000  | **100.00%**| 35.06%     | **99.80%**   |
| medium  | 8    | 32 / 32 | 4500  | **99.93%** | 18.16%     | 18.19%       |
| hard    | 16   | 64 / 64 | 6000  | 9.35%*     | (skipped)  | (skipped)    |

\* the budget for `hard` was too small for *any* model to grok; result is
not informative on its own.

We confirmed the TTT-Linear medium failure with a second seed
(seed=1, same hyperparameters): final accuracy **17.97%** at step
4500. Both seeds plateau in `[15%, 19%]` for the entire training run.

We also extended TTT-Linear at `medium` to **8000 steps**, well past the
point where attention's grokking event has already happened (~step 2000).
Loss stays in `[1.98, 2.06]` and accuracy in `[15.4%, 19.4%]` for the
full 8000 steps. The "longer = grok" explanation does not save the
result — TTT-Linear is in a different basin.

## What this rules in / out

**Rules in (consistent with the thesis):**
- TTT is a real, trainable primitive at small scale. The implementation
  is straightforward (manual closed-form gradients, no magic).
- It dominates the simple SSM baseline at the easy regime
  (`100% vs 35%`), so it is *not* equivalent to a fixed-state recurrence.

**Rules out (against the strong form of the thesis):**
- At `d_model=64` and N=8, the simplest input-gated TTT-Linear cannot
  find the same solution attention finds, even with 2× the compute
  budget. So "TTT linearly replaces attention" is wrong at this scale.

## Why TTT-Linear plateaus

Hypotheses, in order of how much I believe them:

1. **Inner-loop bilinear bottleneck.** The closed-form inner update
   `W ← W − η (Wk − v) k^T` is a rank-1 outer-product accumulation
   modulated by the current `W`. The model has to *learn key projections
   that stay near-orthogonal across all 8 KV pairs* AND learn the input
   gate `η_t`. With a single attention head's worth of headroom
   (`Dh=16`), 8 near-orthogonal directions exist, but the joint
   optimization is harder than attention's "match-and-copy" because
   there's no soft-attention readout.
2. **Single inner step is not enough.** The TTT paper does multiple
   inner SGD steps per chunk; we do exactly one per token. That likely
   matters more for non-linear memories (which is why `ttt_mlp` didn't
   move at all here).
3. **No `q ↔ k` cross-projection at output.** Real TTT layers post-
   process `f_W(q)` with a learned gate that conditions on `x_t`. We
   skipped that for simplicity.

(2) and (3) are the "easy" wins that would likely close the gap. (1) is
the more interesting structural question.

## What I would do next (with more compute)

- Replace the per-token inner step with chunked multi-step updates
  (the actual TTT recipe).
- Add an output gate `o_t = α_t · self.o(f_W(q_t)) + (1-α_t) · v_t` and
  a Mamba-style input dependence on the q/k projections.
- Re-run with at least 3 seeds at N ∈ {4, 8, 16, 32} and plot accuracy
  vs N to see *where* TTT crosses attention rather than just "less than".
- Scale `d_model` to 128/256 — at our `d_model=64` even attention barely
  fits the hard regime, so we can't separate "hard for everyone" from
  "hard for TTT specifically".

## Honest verdict on the original ask

The ask was: think like an engineer, validate, prove or disprove.

- The **engineering hypothesis** ("TTT-style fast-weight memory replaces
  attention as a sequence-modeling primitive") is **not validated** at
  this scale on MQAR.
- The **stronger philosophical claim** I made before running the
  experiment (this is *the* next breakthrough) is **probably wrong**
  in this minimal form. Stronger versions of TTT (multi-step chunks,
  output gating, the actual paper's design) might still close the gap;
  we did not test those.
- Calling it "the next breakthrough" before doing 30 minutes of
  benchmarking would have been overconfident.
