/**
 * Fee Estimator for Election Contract
 * 
 * Place in: contract/src/estimate-fees.ts
 * Run with: npx tsx src/estimate-fees.ts
 */

import {
  type CircuitContext,
  type WitnessContext,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext,
} from "@midnight-ntwrk/compact-runtime";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

import {
  Contract,
  type Ledger,
  type Witnesses,
  ledger,
} from "./managed/election/contract/index.js";

// ─── Constants ───
const SPECKS_PER_DUST = 1_000_000_000_000_000n;

// ─── Private State ───
interface ElectionPrivateState {
  secretKey: Uint8Array;
  state: "initial" | "committed" | "revealed";
  vote: "yes" | "no" | null;
}

function createInitialPrivateState(): ElectionPrivateState {
  // 32 bytes of 0xAA — dummy key for fee estimation
  return {
    secretKey: new Uint8Array(32).fill(0xAA),
    state: "initial",
    vote: null,
  };
}

// ─── Witnesses ───
// Each witness returns a tuple: [newPrivateState, returnValue]
// Bytes<32> in Compact = Uint8Array in TypeScript

const witnesses: Witnesses<ElectionPrivateState> = {
  private$secret_key: (
    context: WitnessContext<Ledger, ElectionPrivateState>
  ): [ElectionPrivateState, Uint8Array] => {
    return [context.privateState, context.privateState.secretKey];
  },

  private$state: (
    context: WitnessContext<Ledger, ElectionPrivateState>
  ): [ElectionPrivateState, string] => {
    return [context.privateState, context.privateState.state];
  },

  private$state$advance: (
    context: WitnessContext<Ledger, ElectionPrivateState>
  ): [ElectionPrivateState, []] => {
    const newState = { ...context.privateState };
    if (newState.state === "initial") newState.state = "committed";
    else if (newState.state === "committed") newState.state = "revealed";
    return [newState, []];
  },

  private$vote$record: (
    context: WitnessContext<Ledger, ElectionPrivateState>,
    ballot: any
  ): [ElectionPrivateState, []] => {
    const newState = { ...context.privateState };
    newState.vote = ballot;
    return [newState, []];
  },

  private$vote: (
    context: WitnessContext<Ledger, ElectionPrivateState>
  ): [ElectionPrivateState, string] => {
    return [context.privateState, context.privateState.vote ?? "yes"];
  },

  context$eligible_voters$path_of: (
    context: WitnessContext<Ledger, ElectionPrivateState>,
    _pk: Uint8Array
  ): [ElectionPrivateState, { is_some: boolean }] => {
    // For fee estimation, return none — vote$commit will fail assertion
    // but simpler circuits (set_topic, add_voter, advance) will work
    return [context.privateState, { is_some: false }];
  },

  context$committed_votes$path_of: (
    context: WitnessContext<Ledger, ElectionPrivateState>,
    _cm: Uint8Array
  ): [ElectionPrivateState, { is_some: boolean }] => {
    return [context.privateState, { is_some: false }];
  },
};

// ─── Simulator ───
class ElectionSimulator {
  readonly contract: Contract<ElectionPrivateState>;
  circuitContext: CircuitContext<ElectionPrivateState>;

  constructor() {
    this.contract = new Contract<ElectionPrivateState>(witnesses);

    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(createInitialPrivateState(), "0".repeat(64))
      );

    this.circuitContext = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState
    );
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  run(circuitName: string, ...args: any[]) {
    try {
      const circuit = (this.contract.impureCircuits as any)[circuitName];
      if (!circuit) return { success: false, error: `Circuit '${circuitName}' not found` };
      const result = circuit(this.circuitContext, ...args);
      this.circuitContext = result.context;
      return { success: true, result };
    } catch (e: any) {
      return { success: false, error: e.message?.slice(0, 120) };
    }
  }
}

// ─── Main ───
async function main() {
  setNetworkId("undeployed");

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Election Contract — Fee Estimator                      ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // Circuit info from: npm run compact
  const circuits = [
    { name: "set_topic",     k: 13, rows: 4184,  writes: 1, desc: "topic.write()" },
    { name: "add_voter",     k: 13, rows: 6751,  writes: 1, desc: "eligible_voters.insert()" },
    { name: "advance",       k: 13, rows: 4192,  writes: 1, desc: "state.write()" },
    { name: "vote$commit",   k: 15, rows: 16593, writes: 3, desc: "MerkleTree + Set inserts" },
    { name: "vote$reveal",   k: 14, rows: 10737, writes: 3, desc: "tally + Set insert" },
  ];

  console.log("Circuit Complexity (from compiler output):");
  console.log("  ┌─────────────────┬──────┬────────┬────────┐");
  console.log("  │ Circuit         │  k   │  Rows  │ Writes │");
  console.log("  ├─────────────────┼──────┼────────┼────────┤");
  for (const c of circuits) {
    console.log(`  │ ${c.name.padEnd(15)} │ ${String(c.k).padStart(4)} │ ${String(c.rows).padStart(6)} │ ${String(c.writes).padStart(6)} │`);
  }
  console.log("  └─────────────────┴──────┴────────┴────────┘\n");

  // Execute circuits through simulator
  console.log("Simulating circuits...\n");
  const sim = new ElectionSimulator();

  // set_topic (state == setup, caller == authority)
  const r1 = sim.run("set_topic", "Should we upgrade the protocol?");
  console.log(`  set_topic:    ${r1.success ? "✓" : "✗ " + r1.error}`);

  // add_voter (state == setup, caller == authority)
  const voterPk = new Uint8Array(32).fill(0xBB);
  const r2 = sim.run("add_voter", voterPk);
  console.log(`  add_voter:    ${r2.success ? "✓" : "✗ " + r2.error}`);

  // advance (state: setup → commit)
  const r3 = sim.run("advance");
  console.log(`  advance:      ${r3.success ? "✓" : "✗ " + r3.error}`);

  // vote$commit (needs valid Merkle path — will likely fail)
  const r4 = sim.run("vote$commit", "yes");
  console.log(`  vote$commit:  ${r4.success ? "✓" : "✗ " + r4.error}`);

  // vote$reveal (needs committed state — will likely fail)
  const r5 = sim.run("vote$reveal");
  console.log(`  vote$reveal:  ${r5.success ? "✓" : "✗ " + r5.error}`);

  console.log();

  // ─── Fee Estimates ───
  // Model calibrated from preprod explorer (poker circuits k=7-12):
  //   Fees are ~66-70 DUST regardless of k or writes
  //   Base ~67 DUST + ~0.41/write
  // Election circuits at k=13-15 are larger — conservative 3%/k-level above 12
  const estimateFee = (k: number, writes: number): number => {
    const base = 67.0 + 0.41 * writes;
    const kAdj = k > 12 ? 1 + 0.03 * (k - 12) : 1;
    return base * kAdj;
  };

  console.log("═══════════════════════════════════════════════════════════");
  console.log("Estimated Fees (floor pricing)\n");
  console.log("  ┌─────────────────┬──────┬────────┬───────────┬──────────────────────────┐");
  console.log("  │ Circuit         │  k   │ Writes │  Fee DUST │ Notes                    │");
  console.log("  ├─────────────────┼──────┼────────┼───────────┼──────────────────────────┤");
  for (const c of circuits) {
    const fee = estimateFee(c.k, c.writes);
    console.log(
      `  │ ${c.name.padEnd(15)} │ ${String(c.k).padStart(4)} │ ${String(c.writes).padStart(6)} │ ${("~" + fee.toFixed(1)).padStart(9)} │ ${c.desc.padEnd(24)} │`
    );
  }
  console.log("  └─────────────────┴──────┴────────┴───────────┴──────────────────────────┘");
  console.log();
  console.log("  * Calibrated from poker circuits (k=7-12): ~66-70 DUST flat");
  console.log("  * k=13-15 adjustment: +3% per k-level above 12 (conservative)");
  console.log("  * For exact fees: deploy to preprod or use Transaction.mockProve().fees()");

  // ─── NIGHT Budget ───
  const DUST_PER_NIGHT = 5;
  const DUST_PER_NIGHT_PER_DAY = DUST_PER_NIGHT / (604814 / 86400);
  const avgFee = circuits.reduce((sum, c) => sum + estimateFee(c.k, c.writes), 0) / circuits.length;

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("NIGHT Budget Scenarios\n");
  console.log(`  Avg fee across circuits: ~${avgFee.toFixed(1)} DUST/TX`);
  console.log(`  DUST generation rate: ${DUST_PER_NIGHT_PER_DAY.toFixed(4)} DUST/NIGHT/day\n`);

  const scenarios = [
    { name: "Small (50 voters)",    voters: 50,  days: 7  },
    { name: "Medium (500 voters)",  voters: 500, days: 14 },
    { name: "Large (5000 voters)",  voters: 5000, days: 30 },
  ];

  for (const s of scenarios) {
    // TXs: set_topic(1) + add_voter(voters) + advance(3) + vote$commit(voters) + vote$reveal(voters)
    const totalTxs = 1 + s.voters + 3 + s.voters + s.voters;
    const totalDust = totalTxs * avgFee;
    const dailyDust = totalDust / s.days;
    const nightNeeded = Math.ceil(dailyDust / DUST_PER_NIGHT_PER_DAY);
    const nightWithBuffer = Math.ceil(nightNeeded * 1.25);

    console.log(`  ${s.name} over ${s.days} days:`);
    console.log(`    Total TXs:    ${totalTxs.toLocaleString()}`);
    console.log(`    Total DUST:   ${totalDust.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} DUST`);
    console.log(`    Daily burn:   ${dailyDust.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} DUST/day`);
    console.log(`    Min NIGHT:    ${nightNeeded.toLocaleString()}`);
    console.log(`    Rec (+25%):   ${nightWithBuffer.toLocaleString()} NIGHT`);
    console.log();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
