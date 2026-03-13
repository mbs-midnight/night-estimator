# NIGHT Estimator

**DUST Budget Calculator for Midnight DApp Operators**

Estimate the NIGHT token holdings required to sustain DApp operations on the Midnight network.

## ⚠️ v0.4 — Corrected Fee Data

The original testnet report (v0.1–v0.3) used the client-side `additionalFeeOverhead` (300T / 0.3 DUST) as the per-TX fee. **This was only a wallet SDK buffer, not the actual network fee.** Explorer-confirmed fee for `post_big_blind` (6 ledger writes) is **~69 DUST per TX** — approximately 230× higher. All calculations have been corrected.

## What's Here

### `src/dust-budget-calculator.jsx`
Interactive React calculator that lets DApp operators:

- Select from preset DApp profiles or define custom patterns
- Model congestion scenarios from floor to 90% utilization spikes
- See DUST burn rates and required NIGHT holdings
- Check sustainability: regen vs burn ratio (testnet shows ~1.015× — thin margin)

### `docs/midnight-tx-profile-data-request.docx`
Data request for protocol team — SyntheticCost vectors for common TX types.

## Key Numbers

| Parameter | Value | Source |
|-----------|-------|--------|
| **Per-TX fee (floor)** | **~69 DUST** | Explorer (preprod, `post_big_blind`, 6 writes) |
| DUST per NIGHT | 5 DUST / ~7 days | `INITIAL_DUST_PARAMETERS` |
| Block time | 6 seconds | Confirmed |
| Target fullness | 50% | Cost model whitepaper |
| Price adjustment | ±4.595% per block | `price_adjustment_a_parameter` |
| Regen/burn ratio (testnet) | ~1.015× | Corrected report (was 3.6×) |

## Testnet Reference (Corrected)

From Dominion Poker on Midnight preprod (231 games, 3,624 TXs):

- **Avg game cost: ~1,083 DUST** (15.7 TXs × ~69 DUST) — was 4.7 DUST in original report
- ~4,000 tNIGHT sustained the system, but with only ~1.5% surplus margin
- DUST pool grew +1,812 over 110 games via ~121K regen vs ~119K burn (thin net)
- Runway without regen: ~2 hours (was reported as 20 days)
- Fee varies by circuit — 69 DUST is mid-range (6 writes); simpler circuits likely cheaper
- Proof server (~22s/proof) remains the throughput bottleneck

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build (Vercel auto-deploys)
```

## Status

**v0.4** — Explorer-corrected fees. Still need:
1. Per-circuit fee data (all 21 circuits, not just `post_big_blind`)
2. SyntheticCost vectors from protocol team
3. Proof verification cost clarification

## License

Internal use — Midnight Foundation / MBS
