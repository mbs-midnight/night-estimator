import { useState, useMemo } from "react";

// ─── Protocol Constants (from dust_params.pdf) ───
const DUST_PER_NIGHT = 5;
const TIME_TO_CAP_SECONDS = 604814; // ~7 days
const DUST_PER_NIGHT_PER_DAY = DUST_PER_NIGHT / (TIME_TO_CAP_SECONDS / 86400);
const BLOCK_TIME_SEC = 6;
const BLOCKS_PER_DAY = Math.floor(86400 / BLOCK_TIME_SEC);
const INITIAL_OVERALL_PRICE = 10;
const MAX_ADJUSTMENT = 0.04595;
const SENSITIVITY_A = 100;

// ─── TESTNET CALIBRATION (Dominion Poker, preprod, CORRECTED) ───
// Original report used 300T (client-side additionalFeeOverhead) — WRONG
// Corrected: explorer-observed fee for post_big_blind (6 writes) = ~69Q = 69 DUST
// Fee varies by circuit (ledger writes, proof size, UTXO structure)
// ~69 DUST is a mid-range data point; 3-write circuits likely cheaper, 13-write likely more
// Regen/burn ratio: ~1.015× (thin margin), NOT 3.6× as originally reported
const OBSERVED_FEE_PER_TX = 69; // DUST — explorer-confirmed, mid-range circuit (6 writes)

// ─── Fee Engine ───
function simulatePriceEvolution(startPrice, fullness, numBlocks) {
  let price = startPrice;
  const u = Math.max(fullness, 0.01);
  const rawA = -Math.log((1 / u) - 0.99) / SENSITIVITY_A;
  const adj = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, rawA));
  for (let i = 0; i < numBlocks; i++) price = Math.max(price * (1 + adj), 0.0001);
  return price;
}

// ─── DApp Profiles ───
const PROFILES = {
  custom: {
    label: "Custom", description: "Define your own transaction pattern",
    txPerAction: 5, actionsPerDay: 200, dustPerTx: OBSERVED_FEE_PER_TX,
  },
  pokerTable: {
    label: "Poker (2P)",
    description: "From Dominion Poker preprod (corrected): ~15.7 TXs/game, ~4.8 games/hr, ~69 DUST/TX. Regen/burn margin is thin (~1.5%).",
    txPerAction: 15.7, actionsPerDay: 115, dustPerTx: OBSERVED_FEE_PER_TX, badge: "TESTNET",
  },
  pokerTable6P: {
    label: "Poker (6P est.)",
    description: "6-player estimate: ~45 TXs/game, ~2.5 games/hr. Would need ~5-10× more NIGHT per agent than 2P.",
    txPerAction: 45, actionsPerDay: 60, dustPerTx: OBSERVED_FEE_PER_TX, badge: "EST",
  },
  lightDApp: {
    label: "Light DApp",
    description: "Token transfers, basic reads. ~1-3 TXs per action. Fee may be lower than 69 DUST for simpler circuits.",
    txPerAction: 2, actionsPerDay: 500, dustPerTx: OBSERVED_FEE_PER_TX,
  },
  mediumDApp: {
    label: "Medium DApp",
    description: "DEX trades, lending, multi-step flows. ~3-8 TXs per action.",
    txPerAction: 5, actionsPerDay: 200, dustPerTx: OBSERVED_FEE_PER_TX,
  },
  heavyDApp: {
    label: "Heavy DApp",
    description: "Complex contracts, multi-party proofs, heavy state updates. ~10-20 TXs per action. Fee per TX may exceed 69 DUST for write-heavy circuits.",
    txPerAction: 15, actionsPerDay: 50, dustPerTx: OBSERVED_FEE_PER_TX,
  },
};

const CONGESTION = {
  floor: { label: "Floor (current)", fullness: 0.05, blocks: 0, desc: "Near-empty blocks — preprod baseline" },
  low: { label: "Low (~25%)", fullness: 0.25, blocks: 500, desc: "Light usage, fees near floor" },
  target: { label: "Target (~50%)", fullness: 0.5, blocks: 1000, desc: "Network at equilibrium" },
  high: { label: "High (~75%)", fullness: 0.75, blocks: 1000, desc: "Sustained above target — fees rising" },
  spike: { label: "Spike (~90%)", fullness: 0.9, blocks: 500, desc: "Congestion burst" },
};

// ─── UI Components ───
function NumInput({ label, value, onChange, unit, min = 0, step = 1, help }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: "var(--label)" }}>{label}</label>
        {unit && <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>{unit}</span>}
      </div>
      {help && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{help}</div>}
      <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        min={min} step={step} style={{
          width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6,
          fontSize: 14, fontFamily: "var(--mono)", background: "var(--input-bg)", color: "var(--text)", boxSizing: "border-box",
        }} />
    </div>
  );
}

function Stat({ label, value, sub, accent, warn, mini }) {
  const bg = warn ? "var(--warn-bg)" : accent ? "var(--accent-bg)" : "var(--card-bg)";
  const brd = warn ? "var(--warn-border)" : accent ? "var(--accent-border)" : "var(--border)";
  const clr = warn ? "var(--warn-text)" : accent ? "var(--accent-text)" : "var(--text)";
  return (
    <div style={{ padding: mini ? "10px 12px" : "14px 16px", borderRadius: 10, background: bg, border: `1px solid ${brd}`, flex: 1, minWidth: mini ? 130 : 160 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: mini ? 4 : 6 }}>{label}</div>
      <div style={{ fontSize: mini ? 17 : 22, fontWeight: 700, fontFamily: "var(--mono)", color: clr }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Pills({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer", transition: "all 0.15s",
          border: value === o.value ? "2px solid var(--accent-border)" : "1px solid var(--border)",
          background: value === o.value ? "var(--accent-bg)" : "transparent",
          color: value === o.value ? "var(--accent-text)" : "var(--text)",
          fontWeight: value === o.value ? 600 : 400, position: "relative",
        }}>
          {o.badge && <span style={{
            position: "absolute", top: -6, right: -4, fontSize: 8, fontWeight: 700,
            background: o.badge === "TESTNET" ? "var(--accent-border)" : "var(--warn-border)",
            color: "#fff", padding: "1px 5px", borderRadius: 6,
          }}>{o.badge}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main ───
export default function DustBudgetCalculator() {
  const [pk, setPk] = useState("pokerTable");
  const [cTx, setCTx] = useState(5);
  const [cAct, setCAct] = useState(200);
  const [cDust, setCDust] = useState(OBSERVED_FEE_PER_TX);
  const [ck, setCk] = useState("floor");
  const [buf, setBuf] = useState(25);

  const p = PROFILES[pk];
  const cong = CONGESTION[ck];
  const txPer = pk === "custom" ? cTx : p.txPerAction;
  const actDay = pk === "custom" ? cAct : p.actionsPerDay;
  const baseFee = pk === "custom" ? cDust : p.dustPerTx;

  const r = useMemo(() => {
    const dailyTx = txPer * actDay;
    let fee = baseFee;
    let priceMult = 1;
    if (ck !== "floor") {
      const evolved = simulatePriceEvolution(INITIAL_OVERALL_PRICE, cong.fullness, cong.blocks);
      priceMult = evolved / INITIAL_OVERALL_PRICE;
      fee = baseFee * Math.max(1, priceMult);
    }
    const dBurn = fee * dailyTx;
    const wBurn = dBurn * 7;
    const mBurn = dBurn * 30;
    const nFlow = dBurn / DUST_PER_NIGHT_PER_DAY;
    const nCap = wBurn / DUST_PER_NIGHT;
    const minN = Math.max(nFlow, nCap);
    const recN = minN * (1 + buf / 100);
    const cap = recN * DUST_PER_NIGHT;
    const dRegen = recN * DUST_PER_NIGHT_PER_DAY;
    return {
      dailyTx, fee, dBurn, wBurn, mBurn, nFlow, nCap, minN, recN,
      congMult: fee / baseFee, priceMult, cap,
      runway: cap / dBurn, ratio: dRegen / dBurn, dRegen,
      bind: nFlow >= nCap ? "Generation rate" : "DUST cap",
    };
  }, [txPer, actDay, baseFee, ck, cong, buf]);

  const f = (n, d = 2) => {
    if (n === 0) return "0";
    if (n < 0.001) return n.toExponential(2);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: d });
    return n.toFixed(d);
  };
  const fi = n => Math.ceil(n).toLocaleString();

  return (
    <div style={{
      "--text": "#E8E6E3", "--label": "#B0ADA8", "--muted": "#7A7672",
      "--bg": "#1A1917", "--card-bg": "#232220", "--input-bg": "#1E1D1B",
      "--border": "#3A3835", "--accent-bg": "#1B2A1F", "--accent-border": "#2D5A3A",
      "--accent-text": "#6BCB7F", "--warn-bg": "#2A1F1B", "--warn-border": "#5A3A2D",
      "--warn-text": "#E8944A", "--section-border": "#2A2826",
      "--testnet-bg": "#1B1F2A", "--testnet-border": "#2D3A5A", "--testnet-text": "#7BA4E8",
      "--mono": "'JetBrains Mono', monospace",
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
          <span style={{ fontSize: 10, fontWeight: 600, background: "var(--warn-border)", color: "#fff", padding: "2px 8px", borderRadius: 10 }}>v0.4</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
          Estimate NIGHT holdings to sustain DApp operations on Midnight.
        </p>
      </div>

      {/* Corrected fee banner */}
      <div style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 24, background: "var(--warn-bg)", border: "1px solid var(--warn-border)" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--warn-text)", marginBottom: 4 }}>
          Corrected fee data (v0.4)
        </div>
        <div style={{ fontSize: 11, color: "var(--label)", lineHeight: 1.6 }}>
          Explorer-observed fee: <strong style={{ color: "var(--warn-text)" }}>~69 DUST per TX</strong> (for <code style={{ fontSize: 10, background: "var(--card-bg)", padding: "1px 4px", borderRadius: 3 }}>post_big_blind</code>, 6 ledger writes). The original report's 0.3 DUST figure was only the client-side <code style={{ fontSize: 10, background: "var(--card-bg)", padding: "1px 4px", borderRadius: 3 }}>additionalFeeOverhead</code> — the actual network fee is ~230× higher. Fee varies by circuit complexity (writes, proof size, UTXO structure). 69 DUST is a mid-range data point.
          <br/><span style={{ fontStyle: "italic", color: "var(--muted)" }}>Source: Midnight preprod explorer + corrected Dominion Poker report (231 games, 3,624 TXs).</span>
        </div>
      </div>

      {/* 1: DApp Profile */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>1 — DApp Profile</h2>
        <Pills options={Object.entries(PROFILES).map(([k, v]) => ({ value: k, label: v.label, badge: v.badge }))} value={pk} onChange={setPk} />
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0", fontStyle: "italic" }}>{p.description}</p>
        {pk === "custom" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px 16px", marginTop: 14 }}>
            <NumInput label="TXs / action" value={cTx} onChange={setCTx} step={1} help="On-chain TXs per operation" />
            <NumInput label="Actions / day" value={cAct} onChange={setCAct} step={10} help="Total daily actions" />
            <NumInput label="DUST / TX" value={cDust} onChange={setCDust} unit="DUST" step={1} help="~69 DUST observed (mid-range)" />
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <Stat mini label="TXs / action" value={txPer} />
            <Stat mini label="Actions / day" value={actDay} />
            <Stat mini label="Daily TXs" value={fi(txPer * actDay)} />
            <Stat mini label="DUST / TX" value={`~${baseFee}`} sub="explorer-observed" />
          </div>
        )}
      </section>

      {/* 2: Network Conditions */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>2 — Network Conditions</h2>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--label)", marginBottom: 8 }}>Congestion scenario</div>
          <Pills options={Object.entries(CONGESTION).map(([k, v]) => ({ value: k, label: v.label }))} value={ck} onChange={setCk} />
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>{cong.desc}</p>
        </div>
        <div style={{ maxWidth: 200 }}>
          <NumInput label="Safety buffer" value={buf} onChange={setBuf} unit="%" min={0} max={200} step={5} help="Headroom above minimum" />
        </div>
      </section>

      {/* 3: DUST Burn */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>3 — DUST Burn Rate</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Stat label="Fee / TX" value={`~${f(r.fee)} DUST`}
            sub={r.congMult > 1 ? `${r.congMult.toFixed(1)}× floor (price: ${r.priceMult.toFixed(2)}×)` : "At floor pricing (explorer-confirmed)"}
            warn={r.congMult > 2} />
          <Stat label="Daily burn" value={`${f(r.dBurn)} DUST`} sub={`${fi(r.dailyTx)} TXs/day`} />
        </div>
        {r.congMult > 1 && (
          <div style={{ fontSize: 11, color: "var(--warn-text)", marginBottom: 12, padding: "8px 12px", borderRadius: 6, background: "var(--warn-bg)", border: "1px solid var(--warn-border)" }}>
            Congestion scales fees from ~{f(baseFee)} → ~{f(r.fee)} DUST/TX. ±4.6% adjustment per block (every 6s). Sustained {(cong.fullness * 100).toFixed(0)}% utilization over {cong.blocks} blocks.
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Stat mini label="Weekly" value={`${f(r.wBurn)} DUST`} />
          <Stat mini label="Monthly" value={`${f(r.mBurn)} DUST`} />
        </div>
      </section>

      {/* 4: NIGHT Requirement */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>4 — NIGHT Holdings Required</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <Stat label="Minimum NIGHT" value={fi(r.minN)} sub={`Binding: ${r.bind}`} />
          <Stat label={`Recommended (+${buf}%)`} value={fi(r.recN)} sub="With safety margin" accent />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Stat mini label="Regen / burn"
            value={`${r.ratio.toFixed(2)}×`}
            sub={r.ratio >= 1.5 ? "Comfortable" : r.ratio >= 1 ? "Tight margin" : "Deficit — need more NIGHT"}
            accent={r.ratio >= 1.5} warn={r.ratio < 1} />
          <Stat mini label="DUST cap (battery)"
            value={`${f(r.cap)} DUST`}
            sub={`${f(r.runway)} day runway w/o regen`} />
        </div>

        {/* Breakdown */}
        <div style={{
          padding: "12px 16px", borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: "var(--label)",
          background: r.ratio >= 1.5 ? "var(--accent-bg)" : r.ratio >= 1 ? "var(--card-bg)" : "var(--warn-bg)",
          border: `1px solid ${r.ratio >= 1.5 ? "var(--accent-border)" : r.ratio >= 1 ? "var(--border)" : "var(--warn-border)"}`,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--text)", fontSize: 13 }}>
            {r.ratio >= 1.5 ? "Comfortably self-sustaining" : r.ratio >= 1.0 ? "Self-sustaining (thin margin)" : "Burns faster than regen — increase NIGHT"}
          </div>
          <div><strong>Generation:</strong> 1 NIGHT → {DUST_PER_NIGHT} DUST / ~7 days ({DUST_PER_NIGHT_PER_DAY.toFixed(4)} DUST/NIGHT/day)</div>
          <div><strong>Your daily regen:</strong> {f(r.dRegen)} DUST from {fi(r.recN)} NIGHT</div>
          <div><strong>Your daily burn:</strong> {f(r.dBurn)} DUST ({fi(r.dailyTx)} TXs × ~{f(r.fee)} DUST)</div>
          <div><strong>Net:</strong> {r.ratio >= 1 ? "+" : ""}{f(r.dRegen - r.dBurn)} DUST/day {r.ratio >= 1 ? "(surplus)" : "(deficit)"}</div>
        </div>
      </section>

      {/* Testnet reference (poker profiles) */}
      {(pk === "pokerTable" || pk === "pokerTable6P") && (
        <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--testnet-text)", marginBottom: 14 }}>Testnet Reference (Corrected)</h2>
          <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--testnet-bg)", border: "1px solid var(--testnet-border)", fontSize: 12, lineHeight: 1.8, color: "var(--label)" }}>
            <div><strong style={{ color: "var(--testnet-text)" }}>Observed (2P, preprod):</strong> ~4,000 tNIGHT total (2,000/agent), 231 games, 48.5 hrs</div>
            <div>Corrected avg game cost: <strong>~1,083 DUST</strong> (15.7 TXs × ~69 DUST) — was 4.7 DUST in original report</div>
            <div>Regen/burn ratio: <strong>~1.015×</strong> (1.5% margin) — NOT 3.6× as originally reported</div>
            <div>DUST pool still grew +1,812 DUST over 110 games — but via ~121K regen vs ~119K burn (thin net)</div>
            <div>Runway without regen: ~2 hours (not 20 days as originally estimated)</div>
            <div>Proof server throughput: ~22s/proof, ~160 proofs/hr — still the real scaling bottleneck</div>
          </div>
        </section>
      )}

      {/* Planning Notes */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>Planning Notes</h2>
        <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.7, color: "var(--label)" }}>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Thin margins are real.</strong> Testnet shows regen barely outpaces burn (~1.5% surplus). Budget conservatively — a sustained burst of expensive TXs can deplete your DUST pool within hours.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Fee varies by circuit.</strong> The ~69 DUST figure is for a 6-write circuit. Simpler circuits (3 writes) cost less; complex circuits (13 writes) cost more. Per-circuit explorer data would improve estimates.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>DUST cap = burst buffer.</strong> Cap is {DUST_PER_NIGHT} DUST per NIGHT. With corrected fees, your cap runway (without regen) is measured in hours, not days. Keep buffer high.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Redesignation is risky at these margins.</strong> Transferring NIGHT or changing DUST targets triggers ~7-day regen ramp. With thin regen/burn margins, any interruption can cause multi-hour DUST outages.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Proof server is still the throughput bottleneck.</strong> ~22s per ZK proof = ~160 proofs/hr. DUST budget matters for sustainability, but proof capacity limits peak TPS.</div>
          <div><strong style={{ color: "var(--text)" }}>6-player scaling needs significantly more NIGHT.</strong> Estimated 5-10× per agent vs 2-player tables to maintain regen &gt; burn.</div>
        </div>
      </section>

      {/* Protocol Params */}
      <section style={{ padding: "14px 16px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--label)", fontSize: 12 }}>Protocol Parameters</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 24px", fontFamily: "var(--mono)", fontSize: 11 }}>
          <div>block_time: {BLOCK_TIME_SEC}s ({BLOCKS_PER_DAY.toLocaleString()} blk/day)</div>
          <div>dust_per_night: {DUST_PER_NIGHT} / ~7d</div>
          <div>overall_price_init: {INITIAL_OVERALL_PRICE}</div>
          <div>target_fullness: 50%</div>
          <div>observed_fee: ~69 DUST/TX (6 writes)</div>
          <div>price_adjust: ±4.595%/blk</div>
          <div>compute_limit: 1s/blk</div>
          <div>block_usage: 200KB/blk</div>
        </div>
      </section>

      <div style={{ textAlign: "center", fontSize: 10, color: "var(--muted)", marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--section-border)" }}>
        DUST Budget Calculator v0.4 — Corrected: explorer-observed ~69 DUST/TX (was 0.3 DUST client-side overhead only) — Not financial advice
      </div>
    </div>
  );
}
