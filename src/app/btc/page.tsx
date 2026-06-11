"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";

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
};

// ── BTC Strategy Config ────────────────────────────────────────

const ACCENT: Record<string, string> = {
  btc_ema_crossover:  "#F59E0B",
  btc_orion:          "#6366F1",
  btc_ema_confluence: "#10B981",
  btc_supertrend:     "#EF4444",
  btc_vwap_scalper:   "#F97316",
};

const RULES: Record<string, string[]> = {
  btc_ema_crossover: [
    "Instrument: BTC/USD · 24/7 perpetual",
    "Timeframe: 30-second candles",
    "Entry LONG: EMA9 crosses above EMA21 (golden cross)",
    "Entry SHORT: EMA9 crosses below EMA21 (death cross)",
    "On opposite cross — existing position closed, new one opens in next cycle",
    "Stop loss: 1.5× ATR(14) from entry price",
    "Trail SL: 1% ratchet trail, activates immediately on open",
    "Max 1 trade per direction per day",
    "₹5,000 INR allocation per trade (paper trading)",
  ],
  btc_orion: [
    "Instrument: BTC/USD · 24/7 perpetual",
    "Opening Range: built from 00:00–00:30 UTC candles each day",
    "Entry LONG: price breaks above ORB High (after 00:30 UTC)",
    "Entry SHORT: price breaks below ORB Low (after 00:30 UTC)",
    "Stop loss LONG: ORB Low · Stop loss SHORT: ORB High",
    "Trail SL: 0.5% ratchet trail",
    "Max 2 trades per day (1 long + 1 short)",
    "₹5,000 INR allocation per trade (paper trading)",
  ],
  btc_ema_confluence: [
    "Instrument: BTC/USD · 24/7 perpetual",
    "Timeframe: 5-minute candles",
    "All 5 filters must align simultaneously:",
    "  1. EMA20 vs EMA50 — trend direction (bullish > / bearish <)",
    "  2. RSI(14) — must be 40–60 (trending, not extreme)",
    "  3. VWAP (UTC day) — price above for long, below for short",
    "  4. ATR volatility — ATR must exceed 0.5% of price",
    "  5. EMA9 slope — positive for long, negative for short",
    "Stop loss: 2× ATR(14) from entry",
    "Trail SL: 1.5% ratchet trail",
    "Max 1 trade per direction per day",
    "₹5,000 INR allocation per trade (paper trading)",
  ],
  btc_supertrend: [
    "Instrument: BTC/USD · 24/7 perpetual",
    "Timeframe: 5-minute candles",
    "Indicator: Supertrend(period=7, multiplier=3)",
    "Entry LONG: Supertrend flips bullish (down→up direction change)",
    "Entry SHORT: Supertrend flips bearish (up→down direction change)",
    "On opposite flip — existing position closed, new one opens next cycle",
    "Stop loss: Supertrend line value at entry",
    "Trail SL: 0.8% ratchet trail",
    "Max 2 trades per day",
    "₹5,000 INR allocation per trade (paper trading)",
  ],
  btc_vwap_scalper: [
    "· BTC VWAP Momentum Scalper — Runs 24/7",
    "· Timeframe: 1-minute candles | Same VWAP + RSI + volume logic as equity",
    "",
    "Entry — LONG (bullish bounce):",
    "  · BTC price closes above VWAP after touching it",
    "  · RSI between 40–60 | Tick volume above 20-candle average",
    "  · Previous candle made a higher low",
    "",
    "Entry — SHORT (bearish rejection):",
    "  · BTC price closes below VWAP after touching it",
    "  · RSI between 40–60 | Tick volume above 20-candle average",
    "  · Previous candle made a lower high",
    "",
    "Position size: ₹10,000 normal · ₹5,000 during IST expiry danger windows",
    "SL: 2×ATR normal · 1×ATR during danger windows",
    "Trail: 1% ratchet trail from peak price",
    "VWAP cross exit: opposite VWAP signal closes open position",
    "Max: 1 LONG + 1 SHORT per day",
  ],
};

// ── Formatters ─────────────────────────────────────────────────

function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
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
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}
function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function winRate(cap: BtcCapital | undefined): string {
  if (!cap || cap.total_trades === 0) return "—";
  return `${((cap.winning_trades / cap.total_trades) * 100).toFixed(0)}%`;
}

// ── BtcStrategyCard ────────────────────────────────────────────

function BtcStrategyCard({
  strategy,
  capital,
  openPositions,
  liveCapital,
  onClick,
}: {
  strategy: BtcStrategy;
  capital: BtcCapital | undefined;
  openPositions: BtcPosition[];
  liveCapital: number;
  onClick: () => void;
}) {
  const accent  = ACCENT[strategy.id] ?? "#6b7280";
  const alloc   = capital?.allocated_inr ?? 10000;
  const livePnl = liveCapital - alloc;
  const retPct  = (livePnl / alloc) * 100;
  const trades  = capital?.total_trades ?? 0;

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

      {/* Stats grid */}
      <div className="grid-stats" style={{ borderTop: `1px solid ${accent}30` }}>
        {[
          { label: "CAPITAL",  value: `₹${fmtINR(liveCapital)}`,       color: "#ffffff",        weight: 600 },
          { label: "TOTAL PnL", value: pnlStr(livePnl),                 color: pnlColor(livePnl), weight: 700 },
          { label: "RETURN",   value: fmtPct(retPct),                   color: pnlColor(retPct),  weight: 600 },
          { label: "WIN RATE", value: winRate(capital),                  color: "#ffffff",         weight: 600 },
          { label: "TRADES",   value: String(trades),                    color: "#ffffff",         weight: 600 },
          { label: "OPEN",     value: String(openPositions.length),      color: openPositions.length > 0 ? "#f5d547" : "#4b5563", weight: 600 },
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
    </div>
  );
}

// ── BtcTradePopup ──────────────────────────────────────────────

function BtcTradePopup({
  strategy,
  capital,
  liveCapital,
  positions,
  onClose,
}: {
  strategy: BtcStrategy;
  capital: BtcCapital | undefined;
  liveCapital: number;
  positions: BtcPosition[];
  onClose: () => void;
}) {
  const accent  = ACCENT[strategy.id] ?? "#6b7280";
  const rules   = RULES[strategy.id] ?? [];
  const alloc   = capital?.allocated_inr ?? 10000;
  const livePnl = liveCapital - alloc;
  const retPct  = (livePnl / alloc) * 100;
  const trades  = capital?.total_trades ?? 0;

  const [rulesOpen,     setRulesOpen]     = useState(false);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);

  const openTrades   = positions.filter(p => p.status === "OPEN");
  const closedTrades = positions
    .filter(p => p.status === "CLOSED")
    .sort((a, b) => new Date(b.closed_at ?? 0).getTime() - new Date(a.closed_at ?? 0).getTime());

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const toggleTrade = (id: string) =>
    setExpandedTrade(prev => (prev === id ? null : id));

  const thStyle: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 9,
    fontWeight: 600,
    color: "#374151",
    textAlign: "left",
    letterSpacing: "0.08em",
    whiteSpace: "nowrap",
  };

  return (
    <div
      className="popup-outer"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.8)",
        overflowY: "auto",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 16px 40px",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="popup-inner"
        style={{
          background: "#0B0E17",
          border: `1px solid ${accent}25`,
          borderTop: `3px solid ${accent}`,
          width: "100%",
          maxWidth: 1120,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid #111827",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: accent }}>{strategy.name}</div>
            <div style={{ fontSize: 11, color: "#4b5563", marginTop: 3 }}>{strategy.description}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #1f2937",
              color: "#6b7280",
              width: 28,
              height: 28,
              fontSize: 13,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Section A: Rules (accordion) */}
        <div style={{ borderBottom: "1px solid #111827" }}>
          <div
            style={{
              padding: "10px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={() => setRulesOpen(v => !v)}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: "#4b5563", letterSpacing: "0.1em" }}>
              STRATEGY RULES
            </span>
            <span style={{ fontSize: 10, color: "#374151" }}>{rulesOpen ? "▲ COLLAPSE" : "▼ EXPAND"}</span>
          </div>
          {rulesOpen && (
            <div style={{ padding: "0 20px 16px" }}>
              {rules.map((line, i) => {
                const isIndented = line.startsWith("  ");
                return (
                  <div key={i} style={{
                    fontSize: 11,
                    color: isIndented ? "#6b7280" : "#9ca3af",
                    padding: "2px 0",
                    lineHeight: 1.65,
                    paddingLeft: isIndented ? 20 : 0,
                  }}>
                    {isIndented ? line.trim() : `· ${line}`}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section B: Stats bar */}
        <div className="grid-popup-stats" style={{ borderBottom: "1px solid #111827" }}>
          {[
            { label: "CAPITAL",   value: `₹${fmtINR(liveCapital)}`,   color: "#e5e7eb" },
            { label: "TOTAL PnL", value: pnlStr(livePnl),              color: pnlColor(livePnl) },
            { label: "RETURN",    value: fmtPct(retPct),               color: pnlColor(retPct) },
            { label: "WIN RATE",  value: winRate(capital),             color: "#e5e7eb" },
            { label: "TRADES",    value: String(trades),                color: "#e5e7eb" },
            { label: "OPEN NOW",  value: String(openTrades.length),     color: openTrades.length > 0 ? "#f5d547" : "#4b5563" },
          ].map((s, i) => (
            <div key={s.label} style={{
              padding: "14px 16px",
              borderRight: i < 5 ? "1px solid #111827" : undefined,
            }}>
              <div style={{ fontSize: 9, color: "#6b7280", letterSpacing: "0.1em", marginBottom: 5 }}>{s.label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Section C: Open trades */}
        {openTrades.length > 0 && (
          <div>
            <div style={{
              padding: "10px 20px",
              borderBottom: "1px solid #111827",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 10,
              fontWeight: 700,
              color: "#f5d547",
              letterSpacing: "0.1em",
            }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#f5d547", flexShrink: 0 }} />
              OPEN TRADES ({openTrades.length}) · live updates every 5s
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                <thead>
                  <tr style={{ background: "#070A11" }}>
                    {["Side", "Entry (USD)", "Current (USD)", "Live PnL (INR)", "Qty (INR)", "Leverage", "Opened (UTC)", "Stop Loss", "Trail SL"].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openTrades.map(pos => (
                    <Fragment key={pos.id}>
                      <tr
                        style={{
                          borderTop: "1px solid #0f1520",
                          background: expandedTrade === pos.id ? `${accent}08` : "rgba(245,213,71,0.01)",
                          cursor: "pointer",
                        }}
                        onClick={() => toggleTrade(pos.id)}
                      >
                        <td style={{ padding: "7px 10px", fontSize: 11, fontWeight: 700, color: pos.side === "LONG" ? "#22c55e" : "#ef4444" }}>
                          {pos.side}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>
                          ${pos.entry_price_usd.toFixed(2)}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#f5d547", fontFamily: "monospace", fontWeight: 600 }}>
                          ${(pos.current_price_usd ?? pos.entry_price_usd).toFixed(2)}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: "#f5d547" }}>
                          {pnlStr(pos.pnl_inr ?? 0)}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#9ca3af" }}>₹{pos.qty_inr.toFixed(0)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", color: "#a78bfa", fontWeight: 600 }}>
                          {pos.leverage != null ? `${pos.leverage}×` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#4b5563" }}>{fmtTime(pos.opened_at)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#ef4444", fontFamily: "monospace" }}>
                          {pos.stop_loss ? `$${pos.stop_loss.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", color: pos.trail_sl ? "#f5d547" : "#374151" }}>
                          {pos.trail_sl ? `$${pos.trail_sl.toFixed(2)}` : "inactive"}
                        </td>
                      </tr>
                      {expandedTrade === pos.id && (
                        <tr style={{ borderTop: "1px solid #0f1520" }}>
                          <td colSpan={9} style={{ padding: "14px 20px", background: "#080B12" }}>
                            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                              <div style={{ flex: 1, minWidth: 220 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 7 }}>WHY THIS TRADE WAS ENTERED</div>
                                <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>
                                  {pos.entry_reason ?? "Entry signal triggered."}
                                </div>
                              </div>
                              <div style={{ minWidth: 160 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 7 }}>STOP LOSS</div>
                                <div style={{ fontSize: 12, color: "#ef4444", fontFamily: "monospace" }}>
                                  {pos.stop_loss ? `$${pos.stop_loss.toFixed(2)}` : "Not set"}
                                </div>
                              </div>
                              <div style={{ minWidth: 200 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 7 }}>TRAILING STOP LOSS</div>
                                <div style={{ fontSize: 12, fontFamily: "monospace", color: pos.trail_sl ? "#f5d547" : "#374151" }}>
                                  {pos.trail_sl ? `Active — $${pos.trail_sl.toFixed(2)}` : "Not yet activated"}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Section D: Closed trades */}
        {closedTrades.length > 0 && (
          <div style={{ borderTop: openTrades.length > 0 ? "2px solid #111827" : undefined }}>
            <div style={{
              padding: "10px 20px",
              borderBottom: "1px solid #111827",
              fontSize: 10,
              fontWeight: 700,
              color: "#4b5563",
              letterSpacing: "0.1em",
            }}>
              CLOSED TRADES ({closedTrades.length})
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
                <thead>
                  <tr style={{ background: "#070A11" }}>
                    {["Side", "Entry (USD)", "Exit (USD)", "Final PnL (INR)", "Leverage", "Exit Reason", "Opened", "Closed"].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.map(pos => (
                    <Fragment key={pos.id}>
                      <tr
                        style={{
                          borderTop: "1px solid #0f1520",
                          background: expandedTrade === pos.id ? "rgba(255,255,255,0.02)" : "transparent",
                          cursor: "pointer",
                        }}
                        onClick={() => toggleTrade(pos.id)}
                      >
                        <td style={{ padding: "7px 10px", fontSize: 11, fontWeight: 700, color: pos.side === "LONG" ? "#22c55e" : "#ef4444" }}>
                          {pos.side}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>
                          ${pos.entry_price_usd.toFixed(2)}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#4b5563", fontFamily: "monospace" }}>
                          {pos.exit_price_usd != null ? `$${pos.exit_price_usd.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: pnlColor(pos.pnl_inr ?? 0) }}>
                          {pnlStr(pos.pnl_inr ?? 0)}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", color: "#a78bfa", fontWeight: 600 }}>
                          {pos.leverage != null ? `${pos.leverage}×` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#374151", whiteSpace: "nowrap" }}>
                          {pos.exit_reason?.replace(/_/g, " ") ?? "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#374151" }}>{fmtTime(pos.opened_at)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#374151" }}>{fmtTime(pos.closed_at)}</td>
                      </tr>
                      {expandedTrade === pos.id && (
                        <tr style={{ borderTop: "1px solid #0f1520" }}>
                          <td colSpan={8} style={{ padding: "14px 20px", background: "#080B12" }}>
                            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                              <div style={{ flex: 1, minWidth: 220 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 7 }}>WHY THIS TRADE WAS ENTERED</div>
                                <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.7 }}>
                                  {pos.entry_reason ?? "Entry signal triggered."}
                                </div>
                              </div>
                              <div style={{ flex: 1, minWidth: 220 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 7 }}>WHY THIS TRADE WAS CLOSED</div>
                                <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>
                                  {pos.exit_reason_detail ?? pos.exit_reason?.replace(/_/g, " ") ?? "—"}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {openTrades.length === 0 && closedTrades.length === 0 && (
          <div style={{ padding: "36px 20px", textAlign: "center", fontSize: 12, color: "#1f2937" }}>
            No trades yet for this strategy.
          </div>
        )}
      </div>
    </div>
  );
}

// ── BTC Arena Page ─────────────────────────────────────────────

export default function BtcArenaPage() {
  const [strategies,     setStrategies]     = useState<BtcStrategy[]>([]);
  const [capitals,       setCapitals]       = useState<BtcCapital[]>([]);
  const [positions,      setPositions]      = useState<BtcPosition[]>([]);
  const [btcPrice,       setBtcPrice]       = useState<number>(0);
  const [lastUpdate,     setLastUpdate]     = useState<Date | null>(null);
  const [error,          setError]          = useState<string | null>(null);
  const [popup,          setPopup]          = useState<BtcStrategy | null>(null);
  const [popupPositions, setPopupPositions] = useState<BtcPosition[]>([]);

  // Main 15s refresh (strategies + capital + positions)
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

  // BTC price poll every 5s — used for live capital computation
  useEffect(() => {
    const fetchPrice = async () => {
      const { data } = await supabase.from("config").select("value").eq("key", "BTC_PRICE_USD").single();
      if (data?.value) setBtcPrice(parseFloat(data.value));
    };
    fetchPrice();
    const iv = setInterval(fetchPrice, 5_000);
    return () => clearInterval(iv);
  }, []);

  // Popup 5s position refresh
  useEffect(() => {
    if (!popup) return;
    const fetchPopup = async () => {
      const { data } = await supabase
        .from("btc_strategy_positions")
        .select("*")
        .eq("strategy_id", popup.id)
        .order("opened_at", { ascending: false })
        .limit(200);
      if (data) setPopupPositions(data as BtcPosition[]);
    };
    fetchPopup();
    const iv = setInterval(fetchPopup, 5_000);
    return () => clearInterval(iv);
  }, [popup]);

  // current_capital = allocated + closed_pnl + live_open_pnl (from btcPrice)
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

  const openPopup = (s: BtcStrategy) => {
    setPopupPositions(positions.filter(p => p.strategy_id === s.id));
    setPopup(s);
  };

  // Aggregate banner stats
  const totalPnl    = capitals.reduce((s, c) => s + c.total_pnl_inr, 0);
  const totalAlloc  = capitals.reduce((s, c) => s + c.allocated_inr, 0) || 40000;
  const retPct      = (totalPnl / totalAlloc) * 100;
  const totalTrades = capitals.reduce((s, c) => s + c.total_trades, 0);

  return (
    <div className="page-content" style={{ background: "#0A0D14", minHeight: "100vh", padding: "18px 16px 32px" }}>
      {/* Page header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <div className="breadcrumb">
            AI TRADING ARENA · SEASON 1 · PAPER TRADING
          </div>
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#e5e7eb" }}>
            BTC Arena
          </h1>
        </div>
        <div style={{ fontSize: 9, color: "#374151" }}>
          {lastUpdate
            ? `UPDATED ${lastUpdate.toLocaleTimeString()} · AUTO-REFRESH 15s`
            : "CONNECTING..."}
        </div>
      </div>

      {/* BTC price banner */}
      <div
        className="btc-banner"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          marginBottom: 16,
          padding: "12px 16px",
          background: "#0B0E17",
          border: "1px solid rgba(247,147,26,0.2)",
          borderRadius: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.12em", marginBottom: 4 }}>BTC / USD · LIVE</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: btcPrice > 0 ? "#F7931A" : "#4b5563", fontFamily: "monospace" }}>
            {btcPrice > 0 ? `$${fmtUSD(btcPrice)}` : "CONNECTING..."}
          </div>
        </div>
        <div className="btc-banner-divider" style={{ height: 32, width: 1, background: "#1f2937" }} />
        <div>
          <div style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.12em", marginBottom: 4 }}>TOTAL PnL (ALL STRATEGIES)</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: pnlColor(totalPnl), fontFamily: "monospace" }}>
            {pnlStr(totalPnl)} &nbsp;
            <span style={{ fontSize: 12, color: pnlColor(retPct) }}>({fmtPct(retPct)})</span>
          </div>
        </div>
        <div className="btc-banner-divider" style={{ height: 32, width: 1, background: "#1f2937" }} />
        <div>
          <div style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.12em", marginBottom: 4 }}>TOTAL TRADES</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#9ca3af", fontFamily: "monospace" }}>
            {totalTrades}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
          <span style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.1em" }}>MARKET OPEN 24/7</span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          marginBottom: 12,
          padding: "9px 12px",
          background: "rgba(239,68,68,0.05)",
          border: "1px solid rgba(239,68,68,0.15)",
          color: "#ef4444",
          fontSize: 11,
          borderRadius: 4,
        }}>
          Supabase error: {error} —{" "}
          <span style={{ color: "#4b5563" }}>
            Run migration 005_btc_rebuild.sql in your Supabase dashboard first.
          </span>
        </div>
      )}

      {/* Strategy cards — responsive grid */}
      {strategies.length > 0 && (
        <div className="grid-btc">
          {strategies.map(s => (
            <BtcStrategyCard
              key={s.id}
              strategy={s}
              capital={capitals.find(c => c.strategy_id === s.id)}
              openPositions={positions.filter(p => p.strategy_id === s.id && p.status === "OPEN")}
              liveCapital={computeLiveCapital(s.id)}
              onClick={() => openPopup(s)}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {strategies.length === 0 && !error && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 8 }}>
          <div style={{ fontSize: 12, color: "#374151" }}>Waiting for data...</div>
          <div style={{ fontSize: 10, color: "#1f2937" }}>
            Run supabase/migrations/005_btc_rebuild.sql if tables are missing.
          </div>
        </div>
      )}

      {/* Trade detail popup */}
      {popup && (
        <BtcTradePopup
          strategy={popup}
          capital={capitals.find(c => c.strategy_id === popup.id)}
          liveCapital={computeLiveCapital(popup.id)}
          positions={popupPositions}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}
