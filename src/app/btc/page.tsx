"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { createChart, AreaSeries, ColorType } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";

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
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
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
  btcPrice,
}: {
  capitals: BtcCapital[];
  openPositions: BtcPosition[];
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

  const totalPnl  = totalCurrent - STARTING;
  const returnPct = STARTING > 0 ? (totalPnl / STARTING) * 100 : 0;
  const pColor    = totalPnl > 0 ? "#4ade80" : totalPnl < 0 ? "#f87171" : "#9ca3af";
  const rColor    = returnPct > 0 ? "#4ade80" : returnPct < 0 ? "#f87171" : "#9ca3af";

  const stats = [
    { label: "STARTING CAPITAL", value: "₹5,00,000",                                                              color: "#9ca3af" },
    { label: "TOTAL CAPITAL",    value: `₹${totalCurrent.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: "#ffffff" },
    { label: "TOTAL PnL",        value: `${totalPnl >= 0 ? "+" : ""}₹${Math.abs(totalPnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: pColor },
    { label: "TOTAL RETURN",     value: `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2)}%`,                    color: rColor },
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
    padding: "8px 12px", fontSize: 10, fontWeight: 700, color: "#4b5563",
    textAlign: "left" as const, letterSpacing: "0.08em",
    whiteSpace: "nowrap" as const, borderBottom: "1px solid #1a1f2e",
    background: "#070A11",
  };

  const rows = openPositions.map(pos => {
    const stratName    = strategies.find(s => s.id === pos.strategy_id)?.name ?? pos.strategy_id;
    const remainingQty = pos.remaining_qty_inr ?? pos.qty_inr;
    const realizedPnl  = pos.realized_pnl ?? 0;
    const livePnlOnRem = btcPrice > 0 && remainingQty > 0
      ? (pos.side === "LONG"
          ? (btcPrice - pos.entry_price_usd) / pos.entry_price_usd
          : (pos.entry_price_usd - btcPrice) / pos.entry_price_usd) * remainingQty
      : 0;
    const pnl = realizedPnl + livePnlOnRem;
    return { pos, stratName, pnl };
  });

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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
            <thead>
              <tr>
                {["Strategy", "Side", "Entry USD", "Entry Time", "BTC Price", "Live PnL", "Tier", "Partial", "Leverage", "SL", "Trail SL"].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ pos, stratName, pnl }) => {
                const tier        = pos.current_tier ?? 0;
                const partialQty  = pos.partial_qty_inr ?? 0;
                const partialPnl  = pos.realized_pnl ?? 0;
                const bookedPct   = pos.qty_inr > 0 ? Math.round(partialQty / pos.qty_inr * 100) : 0;
                return (
                  <tr key={pos.id} style={{ borderTop: "1px solid #0f1520" }}>
                    <td style={{ padding: "8px 12px", fontSize: 12, color: ACCENT[pos.strategy_id] ?? "#9ca3af", fontWeight: 600, whiteSpace: "nowrap" }}>{stratName}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: pos.side === "LONG" ? "#22c55e" : "#ef4444" }}>{pos.side}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace", color: "#9ca3af" }}>${pos.entry_price_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "#4b5563" }}>{fmtTime(pos.opened_at)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace", color: "#f5d547", fontWeight: 600 }}>
                      {btcPrice > 0 ? `$${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: pnlColor(pnl) }}>{pnlStr(pnl)}</td>
                    <td style={{ padding: "8px 10px" }}>
                      {tier > 0 ? (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#f5d547", background: "rgba(245,213,71,0.12)", padding: "2px 6px", borderRadius: 4 }}>
                          T{tier}
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, color: "#374151" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 10, color: pos.partial_booked ? "#4ade80" : "#374151", whiteSpace: "nowrap" }}>
                      {pos.partial_booked
                        ? `${bookedPct}% @ $${pos.current_price_usd > 0 ? pos.current_price_usd.toFixed(0) : "—"} (+₹${fmtINR(partialPnl)})`
                        : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "#6b7280" }}>
                      {pos.leverage ? `${pos.leverage}×` : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 11, fontFamily: "monospace", color: "#ef4444" }}>
                      {pos.stop_loss ? `$${pos.stop_loss.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 11, fontFamily: "monospace", color: pos.trail_sl ? "#f5d547" : "#374151" }}>
                      {pos.trail_sl ? `$${pos.trail_sl.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "inactive"}
                    </td>
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
  const ddVal  = metrics?.max_drawdown_inr ?? 0;
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
          { label: "CAPITAL",   value: `₹${fmtINR(liveCapital)}`,  color: "#ffffff",        weight: 600 },
          { label: "TOTAL PnL", value: pnlStr(livePnl),              color: pnlColor(livePnl), weight: 700 },
          { label: "RETURN",    value: fmtPct(retPct),               color: pnlColor(retPct),  weight: 600 },
          { label: "WIN RATE",  value: winRate(capital),             color: "#ffffff",         weight: 600 },
          { label: "TRADES",    value: String(trades),               color: "#ffffff",         weight: 600 },
          { label: "OPEN",      value: String(openPositions.length), color: openPositions.length > 0 ? "#f5d547" : "#4b5563", weight: 600 },
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

      {/* Row 3: Profit Factor | Max Drawdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: `1px solid ${accent}25` }}>
        <div style={{ padding: "10px 14px", borderRight: `1px solid ${accent}25` }}>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 4, textTransform: "uppercase" as const }}>PROFIT FACTOR</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: hasData ? pfColor(pfVal) : "#4b5563", fontFamily: "monospace" }}>
            {hasData ? pfVal : "—"}
          </div>
        </div>
        <div style={{ padding: "10px 14px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 4, textTransform: "uppercase" as const }}>MAX DRAWDOWN</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: hasData && ddVal > 0 ? "#f87171" : "#4b5563", fontFamily: "monospace" }}>
            {hasData && ddVal > 0 ? `-₹${fmtINR(ddVal)}` : "—"}
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
  const [initialCapital, setInitialCapital] = useState(0);
  const [currentCapital, setCurrentCapital] = useState(0);

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
      lineColor: "#F59E0B",
      topColor: "#F59E0B44",
      bottomColor: "#F59E0B08",
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
    });
    seriesRef.current = series;
    return () => { chart.remove(); chartRef.current = seriesRef.current = null; };
  }, []);

  useEffect(() => {
    fetch(`${BACKEND}/api/btc-capital-history`)
      .then(r => r.json())
      .then((data: CapitalPoint[]) => {
        if (!seriesRef.current || !data?.length) return;
        setInitialCapital(data[0].capital);
        setCurrentCapital(data[data.length - 1].capital);
        const pts = data
          .filter(p => p.date)
          .map(p => ({ time: p.date as unknown as import("lightweight-charts").Time, value: p.capital }));
        seriesRef.current.setData(pts);
        const isUp = data[data.length - 1].capital >= data[0].capital;
        const color = isUp ? "#22c55e" : "#ef4444";
        seriesRef.current.applyOptions({ lineColor: color, topColor: `${color}44`, bottomColor: `${color}08` });
        chartRef.current?.timeScale().fitContent();
      })
      .catch(() => {});
  }, []);

  const isUp = currentCapital >= initialCapital;
  const diffPct = initialCapital > 0 ? ((currentCapital - initialCapital) / initialCapital) * 100 : 0;

  return (
    <div style={{ background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12, overflow: "hidden", marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 20px", borderBottom: "1px solid #1a1f2e" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#4b5563", letterSpacing: "0.1em" }}>BTC COMBINED CAPITAL HISTORY</span>
        {currentCapital > 0 && (
          <>
            <span style={{ fontSize: 15, fontFamily: "monospace", fontWeight: 700, color: "#ffffff" }}>
              ₹{currentCapital.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </span>
            <span style={{ fontSize: 12, fontFamily: "monospace", color: isUp ? "#4ade80" : "#f87171" }}>
              {isUp ? "+" : ""}{diffPct.toFixed(2)}%
            </span>
          </>
        )}
      </div>
      <div ref={containerRef} style={{ height: 200 }} />
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
        <BtcCapitalSummaryBar capitals={capitals} openPositions={openPositions} btcPrice={btcPrice} />

        {/* Live Open Trades panel */}
        <div style={{ height: 320 }}>
          <BtcOpenTradesPanel openPositions={liveOpenPos} strategies={strategies} btcPrice={btcPrice} />
        </div>
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
