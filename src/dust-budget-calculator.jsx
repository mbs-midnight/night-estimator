import { useState, useMemo } from "react";

// ─── Protocol Constants ───
const DUST_PER_NIGHT = 5;
const TIME_TO_CAP_SECONDS = 604814;
const DUST_PER_NIGHT_PER_DAY = DUST_PER_NIGHT / (TIME_TO_CAP_SECONDS / 86400);
const BLOCK_TIME_SEC = 6;
const BLOCKS_PER_DAY = Math.floor(86400 / BLOCK_TIME_SEC);
const INITIAL_OVERALL_PRICE = 10;
const MAX_ADJUSTMENT = 0.04595;
const SENSITIVITY_A = 100;

// ─── FEE CALIBRATION ───
// Two confirmed data points from Midnight preprod:
//   1. Simple NIGHT transfer (DUST proof only, minimal writes): ~0.30 DUST
//   2. post_big_blind (k=10, 6 writes, application proof): ~69 DUST
// Every TX pays for at least one ZK proof (the DUST spend proof).
// Application-level proofs, ledger writes, and TX size drive costs above the floor.
const FEE_FLOOR = 0.30;              // NIGHT transfer — absolute minimum
const FEE_MID = 69;                  // post_big_blind (k=10, 6 writes)
const MID_K = 10;
const MID_WRITES = 6;

// Derived: estimate fee as base + proof_component + write_component
// With 2 data points we model linearly. More data points will refine this.
// Base (DUST proof only, ~0 app writes): 0.30 DUST
// post_big_blind adds: app proof (k=10) + 6 writes = 68.7 DUST above base
// We split attribution: assume proof dominates (most of the cost) with writes adding marginally
// This will be refined when we get fees for 3-write and 13-write circuits
const EST_PROOF_COST_PER_K = 6.0;     // ~60 DUST for k=10 proof → 6/k level (rough)
const EST_WRITE_COST = 1.45;          // Residual: (69 - 0.3 - 60) / 6 writes ≈ 1.45/write

function estimateFee(hasAppProof, k = 10, writes = 3) {
  let fee = FEE_FLOOR; // Every TX pays DUST proof base
  if (hasAppProof) {
    fee += EST_PROOF_COST_PER_K * k;  // Application circuit proof
  }
  fee += EST_WRITE_COST * writes;     // Ledger writes
  return fee;
}

// ─── Congestion Engine ───
function simulatePrice(startPrice, fullness, numBlocks) {
  let price = startPrice;
  const u = Math.max(fullness, 0.01);
  const adj = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT,
    -Math.log((1 / u) - 0.99) / SENSITIVITY_A));
  for (let i = 0; i < numBlocks; i++) price = Math.max(price * (1 + adj), 0.0001);
  return price;
}

// ─── DApp Profiles ───
const PROFILES = {
  custom: {
    label: "Custom",
    desc: "Define your own transaction characteristics",
    hasProof: true, k: 10, writes: 5, txPerAction: 5, actionsPerDay: 200,
  },
  nightTransfer: {
    label: "NIGHT Transfer",
    desc: "Simple token transfer. DUST proof only, no application circuit. Confirmed floor: 0.30 DUST.",
    hasProof: false, k: 0, writes: 0, txPerAction: 1, actionsPerDay: 1000, badge: "CONFIRMED",
  },
  pokerTable: {
    label: "Poker (2P)",
    desc: "Dominion Poker preprod: ~15.7 TXs/game, ~4.8 games/hr. post_big_blind fee confirmed at ~69 DUST (k=10, 6 writes).",
    hasProof: true, k: 10, writes: 6, txPerAction: 15.7, actionsPerDay: 115, badge: "TESTNET",
  },
  lightContract: {
    label: "Light Contract",
    desc: "Simple DApp call — small circuit (k≈7-8), few state updates (2-3 writes).",
    hasProof: true, k: 8, writes: 3, txPerAction: 2, actionsPerDay: 500,
  },
  mediumContract: {
    label: "Medium Contract",
    desc: "DEX trade, lending action — mid-size circuit (k≈10), moderate writes (5-8).",
    hasProof: true, k: 10, writes: 6, txPerAction: 4, actionsPerDay: 200,
  },
  heavyContract: {
    label: "Heavy Contract",
    desc: "Complex multi-party interaction — large circuit (k≈12+), heavy state updates (10-15 writes).",
    hasProof: true, k: 12, writes: 12, txPerAction: 8, actionsPerDay: 50,
  },
};

const CONGESTION = {
  floor: { label: "Floor (current)", fullness: 0.05, blocks: 0, desc: "Near-empty blocks — preprod baseline" },
  low: { label: "Low (~25%)", fullness: 0.25, blocks: 500, desc: "Light usage" },
  target: { label: "Target (~50%)", fullness: 0.5, blocks: 1000, desc: "Network equilibrium" },
  high: { label: "High (~75%)", fullness: 0.75, blocks: 1000, desc: "Sustained pressure — fees rising" },
  spike: { label: "Spike (~90%)", fullness: 0.9, blocks: 500, desc: "Congestion burst" },
};

// ─── UI ───
function NumInput({ label, value, onChange, unit, min = 0, step = 1, help, max }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: "var(--label)" }}>{label}</label>
        {unit && <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>{unit}</span>}
      </div>
      {help && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{help}</div>}
      <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        min={min} max={max} step={step} style={{
          width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6,
          fontSize: 14, fontFamily: "var(--mono)", background: "var(--input-bg)", color: "var(--text)", boxSizing: "border-box",
        }} />
    </div>
  );
}

function Toggle({ label, value, onChange, help }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => onChange(!value)}>
        <div style={{
          width: 36, height: 20, borderRadius: 10, padding: 2, transition: "background 0.2s",
          background: value ? "var(--accent-border)" : "var(--border)",
        }}>
          <div style={{
            width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "transform 0.2s",
            transform: value ? "translateX(16px)" : "translateX(0)",
          }} />
        </div>
        <label style={{ fontSize: 13, fontWeight: 500, color: "var(--label)", cursor: "pointer" }}>{label}</label>
      </div>
      {help && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, marginLeft: 44 }}>{help}</div>}
    </div>
  );
}

function Stat({ label, value, sub, accent, warn, mini }) {
  const bg = warn ? "var(--warn-bg)" : accent ? "var(--accent-bg)" : "var(--card-bg)";
  const brd = warn ? "var(--warn-border)" : accent ? "var(--accent-border)" : "var(--border)";
  const clr = warn ? "var(--warn-text)" : accent ? "var(--accent-text)" : "var(--text)";
  return (
    <div style={{ padding: mini ? "10px 12px" : "14px 16px", borderRadius: 10, background: bg, border: `1px solid ${brd}`, flex: 1, minWidth: mini ? 120 : 150 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: mini ? 4 : 6 }}>{label}</div>
      <div style={{ fontSize: mini ? 16 : 21, fontWeight: 700, fontFamily: "var(--mono)", color: clr }}>{value}</div>
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
            background: o.badge === "CONFIRMED" || o.badge === "TESTNET" ? "var(--accent-border)" : "var(--warn-border)",
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
  const [cProof, setCProof] = useState(true);
  const [cK, setCK] = useState(10);
  const [cWrites, setCWrites] = useState(5);
  const [cTxPer, setCTxPer] = useState(5);
  const [cActDay, setCActDay] = useState(200);
  const [ck, setCk] = useState("floor");
  const [buf, setBuf] = useState(25);

  const p = PROFILES[pk];
  const cong = CONGESTION[ck];
  const hasProof = pk === "custom" ? cProof : p.hasProof;
  const kVal = pk === "custom" ? cK : p.k;
  const writes = pk === "custom" ? cWrites : p.writes;
  const txPer = pk === "custom" ? cTxPer : p.txPerAction;
  const actDay = pk === "custom" ? cActDay : p.actionsPerDay;

  const r = useMemo(() => {
    const feeFloor = estimateFee(hasProof, kVal, writes);
    let fee = feeFloor;
    let priceMult = 1;
    if (ck !== "floor") {
      const evolved = simulatePrice(INITIAL_OVERALL_PRICE, cong.fullness, cong.blocks);
      priceMult = evolved / INITIAL_OVERALL_PRICE;
      fee = feeFloor * Math.max(1, priceMult);
    }
    const dailyTx = txPer * actDay;
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
      feeFloor, fee, dailyTx, dBurn, wBurn, mBurn,
      nFlow, nCap, minN, recN, priceMult,
      congMult: fee / feeFloor, cap,
      runway: cap / dBurn, ratio: dRegen / dBurn, dRegen,
      bind: nFlow >= nCap ? "Generation rate" : "DUST cap",
      // Fee breakdown
      dustProofCost: FEE_FLOOR,
      appProofCost: hasProof ? EST_PROOF_COST_PER_K * kVal : 0,
      writeCost: EST_WRITE_COST * writes,
    };
  }, [hasProof, kVal, writes, txPer, actDay, ck, cong, buf]);

  const f = (n, d = 2) => {
    if (n === 0) return "0";
    if (n < 0.01) return n.toFixed(4);
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
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>NIGHT Estimator</h1>
          <span style={{ fontSize: 10, fontWeight: 600, background: "var(--accent-border)", color: "#fff", padding: "2px 8px", borderRadius: 10 }}>v0.5</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
          Estimate NIGHT holdings to sustain DApp operations on Midnight.
        </p>
      </div>

      {/* Calibration info */}
      <div style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 24, background: "var(--testnet-bg)", border: "1px solid var(--testnet-border)" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--testnet-text)", marginBottom: 4 }}>
          Fee model — 2 calibration points
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--testnet-text)" }}>0.30 DUST</strong> — NIGHT transfer (DUST proof only, no app circuit) · <strong style={{ color: "var(--testnet-text)" }}>~69 DUST</strong> — contract call with proof (k=10, 6 writes, <code style={{ fontSize: 10, background: "var(--card-bg)", padding: "1px 4px", borderRadius: 3 }}>post_big_blind</code>).
          Every TX pays for a DUST spend proof. Application circuits, ledger writes, and TX size add cost above the floor. Fee model is estimated — will be refined with additional explorer data and ledger API integration.
        </div>
      </div>

      {/* 1: DApp Profile */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>1 — Transaction Profile</h2>
        <Pills options={Object.entries(PROFILES).map(([k, v]) => ({ value: k, label: v.label, badge: v.badge }))} value={pk} onChange={setPk} />
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0", fontStyle: "italic" }}>{p.desc}</p>

        {pk === "custom" ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
              <div>
                <Toggle label="Application ZK proof" value={cProof} onChange={setCProof} help="Does each TX include an app-level circuit proof?" />
                {cProof && <NumInput label="Circuit k value" value={cK} onChange={setCK} min={5} max={20} step={1} help="From zkir compile --verbose (7-12 typical)" />}
                <NumInput label="Ledger writes / TX" value={cWrites} onChange={setCWrites} min={0} max={50} step={1} help="On-chain state mutations per TX" />
              </div>
              <div>
                <NumInput label="TXs per action" value={cTxPer} onChange={setCTxPer} step={1} help="On-chain TXs per user operation" />
                <NumInput label="Actions / day" value={cActDay} onChange={setCActDay} step={10} help="Total daily user actions" />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <Stat mini label="Proof" value={hasProof ? `k=${kVal}` : "None"} sub={hasProof ? "app circuit" : "DUST proof only"} />
            <Stat mini label="Writes / TX" value={writes} />
            <Stat mini label="TXs / action" value={txPer} />
            <Stat mini label="Actions / day" value={actDay} />
          </div>
        )}

        {/* Fee breakdown */}
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--label)", marginBottom: 6 }}>Estimated fee breakdown (floor pricing)</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontFamily: "var(--mono)", fontSize: 12 }}>
            <span style={{ color: "var(--muted)" }}>DUST proof:</span>
            <span style={{ color: "var(--text)" }}>{f(r.dustProofCost)}</span>
            <span style={{ color: "var(--muted)" }}>+</span>
            <span style={{ color: "var(--muted)" }}>App proof:</span>
            <span style={{ color: r.appProofCost > 0 ? "var(--text)" : "var(--muted)" }}>{f(r.appProofCost)}</span>
            <span style={{ color: "var(--muted)" }}>+</span>
            <span style={{ color: "var(--muted)" }}>Writes:</span>
            <span style={{ color: "var(--text)" }}>{f(r.writeCost)}</span>
            <span style={{ color: "var(--muted)" }}>=</span>
            <span style={{ color: "var(--accent-text)", fontWeight: 700 }}>~{f(r.feeFloor)} DUST</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4, fontStyle: "italic" }}>
            Model: {f(FEE_FLOOR)} base + {f(EST_PROOF_COST_PER_K)}/k-level + {f(EST_WRITE_COST)}/write. Calibrated from 2 data points — will improve with more explorer data.
          </div>
        </div>
      </section>

      {/* 2: Congestion */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>2 — Network Conditions</h2>
        <div style={{ marginBottom: 14 }}>
          <Pills options={Object.entries(CONGESTION).map(([k, v]) => ({ value: k, label: v.label }))} value={ck} onChange={setCk} />
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>{cong.desc}</p>
        </div>
        <div style={{ maxWidth: 200 }}>
          <NumInput label="Safety buffer" value={buf} onChange={setBuf} unit="%" min={0} max={200} step={5} help="Headroom above minimum" />
        </div>
      </section>

      {/* 3: Burn Rate */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>3 — DUST Burn Rate</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Stat label="Fee / TX" value={`~${f(r.fee)} DUST`}
            sub={r.congMult > 1 ? `${r.congMult.toFixed(1)}× floor` : "At floor pricing"}
            warn={r.congMult > 2} />
          <Stat label="Daily burn" value={`${f(r.dBurn)} DUST`} sub={`${fi(r.dailyTx)} TXs/day`} />
        </div>
        {r.congMult > 1 && (
          <div style={{ fontSize: 11, color: "var(--warn-text)", marginBottom: 12, padding: "8px 12px", borderRadius: 6, background: "var(--warn-bg)", border: "1px solid var(--warn-border)" }}>
            Congestion: {f(r.feeFloor)} → {f(r.fee)} DUST/TX (price multiplier: {r.priceMult.toFixed(2)}×). ±4.6%/block every 6s.
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
            sub={r.ratio >= 1.5 ? "Comfortable" : r.ratio >= 1 ? "Tight margin" : "Deficit"}
            accent={r.ratio >= 1.5} warn={r.ratio < 1} />
          <Stat mini label="Cap runway"
            value={r.runway >= 1 ? `${f(r.runway)} days` : `${f(r.runway * 24)} hrs`}
            sub="Without regen" />
        </div>

        {/* Breakdown */}
        <div style={{
          padding: "12px 16px", borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: "var(--label)",
          background: r.ratio >= 1.5 ? "var(--accent-bg)" : r.ratio >= 1 ? "var(--card-bg)" : "var(--warn-bg)",
          border: `1px solid ${r.ratio >= 1.5 ? "var(--accent-border)" : r.ratio >= 1 ? "var(--border)" : "var(--warn-border)"}`,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--text)", fontSize: 13 }}>
            {r.ratio >= 1.5 ? "Comfortably self-sustaining" : r.ratio >= 1 ? "Self-sustaining (thin margin)" : "Burns faster than regen — increase NIGHT"}
          </div>
          <div><strong>Generation:</strong> 1 NIGHT → {DUST_PER_NIGHT} DUST / ~7d ({DUST_PER_NIGHT_PER_DAY.toFixed(4)} DUST/NIGHT/day)</div>
          <div><strong>Daily regen:</strong> {f(r.dRegen)} DUST from {fi(r.recN)} NIGHT</div>
          <div><strong>Daily burn:</strong> {f(r.dBurn)} DUST ({fi(r.dailyTx)} TXs × ~{f(r.fee)} DUST)</div>
          <div><strong>Net:</strong> {r.ratio >= 1 ? "+" : ""}{f(r.dRegen - r.dBurn)} DUST/day {r.ratio >= 1 ? "(surplus)" : "(deficit)"}</div>
        </div>
      </section>

      {/* Planning Notes */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>Planning Notes</h2>
        <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.7, color: "var(--label)" }}>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Every TX pays for a DUST ZK proof.</strong> Even a simple NIGHT transfer costs 0.30 DUST. There are no proof-free transactions — DUST is shielded, so spending it always requires a ZK proof.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Fees scale with circuit size + writes.</strong> Application circuit proofs (k-value) and ledger writes are the main cost drivers above the 0.30 DUST floor. A k=10 circuit with 6 writes costs ~69 DUST.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Shielded tokens are separate from DUST.</strong> DUST only pays fees. Shielded token operations use a separate ZK subsystem and may add additional proof costs on top of the DUST fee.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Cap runway is short at contract-level fees.</strong> At ~69 DUST/TX, your DUST cap drains fast. Budget for continuous regen and keep buffer high.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Proof server limits throughput.</strong> ~22s per proof = ~160 proofs/hr per server (flat across k=7 to k=12). Proving time doesn't scale with circuit complexity on current hardware.</div>
          <div><strong style={{ color: "var(--text)" }}>Use mockProve() for exact estimates.</strong> The Midnight ledger API provides <code style={{ fontSize: 10, background: "var(--input-bg)", padding: "1px 4px", borderRadius: 3 }}>Transaction.fees()</code> and <code style={{ fontSize: 10, background: "var(--input-bg)", padding: "1px 4px", borderRadius: 3 }}>mockProve()</code> for precise fee computation without a proof server.</div>
        </div>
      </section>

      {/* Protocol Params */}
      <section style={{ padding: "14px 16px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", lineHeight: 1.6, marginBottom: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--label)", fontSize: 12 }}>Protocol Parameters & Calibration</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 24px", fontFamily: "var(--mono)", fontSize: 11 }}>
          <div>block_time: {BLOCK_TIME_SEC}s ({BLOCKS_PER_DAY.toLocaleString()} blk/day)</div>
          <div>dust_per_night: {DUST_PER_NIGHT} / ~7d</div>
          <div>overall_price_init: {INITIAL_OVERALL_PRICE}</div>
          <div>target_fullness: 50%</div>
          <div>fee_floor: 0.30 DUST (NIGHT xfer)</div>
          <div>fee_mid: ~69 DUST (k=10, 6 writes)</div>
          <div>est_proof_cost: ~{EST_PROOF_COST_PER_K}/k-level</div>
          <div>est_write_cost: ~{EST_WRITE_COST}/write</div>
        </div>
      </section>

      <div style={{ textAlign: "center", fontSize: 10, color: "var(--muted)", paddingTop: 16, borderTop: "1px solid var(--section-border)" }}>
        NIGHT Estimator v0.5 — Fee model: 2-point calibration (0.30 DUST floor + 69 DUST mid-range). Estimates only — use ledger API for precise fees.
      </div>
    </div>
  );
}
