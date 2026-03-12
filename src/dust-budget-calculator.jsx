import { useState, useMemo, useCallback } from "react";

// ─── Protocol Constants (from dust_params.pdf) ───
const DUST_PER_NIGHT = 5;
const TIME_TO_CAP_SECONDS = 604814; // ~7 days
const SPECKS_PER_DUST = 1e15;
const STARS_PER_NIGHT = 1e6;
const GEN_RATE_SPECK_PER_STAR_PER_SEC = 8267;
const DUST_PER_NIGHT_PER_DAY = DUST_PER_NIGHT / (TIME_TO_CAP_SECONDS / 86400);
const BLOCK_TIME_SEC = 6;
const BLOCKS_PER_DAY = Math.floor(86400 / BLOCK_TIME_SEC);

// Initial pricing state
const INITIAL_OVERALL_PRICE = 10;

// Price adjustment
const MAX_ADJUSTMENT = 0.04595;
const SENSITIVITY_A = 100;

// ─── TESTNET CALIBRATION (Dominion Poker, preprod, 231 games, 3624 TXs) ───
// 300T per TX = total observed fee at floor congestion (near-empty blocks)
// Confirmed: 15.7 TXs × 300T = 4,710T = 4.71Q matches reported per-game cost exactly
// Fee is flat across all circuit types at floor (13-write deck commit = 3-write fold = 300T)
// Under congestion, dynamic pricing scales fees above this floor
const OBSERVED_FLOOR_FEE = 0.3; // 300T in DUST units

// ─── Fee Engine ───
function simulatePriceEvolution(startPrice, fullness, numBlocks) {
  let price = startPrice;
  const u = Math.max(fullness, 0.01);
  const rawA = -Math.log((1 / u) - 0.99) / SENSITIVITY_A;
  const adjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, rawA));
  for (let i = 0; i < numBlocks; i++) {
    price = Math.max(price * (1 + adjustment), 0.0001);
  }
  return price;
}

// ─── DApp Profile Presets ───
const DAPP_PROFILES = {
  custom: {
    label: "Custom",
    description: "Define your own transaction pattern",
    txPerAction: 5, actionsPerDay: 200, dustPerTx: OBSERVED_FLOOR_FEE,
  },
  pokerTable: {
    label: "Poker Table (2P)",
    description: "Calibrated from Dominion Poker testnet: ~15.7 TXs/game, ~4.8 games/hr. Real preprod data from 231 games.",
    txPerAction: 15.7, actionsPerDay: 115, dustPerTx: OBSERVED_FLOOR_FEE, badge: "TESTNET",
  },
  pokerTable6P: {
    label: "Poker Table (6P est.)",
    description: "Estimated 6-player scaling: ~40-50 TXs/game, ~2-3 games/hr. Extrapolated from 2P testnet data.",
    txPerAction: 45, actionsPerDay: 60, dustPerTx: OBSERVED_FLOOR_FEE, badge: "EST",
  },
  lightDApp: {
    label: "Light DApp",
    description: "Simple interactions — token transfers, basic state reads. ~1-3 TXs per user action.",
    txPerAction: 2, actionsPerDay: 500, dustPerTx: OBSERVED_FLOOR_FEE,
  },
  mediumDApp: {
    label: "Medium DApp",
    description: "DEX trades, lending, multi-step workflows. ~3-8 TXs per user action.",
    txPerAction: 5, actionsPerDay: 200, dustPerTx: OBSERVED_FLOOR_FEE,
  },
  heavyDApp: {
    label: "Heavy DApp",
    description: "Complex contract interactions, multi-party proofs, heavy state updates. ~10-20 TXs per action.",
    txPerAction: 15, actionsPerDay: 50, dustPerTx: OBSERVED_FLOOR_FEE,
  },
};

const CONGESTION = {
  floor: { label: "Floor (current)", fullness: 0.05, blocksToSimulate: 0, description: "Near-empty blocks — flat fee regime (testnet-observed)" },
  low: { label: "Low (~25%)", fullness: 0.25, blocksToSimulate: 500, description: "Light usage, fees declining toward floor" },
  target: { label: "Target (~50%)", fullness: 0.5, blocksToSimulate: 1000, description: "Network at equilibrium target" },
  high: { label: "High (~75%)", fullness: 0.75, blocksToSimulate: 1000, description: "Sustained above target — fees rising" },
  spike: { label: "Spike (~90%)", fullness: 0.9, blocksToSimulate: 500, description: "Short congestion burst — aggressive fee increase" },
};

// ─── UI ───
function NumberInput({ label, value, onChange, unit, min = 0, step = 1, helpText }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: "var(--label)" }}>{label}</label>
        {unit && <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>{unit}</span>}
      </div>
      {helpText && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{helpText}</div>}
      <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min} step={step} style={{
          width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6,
          fontSize: 14, fontFamily: "'JetBrains Mono', monospace",
          background: "var(--input-bg)", color: "var(--text)", boxSizing: "border-box",
        }} />
    </div>
  );
}

function StatCard({ label, value, subtext, accent, warn, mini }) {
  const bg = warn ? "var(--warn-bg)" : accent ? "var(--accent-bg)" : "var(--card-bg)";
  const brd = warn ? "var(--warn-border)" : accent ? "var(--accent-border)" : "var(--border)";
  const clr = warn ? "var(--warn-text)" : accent ? "var(--accent-text)" : "var(--text)";
  return (
    <div style={{
      padding: mini ? "10px 12px" : "14px 16px", borderRadius: 10,
      background: bg, border: `1px solid ${brd}`, flex: 1, minWidth: mini ? 130 : 160,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: mini ? 4 : 6 }}>{label}</div>
      <div style={{ fontSize: mini ? 17 : 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: clr }}>{value}</div>
      {subtext && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{subtext}</div>}
    </div>
  );
}

function PillSelect({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((opt) => (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{
          padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer", transition: "all 0.15s",
          border: value === opt.value ? "2px solid var(--accent-border)" : "1px solid var(--border)",
          background: value === opt.value ? "var(--accent-bg)" : "transparent",
          color: value === opt.value ? "var(--accent-text)" : "var(--text)",
          fontWeight: value === opt.value ? 600 : 400, position: "relative",
        }}>
          {opt.badge && <span style={{
            position: "absolute", top: -6, right: -4, fontSize: 8, fontWeight: 700,
            background: opt.badge === "TESTNET" ? "var(--accent-border)" : "var(--warn-border)",
            color: "#fff", padding: "1px 5px", borderRadius: 6,
          }}>{opt.badge}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main ───
export default function DustBudgetCalculator() {
  const [profileKey, setProfileKey] = useState("pokerTable");
  const [customTx, setCustomTx] = useState(5);
  const [customActions, setCustomActions] = useState(200);
  const [customDust, setCustomDust] = useState(OBSERVED_FLOOR_FEE);
  const [congestionKey, setCongestionKey] = useState("floor");
  const [bufferPct, setBufferPct] = useState(25);

  const profile = DAPP_PROFILES[profileKey];
  const congestion = CONGESTION[congestionKey];
  const txPerAction = profileKey === "custom" ? customTx : profile.txPerAction;
  const actionsPerDay = profileKey === "custom" ? customActions : profile.actionsPerDay;
  const baseDust = profileKey === "custom" ? customDust : profile.dustPerTx;

  const results = useMemo(() => {
    const dailyTxCount = txPerAction * actionsPerDay;

    // Fee = 0.3 DUST total per TX at floor (300T observed on preprod, includes overhead + variable)
    // The 300T "fee overhead" described in the report IS the total fee at near-empty blocks.
    // This is confirmed: 15.7 TXs × 300T = 4,710T = 4.71Q matches exactly the reported per-game cost.
    // Under congestion, the pricing engine scales fees above this floor.
    const FLOOR_FEE = 0.3; // Total fee per TX at floor congestion (confirmed from testnet)

    let effectiveDust = FLOOR_FEE;
    let priceMultiplier = 1;
    if (congestionKey !== "floor") {
      const evolved = simulatePriceEvolution(INITIAL_OVERALL_PRICE, congestion.fullness, congestion.blocksToSimulate);
      priceMultiplier = evolved / INITIAL_OVERALL_PRICE;
      // Under congestion, variable costs from the pricing engine scale the fee above the floor
      effectiveDust = FLOOR_FEE * Math.max(1, priceMultiplier);
    }

    const dailyBurn = effectiveDust * dailyTxCount;
    const weeklyBurn = dailyBurn * 7;
    const monthlyBurn = dailyBurn * 30;
    const nightFlow = dailyBurn / DUST_PER_NIGHT_PER_DAY;
    const nightCap = weeklyBurn / DUST_PER_NIGHT;
    const minNight = Math.max(nightFlow, nightCap);
    const recNight = minNight * (1 + bufferPct / 100);
    const capDust = recNight * DUST_PER_NIGHT;
    const dailyRegen = recNight * DUST_PER_NIGHT_PER_DAY;
    return {
      dailyTxCount, effectiveDust, floorFee: FLOOR_FEE,
      dailyBurn, weeklyBurn, monthlyBurn,
      nightFlow, nightCap, minNight, recNight,
      congMult: effectiveDust / FLOOR_FEE, priceMultiplier,
      capDust, runwayDays: capDust / dailyBurn,
      regenRatio: dailyRegen / dailyBurn,
      dailyRegen, binding: nightFlow >= nightCap ? "Generation rate" : "DUST cap",
    };
  }, [txPerAction, actionsPerDay, baseDust, congestionKey, congestion, bufferPct]);

  const fmt = (n, d = 2) => {
    if (n === 0) return "0";
    if (n < 0.001) return n.toExponential(2);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: d });
    return n.toFixed(d);
  };
  const fmtI = (n) => Math.ceil(n).toLocaleString();

  return (
    <div style={{
      "--text": "#E8E6E3", "--label": "#B0ADA8", "--muted": "#7A7672",
      "--bg": "#1A1917", "--card-bg": "#232220", "--input-bg": "#1E1D1B",
      "--border": "#3A3835", "--accent-bg": "#1B2A1F", "--accent-border": "#2D5A3A",
      "--accent-text": "#6BCB7F", "--warn-bg": "#2A1F1B", "--warn-border": "#5A3A2D",
      "--warn-text": "#E8944A", "--section-border": "#2A2826",
      "--testnet-bg": "#1B1F2A", "--testnet-border": "#2D3A5A", "--testnet-text": "#7BA4E8",
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      color: "var(--text)", background: "var(--bg)",
      minHeight: "100vh", padding: "24px 20px", maxWidth: 740, margin: "0 auto",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>◑</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>DUST Budget Calculator</h1>
          <span style={{ fontSize: 10, fontWeight: 600, background: "var(--testnet-border)", color: "#fff", padding: "2px 8px", borderRadius: 10 }}>v0.3</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
          Estimate NIGHT holdings to sustain DApp operations on Midnight.
        </p>
      </div>

      {/* Testnet banner */}
      <div style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 24, background: "var(--testnet-bg)", border: "1px solid var(--testnet-border)" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--testnet-text)", marginBottom: 4 }}>
          Calibrated with preprod testnet data
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--testnet-text)" }}>0.3 DUST total per TX at floor pricing</strong> (300T — confirmed flat across all circuit types at near-empty blocks). Under congestion, dynamic pricing scales fees above this floor. The 300T includes both the UTXO overhead and variable cost model components, which are negligible when blocks are near-empty.
          <br/><span style={{ fontStyle: "italic" }}>Source: 3,624 TXs across 231 games, Dominion Poker, Midnight preprod.</span>
        </div>
      </div>

      {/* 1: DApp Profile */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>1 — DApp Profile</h2>
        <PillSelect options={Object.entries(DAPP_PROFILES).map(([k, v]) => ({ value: k, label: v.label, badge: v.badge }))} value={profileKey} onChange={setProfileKey} />
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0", fontStyle: "italic" }}>{profile.description}</p>
        {profileKey === "custom" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px 16px", marginTop: 14 }}>
            <NumberInput label="TXs per action" value={customTx} onChange={setCustomTx} step={1} helpText="On-chain TXs per operation" />
            <NumberInput label="Actions / day" value={customActions} onChange={setCustomActions} step={10} helpText="Total daily actions" />
            <NumberInput label="DUST / TX" value={customDust} onChange={setCustomDust} unit="DUST" step={0.01} helpText="0.3 fixed overhead + variable" />
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <StatCard mini label="TXs / action" value={txPerAction} />
            <StatCard mini label="Actions / day" value={actionsPerDay} />
            <StatCard mini label="Daily TXs" value={fmtI(txPerAction * actionsPerDay)} />
            <StatCard mini label="DUST / TX" value={`${baseDust}`} subtext="overhead (floor)" />
          </div>
        )}
      </section>

      {/* 2: Network Conditions */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>2 — Network Conditions</h2>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--label)", marginBottom: 8 }}>Congestion scenario</div>
          <PillSelect options={Object.entries(CONGESTION).map(([k, v]) => ({ value: k, label: v.label }))} value={congestionKey} onChange={setCongestionKey} />
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>{congestion.description}</p>
        </div>
        <div style={{ maxWidth: 200 }}>
          <NumberInput label="Safety buffer" value={bufferPct} onChange={setBufferPct} unit="%" min={0} max={200} step={5} helpText="Headroom above minimum" />
        </div>
      </section>

      {/* 3: DUST Burn */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>3 — DUST Burn Rate</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <StatCard label="Fee / TX" value={`${fmt(results.effectiveDust)} DUST`}
            subtext={results.congMult > 1
              ? `${results.congMult.toFixed(1)}× floor (price multiplier: ${results.priceMultiplier.toFixed(2)}×)`
              : "At floor pricing (testnet-confirmed)"}
            warn={results.congMult > 2} />
          <StatCard label="Daily burn" value={`${fmt(results.dailyBurn)} DUST`} subtext={`${fmtI(results.dailyTxCount)} TXs/day`} />
        </div>
        {results.congMult > 1 && (
          <div style={{ fontSize: 11, color: "var(--warn-text)", marginBottom: 12, padding: "8px 12px", borderRadius: 6, background: "var(--warn-bg)", border: "1px solid var(--warn-border)" }}>
            Congestion scales fees from {fmt(results.floorFee)} → {fmt(results.effectiveDust)} DUST/TX. Dynamic pricing adjusts ±4.6% per block (every 6s). Sustained {(congestion.fullness * 100).toFixed(0)}% utilization over {congestion.blocksToSimulate} blocks.
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatCard mini label="Weekly" value={`${fmt(results.weeklyBurn)} DUST`} />
          <StatCard mini label="Monthly" value={`${fmt(results.monthlyBurn)} DUST`} />
        </div>
      </section>

      {/* 4: NIGHT Requirement */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>4 — NIGHT Holdings Required</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <StatCard label="Minimum NIGHT" value={fmtI(results.minNight)} subtext={`Binding: ${results.binding}`} />
          <StatCard label={`Recommended (+${bufferPct}%)`} value={fmtI(results.recNight)} subtext="With safety margin" accent />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <StatCard mini label="Regen / burn"
            value={`${results.regenRatio.toFixed(1)}×`}
            subtext={results.regenRatio >= 1 ? "Self-sustaining" : "Deficit — increase NIGHT"}
            accent={results.regenRatio >= 1} warn={results.regenRatio < 1} />
          <StatCard mini label="DUST cap (battery)"
            value={`${fmt(results.capDust)} DUST`}
            subtext={`${fmt(results.runwayDays)} day runway if regen stopped`} />
        </div>

        {/* Breakdown box */}
        <div style={{
          padding: "12px 16px", borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: "var(--label)",
          background: results.regenRatio >= 1.5 ? "var(--accent-bg)" : results.regenRatio >= 1 ? "var(--card-bg)" : "var(--warn-bg)",
          border: `1px solid ${results.regenRatio >= 1.5 ? "var(--accent-border)" : results.regenRatio >= 1 ? "var(--border)" : "var(--warn-border)"}`,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--text)", fontSize: 13 }}>
            {results.regenRatio >= 1.5 ? "Comfortably self-sustaining" : results.regenRatio >= 1 ? "Self-sustaining (tight)" : "Burns faster than regen — increase NIGHT holdings"}
          </div>
          <div><strong>Generation:</strong> 1 NIGHT → {DUST_PER_NIGHT} DUST / ~7 days ({DUST_PER_NIGHT_PER_DAY.toFixed(4)} DUST/NIGHT/day)</div>
          <div><strong>Your daily regen:</strong> {fmt(results.dailyRegen)} DUST from {fmtI(results.recNight)} NIGHT</div>
          <div><strong>Your daily burn:</strong> {fmt(results.dailyBurn)} DUST ({fmtI(results.dailyTxCount)} TXs × {fmt(results.effectiveDust)} DUST)</div>
          <div><strong>Net:</strong> {results.regenRatio >= 1 ? "+" : ""}{fmt(results.dailyRegen - results.dailyBurn)} DUST/day {results.regenRatio >= 1 ? "(surplus)" : "(deficit)"}</div>
        </div>
      </section>

      {/* Testnet comparison (poker profiles only) */}
      {(profileKey === "pokerTable" || profileKey === "pokerTable6P") && (
        <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--testnet-text)", marginBottom: 14 }}>Testnet Reference</h2>
          <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--testnet-bg)", border: "1px solid var(--testnet-border)", fontSize: 12, lineHeight: 1.8, color: "var(--label)" }}>
            <div><strong style={{ color: "var(--testnet-text)" }}>Observed (2P, preprod):</strong> ~4,000 tNIGHT total (2,000/agent) sustained 231 games / 48.5 hrs</div>
            <div>Avg game cost: 4.7 DUST (15.7 TXs × 0.3 DUST) — regen outpaced burn 3.6×</div>
            <div>DUST pool grew +1,812 DUST over longest session (110 games, 23 hrs)</div>
            <div>Real bottleneck: proof server (~22s/proof, ~160 proofs/hr capacity)</div>
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
              Testnet values (2,000 tNIGHT/agent = 2B STAR). Mainnet NIGHT requirements depend on launch pricing state.
            </div>
          </div>
        </section>
      )}

      {/* Planning Considerations */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>Planning Notes</h2>
        <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.7, color: "var(--label)" }}>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>DUST cap = battery size.</strong> Cap is {DUST_PER_NIGHT} DUST per NIGHT. Burst usage beyond your cap causes temporary shortfalls until regen catches up.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Redesignation lag.</strong> Transferring NIGHT or changing DUST target triggers decay on the old address + ~7-day regen on the new one (3-hour grace period before decay starts).</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Congestion is fast and symmetric.</strong> ±4.6% per block (every 6s). 90% fullness roughly doubles fees in ~96 seconds — but cools equally fast.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Proof server may be your real bottleneck.</strong> ~22s per ZK proof on testnet = ~160 proofs/hr per server. Multi-table DApps need horizontal proving infrastructure.</div>
          <div><strong style={{ color: "var(--text)" }}>Sponsorship model.</strong> If your DApp covers user TX fees, all DUST burns from your designated address. Budget for total user volume.</div>
        </div>
      </section>

      {/* Protocol Params */}
      <section style={{ padding: "14px 16px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--label)", fontSize: 12 }}>Protocol Parameters</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 24px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
          <div>block_time: {BLOCK_TIME_SEC}s ({BLOCKS_PER_DAY.toLocaleString()} blk/day)</div>
          <div>dust_per_night: {DUST_PER_NIGHT} / ~7d</div>
          <div>overall_price_init: {INITIAL_OVERALL_PRICE}</div>
          <div>target_fullness: 50%</div>
          <div>floor_fee: 0.3 DUST/TX (300T)</div>
          <div>price_adjust: ±4.595%/blk</div>
          <div>compute_limit: 1s/blk</div>
          <div>block_usage: 200KB/blk</div>
        </div>
      </section>

      <div style={{ textAlign: "center", fontSize: 10, color: "var(--muted)", marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--section-border)" }}>
        DUST Budget Calculator v0.3 — Fixed overhead (300T) + variable congestion model — Not financial advice
      </div>
    </div>
  );
}
