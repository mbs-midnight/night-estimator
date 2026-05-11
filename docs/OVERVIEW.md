# NIGHT Estimator — Overview

## What It Is

The NIGHT Estimator is a planning tool for DApp operators on the Midnight network. It answers two questions:

1. **How much NIGHT do I need to hold** to run my application indefinitely?
2. **How much infrastructure do I need** to support my expected concurrent users?

The tool runs as a web application and is available at the deployed Vercel URL and in the [GitHub repo](https://github.com/mbs-midnight/night-estimator).

## Why It Exists

Midnight's dual-token model — where NIGHT generates DUST, and DUST pays for transaction fees — is powerful but creates a planning problem for DApp operators. Unlike traditional blockchains where you simply buy gas tokens as needed, Midnight operators need to hold a sufficient, *ongoing* balance of NIGHT to continuously generate enough DUST to cover their transaction volume. Holding too little NIGHT means your application runs out of DUST and stalls. Holding too much ties up capital unnecessarily.

Additionally, Midnight's UTXO-based DUST model means that concurrency — how many transactions your application can process simultaneously — is constrained by how many DUST UTXOs your wallet holds, not just your total DUST balance. This is a non-obvious operational consideration that most operators won't discover until they hit it in production.

The NIGHT Estimator makes both of these constraints visible and plannable before deployment.

## What It Does

### DUST Budget Mode

Operators select or configure a transaction profile (whether their transactions include application circuit proofs, how many ledger writes per transaction, and their expected daily volume), choose a network congestion scenario, and get:

- **Infinite Runway Target** — the exact amount of NIGHT to hold so that DUST regeneration outpaces DUST consumption indefinitely
- **Daily, weekly, and monthly DUST burn projections**
- **Regen-to-burn ratio** — whether the operator is comfortably self-sustaining or running a thin margin
- **Cap runway** — how long the DUST reserves last if regeneration were interrupted

### Concurrency Mode

Operators input their expected concurrent users, transaction burst patterns, and DUST balance per UTXO, and get:

- **DUST UTXOs needed** — how many separate NIGHT UTXOs to split holdings into for concurrent transaction slots
- **Total NIGHT** — across all UTXOs
- **Proof servers needed** — based on proving throughput
- **Throughput analysis** — identifying whether the bottleneck is UTXO concurrency, proof server capacity, or the chain's block size limit
- **Scaling reference table** — from single-UTXO operation up to chain saturation

## How It Works (Conceptually)

The fee model is calibrated from confirmed data points observed on the Midnight network. The key finding is that transaction fees fall into two tiers:

- **Simple transfers** (DUST spend proof only, no application circuit): ~0.30 DUST
- **Contract calls** (DUST spend proof + application circuit proof): ~0.66–0.70 DUST

Fees are remarkably flat across contract calls of different complexity. Circuit size (k-value) and ledger write count have minimal impact on the fee — the proof verification component dominates. This means operators can budget primarily around their *transaction count*, not the complexity of individual transactions.

The concurrency model is based on the fact that each NIGHT UTXO generates exactly one DUST UTXO, and each DUST UTXO locks during the proving window (~22–28 seconds). More DUST UTXOs means more concurrent transaction slots, up to the chain's block-size-derived throughput ceiling.

## What's Missing

### Fee calibration at steady-state pricing

The fee data points used for calibration were collected when the network's dynamic pricing had decayed to its minimum floor due to sustained low utilization. The dynamic pricing mechanism adjusts fees ±4.6% per block based on block fullness, targeting 50% utilization. On a lightly used network, prices decay over time. On a busy network, they rise.

**At current network utilization, actual transaction fees are far below the calibrated values** — effectively negligible. The estimates shown in the tool reflect fees at or near the initial pricing state (overall price = 10, all dimensional factors = 1), which approximates where fees would settle during periods of moderate network activity. Actual fees will be lower during quiet periods and higher during congestion.

Accurate fee calibration at realistic demand levels requires either computing fees using the ledger API's `Transaction.fees(LedgerParameters)` method with parameters reflecting steady-state pricing, or waiting for sustained real-world demand to establish a natural price equilibrium.

### Precise proving pipeline timing

The tool uses ~22 seconds for proof generation and ~28 seconds for the full lock duration (proving + submission + block acceptance). These are observed values from testnet. The actual breakdown between proof generation, proof submission, mempool residence, block inclusion, and GRANDPA finality is not precisely characterized. The lock duration affects concurrency calculations directly — a shorter lock means fewer UTXOs needed for the same throughput.

### Per-circuit fee variation

While fee data from multiple circuit types shows fees are flat (±3%), this has only been confirmed for circuits in the k=7–13 range. Very large circuits or unusual transaction structures may exhibit different fee characteristics. The tool currently treats all proof-bearing transactions equally; future calibration against a wider range of real-world contracts would improve accuracy.

### Indexer fee computation

The network's indexer currently uses a heuristic for fee estimation that does not match the ledger's actual fee computation. The accurate method is to deserialize the transaction and ledger parameters from the block and call `Transaction.fees(LedgerParameters)`. A fix is tracked in [midnight-indexer#1026](https://github.com/midnightntwrk/midnight-indexer/issues/1026). Until this is resolved, fee data from the explorer or indexer API should not be relied upon for precise cost analysis.

## Caveats

- **Estimates, not guarantees.** The tool is a planning aid. Actual fees depend on network conditions at the time of transaction submission. Use the Midnight ledger API (`Transaction.mockProve().fees()` or `Transaction.fees()`) for precise, transaction-specific fee computation.

- **Dynamic pricing means fees change.** The network targets 50% block utilization. Below this, fees decline toward a floor. Above this, fees rise. Operators should plan for the target scenario, not the floor — the floor represents an empty network, not a healthy one.

- **DUST is a resource, not a token.** DUST cannot be transferred, traded, or stored as value. It is consumed when used and decays when disconnected from its generating NIGHT. The NIGHT Estimator models DUST as an operational resource budget, not a financial asset.

- **Concurrency is bounded by infrastructure.** Having enough DUST UTXOs is necessary but not sufficient for high throughput. Proof servers (each handling ~160 proofs/hour) and the chain's block size limit (~29 transactions per block at current average transaction sizes) impose independent ceilings.

- **NIGHT UTXO splitting has trade-offs.** Splitting NIGHT into more UTXOs increases concurrency but reduces the DUST balance per UTXO and the per-UTXO regeneration rate. Operators should balance concurrency needs against DUST sustainability per slot.