# NIGHT Estimator

**DUST Budget Calculator for Midnight DApp Operators**

Estimate the NIGHT token holdings required to sustain DApp operations on the Midnight network. The calculator shows the **Infinite Runway Target** — the amount of NIGHT needed to generate DUST faster than you burn it, indefinitely.

## Fee Model

Every Midnight transaction pays for at least one ZK proof (the DUST spend proof). Application-level circuit proofs and ledger writes add cost above the floor.

```
fee ≈ DUST_proof_base (0.30 DUST, constant)
    + app_proof_cost (~0.37 DUST for any app circuit)
    + write_cost    (~0.004 DUST per ledger write)
```

Calibrated from 5 confirmed data points on Midnight preprod:

| Transaction | Fee (DUST) | k | Writes | Source |
|---|---|---|---|---|
| NIGHT transfer | **0.30** | — | 0 | Protocol architect (confirmed) |
| `commit_action_state` | **0.6631** | 7 | 3 | Preprod explorer |
| `post_small_blind` | **0.6863** | 11 | 5 | Preprod explorer |
| `post_big_blind` | **~0.69** | 10 | 6 | Preprod explorer |
| `commit_deck_cards` | **0.7042** | 10 | 13 | Preprod explorer |

**Two tiers:** NIGHT transfers cost ~0.30 DUST. Contract calls with app circuit proofs cost ~0.66-0.70 DUST regardless of circuit complexity (k=7 to k=12, 3 to 13 writes — only ±3% variation). The app circuit proof dominates; writes add ~0.004 DUST each.

## Key Insights

- **Fees are nearly flat** across all contract circuits. Proof verification is a near-constant compute cost that dominates the fee formula's `max(compute, IO, blockUsage)` term.
- **Proving time is flat** at ~22-23s regardless of circuit size (k=7 to k=12). Proof server overhead dominates, not circuit complexity.
- **Writes are marginal.** Going from 3 to 13 writes adds ~0.04 DUST (~6% of total).
- **All TXs require a ZK proof.** DUST is shielded — even a NIGHT transfer needs a DUST spend proof.

## Usage

```bash
npm install
npm run dev      # local dev server
npm run build    # production build
```

## For Precise Estimates

Use the Midnight ledger API (`@midnight-ntwrk/ledger`):

```typescript
const mockTx = transaction.mockProve();
const fee = mockTx.fees(ledgerParams);
```

## Status

**v0.9** — 5-point calibration (corrected). Infinite Runway model.

## Sources

- [Cost model spec](docs/) — Midnight's multi-dimensional fee architecture
- [Dominion Poker report](https://gist.github.com/UvRoxx/c6272e68f0ce4e91698c1a56fbe6badd) — Corrected fee data
- [Circuit analysis](https://gist.github.com/UvRoxx/87dbfe7bfc2cf3ea853a86e471878090) — k-values and proving times
- [Ledger spec](https://github.com/midnightntwrk/midnight-ledger/tree/main/spec) — Protocol-level fee computation

## License

Internal use — Midnight Foundation / MBS
