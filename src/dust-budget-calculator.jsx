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

// ─── FEE MODEL (calibrated from 5 preprod data points) ───
//
// Observed fees (Midnight preprod explorer, Dominion Poker):
//   commit_action_state  k=7   3 writes   66.31 DUST
//   post_small_blind     k=11  5 writes   68.63 DUST
//   post_big_blind       k=10  6 writes   ~69   DUST
//   commit_deck_cards    k=10  13 writes  70.42 DUST
//   NIGHT transfer       —     0 writes   0.30  DUST
//
// Key finding: fees are nearly flat (~66-70 DUST, ±3%) across all contract
// circuits regardless of k-value (7-12) or write count (3-13).
// Fee is dominated by a large constant (proof verification + TX base cost).
// k and writes contribute only marginally.
//
// Two-tier model:
//   - No app circuit (NIGHT transfer, DUST proof only): 0.30 DUST
//   - With app circuit (contract call, DUST proof + app proof): ~68 DUST
//
// Marginal effects (small but observable):
//   - Per write: ~0.4 DUST (from 66.31@3writes to 70.42@13writes ≈ 0.41/write)
//   - Per k-level: negligible (dominated by constant)

const FEE_NO_PROOF = 0.30;          // NIGHT transfer — confirmed
const FEE_WITH_PROOF_BASE = 67.0;   // Base cost for any TX with app proof
const FEE_PER_WRITE = 0.41;         // Marginal cost per ledger write (derived from data)
const FEE_WITH_PROOF_AVG = 68.5;    // Simple average for quick estimates

// Observed data for calibration display
const CALIBRATION = [
  { circuit: "NIGHT transfer", k: "—", writes: 0, fee: 0.30, confirmed: true },
  { circuit: "commit_action_state", k: 7, writes: 3, fee: 66.31, confirmed: true },
  { circuit: "post_small_blind", k: 11, writes: 5, fee: 68.63, confirmed: true },
  { circuit: "post_big_blind", k: 10, writes: 6, fee: 69.00, confirmed: true },
  { circuit: "commit_deck_cards", k: 10, writes: 13, fee: 70.42, confirmed: true },
];

function estimateFee(hasAppProof, writes = 5) {
  if (!hasAppProof) return FEE_NO_PROOF;
  return FEE_WITH_PROOF_BASE + FEE_PER_WRITE * writes;
}

// ─── Congestion Model ───
// The dynamic pricing adjusts ±4.6% per block based on previous block fullness.
// At 50% target: no adjustment (equilibrium). Below 50%: prices decline to floor.
// Above 50%: prices rise. But rising prices suppress demand → blocks empty → prices cool.
//
// Rather than simulating runaway compounding (unrealistic — ignores the feedback loop),
// we model realistic steady-state fee multipliers at each utilization level.
// These represent what an operator should budget for at sustained utilization:
//
// - Floor/Low/Target (<= 50%): Prices at or declining toward floor. Multiplier = 1×.
//   The system is designed to stabilize at 50%. Below that, no fee pressure.
// - Moderate (60%): Mild sustained pressure. ~1.5× floor over minutes.
// - High (75%): Sustained congestion. ~3-5× floor (fees rise until demand drops).
// - Spike (90%): Short burst. ~8-15× floor (aggressive but self-correcting in <2min).
//
// These are planning estimates. Actual multipliers depend on duration and demand elasticity.

// ─── DApp Profiles ───
const PROFILES = {
  custom: {
    label: "Custom", desc: "Define your own transaction pattern",
    hasProof: true, writes: 5, txPerAction: 5, actionsPerDay: 200,
  },
  nightTransfer: {
    label: "NIGHT Transfer",
    desc: "Simple token transfer. Requires a DUST spend proof (all TXs do) but no application circuit — 0.30 DUST confirmed.",
    hasProof: false, writes: 0, txPerAction: 1, actionsPerDay: 1000, badge: "✓",
  },
  pokerTable: {
    label: "Poker (2P)",
    desc: "Dominion Poker: ~15.7 TXs/game, ~4.8 games/hr. Fee ~66-70 DUST/TX across all circuits (k=7-12, 3-13 writes).",
    hasProof: true, writes: 6, txPerAction: 15.7, actionsPerDay: 115, badge: "✓",
  },
  lightContract: {
    label: "Light Contract",
    desc: "Simple DApp — small circuit, few writes. Fee still ~67-68 DUST (app circuit proof dominates).",
    hasProof: true, writes: 2, txPerAction: 2, actionsPerDay: 500,
  },
  mediumContract: {
    label: "Medium Contract",
    desc: "DEX/lending — moderate writes. Fee ~68-70 DUST.",
    hasProof: true, writes: 6, txPerAction: 4, actionsPerDay: 200,
  },
  heavyContract: {
    label: "Heavy Contract",
    desc: "Complex operations — many writes. Fee ~72-75 DUST (writes add marginally).",
    hasProof: true, writes: 15, txPerAction: 8, actionsPerDay: 50,
  },
};

const CONGESTION = {
  floor:  { label: "Floor (current)", mult: 1,  desc: "Near-empty blocks — preprod baseline. Best case." },
  low:    { label: "Low (~25%)",      mult: 1,  desc: "Below target — prices declining toward floor. Same as floor for planning." },
  target: { label: "Target (~50%)",   mult: 1,  desc: "Network equilibrium. No price adjustment. Plan here for steady-state mainnet." },
  high:   { label: "High (~75%)",     mult: 4,  desc: "Sustained congestion. Fees ~4× floor — demand/price feedback limits runaway." },
  spike:  { label: "Spike (~90%)",    mult: 10, desc: "Short burst (~minutes). Fees ~10× floor — self-corrects as demand drops." },
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
            background: "var(--accent-border)", color: "#fff", padding: "1px 5px", borderRadius: 6,
          }}>{o.badge}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main ───
export default function DustBudgetCalculator() {
  const [pk, setPk] = useState("mediumContract");
  const [cProof, setCProof] = useState(true);
  const [cWrites, setCWrites] = useState(5);
  const [cTxPer, setCTxPer] = useState(5);
  const [cActDay, setCActDay] = useState(200);
  const [ck, setCk] = useState("target");
  const [buf, setBuf] = useState(25);
  const [showCal, setShowCal] = useState(false);

  const p = PROFILES[pk];
  const cong = CONGESTION[ck];
  const hasProof = pk === "custom" ? cProof : p.hasProof;
  const writes = pk === "custom" ? cWrites : p.writes;
  const txPer = pk === "custom" ? cTxPer : p.txPerAction;
  const actDay = pk === "custom" ? cActDay : p.actionsPerDay;

  const r = useMemo(() => {
    const feeFloor = estimateFee(hasProof, writes);
    const priceMult = cong.mult;
    const fee = feeFloor * priceMult;
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
      nFlow, nCap, minN, recN,
      eqNight: dBurn / DUST_PER_NIGHT_PER_DAY, // Exact equilibrium: regen == burn
      congMult: priceMult, cap,
      runway: cap / dBurn, ratio: dRegen / dBurn, dRegen,
      bind: nFlow >= nCap ? "Generation rate" : "DUST cap",
    };
  }, [hasProof, writes, txPer, actDay, ck, cong, buf]);

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
          <span style={{ fontSize: 10, fontWeight: 600, background: "var(--accent-border)", color: "#fff", padding: "2px 8px", borderRadius: 10 }}>v0.8</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
          Estimate NIGHT holdings to sustain DApp operations on Midnight.
        </p>
      </div>

      {/* Key insight banner */}
      <div style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 24, background: "var(--testnet-bg)", border: "1px solid var(--testnet-border)" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--testnet-text)", marginBottom: 4 }}>
          Fee structure — confirmed from 5 preprod data points
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--testnet-text)" }}>Two tiers:</strong> NIGHT transfers cost <strong style={{ color: "var(--testnet-text)" }}>0.30 DUST</strong> (DUST spend proof only, no app circuit). Contract calls cost <strong style={{ color: "var(--testnet-text)" }}>~66-70 DUST</strong> (DUST proof + application circuit proof) regardless of circuit complexity (k=7 to k=12, 3 to 13 writes — only ±3% variation). The app circuit proof dominates; writes add ~0.4 DUST each.
          <span style={{ display: "inline-block", marginLeft: 4, cursor: "pointer", color: "var(--testnet-text)", textDecoration: "underline", fontSize: 10 }} onClick={() => setShowCal(!showCal)}>
            {showCal ? "hide data ▲" : "show data ▼"}
          </span>
        </div>
        {showCal && (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "var(--mono)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Circuit", "k", "Writes", "Fee (DUST)", "Model"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: "var(--label)", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CALIBRATION.map((c, i) => {
                  const predicted = c.writes === 0 && c.k === "—" ? FEE_NO_PROOF : estimateFee(true, c.writes);
                  const err = c.fee > 1 ? ((predicted - c.fee) / c.fee * 100).toFixed(1) : "—";
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--section-border)" }}>
                      <td style={{ padding: "5px 8px", color: "var(--text)" }}>{c.circuit}</td>
                      <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{c.k}</td>
                      <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{c.writes}</td>
                      <td style={{ padding: "5px 8px", color: "var(--accent-text)", fontWeight: 600 }}>{c.fee.toFixed(2)}</td>
                      <td style={{ padding: "5px 8px", color: Math.abs(parseFloat(err)) > 3 ? "var(--warn-text)" : "var(--muted)" }}>
                        {predicted.toFixed(2)} ({err}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ HERO: Infinite Runway Target ═══ */}
      <div style={{
        padding: "24px 20px", borderRadius: 12, marginBottom: 28,
        background: r.ratio >= 1 ? "var(--accent-bg)" : "var(--warn-bg)",
        border: `2px solid ${r.ratio >= 1 ? "var(--accent-border)" : "var(--warn-border)"}`,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)", marginBottom: 10 }}>
          Infinite Runway Target
        </div>
        <div style={{ fontSize: 44, fontWeight: 800, fontFamily: "var(--mono)", color: "var(--text)", lineHeight: 1.1 }}>
          {fi(r.recN)}
          <span style={{ fontSize: 20, fontWeight: 600, color: "var(--accent-text)", marginLeft: 8 }}>NIGHT</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--label)", marginTop: 10, lineHeight: 1.5 }}>
          Hold this amount to generate DUST faster than you burn it — indefinitely.
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
          Burn: <strong style={{ color: "var(--text)" }}>{f(r.dBurn)}</strong> DUST/day
          {" · "}Regen: <strong style={{ color: "var(--text)" }}>{f(r.dRegen)}</strong> DUST/day
          {" · "}Surplus: <strong style={{ color: r.ratio >= 1 ? "var(--accent-text)" : "var(--warn-text)" }}>{r.ratio >= 1 ? "+" : ""}{f(r.dRegen - r.dBurn)}</strong>/day
        </div>
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 8, borderTop: `1px solid ${r.ratio >= 1 ? "var(--accent-border)" : "var(--warn-border)"}`, paddingTop: 8 }}>
          Equilibrium: {fi(r.eqNight)} NIGHT (exact break-even) · Shown: +{buf}% buffer
        </div>
      </div>

      {/* 1: Profile */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>1 — Transaction Profile</h2>
        <Pills options={Object.entries(PROFILES).map(([k, v]) => ({ value: k, label: v.label, badge: v.badge }))} value={pk} onChange={setPk} />
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0", fontStyle: "italic" }}>{p.desc}</p>

        {pk === "custom" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginTop: 14 }}>
            <div>
              <Toggle label="Application circuit proof" value={cProof} onChange={setCProof} help="All TXs have a DUST spend proof (0.30). Smart contract calls add an app circuit proof (~67+ DUST)." />
              <NumInput label="Ledger writes / TX" value={cWrites} onChange={setCWrites} min={0} max={50} step={1} help="On-chain state mutations. Adds ~0.4 DUST each." />
            </div>
            <div>
              <NumInput label="TXs per action" value={cTxPer} onChange={setCTxPer} step={1} help="On-chain TXs per user operation" />
              <NumInput label="Actions / day" value={cActDay} onChange={setCActDay} step={10} help="Total daily user actions" />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <Stat mini label="App circuit" value={hasProof ? "Yes" : "No"} sub={hasProof ? "~67+ DUST added" : "DUST proof only (0.30)"} />
            <Stat mini label="Writes" value={writes} sub={`+${f(FEE_PER_WRITE * writes)} DUST`} />
            <Stat mini label="TXs / action" value={txPer} />
            <Stat mini label="Actions / day" value={actDay} />
          </div>
        )}

        <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "var(--card-bg)", border: "1px solid var(--border)", fontFamily: "var(--mono)", fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Est. fee/TX: </span>
          <span style={{ color: "var(--accent-text)", fontWeight: 700 }}>~{f(r.feeFloor)} DUST</span>
          <span style={{ color: "var(--muted)", fontSize: 11 }}> ({hasProof ? `${f(FEE_WITH_PROOF_BASE)} app circuit + ${f(FEE_PER_WRITE * writes)} writes` : "DUST spend proof only, no app circuit"})</span>
        </div>
      </section>

      {/* 2: Congestion */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>2 — Network Conditions</h2>
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
          Fees adjust dynamically based on <strong style={{ color: "var(--label)" }}>previous block fullness</strong>. Each block, prices shift ±4.6% toward the 50% utilization target. Floor = current preprod (near-empty blocks, best case). Plan for Target — that's where a healthy mainnet stabilizes.
        </p>
        <div style={{ marginBottom: 14 }}>
          <Pills options={Object.entries(CONGESTION).map(([k, v]) => ({ value: k, label: v.label }))} value={ck} onChange={setCk} />
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>
            {cong.desc}
            {ck === "floor" && <span style={{ color: "var(--warn-text)" }}> — This is the cheapest fees will ever be. Not recommended for mainnet planning.</span>}
          </p>
        </div>
        <div style={{ maxWidth: 200 }}>
          <NumInput label="Safety buffer" value={buf} onChange={setBuf} unit="%" min={0} max={200} step={5} help="Headroom above minimum" />
        </div>
      </section>

      {/* 3: Burn */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>3 — DUST Burn Rate</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Stat label="Fee / TX" value={`~${f(r.fee)} DUST`}
            sub={r.congMult > 1 ? `${r.congMult.toFixed(1)}× floor` : "Floor pricing"}
            warn={r.congMult > 2} />
          <Stat label="Daily burn" value={`${f(r.dBurn)} DUST`} sub={`${fi(r.dailyTx)} TXs/day`} />
        </div>
        {r.congMult > 1 && (
          <div style={{ fontSize: 11, color: "var(--warn-text)", marginBottom: 12, padding: "8px 12px", borderRadius: 6, background: "var(--warn-bg)", border: "1px solid var(--warn-border)" }}>
            Congestion: ~{f(r.feeFloor)} → ~{f(r.fee)} DUST/TX ({r.congMult}× multiplier). Actual multiplier depends on duration and demand elasticity — these are conservative planning estimates.
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Stat mini label="Weekly" value={`${f(r.wBurn)} DUST`} />
          <Stat mini label="Monthly" value={`${f(r.mBurn)} DUST`} />
        </div>
      </section>

      {/* 4: NIGHT Detail */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>4 — Sustainability Breakdown</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Stat mini label="Equilibrium" value={fi(r.eqNight)} sub="Exact break-even" />
          <Stat mini label={`+${buf}% buffer`} value={fi(r.recN)} sub="Recommended" accent />
          <Stat mini label="Regen / burn"
            value={`${r.ratio.toFixed(2)}×`}
            sub={r.ratio >= 1.5 ? "Comfortable" : r.ratio >= 1 ? "Tight" : "Deficit"}
            accent={r.ratio >= 1.5} warn={r.ratio < 1} />
          <Stat mini label="Cap runway"
            value={r.runway >= 1 ? `${f(r.runway)} days` : `${f(r.runway * 24)} hrs`}
            sub="Without regen" />
        </div>
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

      {/* Planning */}
      <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>Planning Notes</h2>
        <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.7, color: "var(--label)" }}>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>All TXs require a ZK proof.</strong> DUST is shielded, so even a simple NIGHT transfer needs a DUST spend proof (0.30 DUST). Contract calls add an application circuit proof on top, bringing the fee to ~66-70 DUST. The app circuit proof is the cost — circuit complexity (k-value) barely matters.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Prices adjust every block based on previous block fullness.</strong> Below 50% → prices decrease. Above 50% → prices increase. ±4.6% per block (every 6s). At 75% sustained utilization, fees roughly 12× floor within 10 minutes. At 90%, fees double every ~96 seconds. Prices cool equally fast when demand drops.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Floor fees are the best case.</strong> All confirmed data is from near-empty preprod blocks where prices have been declining to the MIN_COST floor. On a healthy mainnet at ~50% utilization, prices stabilize but won't decrease. Plan for Target, not Floor.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Writes add marginally.</strong> Each ledger write adds ~0.4 DUST. Going from 3 to 13 writes only adds ~4 DUST (~6% of total). Optimize TX count, not writes per TX.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Cap runway is hours, not days.</strong> At ~69 DUST/TX for contract calls, your DUST cap depletes fast. Continuous regen from NIGHT is essential — any interruption (redesignation, transfer) risks outage.</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Proving time is the throughput cap.</strong> ~22s/proof regardless of k (7-12). ~160 proofs/hr per server. Scale horizontally.</div>
          <div><strong style={{ color: "var(--text)" }}>For exact fees:</strong> use <code style={{ fontSize: 10, background: "var(--input-bg)", padding: "1px 4px", borderRadius: 3 }}>Transaction.mockProve().fees(params)</code> from <code style={{ fontSize: 10, background: "var(--input-bg)", padding: "1px 4px", borderRadius: 3 }}>@midnight/ledger</code>.</div>
        </div>
      </section>

      {/* Params */}
      <section style={{ padding: "14px 16px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--label)", fontSize: 12 }}>Protocol Parameters</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 24px", fontFamily: "var(--mono)", fontSize: 11 }}>
          <div>block_time: {BLOCK_TIME_SEC}s</div>
          <div>dust/night: {DUST_PER_NIGHT} / ~7d</div>
          <div>fee_dust_proof_only: 0.30 DUST</div>
          <div>fee_with_app_circuit: ~67-70 DUST</div>
          <div>marginal/write: ~0.41 DUST</div>
          <div>price_adjust: ±4.6%/blk</div>
        </div>
      </section>

      <div style={{ textAlign: "center", fontSize: 10, color: "var(--muted)", marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--section-border)" }}>
        NIGHT Estimator v0.8 — Infinite Runway model. 5-point calibration. Fee ≈ ~68 DUST (app circuit) or 0.30 (DUST proof only).
      </div>
    </div>
  );
}
