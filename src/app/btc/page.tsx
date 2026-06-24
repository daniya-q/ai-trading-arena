"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { createChart, HistogramSeries, AreaSeries, ColorType, createSeriesMarkers } from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";

const BACKEND = "https://ai-trading-arena-backend-production.up.railway.app";

// ── Types ──────────────────────────────────────────────────────

type BtcStrategy = {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  sort_order: number;
};

type BtcCapital = {
  strategy_id: string;
  allocated_inr: number;
  total_pnl_inr: number;
  total_trades: number;
  winning_trades: number;
  sharpe_ratio: number;
};

type BtcPosition = {
  id: string;
  strategy_id: string;
  side: "LONG" | "SHORT";
  entry_price_usd: number;
  current_price_usd: number;
  exit_price_usd: number | null;
  qty_inr: number;
  pnl_inr: number;
  stop_loss: number | null;
  trail_sl: number | null;
  leverage: number | null;
  status: "OPEN" | "CLOSED";
  opened_at: string;
  closed_at: string | null;
  entry_reason: string | null;
  exit_reason: string | null;
  exit_reason_detail: string | null;
  // Tiered trail / partial booking (migration 006)
  partial_booked: boolean | null;
  partial_qty_inr: number | null;
  remaining_qty_inr: number | null;
  current_tier: number | null;
  realized_pnl: number | null;
};

type OhlcCandle = { time: number; open: number; high: number; low: number; close: number };
type CapitalPoint = { date: string; capital: number };
type CorrelationData = {
  strategies: string[];
  matrix: (number | null)[][] | null;
  insufficient?: boolean;
};
type CardMetrics = { profit_factor: string; max_drawdown_inr: number };

// ── BTC Strategy Config ────────────────────────────────────────

const ACCENT: Record<string, string> = {
  btc_ema_crossover:  "#F59E0B",
  btc_orion:          "#6366F1",
  btc_ema_confluence: "#10B981",
  btc_supertrend:     "#EF4444",
  btc_vwap_scalper:   "#F97316",
};

// ── Formatters ─────────────────────────────────────────────────

function fmtINR(n: number): string {
  return Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function pnlStr(n: number): string {
  return `${n >= 0 ? "+" : "-"}₹${fmtINR(n)}`;
}
function pnlColor(n: number): string {
  if (n === 0) return "#ffffff";
  return n > 0 ? "#4ade80" : "#f87171";
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) + " IST";
}
function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function pfColor(pf: string): string {
  if (pf === "N/A") return "#6b7280";
  const v = parseFloat(pf);
  if (v > 1.5) return "#4ade80";
  if (v >= 1)  return "#facc15";
  return "#f87171";
}
function winRate(cap: BtcCapital | undefined): string {
  if (!cap || cap.total_trades === 0) return "—";
  return `${((cap.winning_trades / cap.total_trades) * 100).toFixed(0)}%`;
}

// ── BtcTopBar ──────────────────────────────────────────────────

type BtcPrices = { btcPrice: number; ethPrice: number; btcChange: number; btcChangePct: number };

function BtcTopBar() {
  const [prices,  setPrices]  = useState<BtcPrices>({ btcPrice: 0, ethPrice: 0, btcChange: 0, btcChangePct: 0 });
  const [utcTime, setUtcTime] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const utc = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
      const ist = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
      setUtcTime(`UTC ${utc} · IST ${ist}`);
    };
    tick();
    const iv = setInterval(tick, 1_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch(`${BACKEND}/api/btc/prices`)
        .then(r => r.json())
        .then(d => { if (!cancelled) setPrices(d as BtcPrices); })
        .catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 1_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const { btcPrice, ethPrice, btcChange, btcChangePct } = prices;
  const btcColor = btcChange > 0 ? "#22c55e" : btcChange < 0 ? "#f87171" : "#6b7280";

  return (
    <div style={{
      background: "#0B0E17",
      border: "1px solid #1a1f2e",
      borderRadius: 12,
      padding: "10px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 10,
      marginBottom: 10,
    }}>
      {/* Market status */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 140 }}>
        <span className="pulse" style={{
          display: "inline-block", width: 8, height: 8, borderRadius: "50%",
          background: "#22c55e", boxShadow: "0 0 8px #22c55e88", flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
          MARKET OPEN 24/7
        </span>
      </div>

      {/* Prices */}
      <div className="top-bar-indices" style={{ display: "flex", gap: 28, flexWrap: "wrap", justifyContent: "center", flex: 1 }}>
        {/* BTC/USD */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", marginBottom: 2, fontWeight: 600 }}>BTC / USD</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#F59E0B", fontFamily: "monospace", lineHeight: 1 }}>
            {btcPrice > 0 ? `$${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
          </div>
          <div style={{ fontSize: 12, color: btcColor, fontFamily: "monospace", marginTop: 2 }}>
            {btcPrice > 0 && btcChange !== 0
              ? `${btcChange >= 0 ? "+" : ""}${btcChange.toFixed(2)} (${btcChangePct >= 0 ? "+" : ""}${btcChangePct.toFixed(2)}%)`
              : "—"}
          </div>
        </div>

        {/* ETH/USD */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", marginBottom: 2, fontWeight: 600 }}>ETH / USD</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#8B5CF6", fontFamily: "monospace", lineHeight: 1 }}>
            {ethPrice > 0 ? `$${ethPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "monospace", marginTop: 2 }}>LIVE</div>
        </div>
      </div>

      {/* Clock */}
      <div style={{ textAlign: "right", minWidth: 180 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", marginBottom: 2, fontWeight: 600 }}>TIME</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#ffffff", fontFamily: "monospace" }}>{utcTime}</div>
      </div>
    </div>
  );
}

// ── BtcCapitalSummaryBar ────────────────────────────────────────

function BtcCapitalSummaryBar({
  capitals,
  openPositions,
  positions,
  btcPrice,
}: {
  capitals: BtcCapital[];
  openPositions: BtcPosition[];
  positions: BtcPosition[];
  btcPrice: number;
}) {
  const STARTING = 500_000; // 5 × ₹1,00,000

  const totalCurrent = useMemo(() => {
    return capitals.reduce((sum, cap) => {
      const liveOpenPnl = openPositions
        .filter(p => p.strategy_id === cap.strategy_id)
        .reduce((s, p) => {
          if (!btcPrice) return s + (p.pnl_inr ?? 0);
          const pct = p.side === "LONG"
            ? (btcPrice - p.entry_price_usd) / p.entry_price_usd
            : (p.entry_price_usd - btcPrice) / p.entry_price_usd;
          return s + pct * p.qty_inr;
        }, 0);
      return sum + cap.allocated_inr + (cap.total_pnl_inr ?? 0) + liveOpenPnl;
    }, 0);
  }, [capitals, openPositions, btcPrice]);

  const { daysPnl, daysReturn, avgPnlToday } = useMemo(() => {
    const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const todayClosed = positions.filter(p => p.status === "CLOSED" && p.closed_at?.startsWith(todayIST));
    const todayClosedPnl = todayClosed.reduce((s, p) => s + (p.pnl_inr ?? 0), 0);
    const liveOpenPnl = openPositions.reduce((s, p) => {
      if (!btcPrice) return s + (p.pnl_inr ?? 0);
      const rem = p.remaining_qty_inr ?? p.qty_inr;
      const pct = p.side === "LONG"
        ? (btcPrice - p.entry_price_usd) / p.entry_price_usd
        : (p.entry_price_usd - btcPrice) / p.entry_price_usd;
      return s + (p.realized_pnl ?? 0) + pct * rem;
    }, 0);
    const daysPnl = todayClosedPnl + liveOpenPnl;
    const avgPnlToday = todayClosed.length > 0 ? todayClosedPnl / todayClosed.length : null;
    return { daysPnl, daysReturn: STARTING > 0 ? (daysPnl / STARTING) * 100 : 0, avgPnlToday };
  }, [positions, openPositions, btcPrice]);

  const totalPnl  = totalCurrent - STARTING;
  const returnPct = STARTING > 0 ? (totalPnl / STARTING) * 100 : 0;
  const pColor    = totalPnl > 0 ? "#4ade80" : totalPnl < 0 ? "#f87171" : "#9ca3af";
  const rColor    = returnPct > 0 ? "#4ade80" : returnPct < 0 ? "#f87171" : "#9ca3af";
  const dpColor   = daysPnl > 0 ? "#4ade80" : daysPnl < 0 ? "#f87171" : "#9ca3af";
  const drColor   = daysReturn > 0 ? "#4ade80" : daysReturn < 0 ? "#f87171" : "#9ca3af";
  const apColor   = avgPnlToday != null ? (avgPnlToday > 0 ? "#4ade80" : avgPnlToday < 0 ? "#f87171" : "#9ca3af") : "#4b5563";

  const stats = [
    { label: "STARTING CAPITAL",    value: "₹5,00,000",                                                              color: "#9ca3af" },
    { label: "TOTAL CAPITAL",       value: `₹${totalCurrent.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: "#ffffff" },
    { label: "TOTAL PnL",           value: `${totalPnl >= 0 ? "+" : ""}₹${Math.abs(totalPnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: pColor },
    { label: "TOTAL RETURN",        value: `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2)}%`,                    color: rColor },
    { label: "DAY'S PnL",           value: `${daysPnl >= 0 ? "+" : ""}₹${Math.abs(daysPnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: dpColor },
    { label: "DAY'S RETURN",        value: `${daysReturn >= 0 ? "+" : ""}${daysReturn.toFixed(2)}%`,                  color: drColor },
    { label: "AVG PNL/TRADE TODAY", value: avgPnlToday != null ? `${avgPnlToday >= 0 ? "+" : ""}₹${Math.abs(avgPnlToday).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—", color: apColor },
  ];

  return (
    <div style={{
      background: "#0B0E17",
      border: "1px solid #1a1f2e",
      borderRadius: 12,
      display: "flex",
      marginBottom: 10,
      overflow: "hidden",
    }}>
      {stats.map((s, i) => (
        <div key={s.label} style={{
          flex: 1,
          padding: "12px 20px",
          borderLeft: i > 0 ? "1px solid #1a1f2e" : undefined,
        }}>
          <div style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.1em", marginBottom: 5, fontWeight: 600 }}>{s.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── BTC panel tier config (mirrors server BTC_TIER_CONFIG) ─────

const BTC_PANEL_CFG: Record<string, {
  partialMultiplier: number;
  partialPct: number;
  tiers: { multiplier: number; trailPct: number }[];
}> = {
  btc_ema_crossover:  { partialMultiplier: 1.0, partialPct: 0.30, tiers: [{ multiplier: 1, trailPct: 0.70 }, { multiplier: 2, trailPct: 0.80 }, { multiplier: 4, trailPct: 0.90 }] },
  btc_orion:          { partialMultiplier: 1.0, partialPct: 0.30, tiers: [{ multiplier: 1, trailPct: 0.75 }, { multiplier: 2, trailPct: 0.85 }, { multiplier: 4, trailPct: 0.92 }] },
  btc_ema_confluence: { partialMultiplier: 1.0, partialPct: 0.35, tiers: [{ multiplier: 1, trailPct: 0.70 }, { multiplier: 2, trailPct: 0.82 }, { multiplier: 3, trailPct: 0.92 }] },
  btc_supertrend:     { partialMultiplier: 1.0, partialPct: 0.30, tiers: [{ multiplier: 1, trailPct: 0.72 }, { multiplier: 2, trailPct: 0.84 }, { multiplier: 4, trailPct: 0.92 }] },
  btc_vwap_scalper:   { partialMultiplier: 0.5, partialPct: 0.40, tiers: [{ multiplier: 0.5, trailPct: 0.80 }, { multiplier: 1, trailPct: 0.88 }, { multiplier: 2, trailPct: 0.95 }] },
};

const USD_INR = 83; // fixed rate for BTC qty display

// ── BtcOpenTradesPanel ─────────────────────────────────────────

function BtcOpenTradesPanel({
  openPositions,
  strategies,
  btcPrice,
}: {
  openPositions: BtcPosition[];
  strategies: BtcStrategy[];
  btcPrice: number;
}) {
  const thStyle: React.CSSProperties = {
    padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#4b5563",
    textAlign: "left" as const, letterSpacing: "0.08em",
    whiteSpace: "nowrap" as const, borderBottom: "1px solid #1a1f2e",
    background: "#070A11",
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
        padding: "10px 16px", borderBottom: "1px solid #1a1f2e",
      }}>
        <span className="pulse" style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#f5d547", boxShadow: "0 0 6px #f5d54788", flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#f5d547", letterSpacing: "0.1em" }}>
          LIVE OPEN TRADES — BTC ARENA
        </span>
        <span style={{ fontSize: 10, color: "#374151", marginLeft: "auto" }}>
          {openPositions.length} open · 1s refresh
        </span>
      </div>

      {openPositions.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 4 }}>No open trades</div>
            <div style={{ fontSize: 10, color: "#1f2937" }}>All BTC strategies are flat</div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1320 }}>
            <thead>
              <tr>
                {["Strategy","Side","Entry USD","Qty (BTC)","Leverage","Entry Time","BTC Price","Live PnL","SL","Partial Booking","Tier","Trail SL"].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {openPositions.map(pos => {
                const stratName    = strategies.find(s => s.id === pos.strategy_id)?.name ?? pos.strategy_id;
                const cfg          = BTC_PANEL_CFG[pos.strategy_id];
                const tier         = pos.current_tier ?? 0;
                const remainingQty = pos.remaining_qty_inr ?? pos.qty_inr;
                const realizedPnl  = pos.realized_pnl ?? 0;
                const partialQtyInr = pos.partial_qty_inr ?? 0;

                // ── Live PnL on remaining ──────────────────────
                const livePnlOnRem = btcPrice > 0 && remainingQty > 0
                  ? (pos.side === "LONG"
                      ? (btcPrice - pos.entry_price_usd) / pos.entry_price_usd
                      : (pos.entry_price_usd - btcPrice) / pos.entry_price_usd) * remainingQty
                  : 0;
                const totalPnl = realizedPnl + livePnlOnRem;

                // ── Qty (BTC) ──────────────────────────────────
                const btcQty = pos.qty_inr > 0 && pos.entry_price_usd > 0
                  ? (pos.qty_inr / USD_INR) / pos.entry_price_usd
                  : 0;

                // ── SL column ─────────────────────────────────
                let slCell = "—";
                if (pos.stop_loss !== null) {
                  const slPctRaw = (pos.stop_loss - pos.entry_price_usd) / pos.entry_price_usd * 100;
                  const slPctStr = `${slPctRaw >= 0 ? "+" : ""}${slPctRaw.toFixed(1)}%`;
                  slCell = `$${pos.stop_loss.toLocaleString("en-US", { maximumFractionDigits: 0 })} (${slPctStr})`;
                }

                // ── Partial Booking column ────────────────────
                let partialCell: React.ReactNode = <span style={{ color: "#374151" }}>—</span>;
                if (pos.partial_booked) {
                  const bookedPct = pos.qty_inr > 0 ? Math.round(partialQtyInr / pos.qty_inr * 100) : 0;
                  // Derive booking price from realized PnL
                  const bookedPriceUsd = partialQtyInr > 0
                    ? (pos.side === "LONG"
                        ? pos.entry_price_usd * (1 + realizedPnl / partialQtyInr)
                        : pos.entry_price_usd * (1 - realizedPnl / partialQtyInr))
                    : 0;
                  partialCell = (
                    <span>
                      <span style={{ color: "#4ade80", fontWeight: 700 }}>✓ Booked {bookedPct}%</span>
                      <span style={{ color: "#6b7280" }}> @ </span>
                      <span style={{ color: "#9ca3af", fontFamily: "monospace" }}>${bookedPriceUsd > 0 ? bookedPriceUsd.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</span>
                      <span style={{ color: "#4ade80" }}> (+₹{fmtINR(realizedPnl)} realized)</span>
                    </span>
                  );
                } else if (cfg && pos.stop_loss !== null) {
                  const slDist = Math.abs(pos.entry_price_usd - pos.stop_loss);
                  const triggerPrice = pos.side === "LONG"
                    ? pos.entry_price_usd + cfg.partialMultiplier * slDist
                    : pos.entry_price_usd - cfg.partialMultiplier * slDist;
                  const pct = Math.round(cfg.partialPct * 100);
                  partialCell = (
                    <span>
                      <span style={{ color: "#94a3b8" }}>Books {pct}%</span>
                      <span style={{ color: "#6b7280" }}> @ </span>
                      <span style={{ color: "#9ca3af", fontFamily: "monospace" }}>${triggerPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                      <span style={{ color: "#4b5563" }}> (+{cfg.partialMultiplier}× SL)</span>
                    </span>
                  );
                }

                // ── Tier column ───────────────────────────────
                let tierCell: React.ReactNode;
                if (tier === 0) {
                  tierCell = <span style={{ fontSize: 11, color: "#4b5563" }}>Tier 0</span>;
                } else {
                  const lockPct = cfg && tier <= cfg.tiers.length
                    ? Math.round(cfg.tiers[tier - 1].trailPct * 100)
                    : 0;
                  tierCell = (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#f5d547", background: "rgba(245,213,71,0.12)", padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap" }}>
                      Tier {tier} ({lockPct}%)
                    </span>
                  );
                }

                // ── Trail SL column ───────────────────────────
                let trailCell: React.ReactNode;
                if (pos.trail_sl !== null) {
                  const lockPct = cfg && tier > 0 && tier <= cfg.tiers.length
                    ? Math.round(cfg.tiers[tier - 1].trailPct * 100)
                    : 0;
                  trailCell = (
                    <span>
                      <span style={{ color: "#f5d547", fontFamily: "monospace", fontWeight: 600 }}>${pos.trail_sl.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                      {lockPct > 0 && <span style={{ color: "#6b7280" }}> (Locking {lockPct}%)</span>}
                    </span>
                  );
                } else {
                  trailCell = <span style={{ color: "#374151", fontSize: 10 }}>Pending partial book</span>;
                }

                // ── Live PnL column ───────────────────────────
                let pnlCell: React.ReactNode;
                if (pos.partial_booked && realizedPnl !== 0) {
                  pnlCell = (
                    <span>
                      <span style={{ color: pnlColor(totalPnl), fontWeight: 700 }}>{pnlStr(totalPnl)}</span>
                      <br />
                      <span style={{ color: "#4b5563", fontSize: 10 }}>
                        ₹{fmtINR(realizedPnl)} realized + ₹{fmtINR(livePnlOnRem)} live
                      </span>
                    </span>
                  );
                } else {
                  pnlCell = <span style={{ color: pnlColor(totalPnl), fontWeight: 700 }}>{pnlStr(totalPnl)}</span>;
                }

                return (
                  <tr key={pos.id} style={{ borderTop: "1px solid #0f1520" }}>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: ACCENT[pos.strategy_id] ?? "#9ca3af", fontWeight: 600, whiteSpace: "nowrap" }}>{stratName}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: pos.side === "LONG" ? "#22c55e" : "#ef4444" }}>{pos.side}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace", color: "#9ca3af" }}>${pos.entry_price_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, fontFamily: "monospace", color: "#94a3b8" }}>{btcQty > 0 ? `${btcQty.toFixed(4)} BTC` : "—"}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "#6b7280" }}>{pos.leverage ? `${pos.leverage}×` : "—"}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "#4b5563" }}>{fmtTime(pos.opened_at)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace", color: "#f5d547", fontWeight: 600 }}>
                      {btcPrice > 0 ? `$${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>{pnlCell}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, fontFamily: "monospace", color: "#ef4444", whiteSpace: "nowrap" }}>{slCell}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, whiteSpace: "nowrap" }}>{partialCell}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{tierCell}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, whiteSpace: "nowrap" }}>{trailCell}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── BtcClosedTodayPanel ────────────────────────────────────────

function BtcClosedTodayPanel({
  positions,
  strategies,
}: {
  positions: BtcPosition[];
  strategies: BtcStrategy[];
}) {
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const rows = positions
    .filter(p => p.status === "CLOSED" && p.closed_at &&
      new Date(p.closed_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === todayIST)
    .sort((a, b) => new Date(b.closed_at!).getTime() - new Date(a.closed_at!).getTime());

  const thStyle: React.CSSProperties = {
    padding: "7px 10px", fontSize: 10, fontWeight: 700, color: "#4b5563",
    textAlign: "left" as const, letterSpacing: "0.08em",
    whiteSpace: "nowrap" as const, borderBottom: "1px solid #1a1f2e",
    background: "#070A11",
  };

  return (
    <div style={{
      background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12,
      overflow: "hidden", marginTop: 10,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "9px 16px", borderBottom: "1px solid #1a1f2e",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.1em" }}>
          CLOSED TODAY
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, color: rows.length > 0 ? "#f5d547" : "#374151",
          background: rows.length > 0 ? "rgba(245,213,71,0.10)" : "rgba(255,255,255,0.03)",
          padding: "1px 7px", borderRadius: 10,
        }}>
          {rows.length}
        </span>
        <span style={{ fontSize: 10, color: "#1f2937", marginLeft: "auto" }}>15s refresh</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "16px 16px", fontSize: 12, color: "#374151" }}>
          No trades closed today yet
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
            <thead>
              <tr>
                {["#", "Strategy", "Side", "Entry USD", "Exit USD", "PnL", "Exit Reason", "Time Closed"].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((pos, idx) => {
                const stratName = strategies.find(s => s.id === pos.strategy_id)?.name ?? pos.strategy_id;
                const reason = [pos.exit_reason, pos.exit_reason_detail].filter(Boolean).join(" — ");
                return (
                  <tr key={pos.id} style={{ borderTop: "1px solid #0f1520" }}>
                    <td style={{ padding: "7px 10px", fontSize: 11, color: "#374151", fontFamily: "monospace", textAlign: "right" as const }}>{idx + 1}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, color: ACCENT[pos.strategy_id] ?? "#9ca3af", fontWeight: 600, whiteSpace: "nowrap" }}>{stratName}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, fontWeight: 700, color: pos.side === "LONG" ? "#22c55e" : "#ef4444" }}>{pos.side}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", color: "#6b7280" }}>${pos.entry_price_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", color: "#9ca3af" }}>${(pos.exit_price_usd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: pnlColor(pos.pnl_inr ?? 0) }}>{pnlStr(pos.pnl_inr ?? 0)}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, color: "#4b5563", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{reason || "—"}</td>
                    <td style={{ padding: "7px 10px", fontSize: 11, color: "#374151", whiteSpace: "nowrap" }}>{fmtTime(pos.closed_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── BtcStrategyCard ────────────────────────────────────────────

function BtcStrategyCard({
  strategy,
  capital,
  openPositions,
  positions,
  liveCapital,
  onClick,
}: {
  strategy: BtcStrategy;
  capital: BtcCapital | undefined;
  openPositions: BtcPosition[];
  positions: BtcPosition[];
  liveCapital: number;
  onClick: () => void;
}) {
  const accent  = ACCENT[strategy.id] ?? "#6b7280";
  const alloc   = capital?.allocated_inr ?? 10000;
  const livePnl = liveCapital - alloc;
  const retPct  = (livePnl / alloc) * 100;
  const trades  = capital?.total_trades ?? 0;

  // Today's KPIs — filter by opened_at IST date (matches server dailyTradeCounts logic)
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const todayClosed = positions.filter(p =>
    p.strategy_id === strategy.id &&
    p.status === "CLOSED" &&
    new Date(p.opened_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === todayIST
  );
  const todayPnl    = todayClosed.reduce((s, p) => s + (p.pnl_inr ?? 0), 0);
  const todayCount  = todayClosed.length;
  const avgPnlToday = todayCount > 0 ? todayPnl / todayCount : null;
  const lifetimePnl = capital?.total_pnl_inr ?? 0;
  const lifeCount   = capital?.total_trades ?? 0;
  const avgPnlLife  = lifeCount > 0 ? lifetimePnl / lifeCount : null;
  const btcSharpe   = capital?.sharpe_ratio ?? 0;
  const todayAll    = positions.filter(p =>
    p.strategy_id === strategy.id &&
    new Date(p.opened_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === todayIST
  ).length;

  const [metrics, setMetrics] = useState<CardMetrics | null>(null);
  useEffect(() => {
    const fetchMetrics = () => {
      fetch(`${BACKEND}/api/btc-strategy-metrics?strategy=${strategy.id}`)
        .then(r => r.json())
        .then(d => setMetrics({ profit_factor: d.profit_factor ?? "N/A", max_drawdown_inr: d.max_drawdown_inr ?? 0 }))
        .catch(() => {});
    };
    fetchMetrics();
    const iv = setInterval(fetchMetrics, 60_000);
    return () => clearInterval(iv);
  }, [strategy.id]);

  const pfVal  = metrics?.profit_factor ?? "N/A";
  const hasData = pfVal !== "N/A";

  return (
    <div
      onClick={onClick}
      style={{
        background: "#0B0E17",
        border: `1px solid ${accent}99`,
        borderTop: `3px solid ${accent}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        overflow: "hidden",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.borderTopColor = accent; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = `${accent}99`; e.currentTarget.style.borderTopColor = accent; }}
    >
      {/* Header */}
      <div style={{ padding: "16px 16px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="strategy-name" style={{ fontSize: 18, fontWeight: 700, color: "#ffffff" }}>{strategy.name}</div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4, lineHeight: 1.5 }}>{strategy.description}</div>
          </div>
          <div style={{ fontSize: 10, color: "#9ca3af", letterSpacing: "0.06em", marginTop: 3, whiteSpace: "nowrap" }}>
            VIEW →
          </div>
        </div>
        {openPositions.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {openPositions.map(p => (
              <span key={p.id} style={{
                fontSize: 10, fontWeight: 700, color: p.side === "LONG" ? "#22c55e" : "#ef4444",
                background: p.side === "LONG" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                padding: "2px 7px", borderRadius: 4,
              }}>
                {p.side} @ ${p.entry_price_usd.toFixed(0)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Stats grid — row 1: Capital/PnL/Return, row 2: WinRate/Trades/Open */}
      <div className="grid-stats" style={{ borderTop: `1px solid ${accent}30` }}>
        {[
          { label: "CAPITAL",   value: `₹${fmtINR(liveCapital)}`,                             color: "#ffffff",                                              weight: 600 },
          { label: "TOTAL PnL", value: pnlStr(livePnl),                                       color: pnlColor(livePnl),                                     weight: 700 },
          { label: "RETURN",    value: fmtPct(retPct),                                        color: pnlColor(retPct),                                      weight: 600 },
          { label: "SHARPE",    value: btcSharpe.toFixed(2),                                  color: "#ffffff",                                             weight: 600 },
          { label: "WIN RATE",  value: winRate(capital),                                      color: "#ffffff",                                             weight: 600 },
          { label: "TODAY",     value: String(todayAll),                                      color: "#ffffff",                                             weight: 600 },
          { label: "TRADES",    value: String(trades),                                        color: "#ffffff",                                             weight: 600 },
          { label: "OPEN",      value: String(openPositions.length),                          color: openPositions.length > 0 ? "#f5d547" : "#4b5563",     weight: 600 },
        ].map((s, i) => (
          <div key={s.label} style={{
            padding: "12px 14px",
            borderRight: i % 3 < 2 ? `1px solid ${accent}25` : undefined,
            borderTop:   i >= 3    ? `1px solid ${accent}25` : undefined,
          }}>
            <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 5, textTransform: "uppercase" as const }}>{s.label}</div>
            <div className="stat-value" style={{ fontSize: 16, fontWeight: s.weight, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Row 3: Profit Factor */}
      <div style={{ borderTop: `1px solid ${accent}25`, padding: "10px 14px" }}>
        <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 4, textTransform: "uppercase" as const }}>PROFIT FACTOR</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: hasData ? pfColor(pfVal) : "#4b5563", fontFamily: "monospace" }}>
          {hasData ? pfVal : "—"}
        </div>
      </div>

      {/* Row 4: Today PnL | Avg Today | Avg Overall */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: `1px solid ${accent}25` }}>
        <div style={{ padding: "10px 14px", borderRight: `1px solid ${accent}25` }}>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 4, textTransform: "uppercase" as const }}>TODAY PnL</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: todayCount > 0 ? pnlColor(todayPnl) : "#374151", fontFamily: "monospace" }}>
            {todayCount > 0 ? pnlStr(todayPnl) : "—"}
          </div>
        </div>
        <div style={{ padding: "10px 14px", borderRight: `1px solid ${accent}25` }}>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 4, textTransform: "uppercase" as const }}>AVG PNL/TRADE TODAY</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: avgPnlToday != null ? pnlColor(avgPnlToday) : "#374151", fontFamily: "monospace" }}>
            {avgPnlToday != null ? pnlStr(avgPnlToday) : "—"}
          </div>
        </div>
        <div style={{ padding: "10px 14px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 4, textTransform: "uppercase" as const }}>AVG PNL/TRADE LIFE</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: avgPnlLife != null ? pnlColor(avgPnlLife) : "#374151", fontFamily: "monospace" }}>
            {avgPnlLife != null ? pnlStr(avgPnlLife) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── BtcCorrelationHeatmap ───────────────────────────────────────────────────

const BTC_STRATEGY_LABELS: Record<string, string> = {
  btc_ema_crossover: "EMA ×",
  btc_orion: "ORION",
  btc_ema_confluence: "EMA Conf",
  btc_supertrend: "Supertrend",
};

function corrColor(v: number | null): string {
  if (v === null) return "#1a1f2e";
  if (v === 1) return "#1a3a2a";
  if (v >= 0.5) return `rgba(34,197,94,${0.3 + v * 0.5})`;
  if (v >= 0) return `rgba(34,197,94,${v * 0.4})`;
  if (v >= -0.5) return `rgba(239,68,68,${Math.abs(v) * 0.4})`;
  return `rgba(239,68,68,${0.3 + Math.abs(v) * 0.5})`;
}

function corrTextColor(v: number | null): string {
  if (v === null) return "#374151";
  if (v === 1) return "#22c55e";
  const abs = Math.abs(v);
  if (abs > 0.3) return v > 0 ? "#4ade80" : "#f87171";
  return "#6b7280";
}

function BtcCorrelationHeatmap() {
  const [data, setData] = useState<CorrelationData | null>(null);
  useEffect(() => {
    fetch(`${BACKEND}/api/btc-correlation`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {});
    const iv = setInterval(() => {
      fetch(`${BACKEND}/api/btc-correlation`)
        .then(r => r.json())
        .then(d => setData(d))
        .catch(() => {});
    }, 300_000);
    return () => clearInterval(iv);
  }, []);

  const strats = data?.strategies ?? [];
  const matrix = data?.matrix ?? null;

  return (
    <div style={{ background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12, padding: "20px 24px", marginTop: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#4b5563", letterSpacing: "0.1em", marginBottom: 16 }}>
        BTC STRATEGY CORRELATION
      </div>
      {(!matrix || data?.insufficient) ? (
        <div style={{ fontSize: 12, color: "#374151", textAlign: "center", padding: "24px 0" }}>
          Insufficient data — needs at least 5 days of overlapping trade history
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <td style={{ padding: "4px 8px", minWidth: 80 }} />
                {strats.map(s => (
                  <th key={s} style={{ padding: "4px 6px", color: "#6b7280", fontWeight: 600, fontSize: 10, textAlign: "center", whiteSpace: "nowrap" }}>
                    {BTC_STRATEGY_LABELS[s] ?? s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strats.map((si, i) => (
                <tr key={si}>
                  <td style={{ padding: "4px 8px", color: "#6b7280", fontWeight: 600, fontSize: 10, whiteSpace: "nowrap" }}>
                    {BTC_STRATEGY_LABELS[si] ?? si}
                  </td>
                  {strats.map((_sj, j) => {
                    const v = matrix[i]?.[j] ?? null;
                    return (
                      <td key={j} style={{
                        padding: "2px 3px", textAlign: "center", minWidth: 60, height: 36,
                        background: corrColor(v),
                        border: "1px solid rgba(255,255,255,0.04)",
                        borderRadius: 4,
                        color: corrTextColor(v),
                        fontFamily: "monospace",
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                        {v === null ? "—" : v === 1 ? "1.00" : v.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 10, display: "flex", gap: 16, fontSize: 10, color: "#374151" }}>
            <span style={{ color: "#4ade80" }}>▉ Positive correlation</span>
            <span style={{ color: "#f87171" }}>▉ Negative correlation</span>
            <span style={{ color: "#374151" }}>▉ No correlation</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BtcCombinedCapitalHistory ───────────────────────────────────────────────

function BtcCombinedCapitalHistory() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Area"> | null>(null);
  const [livePnl,     setLivePnl]     = useState(0);
  const [closeCount,  setCloseCount]  = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#0A0D14" }, textColor: "#6b7280", fontSize: 11 },
      grid: { vertLines: { color: "#1a1f2e" }, horzLines: { color: "#1a1f2e" } },
      rightPriceScale: { borderColor: "#1a1f2e" },
      timeScale: { borderColor: "#1a1f2e", timeVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;
    const series = chart.addSeries(AreaSeries, {
      lineColor:              "#3b82f6",
      topColor:               "rgba(59,130,246,0.20)",
      bottomColor:            "rgba(59,130,246,0.00)",
      lineWidth:              2,
      lineType:               1,
      crosshairMarkerVisible: true,
      lastValueVisible:       true,
      priceLineVisible:       false,
    });
    seriesRef.current = series;
    series.createPriceLine({ price: 0, color: "#374151", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    return () => { chart.remove(); chartRef.current = seriesRef.current = null; };
  }, []);

  useEffect(() => {
    fetch(`${BACKEND}/api/btc-capital-history`)
      .then(r => r.json())
      .then((data: CapitalPoint[]) => {
        if (!seriesRef.current || !data?.length) return;
        const BASELINE = 500_000;
        const filtered = data.filter(p => p.date);
        const pts = filtered.map(p => ({
          time:  p.date as unknown as Time,
          value: p.capital - BASELINE,
        }));
        seriesRef.current.setData(pts);
        const last = pts[pts.length - 1];
        if (last) {
          setLivePnl(last.value);
          setCloseCount(pts.length);
          const dotColor = last.value >= 0 ? "#4ade80" : "#f87171";
          createSeriesMarkers(seriesRef.current, [{
            time:     last.time,
            position: "inBar" as const,
            shape:    "circle" as const,
            color:    dotColor,
            size:     1,
          }]);
        }
        chartRef.current?.timeScale().fitContent();
      })
      .catch(() => {});
  }, []);

  const pnlColor = livePnl >= 0 ? "#4ade80" : "#f87171";

  return (
    <div style={{ background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12, overflow: "hidden", marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #1a1f2e" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6", letterSpacing: "0.1em" }}>CUMULATIVE PNL</div>
          <div style={{ fontSize: 9, color: "#374151", marginTop: 2 }}>Profit since start · step on each close · {closeCount} closes</div>
        </div>
        {livePnl !== 0 && (
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.08em", marginBottom: 2 }}>LIVE PNL</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: pnlColor, fontFamily: "monospace" }}>
              {livePnl >= 0 ? "+" : ""}₹{Math.abs(livePnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
        )}
      </div>
      <div ref={containerRef} style={{ height: 220 }} />
    </div>
  );
}

// ── BTC Arena Page ─────────────────────────────────────────────

export default function BtcArenaPage() {
  const router = useRouter();
  const [strategies,    setStrategies]    = useState<BtcStrategy[]>([]);
  const [capitals,      setCapitals]      = useState<BtcCapital[]>([]);
  const [positions,     setPositions]     = useState<BtcPosition[]>([]);
  const [btcPrice,      setBtcPrice]      = useState<number>(0);
  const [lastUpdate,    setLastUpdate]    = useState<Date | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [liveOpenPos,   setLiveOpenPos]   = useState<BtcPosition[]>([]);

  // Main 15s refresh
  const refresh = useCallback(async () => {
    const [sRes, cRes, pRes] = await Promise.all([
      supabase.from("btc_strategies").select("*").order("sort_order"),
      supabase.from("btc_strategy_capital").select("*"),
      supabase.from("btc_strategy_positions").select("*").order("opened_at", { ascending: false }).limit(300),
    ]);
    if (sRes.error || cRes.error || pRes.error) {
      setError(sRes.error?.message ?? cRes.error?.message ?? pRes.error?.message ?? "Unknown");
      return;
    }
    setError(null);
    setStrategies((sRes.data ?? []) as BtcStrategy[]);
    setCapitals((cRes.data ?? []) as BtcCapital[]);
    setPositions((pRes.data ?? []) as BtcPosition[]);
    setLastUpdate(new Date());
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, [refresh]);

  // BTC price poll every 5s
  useEffect(() => {
    const fetchPrice = async () => {
      const { data } = await supabase.from("config").select("value").eq("key", "BTC_PRICE_USD").single();
      if (data?.value) setBtcPrice(parseFloat(data.value));
    };
    fetchPrice();
    const iv = setInterval(fetchPrice, 5_000);
    return () => clearInterval(iv);
  }, []);

  // 1s open positions poll — keeps live trades panel fresh
  useEffect(() => {
    const fetchOpen = async () => {
      const { data } = await supabase.from("btc_strategy_positions").select("*").eq("status", "OPEN");
      if (data) setLiveOpenPos(data as BtcPosition[]);
    };
    fetchOpen();
    const iv = setInterval(fetchOpen, 1_000);
    return () => clearInterval(iv);
  }, []);

  const computeLiveCapital = useCallback((strategyId: string): number => {
    const cap = capitals.find(c => c.strategy_id === strategyId);
    const alloc = cap?.allocated_inr ?? 10000;
    const closedPnl = cap?.total_pnl_inr ?? 0;
    if (!btcPrice) return alloc + closedPnl;
    const liveOpenPnl = positions
      .filter(p => p.strategy_id === strategyId && p.status === "OPEN")
      .reduce((sum, p) => {
        const pct = p.side === "LONG"
          ? (btcPrice - p.entry_price_usd) / p.entry_price_usd
          : (p.entry_price_usd - btcPrice) / p.entry_price_usd;
        return sum + pct * p.qty_inr;
      }, 0);
    return alloc + closedPnl + liveOpenPnl;
  }, [capitals, positions, btcPrice]);

  const openPositions = positions.filter(p => p.status === "OPEN");

  return (
    <div className="page-content" style={{ background: "#0A0D14", minHeight: "100vh" }}>
      <div style={{ padding: "18px 16px 12px" }}>
        {/* Page header */}
        <div style={{ marginBottom: 12, textAlign: "center" }}>
          <div className="breadcrumb" style={{ textAlign: "center" }}>
            AI TRADING ARENA · SEASON 1 · PAPER TRADING
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 700, margin: "6px 0 0", color: "#e5e7eb" }}>
            BTC Arena
          </h1>
          <div style={{ fontSize: 9, color: "#374151", marginTop: 6 }}>
            {lastUpdate
              ? `UPDATED ${lastUpdate.toLocaleTimeString()} · AUTO-REFRESH 15s`
              : "CONNECTING..."}
          </div>
        </div>

        <BtcTopBar />
        <BtcCapitalSummaryBar capitals={capitals} openPositions={openPositions} positions={positions} btcPrice={btcPrice} />

        {/* Live Open Trades panel */}
        <div style={{ height: 320 }}>
          <BtcOpenTradesPanel openPositions={liveOpenPos} strategies={strategies} btcPrice={btcPrice} />
        </div>

        {/* Closed Today panel */}
        <BtcClosedTodayPanel positions={positions} strategies={strategies} />
      </div>

      {/* Strategy Cards */}
      <div style={{ padding: "12px 16px 32px" }}>
        {error && (
          <div style={{
            marginBottom: 12, padding: "9px 12px",
            background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)",
            color: "#ef4444", fontSize: 11, borderRadius: 4,
          }}>
            Supabase error: {error} —{" "}
            <span style={{ color: "#4b5563" }}>
              Run migration 005_btc_rebuild.sql in your Supabase dashboard first.
            </span>
          </div>
        )}

        {strategies.length > 0 && (
          <div className="grid-btc">
            {strategies.map(s => (
              <BtcStrategyCard
                key={s.id}
                strategy={s}
                capital={capitals.find(c => c.strategy_id === s.id)}
                openPositions={positions.filter(p => p.strategy_id === s.id && p.status === "OPEN")}
                positions={positions}
                liveCapital={computeLiveCapital(s.id)}
                onClick={() => router.push('/btc/strategy/' + s.id)}
              />
            ))}
          </div>
        )}

        {strategies.length === 0 && !error && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 8 }}>
            <div style={{ fontSize: 12, color: "#374151" }}>Waiting for data...</div>
            <div style={{ fontSize: 10, color: "#1f2937" }}>
              Run supabase/migrations/005_btc_rebuild.sql if tables are missing.
            </div>
          </div>
        )}

        {/* BTC Combined Capital History */}
        <BtcCombinedCapitalHistory />

        {/* BTC Correlation Heatmap */}
        <BtcCorrelationHeatmap />
      </div>
    </div>
  );
}
