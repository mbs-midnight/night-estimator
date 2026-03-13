# NIGHT Estimator

**DUST Budget Calculator for Midnight DApp Operators**

Estimate the NIGHT token holdings required to sustain DApp operations on the Midnight network. Input your circuit characteristics (k-value, ledger writes, TX volume) and get NIGHT requirements, sustainability projections, and congestion scenarios.

## Fee Model

Every Midnight transaction pays for at least one ZK proof (the DUST spend proof). Application-level circuit proofs and ledger writes add cost above the floor.

```
fee ≈ DUST_proof_base (0.30 DUST, constant)
    + app_proof_cost (~6.0 DUST per k-level)
    + write_cost    (~1.45 DUST per ledger write)
```

Calibrated from two confirmed data points on Midnight preprod:

| Transaction | Fee | k | Writes | Source |
|---|---|---|---|---|
| NIGHT transfer | **0.30 DUST** | — | 0 | Protocol architect (confirmed) |
| `post_big_blind` | **~69 DUST** | 10 | 6 | Preprod explorer (confirmed) |

Under congestion, dynamic pricing (±4.6% per block, every 6s) scales fees above these floor values.

## Key Insight: Proving Time is Flat

Circuit k-value ranges from 7 to 12 across the Dominion Poker contract (32× domain size difference), but proving time is constant at ~22-23s. The proof server setup/serialization overhead dominates, not circuit complexity. This means the `proof_verify_constant` (~5.8s) in the cost model drives compute cost equally for all proof-bearing transactions.

## Usage

```bash
npm install
npm run dev      # local dev server
npm run build    # production build
```

The calculator lets operators:
- Select preset profiles (NIGHT transfer, light/medium/heavy contracts, poker) or define custom TX characteristics
- Input circuit k-value, ledger writes per TX, and daily volume
- Model congestion from floor to 90% utilization spikes
- See fee breakdown, burn rates, NIGHT requirements, and regen/burn sustainability

## For Precise Estimates

The Midnight ledger API (`@midnight/ledger`) provides exact fee computation:

```typescript
// Mock prove for fee estimation (no proof server needed)
const mockTx = transaction.mockProve();
const fee = mockTx.fees(ledgerParams);

// With margin for fee blocks
const feeMargin = mockTx.feesWithMargin(ledgerParams, margin);

// Pre-proving estimation
const est = balancedFees + inputs * costModel.inputFeeOverhead + outputs * costModel.outputFeeOverhead;
```

## Status

**v0.5** — Generic input-based model. Two calibration points. Estimates will improve with:
1. Explorer fees for additional circuit types (3-write, 13-write)
2. Direct ledger API integration for exact fee computation
3. Per-circuit fee data from `Transaction.fees()` / `mockProve()`

## Sources

- [Cost model whitepaper](docs/) — Midnight's multi-dimensional fee architecture
- [Dominion Poker testnet report](https://gist.github.com/UvRoxx/c6272e68f0ce4e91698c1a56fbe6badd) — Corrected fee data
- [Circuit analysis](https://gist.github.com/UvRoxx/87dbfe7bfc2cf3ea853a86e471878090) — k-values and proving times
- [Ledger parameters](docs/) — Initial protocol configuration

## License

Internal use — Midnight Foundation / MBS
