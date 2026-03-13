/**
 * NIGHT Estimator — Ledger API Fee Calculator
 * 
 * This script demonstrates how to compute exact transaction fees
 * using Midnight's ledger API without a proof server.
 * 
 * APPROACH:
 * 1. Build a transaction for your contract's entry point
 * 2. Mock-prove it (no proof server needed)
 * 3. Call transaction.fees() with current LedgerParameters
 * 4. Account for balancing overhead (inputs/outputs added for fee payment)
 * 
 * REQUIREMENTS:
 * - @midnight/ledger (v7.0.0+)
 * - Your compiled Compact contract (generates TS bindings)
 * - Node.js 18+
 * 
 * USAGE:
 *   npx ts-node fee-calculator.ts
 * 
 * For integration into a DApp, extract the calculateFee() function.
 */

import * as ledger from '@midnight/ledger';

// ─── CONSTANTS ───
const SPECKS_PER_DUST = 1_000_000_000_000_000n; // 10^15

function specksToDust(specks: bigint): number {
  return Number(specks) / Number(SPECKS_PER_DUST);
}

// ─── FEE CALCULATION ───

/**
 * Calculate the exact fee for a transaction using the ledger API.
 * 
 * For proven transactions:
 *   tx.fees(params) returns the exact fee in SPECKs.
 * 
 * For unproven transactions (before proving):
 *   Use mockProve() to get a fee-accurate mock, then call fees().
 *   mockProve() only works for transactions WITHOUT unproven contract calls.
 * 
 * For pre-balancing estimation (before DUST inputs/outputs are added):
 *   balanced_fee ≈ tx.fees(params) 
 *                  + num_new_inputs * costModel.inputFeeOverhead
 *                  + num_new_outputs * costModel.outputFeeOverhead
 * 
 * For fee with safety margin (accounts for price changes over N blocks):
 *   tx.feesWithMargin(params, margin)
 *   where margin = number of blocks (use with care — this is an exponent)
 */

interface FeeEstimate {
  feeSpecks: bigint;
  feeDust: number;
  feeWithMarginSpecks?: bigint;
  feeWithMarginDust?: number;
  // Pre-balancing overhead estimates
  estimatedInputOverhead?: bigint;
  estimatedOutputOverhead?: bigint;
  totalEstimatedSpecks?: bigint;
  totalEstimatedDust?: number;
}

/**
 * Calculate fee for a proven or mock-proven transaction.
 */
function calculateFee(
  transaction: ledger.Transaction<any, any, any>,
  params: ledger.LedgerParameters,
  options?: {
    /** Number of blocks for fee margin (default: 5) */
    feeBlocksMargin?: number;
    /** Expected number of new inputs added during balancing */
    expectedNewInputs?: number;
    /** Expected number of new outputs added during balancing */
    expectedNewOutputs?: number;
  }
): FeeEstimate {
  const margin = options?.feeBlocksMargin ?? 5;
  const newInputs = options?.expectedNewInputs ?? 1;
  const newOutputs = options?.expectedNewOutputs ?? 1;

  // Base fee from the transaction
  const feeSpecks = transaction.fees(params);
  const feeDust = specksToDust(feeSpecks);

  // Fee with margin (for fee blocks safety)
  const feeWithMarginSpecks = transaction.feesWithMargin(params, margin);
  const feeWithMarginDust = specksToDust(feeWithMarginSpecks);

  // Overhead from balancing (adding DUST inputs/outputs to pay the fee)
  const costModel = params.transactionCostModel;
  const inputOverhead = BigInt(newInputs) * costModel.inputFeeOverhead;
  const outputOverhead = BigInt(newOutputs) * costModel.outputFeeOverhead;
  const totalEstimatedSpecks = feeWithMarginSpecks + inputOverhead + outputOverhead;

  return {
    feeSpecks,
    feeDust,
    feeWithMarginSpecks,
    feeWithMarginDust,
    estimatedInputOverhead: inputOverhead,
    estimatedOutputOverhead: outputOverhead,
    totalEstimatedSpecks,
    totalEstimatedDust: specksToDust(totalEstimatedSpecks),
  };
}

// ─── EXAMPLE: Fee estimation for different transaction types ───

async function main() {
  console.log('NIGHT Estimator — Ledger API Fee Calculator\n');

  // Get initial ledger parameters (these match the on-chain config)
  const params = ledger.LedgerParameters.initialParameters();

  console.log('=== Ledger Parameters ===');
  console.log(`  Overall price: ${params.feePrices.overallPrice}`);
  console.log(`  Compute factor: ${params.feePrices.computeFactor}`);
  console.log(`  Read factor: ${params.feePrices.readFactor}`);
  console.log(`  Block usage factor: ${params.feePrices.blockUsageFactor}`);
  console.log(`  Write factor: ${params.feePrices.writeFactor}`);
  console.log(`  Input fee overhead: ${params.transactionCostModel.inputFeeOverhead} SPECKs`);
  console.log(`  Output fee overhead: ${params.transactionCostModel.outputFeeOverhead} SPECKs`);
  console.log();

  // ─── APPROACH 1: Fee from a real transaction (requires contract) ───
  //
  // If you have a compiled Compact contract with generated TS bindings:
  //
  // import { Contract } from './your-contract';
  //
  // // Build the transaction for your entry point
  // const contractApi = /* ... get your contract API ... */;
  // const txBuilder = contractApi.yourEntryPoint(args);
  // const unprovenTx = await txBuilder.build();
  //
  // // Mock-prove for fee estimation (no proof server)
  // const mockTx = unprovenTx.mockProve();
  //
  // // Calculate exact fee
  // const fee = calculateFee(mockTx, params, {
  //   feeBlocksMargin: 5,
  //   expectedNewInputs: 2,  // DUST inputs for fee payment
  //   expectedNewOutputs: 1, // Change output
  // });
  //
  // console.log(`Fee for yourEntryPoint: ${fee.totalEstimatedDust} DUST`);

  // ─── APPROACH 2: Fee from a manually constructed transaction ───
  //
  // For estimating fees without a specific contract:
  //
  // const intent = ledger.Intent.new(ttl);
  // intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(inputs, outputs, []);
  // const tx = ledger.Transaction.fromParts(networkId, undefined, undefined, intent);
  // const mockTx = tx.eraseProofs(); // or .mockProve() if applicable
  // const fee = mockTx.fees(params);

  // ─── APPROACH 3: Offline estimation from cost model parameters ───
  //
  // For quick estimates without building transactions:
  
  console.log('=== Offline Fee Estimation ===');
  console.log('(Based on preprod explorer-confirmed data + cost model)');
  console.log();
  
  const scenarios = [
    { name: 'NIGHT transfer (DUST proof only)', dustEstimate: 0.30 },
    { name: 'Light contract (k=7, 3 writes)', dustEstimate: 66.31 },
    { name: 'Medium contract (k=10, 6 writes)', dustEstimate: 69.00 },
    { name: 'Heavy contract (k=10, 13 writes)', dustEstimate: 70.42 },
  ];

  console.log('  Transaction Type                    | Est. Fee (DUST)');
  console.log('  ------------------------------------|----------------');
  for (const s of scenarios) {
    console.log(`  ${s.name.padEnd(37)} | ${s.dustEstimate.toFixed(2)}`);
  }
  
  console.log();
  console.log('=== NIGHT Requirement Quick Calc ===');
  console.log();
  
  const dustPerNight = 5;
  const timeToCapDays = 604814 / 86400; // ~7 days
  const dustPerNightPerDay = dustPerNight / timeToCapDays;
  
  const txPerDay = 400;
  const dustPerTx = 69; // Medium contract
  const dailyBurn = txPerDay * dustPerTx;
  const minNight = Math.ceil(dailyBurn / dustPerNightPerDay);
  
  console.log(`  Daily TXs: ${txPerDay}`);
  console.log(`  Fee/TX: ~${dustPerTx} DUST`);
  console.log(`  Daily burn: ${dailyBurn.toLocaleString()} DUST`);
  console.log(`  DUST/NIGHT/day: ${dustPerNightPerDay.toFixed(4)}`);
  console.log(`  Minimum NIGHT needed: ${minNight.toLocaleString()}`);
  console.log(`  Recommended (+25%): ${Math.ceil(minNight * 1.25).toLocaleString()}`);
}

main().catch(console.error);

// ─── EXPORT for use as a module ───
export { calculateFee, specksToDust, FeeEstimate };
