# NIGHT Estimator

**DUST Budget Calculator for Midnight DApp Operators**

Estimate the NIGHT token holdings required to sustain DApp operations on the Midnight network. Uses Midnight's dual-token economics (NIGHT generates DUST) and multi-dimensional fee model to project operational costs.

## What's Here

### `src/dust-budget-calculator.jsx`
Interactive React calculator (renders as a Claude artifact or standalone React app) that lets DApp operators:

- Select from preset DApp profiles (poker table, light/medium/heavy DApps) or define custom transaction patterns
- Model congestion scenarios from floor pricing to 90% block utilization spikes  
- See DUST burn rates (daily/weekly/monthly) and required NIGHT holdings
- Check sustainability: does DUST regen outpace burn at your usage level?

**Calibrated with real testnet data** from Dominion Poker on Midnight preprod (231 games, 3,624 TXs). Floor fee confirmed at 0.3 DUST/TX (300T) across all circuit types.

### `docs/midnight-tx-profile-data-request.docx`
Data request template for the protocol engineering team. Asks for SyntheticCost vectors for common transaction types — the key missing input for per-profile fee accuracy under congestion.

## Key Parameters (from protocol docs)

| Parameter | Value | Source |
|-----------|-------|--------|
| DUST per NIGHT | 5 DUST / ~7 days | `INITIAL_DUST_PARAMETERS` |
| Generation rate | 8,267 SPECK/STAR/sec | `generation_decay_rate` |
| Block time | 6 seconds | Confirmed |
| Floor fee | 0.3 DUST/TX (300T) | Testnet observation |
| Target fullness | 50% | Cost model whitepaper |
| Price adjustment | ±4.595% per block | `price_adjustment_a_parameter` |
| Compute block limit | 1 second | `INITIAL_LIMITS` |
| Block usage limit | 200,000 bytes | `INITIAL_LIMITS` |

## How the Fee Model Works

```
Fee/TX at floor:  ~0.3 DUST (flat, confirmed on testnet)
Fee/TX congested:  0.3 × price_multiplier (dynamic pricing scales with block utilization)

Daily DUST burn = fee/TX × TXs/action × actions/day
Required NIGHT = max(burn/generation_rate, weekly_burn/cap)

1 NIGHT → 5 DUST cap, regenerated linearly over ~7 days
```

Under congestion, prices adjust ±4.6% per block (every 6s). Sustained 90% utilization roughly doubles fees in ~96 seconds — but cools equally fast when demand drops.

## Testnet Reference (Dominion Poker)

- **231 games**, 3,624 on-chain TXs, 48.5 hours of play
- ~4,000 tNIGHT sustained the system indefinitely (regen outpaced burn 3.6×)
- Fee was flat at 300T regardless of circuit complexity (13-write deck commit = 3-write fold)
- Proof server throughput (~22s/proof, ~160 proofs/hr) was the real bottleneck, not DUST
- Source: [Dominion Poker report by Utkarsh Varma / Webisoft](https://gist.github.com/UvRoxx/cfbb2b77ede4aa391c1f0a58b3227bc9)

## Status

**v0.3** — Floor pricing calibrated, congestion model estimated. Waiting on:
1. SyntheticCost vectors from protocol team (critical for per-profile congestion accuracy)
2. Proof verification cost clarification (`proof_verify_constant` at ~5.8s vs 1s block compute limit)

## Usage

The `.jsx` file renders as a React component. You can:
- Drop it into a Claude artifact for interactive use
- Import it into any React project (`export default` component, uses Tailwind-compatible inline styles)
- Dependencies: React 18+ (uses `useState`, `useMemo`, `useCallback`)

## License

Internal use — Midnight Foundation / MBS
