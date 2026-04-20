import { useState, useMemo } from "react";

// ─── Protocol Constants ───
const DUST_PER_NIGHT = 5;
const TIME_TO_CAP_SECONDS = 604814;
const DUST_PER_NIGHT_PER_DAY = DUST_PER_NIGHT / (TIME_TO_CAP_SECONDS / 86400);
const BLOCK_TIME_SEC = 6;
const BLOCKS_PER_MIN = 60 / BLOCK_TIME_SEC;
const BLOCKS_PER_DAY = Math.floor(86400 / BLOCK_TIME_SEC);
const BLOCK_SIZE_LIMIT = 200_000; // bytes
const AVG_TX_SIZE = 6759; // bytes — observed from mainnet CSV
const MAX_TX_PER_BLOCK = Math.floor(BLOCK_SIZE_LIMIT / AVG_TX_SIZE);
const MAX_TX_PER_MIN = MAX_TX_PER_BLOCK * BLOCKS_PER_MIN;
const PROVING_TIME_SEC = 22;
const LOCK_DURATION_SEC = 28; // proving + submission + acceptance
const PROOFS_PER_HOUR_PER_SERVER = Math.floor(3600 / PROVING_TIME_SEC);
const MAX_WALLETS_PER_PROOF_SERVER = 3;

// ─── Fee Model ───
const FEE_NO_PROOF = 0.30;
const FEE_WITH_PROOF_BASE = 0.67;
const FEE_PER_WRITE = 0.0041;

const CALIBRATION = [
  { circuit: "NIGHT transfer", k: "—", writes: 0, fee: 0.30 },
  { circuit: "commit_action_state", k: 7, writes: 3, fee: 0.6631 },
  { circuit: "post_small_blind", k: 11, writes: 5, fee: 0.6863 },
  { circuit: "post_big_blind", k: 10, writes: 6, fee: 0.69 },
  { circuit: "commit_deck_cards", k: 10, writes: 13, fee: 0.7042 },
];

function estimateFee(hasProof, writes = 5) {
  if (!hasProof) return FEE_NO_PROOF;
  return FEE_WITH_PROOF_BASE + FEE_PER_WRITE * writes;
}

// ─── Profiles ───
const PROFILES = {
  custom: { label: "Custom", desc: "Define your own pattern", hasProof: true, writes: 5, txPerAction: 5, actionsPerDay: 200 },
  nightTransfer: { label: "NIGHT Transfer", desc: "DUST spend proof only — 0.30 DUST.", hasProof: false, writes: 0, txPerAction: 1, actionsPerDay: 1000, badge: "✓" },
  pokerTable: { label: "Poker (2P)", desc: "~15.7 TXs/game, ~4.8 games/hr. ~0.66-0.70 DUST/TX.", hasProof: true, writes: 6, txPerAction: 15.7, actionsPerDay: 115, badge: "✓" },
  lightContract: { label: "Light Contract", desc: "Simple DApp. ~0.67 DUST/TX. 200 actions/day, 1 TX each.", hasProof: true, writes: 2, txPerAction: 1, actionsPerDay: 200 },
  mediumContract: { label: "Medium Contract", desc: "DEX/lending. ~0.69 DUST/TX. 200 actions/day, 3 TXs each.", hasProof: true, writes: 6, txPerAction: 3, actionsPerDay: 200 },
  heavyContract: { label: "Heavy Contract", desc: "Complex ops. ~0.73 DUST/TX. 200 actions/day, 8 TXs each.", hasProof: true, writes: 15, txPerAction: 8, actionsPerDay: 200 },
};

const CONGESTION = {
  floor: { label: "Floor", mult: 1, desc: "Near-empty blocks. Best case." },
  target: { label: "Target (50%)", mult: 1, desc: "Network equilibrium. Plan here." },
  high: { label: "High (75%)", mult: 4, desc: "Sustained congestion. 4× fees." },
  spike: { label: "Spike (90%)", mult: 10, desc: "Short burst. 10× fees." },
};

// ─── UI Components ───
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
        <div style={{ width: 36, height: 20, borderRadius: 10, padding: 2, transition: "background 0.2s", background: value ? "var(--accent-border)" : "var(--border)" }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "transform 0.2s", transform: value ? "translateX(16px)" : "translateX(0)" }} />
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
          {o.badge && <span style={{ position: "absolute", top: -6, right: -4, fontSize: 8, fontWeight: 700, background: "var(--accent-border)", color: "#fff", padding: "1px 5px", borderRadius: 6 }}>{o.badge}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Format helpers ───
const f = (n, d = 2) => {
  if (n === 0) return "0";
  if (n < 0.01) return n.toFixed(4);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: d });
  return n.toFixed(d);
};
const fi = n => Math.ceil(n).toLocaleString();

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════
export default function NightEstimator() {
  const [mode, setMode] = useState("budget"); // "budget" | "concurrency"

  // Budget mode state
  const [pk, setPk] = useState("mediumContract");
  const [cProof, setCProof] = useState(true);
  const [cWrites, setCWrites] = useState(5);
  const [cTxPer, setCTxPer] = useState(5);
  const [cActDay, setCActDay] = useState(200);
  const [ck, setCk] = useState("target");
  const [buf, setBuf] = useState(25);
  const [showCal, setShowCal] = useState(false);

  // Concurrency mode state
  const [concUsers, setConcUsers] = useState(10);
  const [txPerUserBurst, setTxPerUserBurst] = useState(1);
  const [burstIntervalSec, setBurstIntervalSec] = useState(30);
  const [dustPerUtxo, setDustPerUtxo] = useState(10000);
  const [hasProofConc, setHasProofConc] = useState(true);
  const [writesConc, setWritesConc] = useState(6);

  // Budget mode computation
  const p = PROFILES[pk];
  const cong = CONGESTION[ck];
  const hasProof = pk === "custom" ? cProof : p.hasProof;
  const writes = pk === "custom" ? cWrites : p.writes;
  const txPer = pk === "custom" ? cTxPer : p.txPerAction;
  const actDay = pk === "custom" ? cActDay : p.actionsPerDay;

  const budgetResults = useMemo(() => {
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
      feeFloor, fee, dailyTx, dBurn, wBurn, mBurn, nFlow, nCap, minN, recN,
      eqNight: dBurn / DUST_PER_NIGHT_PER_DAY,
      congMult: priceMult, cap,
      runway: cap / dBurn, ratio: dRegen / dBurn, dRegen,
      bind: nFlow >= nCap ? "Generation rate" : "DUST cap",
    };
  }, [hasProof, writes, txPer, actDay, ck, cong, buf]);

  // Concurrency mode computation
  const concResults = useMemo(() => {
    const feePerTx = estimateFee(hasProofConc, writesConc);
    const txPerMinPerUtxo = 60 / LOCK_DURATION_SEC;

    // UTXOs needed for concurrency
    const utxosPerUser = Math.ceil(txPerUserBurst * (LOCK_DURATION_SEC / burstIntervalSec));
    const utxosNeeded = concUsers * Math.max(utxosPerUser, 1);

    // Throughput
    const maxTxPerMin = utxosNeeded * txPerMinPerUtxo;
    const chainLimited = maxTxPerMin > MAX_TX_PER_MIN;
    const effectiveTxPerMin = Math.min(maxTxPerMin, MAX_TX_PER_MIN);

    // Proof servers needed
    const proofServersForThroughput = Math.ceil(effectiveTxPerMin * 60 / PROOFS_PER_HOUR_PER_SERVER);
    const proofServersForWallets = Math.ceil(utxosNeeded / MAX_WALLETS_PER_PROOF_SERVER / 30); // rough: each server handles ~30 UTXOs across ~3 wallets
    const proofServersNeeded = Math.max(proofServersForThroughput, 1);

    // Bottleneck identification
    const utxoCapacity = utxosNeeded * txPerMinPerUtxo;
    const chainCapacity = MAX_TX_PER_MIN;
    const proofCapacity = proofServersNeeded * PROOFS_PER_HOUR_PER_SERVER / 60;
    const bottleneck = chainCapacity <= utxoCapacity && chainCapacity <= proofCapacity ? "Chain (block size)"
      : proofCapacity <= utxoCapacity ? "Proof server throughput"
      : "DUST UTXO concurrency";

    // NIGHT requirements
    // Each UTXO = 1 NIGHT UTXO. Total NIGHT needed = enough for DUST balance + enough UTXOs
    const nightPerUtxo = dustPerUtxo / DUST_PER_NIGHT; // NIGHT needed per UTXO to fill its DUST cap
    const totalNight = utxosNeeded * nightPerUtxo;

    // DUST sustainability
    const dailyTxAtCapacity = effectiveTxPerMin * 60 * 24;
    const dailyBurn = dailyTxAtCapacity * feePerTx;
    const dailyRegen = totalNight * DUST_PER_NIGHT_PER_DAY;
    const sustainable = dailyRegen >= dailyBurn;

    // How long DUST lasts per UTXO without regen
    const txPerUtxoBeforeDry = dustPerUtxo / feePerTx;
    const utxoRunwayMin = txPerUtxoBeforeDry / txPerMinPerUtxo;

    // Chain saturation: how many UTXOs to max out the chain
    const utxosToSaturate = Math.ceil(MAX_TX_PER_MIN / txPerMinPerUtxo);

    return {
      feePerTx, txPerMinPerUtxo,
      utxosPerUser, utxosNeeded,
      maxTxPerMin, effectiveTxPerMin, chainLimited,
      proofServersNeeded, bottleneck,
      nightPerUtxo, totalNight,
      dailyTxAtCapacity, dailyBurn, dailyRegen, sustainable,
      txPerUtxoBeforeDry, utxoRunwayMin,
      utxosToSaturate,
    };
  }, [concUsers, txPerUserBurst, burstIntervalSec, dustPerUtxo, hasProofConc, writesConc]);

  const r = budgetResults;
  const c = concResults;

  // ─── CSS Variables ───
  const cssVars = {
    "--text": "#E8E6E3", "--label": "#B0ADA8", "--muted": "#7A7672",
    "--bg": "#1A1917", "--card-bg": "#232220", "--input-bg": "#1E1D1B",
    "--border": "#3A3835", "--accent-bg": "#1B2A1F", "--accent-border": "#2D5A3A",
    "--accent-text": "#6BCB7F", "--warn-bg": "#2A1F1B", "--warn-border": "#5A3A2D",
    "--warn-text": "#E8944A", "--section-border": "#2A2826",
    "--testnet-bg": "#1B1F2A", "--testnet-border": "#2D3A5A", "--testnet-text": "#7BA4E8",
    "--mono": "'JetBrains Mono', monospace",
  };

  return (
    <div style={{
      ...cssVars,
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      color: "var(--text)", background: "var(--bg)",
      minHeight: "100vh", padding: "24px 20px", maxWidth: 740, margin: "0 auto",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>◑</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>NIGHT Estimator</h1>
          <span style={{ fontSize: 10, fontWeight: 600, background: "var(--accent-border)", color: "#fff", padding: "2px 8px", borderRadius: 10 }}>v1.0</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>DUST budget &amp; concurrency planning for Midnight DApp operators.</p>
      </div>

      {/* Mode Toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
        {[
          { key: "budget", label: "DUST Budget", icon: "◈" },
          { key: "concurrency", label: "Concurrency", icon: "⫘" },
        ].map(m => (
          <button key={m.key} onClick={() => setMode(m.key)} style={{
            flex: 1, padding: "12px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
            background: mode === m.key ? "var(--accent-bg)" : "var(--card-bg)",
            color: mode === m.key ? "var(--accent-text)" : "var(--muted)",
            borderBottom: mode === m.key ? "2px solid var(--accent-border)" : "2px solid transparent",
            transition: "all 0.2s",
          }}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* BUDGET MODE */}
      {/* ═══════════════════════════════════════════════════════ */}
      {mode === "budget" && (
        <>
          {/* Calibration banner */}
          <div style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 20, background: "var(--testnet-bg)", border: "1px solid var(--testnet-border)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--testnet-text)", marginBottom: 4 }}>Fee structure — 5 data points</div>
            <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--testnet-text)" }}>Two tiers:</strong> NIGHT transfers: <strong style={{ color: "var(--testnet-text)" }}>0.30 DUST</strong>. Contract calls: <strong style={{ color: "var(--testnet-text)" }}>~0.66-0.70 DUST</strong> (±3% regardless of circuit complexity).
              <span style={{ cursor: "pointer", color: "var(--testnet-text)", textDecoration: "underline", fontSize: 10, marginLeft: 4 }} onClick={() => setShowCal(!showCal)}>{showCal ? "hide ▲" : "data ▼"}</span>
            </div>
            {showCal && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "var(--mono)", marginTop: 8 }}>
                <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Circuit", "k", "Writes", "Fee", "Model"].map(h => <th key={h} style={{ padding: "4px 8px", textAlign: "left", color: "var(--label)" }}>{h}</th>)}
                </tr></thead>
                <tbody>{CALIBRATION.map((c, i) => {
                  const pred = c.writes === 0 && c.k === "—" ? FEE_NO_PROOF : estimateFee(true, c.writes);
                  return <tr key={i} style={{ borderBottom: "1px solid var(--section-border)" }}>
                    <td style={{ padding: "4px 8px", color: "var(--text)" }}>{c.circuit}</td>
                    <td style={{ padding: "4px 8px", color: "var(--muted)" }}>{c.k}</td>
                    <td style={{ padding: "4px 8px", color: "var(--muted)" }}>{c.writes}</td>
                    <td style={{ padding: "4px 8px", color: "var(--accent-text)", fontWeight: 600 }}>{c.fee.toFixed(4)}</td>
                    <td style={{ padding: "4px 8px", color: "var(--muted)" }}>{pred.toFixed(4)}</td>
                  </tr>;
                })}</tbody>
              </table>
            )}
          </div>

          {/* Hero */}
          <div style={{
            padding: "24px 20px", borderRadius: 12, marginBottom: 28, textAlign: "center",
            background: r.ratio >= 1 ? "var(--accent-bg)" : "var(--warn-bg)",
            border: `2px solid ${r.ratio >= 1 ? "var(--accent-border)" : "var(--warn-border)"}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)", marginBottom: 10 }}>Infinite Runway Target</div>
            <div style={{ fontSize: 44, fontWeight: 800, fontFamily: "var(--mono)", color: "var(--text)", lineHeight: 1.1 }}>
              {fi(r.recN)}<span style={{ fontSize: 20, fontWeight: 600, color: "var(--accent-text)", marginLeft: 8 }}>NIGHT</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--label)", marginTop: 10 }}>Hold this amount to generate DUST faster than you burn it — indefinitely.</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
              Burn: <strong style={{ color: "var(--text)" }}>{f(r.dBurn)}</strong> DUST/day · Regen: <strong style={{ color: "var(--text)" }}>{f(r.dRegen)}</strong> DUST/day · Surplus: <strong style={{ color: r.ratio >= 1 ? "var(--accent-text)" : "var(--warn-text)" }}>{r.ratio >= 1 ? "+" : ""}{f(r.dRegen - r.dBurn)}</strong>/day
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 8, borderTop: `1px solid ${r.ratio >= 1 ? "var(--accent-border)" : "var(--warn-border)"}`, paddingTop: 8 }}>
              Equilibrium: {fi(r.eqNight)} NIGHT · +{buf}% buffer
            </div>
          </div>

          {/* Profile */}
          <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>Transaction Profile</h2>
            <Pills options={Object.entries(PROFILES).map(([k, v]) => ({ value: k, label: v.label, badge: v.badge }))} value={pk} onChange={setPk} />
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0", fontStyle: "italic" }}>{p.desc}</p>
            {pk === "custom" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginTop: 14 }}>
                <div>
                  <Toggle label="Application circuit proof" value={cProof} onChange={setCProof} help="Contract calls: ~0.67+ DUST. Transfers: 0.30 DUST." />
                  <NumInput label="Ledger writes / TX" value={cWrites} onChange={setCWrites} min={0} max={50} step={1} help="~0.004 DUST each" />
                </div>
                <div>
                  <NumInput label="TXs per action" value={cTxPer} onChange={setCTxPer} step={1} />
                  <NumInput label="Actions / day" value={cActDay} onChange={setCActDay} step={10} />
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <Stat mini label="Fee/TX" value={`~${f(estimateFee(hasProof, writes))}`} sub="DUST" />
                <Stat mini label="TXs/action" value={txPer} />
                <Stat mini label="Actions/day" value={actDay} />
                <Stat mini label="Daily TXs" value={fi(txPer * actDay)} />
              </div>
            )}
          </section>

          {/* Congestion */}
          <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 10 }}>Network Conditions</h2>
            <Pills options={Object.entries(CONGESTION).map(([k, v]) => ({ value: k, label: v.label }))} value={ck} onChange={setCk} />
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 12px" }}>{cong.desc}</p>
            <div style={{ maxWidth: 200 }}>
              <NumInput label="Safety buffer" value={buf} onChange={setBuf} unit="%" min={0} max={200} step={5} />
            </div>
          </section>

          {/* Sustainability */}
          <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>Sustainability</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <Stat mini label="Daily burn" value={`${f(r.dBurn)} DUST`} sub={`${fi(r.dailyTx)} TXs`} />
              <Stat mini label="Weekly" value={`${f(r.wBurn)} DUST`} />
              <Stat mini label="Regen/burn" value={`${r.ratio.toFixed(2)}×`} accent={r.ratio >= 1.5} warn={r.ratio < 1} sub={r.ratio >= 1.5 ? "Comfortable" : r.ratio >= 1 ? "Tight" : "Deficit"} />
              <Stat mini label="Cap runway" value={r.runway >= 1 ? `${f(r.runway)}d` : `${f(r.runway * 24)}h`} sub="W/o regen" />
            </div>
          </section>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* CONCURRENCY MODE */}
      {/* ═══════════════════════════════════════════════════════ */}
      {mode === "concurrency" && (
        <>
          {/* Chain limits banner */}
          <div style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 20, background: "var(--testnet-bg)", border: "1px solid var(--testnet-border)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--testnet-text)", marginBottom: 4 }}>UTXO Concurrency Model</div>
            <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
              Each NIGHT UTXO generates 1 DUST UTXO. DUST UTXOs lock during proving (~{LOCK_DURATION_SEC}s). More UTXOs = more concurrent TXs. Chain max: ~{MAX_TX_PER_BLOCK} TXs/block ({fi(MAX_TX_PER_MIN)} TXs/min). Split NIGHT UTXOs to increase concurrency.
            </div>
          </div>

          {/* Hero: Concurrency */}
          <div style={{
            padding: "24px 20px", borderRadius: 12, marginBottom: 28, textAlign: "center",
            background: c.chainLimited ? "var(--warn-bg)" : "var(--accent-bg)",
            border: `2px solid ${c.chainLimited ? "var(--warn-border)" : "var(--accent-border)"}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)", marginBottom: 10 }}>
              Infrastructure Required
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 40, fontWeight: 800, fontFamily: "var(--mono)", color: "var(--text)" }}>{fi(c.utxosNeeded)}</div>
                <div style={{ fontSize: 12, color: "var(--accent-text)", fontWeight: 600 }}>DUST UTXOs</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>(= NIGHT UTXOs to split)</div>
              </div>
              <div>
                <div style={{ fontSize: 40, fontWeight: 800, fontFamily: "var(--mono)", color: "var(--text)" }}>{fi(c.totalNight)}</div>
                <div style={{ fontSize: 12, color: "var(--accent-text)", fontWeight: 600 }}>NIGHT</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>({fi(c.nightPerUtxo)}/UTXO × {fi(dustPerUtxo)} DUST cap)</div>
              </div>
              <div>
                <div style={{ fontSize: 40, fontWeight: 800, fontFamily: "var(--mono)", color: "var(--text)" }}>{c.proofServersNeeded}</div>
                <div style={{ fontSize: 12, color: "var(--accent-text)", fontWeight: 600 }}>Proof Servers</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>({PROOFS_PER_HOUR_PER_SERVER} proofs/hr each)</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 14, borderTop: `1px solid ${c.chainLimited ? "var(--warn-border)" : "var(--accent-border)"}`, paddingTop: 8 }}>
              Throughput: <strong style={{ color: "var(--text)" }}>{f(c.effectiveTxPerMin)}</strong> TXs/min · Bottleneck: <strong style={{ color: c.chainLimited ? "var(--warn-text)" : "var(--accent-text)" }}>{c.bottleneck}</strong>
              {c.chainLimited && <span style={{ color: "var(--warn-text)" }}> — Chain saturated, more UTXOs won't help</span>}
            </div>
          </div>

          {/* Inputs */}
          <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>Workload</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
              <NumInput label="Concurrent users" value={concUsers} onChange={setConcUsers} min={1} step={1} help="Users submitting TXs simultaneously" />
              <NumInput label="TXs per user burst" value={txPerUserBurst} onChange={setTxPerUserBurst} min={1} step={1} help="TXs each user sends before waiting" />
              <NumInput label="Burst interval" value={burstIntervalSec} onChange={setBurstIntervalSec} unit="sec" min={1} step={1} help="Time between each user's TX submissions" />
              <NumInput label="DUST per UTXO" value={dustPerUtxo} onChange={setDustPerUtxo} min={100} step={1000} help="DUST balance in each UTXO (~10K+ typical)" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginTop: 8 }}>
              <Toggle label="Application circuit proof" value={hasProofConc} onChange={setHasProofConc} help="Contract calls vs simple transfers" />
              <NumInput label="Ledger writes / TX" value={writesConc} onChange={setWritesConc} min={0} max={50} step={1} />
            </div>
          </section>

          {/* Throughput Analysis */}
          <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>Throughput Analysis</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <Stat mini label="UTXOs/user" value={c.utxosPerUser} sub={`${LOCK_DURATION_SEC}s lock ÷ ${burstIntervalSec}s interval`} />
              <Stat mini label="Your capacity" value={`${f(c.maxTxPerMin)}/min`} sub={c.chainLimited ? "Exceeds chain limit" : "UTXO-limited"} warn={c.chainLimited} />
              <Stat mini label="Chain max" value={`${fi(MAX_TX_PER_MIN)}/min`} sub={`${MAX_TX_PER_BLOCK} TXs × ${BLOCKS_PER_MIN} blk/min`} />
              <Stat mini label="Fee/TX" value={`${f(c.feePerTx)} DUST`} />
            </div>

            {/* UTXO runway */}
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--label)", marginBottom: 4 }}>Per-UTXO Capacity</div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                Each UTXO holds <strong style={{ color: "var(--text)" }}>{fi(dustPerUtxo)} DUST</strong> → <strong style={{ color: "var(--text)" }}>{fi(c.txPerUtxoBeforeDry)}</strong> TXs before depletion →
                at max throughput, <strong style={{ color: "var(--text)" }}>{f(c.utxoRunwayMin)} min</strong> before needing regen.
                Regen rate: {DUST_PER_NIGHT_PER_DAY.toFixed(4)} DUST/NIGHT/day.
              </div>
            </div>

            {/* Sustainability check */}
            <div style={{
              padding: "10px 14px", borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: "var(--label)",
              background: c.sustainable ? "var(--accent-bg)" : "var(--warn-bg)",
              border: `1px solid ${c.sustainable ? "var(--accent-border)" : "var(--warn-border)"}`,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--text)" }}>
                {c.sustainable ? "✓ Sustainable at full throughput" : "⚠ Burns faster than regen at full throughput"}
              </div>
              <div>Daily burn at capacity: <strong>{f(c.dailyBurn)}</strong> DUST · Daily regen: <strong>{f(c.dailyRegen)}</strong> DUST</div>
              {!c.sustainable && <div style={{ color: "var(--warn-text)", marginTop: 4 }}>Increase NIGHT holdings or reduce throughput. DUST UTXOs will deplete over time.</div>}
            </div>
          </section>

          {/* Scaling reference */}
          <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>Scaling Reference</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "var(--mono)" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["UTXOs", "Concurrent", "TXs/min", "TXs/hr", "NIGHT", "Proof Servers", "Status"].map(h =>
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: "var(--label)", fontWeight: 600 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {[1, 5, 10, 25, 50, 100, c.utxosToSaturate].map(n => {
                    const txMin = Math.min(n * (60 / LOCK_DURATION_SEC), MAX_TX_PER_MIN);
                    const sat = txMin >= MAX_TX_PER_MIN;
                    const night = n * c.nightPerUtxo;
                    const servers = Math.max(Math.ceil(txMin * 60 / PROOFS_PER_HOUR_PER_SERVER), 1);
                    return <tr key={n} style={{ borderBottom: "1px solid var(--section-border)", background: n === c.utxosNeeded ? "var(--accent-bg)" : undefined }}>
                      <td style={{ padding: "5px 8px", color: "var(--text)" }}>{n}</td>
                      <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{n}</td>
                      <td style={{ padding: "5px 8px", color: "var(--text)" }}>{f(txMin)}</td>
                      <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{fi(txMin * 60)}</td>
                      <td style={{ padding: "5px 8px", color: "var(--text)" }}>{fi(night)}</td>
                      <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{servers}</td>
                      <td style={{ padding: "5px 8px", color: sat ? "var(--warn-text)" : "var(--accent-text)" }}>{sat ? "Chain max" : "OK"}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Planning Notes */}
          <section style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--section-border)" }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14 }}>Concurrency Notes</h2>
            <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.7, color: "var(--label)" }}>
              <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>1 NIGHT UTXO = 1 DUST UTXO.</strong> Split your NIGHT holdings into N separate UTXOs to get N concurrent transaction slots. Each DUST UTXO locks for ~{LOCK_DURATION_SEC}s during proving + submission.</div>
              <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Spending creates change.</strong> When a DUST UTXO pays a fee, it's nullified and a new UTXO is created with the remaining balance. The new UTXO isn't available until the TX is accepted on-chain.</div>
              <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Proof servers handle ~2-3 wallets.</strong> Beyond that, performance degrades. Scale proof servers horizontally — each handles ~{PROOFS_PER_HOUR_PER_SERVER} proofs/hr.</div>
              <div style={{ marginBottom: 8 }}><strong style={{ color: "var(--text)" }}>Block size is the hard ceiling.</strong> At ~{fi(AVG_TX_SIZE)}B per TX and {fi(BLOCK_SIZE_LIMIT)}B per block, the chain caps at ~{MAX_TX_PER_BLOCK} TXs/block ({fi(MAX_TX_PER_MIN)} TXs/min). ~{c.utxosToSaturate} UTXOs saturates the chain.</div>
              <div><strong style={{ color: "var(--text)" }}>DUST regenerates linearly.</strong> Same rate as initial generation. After spending, the UTXO refills at {DUST_PER_NIGHT_PER_DAY.toFixed(4)} DUST/NIGHT/day toward its cap.</div>
            </div>
          </section>
        </>
      )}

      {/* Protocol Params (both modes) */}
      <section style={{ padding: "14px 16px", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--label)", fontSize: 12 }}>Protocol Parameters</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 24px", fontFamily: "var(--mono)", fontSize: 11 }}>
          <div>block_time: {BLOCK_TIME_SEC}s ({BLOCKS_PER_MIN} blk/min)</div>
          <div>dust/night: {DUST_PER_NIGHT} / ~7d</div>
          <div>block_size: {fi(BLOCK_SIZE_LIMIT)}B</div>
          <div>avg_tx_size: {fi(AVG_TX_SIZE)}B</div>
          <div>proving_time: ~{PROVING_TIME_SEC}s</div>
          <div>lock_duration: ~{LOCK_DURATION_SEC}s</div>
          <div>fee_transfer: 0.30 DUST</div>
          <div>fee_contract: ~0.67-0.70 DUST</div>
        </div>
      </section>

      <div style={{ textAlign: "center", fontSize: 10, color: "var(--muted)", marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--section-border)" }}>
        NIGHT Estimator v1.0 — DUST Budget + Concurrency Planning. 5-point fee calibration. UTXO lock model.
      </div>
    </div>
  );
}
