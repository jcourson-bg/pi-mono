"""Mixers under test for MQAR.

All mixers conform to: forward(x: [B, T, D]) -> [B, T, D], causal.

Variants:
  AttentionMixer  : standard causal multi-head self-attention with RoPE.
  GLAMixer        : gated linear attention (fixed-size matrix state).
  TTTLinearMixer  : memory is W ∈ R[D,D]; closed-form inner SGD step per token.
  TTTMLPMixer     : memory is a 2-layer MLP; inner SGD via autograd.

The wrapping LM (TinyLM) is identical across mixers so any difference in
performance is attributable to the mixer.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F


# ---------------------------------------------------------------------------
# Shared positional embedding (RoPE) for attention only.
# ---------------------------------------------------------------------------
def _rope_cache(T: int, head_dim: int, device, dtype=torch.float32):
    half = head_dim // 2
    freqs = torch.exp(-math.log(10000.0) * torch.arange(0, half, device=device, dtype=dtype) / half)
    t = torch.arange(T, device=device, dtype=dtype)
    angles = torch.outer(t, freqs)  # [T, half]
    return torch.cos(angles), torch.sin(angles)


def _apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    # x: [B, H, T, Dh]
    Dh = x.size(-1)
    x1, x2 = x[..., : Dh // 2], x[..., Dh // 2 :]
    rot = torch.cat([-x2, x1], dim=-1)
    cos_b = cos[None, None, :, :].expand_as(x1).repeat(1, 1, 1, 2)
    sin_b = sin[None, None, :, :].expand_as(x1).repeat(1, 1, 1, 2)
    return x * cos_b + rot * sin_b


# ---------------------------------------------------------------------------
# 1) Standard causal multi-head attention with RoPE.
# ---------------------------------------------------------------------------
class AttentionMixer(nn.Module):
    def __init__(self, d_model: int, n_heads: int = 4):
        super().__init__()
        assert d_model % n_heads == 0
        self.d_model = d_model
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads
        self.qkv = nn.Linear(d_model, 3 * d_model, bias=False)
        self.o = nn.Linear(d_model, d_model, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, D = x.shape
        qkv = self.qkv(x).view(B, T, 3, self.n_heads, self.head_dim)
        q, k, v = qkv.unbind(dim=2)  # [B, T, H, Dh]
        q = q.transpose(1, 2)  # [B, H, T, Dh]
        k = k.transpose(1, 2)
        v = v.transpose(1, 2)
        cos, sin = _rope_cache(T, self.head_dim, x.device, x.dtype)
        q = _apply_rope(q, cos, sin)
        k = _apply_rope(k, cos, sin)
        out = F.scaled_dot_product_attention(q, k, v, is_causal=True)  # [B,H,T,Dh]
        out = out.transpose(1, 2).contiguous().view(B, T, D)
        return self.o(out)


# ---------------------------------------------------------------------------
# 2) Gated Linear Attention — fixed-state SSM proxy.
#    Recurrence: S_t = diag(g_t) @ S_{t-1} + k_t v_t^T
#                o_t = q_t S_t
#    g_t ∈ (0,1)^d  is a per-channel forget gate.
# ---------------------------------------------------------------------------
class GLAMixer(nn.Module):
    def __init__(self, d_model: int, n_heads: int = 4):
        super().__init__()
        self.d_model = d_model
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads
        self.qkv = nn.Linear(d_model, 3 * d_model, bias=False)
        self.gate = nn.Linear(d_model, d_model, bias=True)
        self.o = nn.Linear(d_model, d_model, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, D = x.shape
        H, Dh = self.n_heads, self.head_dim
        qkv = self.qkv(x).view(B, T, 3, H, Dh)
        q, k, v = qkv.unbind(dim=2)
        # Apply softplus to keys to keep them positive (linear-attention trick).
        k = F.elu(k) + 1.0
        q = F.elu(q) + 1.0
        gate = torch.sigmoid(self.gate(x)).view(B, T, H, Dh)  # [B,T,H,Dh]

        # State: [B, H, Dh, Dh]. Loop over T (CPU friendly at small T).
        S = x.new_zeros(B, H, Dh, Dh)
        outs = []
        for t in range(T):
            g_t = gate[:, t]  # [B,H,Dh]
            # Diagonal gating along the "key" dim (rows of S).
            S = S * g_t.unsqueeze(-1)
            kt = k[:, t]  # [B,H,Dh]
            vt = v[:, t]  # [B,H,Dh]
            S = S + torch.einsum("bhi,bhj->bhij", kt, vt)
            qt = q[:, t]  # [B,H,Dh]
            ot = torch.einsum("bhi,bhij->bhj", qt, S)  # [B,H,Dh]
            outs.append(ot)
        out = torch.stack(outs, dim=1).reshape(B, T, D)
        return self.o(out)


# ---------------------------------------------------------------------------
# 3) TTT-Linear: memory is a linear map W ∈ R[B, D, D].
#    Inner loss : L = ||W k - v||^2
#    Inner step : W ← W - η (W k - v) k^T
#    Output     : o = W q
#
#    Inner LR η is a learnable scalar (positive via softplus).
# ---------------------------------------------------------------------------
class TTTLinearMixer(nn.Module):
    """Memory is W ∈ R[H, Dh, Dh]; closed-form inner SGD step per token.

    Adds an input-dependent per-head learning rate η_t = η_base · σ(W_lr x_t).
    This lets the model learn to *not* update memory on tokens that shouldn't
    be written (e.g. answer / query tokens), which is critical for MQAR.
    """

    def __init__(self, d_model: int, n_heads: int = 4):
        super().__init__()
        self.d_model = d_model
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads
        self.qkv = nn.Linear(d_model, 3 * d_model, bias=False)
        self.lr_proj = nn.Linear(d_model, n_heads, bias=True)
        self.o = nn.Linear(d_model, d_model, bias=False)
        self.W0 = nn.Parameter(torch.zeros(n_heads, self.head_dim, self.head_dim))
        self.log_lr_base = nn.Parameter(torch.tensor(math.log(1.0)))

    @staticmethod
    def _norm(x: torch.Tensor) -> torch.Tensor:
        return x / (x.norm(dim=-1, keepdim=True) + 1e-6)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, D = x.shape
        H, Dh = self.n_heads, self.head_dim
        qkv = self.qkv(x).view(B, T, 3, H, Dh)
        q, k, v = qkv.unbind(dim=2)
        k = self._norm(k)
        q = self._norm(q)
        eta_base = F.softplus(self.log_lr_base)
        eta_gate = torch.sigmoid(self.lr_proj(x))  # [B, T, H]
        W = self.W0.unsqueeze(0).expand(B, -1, -1, -1).contiguous()
        outs = []
        for t in range(T):
            kt = k[:, t]
            vt = v[:, t]
            qt = q[:, t]
            eta_t = eta_base * eta_gate[:, t]  # [B, H]
            pred = torch.einsum("bhij,bhj->bhi", W, kt)
            err = pred - vt
            grad = torch.einsum("bhi,bhj->bhij", err, kt)
            W = W - eta_t[..., None, None] * grad
            ot = torch.einsum("bhij,bhj->bhi", W, qt)
            outs.append(ot)
        out = torch.stack(outs, dim=1).reshape(B, T, D)
        return self.o(out)


# ---------------------------------------------------------------------------
# 4) TTT-MLP: memory is a 2-layer MLP f(x) = W2 GELU(W1 x).
#    Inner loss : ||f(k) - v||^2
#    Inner step : autograd-derived gradient on (W1, W2), one SGD step per token.
#    Output     : f_{W_t}(q_t) using the freshly updated weights.
#
#    Implementation note: we manually compute gradients in closed form to keep
#    the per-step graph small (and to actually run on CPU). For a 2-layer MLP
#    f(x) = W2 σ(W1 x) with σ = GELU and L = 0.5 ||f(x) - v||^2:
#
#       z   = W1 k                    [B,H,Dh_h]
#       a   = σ(z)                    [B,H,Dh_h]
#       y   = W2 a                    [B,H,Dh]
#       err = y - v                   [B,H,Dh]
#       dW2 = err a^T                 [B,H,Dh,Dh_h]
#       da  = W2^T err                [B,H,Dh_h]
#       dz  = da * σ'(z)              [B,H,Dh_h]
#       dW1 = dz k^T                  [B,H,Dh_h,Dh]
#
#    σ' for GELU is approximated by the closed-form derivative of the tanh
#    approximation, which is fine here.
# ---------------------------------------------------------------------------
def _gelu_and_deriv(z: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    # tanh-approx GELU: 0.5 z (1 + tanh(c (z + 0.044715 z^3))) with c=√(2/π)
    c = math.sqrt(2.0 / math.pi)
    z3 = z * z * z
    inner = c * (z + 0.044715 * z3)
    th = torch.tanh(inner)
    a = 0.5 * z * (1.0 + th)
    sech2 = 1.0 - th * th
    dinner_dz = c * (1.0 + 3.0 * 0.044715 * z * z)
    deriv = 0.5 * (1.0 + th) + 0.5 * z * sech2 * dinner_dz
    return a, deriv


class TTTMLPMixer(nn.Module):
    """Memory is a 2-layer MLP. Same input-dependent η as TTT-Linear."""

    def __init__(self, d_model: int, n_heads: int = 4, hidden_mult: float = 1.0):
        super().__init__()
        self.d_model = d_model
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads
        self.hidden_dim = max(1, int(self.head_dim * hidden_mult))
        self.qkv = nn.Linear(d_model, 3 * d_model, bias=False)
        self.lr_proj = nn.Linear(d_model, n_heads, bias=True)
        self.o = nn.Linear(d_model, d_model, bias=False)
        self.W1_0 = nn.Parameter(torch.randn(n_heads, self.hidden_dim, self.head_dim) * 0.1)
        self.W2_0 = nn.Parameter(torch.randn(n_heads, self.head_dim, self.hidden_dim) * 0.1)
        self.log_lr_base = nn.Parameter(torch.tensor(math.log(0.5)))

    @staticmethod
    def _norm(x: torch.Tensor) -> torch.Tensor:
        return x / (x.norm(dim=-1, keepdim=True) + 1e-6)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, D = x.shape
        H, Dh, Hh = self.n_heads, self.head_dim, self.hidden_dim
        qkv = self.qkv(x).view(B, T, 3, H, Dh)
        q, k, v = qkv.unbind(dim=2)
        k = self._norm(k)
        q = self._norm(q)
        eta_base = F.softplus(self.log_lr_base)
        eta_gate = torch.sigmoid(self.lr_proj(x))  # [B, T, H]

        W1 = self.W1_0.unsqueeze(0).expand(B, -1, -1, -1).contiguous()
        W2 = self.W2_0.unsqueeze(0).expand(B, -1, -1, -1).contiguous()

        outs = []
        for t in range(T):
            kt = k[:, t]
            vt = v[:, t]
            qt = q[:, t]
            eta_t = eta_base * eta_gate[:, t]  # [B, H]
            z = torch.einsum("bhij,bhj->bhi", W1, kt)
            a, sigma_p = _gelu_and_deriv(z)
            y = torch.einsum("bhij,bhj->bhi", W2, a)
            err = y - vt
            dW2 = torch.einsum("bhi,bhj->bhij", err, a)
            da = torch.einsum("bhij,bhi->bhj", W2, err)
            dz = da * sigma_p
            dW1 = torch.einsum("bhi,bhj->bhij", dz, kt)
            scale = eta_t[..., None, None]
            W1 = W1 - scale * dW1
            W2 = W2 - scale * dW2
            zq = torch.einsum("bhij,bhj->bhi", W1, qt)
            aq, _ = _gelu_and_deriv(zq)
            ot = torch.einsum("bhij,bhj->bhi", W2, aq)
            outs.append(ot)
        out = torch.stack(outs, dim=1).reshape(B, T, D)
        return self.o(out)


# ---------------------------------------------------------------------------
# Tiny LM that wraps a chosen mixer.
# ---------------------------------------------------------------------------
class _Block(nn.Module):
    def __init__(self, d_model: int, mixer: nn.Module, ffn_mult: int = 2):
        super().__init__()
        self.mixer_norm = nn.LayerNorm(d_model)
        self.mixer = mixer
        self.ffn_norm = nn.LayerNorm(d_model)
        self.ffn = nn.Sequential(
            nn.Linear(d_model, ffn_mult * d_model, bias=False),
            nn.GELU(),
            nn.Linear(ffn_mult * d_model, d_model, bias=False),
        )

    def forward(self, h: torch.Tensor) -> torch.Tensor:
        h = h + self.mixer(self.mixer_norm(h))
        h = h + self.ffn(self.ffn_norm(h))
        return h


class TinyLM(nn.Module):
    """Tiny LM with learned absolute position embeddings shared by all mixers.

    Attention additionally uses RoPE inside its mixer. SSM/TTT mixers rely
    solely on this absolute positional signal in the input.
    """

    def __init__(self, vocab_size: int, d_model: int, blocks: list[nn.Module],
                 max_len: int = 256):
        super().__init__()
        self.embed = nn.Embedding(vocab_size, d_model)
        self.pos = nn.Embedding(max_len, d_model)
        self.blocks = nn.ModuleList(blocks)
        self.out_norm = nn.LayerNorm(d_model)
        self.head = nn.Linear(d_model, vocab_size, bias=False)
        self.head.weight = self.embed.weight  # tied

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        T = x.size(1)
        pos = torch.arange(T, device=x.device)
        h = self.embed(x) + self.pos(pos)[None, :, :]
        for blk in self.blocks:
            h = blk(h)
        return self.head(self.out_norm(h))


def count_params(m: nn.Module) -> int:
    return sum(p.numel() for p in m.parameters())


def _make_mixer(name: str, d_model: int, n_heads: int) -> nn.Module:
    name = name.lower()
    if name == "attn":
        return AttentionMixer(d_model, n_heads)
    if name == "gla":
        return GLAMixer(d_model, n_heads)
    if name == "ttt_linear":
        return TTTLinearMixer(d_model, n_heads)
    if name == "ttt_mlp":
        return TTTMLPMixer(d_model, n_heads, hidden_mult=1.0)
    raise ValueError(name)


def build(name: str, vocab_size: int, d_model: int = 64, n_heads: int = 4,
          n_layers: int = 2) -> TinyLM:
    blocks = [_Block(d_model, _make_mixer(name, d_model, n_heads)) for _ in range(n_layers)]
    return TinyLM(vocab_size, d_model, blocks)


if __name__ == "__main__":
    torch.manual_seed(0)
    V = 64
    for name in ["attn", "gla", "ttt_linear", "ttt_mlp"]:
        m = build(name, V, d_model=64, n_heads=4)
        x = torch.randint(0, V, (2, 16))
        y = m(x)
        mp = sum(count_params(b.mixer) for b in m.blocks)
        print(f"{name:12s}  out {tuple(y.shape)}  params={count_params(m):,}  mixer_params={mp:,}")
