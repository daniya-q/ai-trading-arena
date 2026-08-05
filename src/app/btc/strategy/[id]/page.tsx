"use client";

import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  createChart, BaselineSeries, ColorType, createSeriesMarkers,
} from "lightweight-charts";
import type {
  IChartApi, ISeriesApi, Time,
} from "lightweight-charts";
import { supabase } from "@/lib/supabase/client";
import { accentFor } from '@/lib/strategySpec';
import StrategySpecCard from '@/components/StrategySpecCard';

const BACKEND = "https://ai-trading-arena-backend-production.up.railway.app";

// ── Types ─────────────────────────────────────────────────────────

type BtcStrategy = {
  id: string; name: string; description: string;
  is_active: boolean; sort_order: number;
};
type BtcCapital = {
  strategy_id: string; allocated_inr: number; total_pnl_inr: number;
  total_trades: number; winning_trades: number; sharpe_ratio: number;
};
type BtcPosition = {
  id: string; strategy_id: string; side: "LONG" | "SHORT";
  entry_price_usd: number; current_price_usd: number; exit_price_usd: number | null;
  qty_inr: number; pnl_inr: number; charges_inr: number | null; stop_loss: number | null; trail_sl: number | null;
  leverage: number | null; status: "OPEN" | "CLOSED";
  opened_at: string; closed_at: string | null;
  entry_reason: string | null; exit_reason: string | null; exit_reason_detail: string | null;
  // Tiered trail / partial booking (migration 006)
  partial_booked: boolean | null;
  partial_qty_inr: number | null;
  remaining_qty_inr: number | null;
  current_tier: number | null;
  realized_pnl: number | null;
};

type StrategyMetrics = {
  profit_factor: string;
  avg_win_avg_loss: string;
  max_drawdown_inr: number;
  max_drawdown_pct: number;
  expectancy: number;
  max_consecutive_losses: number;
  exit_reason_breakdown: Record<string, number>;
};
type CapitalPoint = { date: string; capital: number };

// ── Formatters ────────────────────────────────────────────────────

function fmtINR(n: number) { return Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
function pnlStr(n: number) { return `${n >= 0 ? "+" : "-"}₹${fmtINR(n)}`; }
function pnlColor(n: number) { return n > 0 ? "#4ade80" : n < 0 ? "#f87171" : "#ffffff"; }
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) + " IST";
}
function fmtPct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }
function formatDuration(openedAt: string, closedAt: string | null) {
  const ms = Math.max(0, (closedAt ? new Date(closedAt) : new Date()).getTime() - new Date(openedAt).getTime());
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── CapitalHistoryChart ───────────────────────────────────────────────────────

function CapitalHistoryChart({ strategyId, accent }: { strategyId: string; accent: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Baseline"> | null>(null);
  const [livePnl,    setLivePnl]    = useState(0);
  const [closeCount, setCloseCount] = useState(0);

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
    const series = chart.addSeries(BaselineSeries, {
      baseValue:              { type: "price", price: 0 },
      topLineColor:           "#4ade80",
      topFillColor1:          "rgba(74,222,128,0.28)",
      topFillColor2:          "rgba(74,222,128,0.03)",
      bottomLineColor:        "#f87171",
      bottomFillColor1:       "rgba(248,113,113,0.03)",
      bottomFillColor2:       "rgba(248,113,113,0.28)",
      lineWidth:              2,
      lineType:               1,
      crosshairMarkerVisible: true,
      lastValueVisible:       true,
      priceLineVisible:       false,
    });
    series.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
    seriesRef.current = series;
    return () => { chart.remove(); chartRef.current = seriesRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch(`${BACKEND}/api/btc-capital-history?strategy=${strategyId}`)
      .then(r => r.json())
      .then((data: CapitalPoint[]) => {
        if (!seriesRef.current || !data?.length) return;
        const initial  = data[0].capital;
        const filtered = data.filter(p => p.date);
        const pts = filtered.map(p => ({
          time:  p.date as unknown as Time,
          value: p.capital - initial,
        }));
        seriesRef.current.setData(pts);
        const last = pts[pts.length - 1];
        if (last) {
          setLivePnl(last.value);
          setCloseCount(pts.length);
          createSeriesMarkers(seriesRef.current, [{
            time:     last.time,
            position: "inBar" as const,
            shape:    "circle" as const,
            color:    last.value >= 0 ? "#4ade80" : "#f87171",
            size:     1,
          }]);
        }
        chartRef.current?.timeScale().fitContent();
      })
      .catch(() => {});
  }, [strategyId]);

  const pnlColorVal = livePnl >= 0 ? "#4ade80" : "#f87171";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "0 24px", height: 48, borderBottom: "1px solid #1a1f2e", background: "#0B0E17", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: "0.1em" }}>CUMULATIVE PNL</div>
          <div style={{ fontSize: 9, color: "#374151", marginTop: 1 }}>Profit since start · {closeCount} closes</div>
        </div>
        {livePnl !== 0 && (
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.08em", marginBottom: 1 }}>LIVE PNL</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: pnlColorVal, fontFamily: "monospace" }}>
              {livePnl >= 0 ? "+" : "-"}₹{Math.abs(livePnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
        )}
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}

// ── BTC Strategy Detail Page ─────────────────────────────────────────────────

export default function BtcStrategyDetailPage() {
  const params = useParams();
  const id     = (params.id as string) ?? "";
  const accent = accentFor(id);

  // Data
  const [strategy,  setStrategy]  = useState<BtcStrategy | null>(null);
  const [capital,   setCapital]   = useState<BtcCapital | null>(null);
  const [positions, setPositions] = useState<BtcPosition[]>([]);
  const [openPos,   setOpenPos]   = useState<BtcPosition[]>([]);
  const [loading,   setLoading]   = useState(true);

  // UI state
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StrategyMetrics | null>(null);

  // ── Data fetching ──

  const loadData = useCallback(async () => {
    const [sRes, cRes] = await Promise.all([
      supabase.from("btc_strategies").select("*").eq("id", id).single(),
      supabase.from("btc_strategy_capital").select("*").eq("strategy_id", id).single(),
    ]);
    if (sRes.data) setStrategy(sRes.data as BtcStrategy);
    if (cRes.data) setCapital(cRes.data as BtcCapital);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 15_000);
    return () => clearInterval(iv);
  }, [loadData]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("btc_strategy_positions").select("*")
        .eq("strategy_id", id).order("opened_at", { ascending: false }).limit(300);
      if (data) setPositions(data as BtcPosition[]);
    };
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, [id]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("btc_strategy_positions").select("*")
        .eq("strategy_id", id).eq("status", "OPEN");
      if (data) setOpenPos(data as BtcPosition[]);
    };
    load();
    const iv = setInterval(load, 1_000);
    return () => clearInterval(iv);
  }, [id]);

  useEffect(() => {
    fetch(`${BACKEND}/api/btc-strategy-metrics?strategy=${id}`)
      .then(r => r.json())
      .then(d => setMetrics(d))
      .catch(() => {});
    const iv = setInterval(() => {
      fetch(`${BACKEND}/api/btc-strategy-metrics?strategy=${id}`)
        .then(r => r.json())
        .then(d => setMetrics(d))
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(iv);
  }, [id]);

  // ── Derived values ──

  const alloc       = capital?.allocated_inr ?? 100_000;
  const closedPnl   = capital?.total_pnl_inr ?? 0;
  const openPnl     = openPos.reduce((s, p) => s + (p.pnl_inr ?? 0), 0);
  const liveCapital = alloc + closedPnl + openPnl;
  const livePnl     = liveCapital - alloc;
  const retPct      = (livePnl / alloc) * 100;
  const sharpe      = capital?.sharpe_ratio ?? 0;
  const winRate     = capital?.total_trades ? (capital.winning_trades / capital.total_trades) * 100 : 0;
  const lifetime    = capital?.total_trades ?? 0;

  const openTrades   = openPos;
  const closedTrades = positions
    .filter(p => p.status === "CLOSED")
    .sort((a, b) => new Date(b.closed_at ?? 0).getTime() - new Date(a.closed_at ?? 0).getTime());
  const allPositions = [...openTrades, ...closedTrades];

  // Exit breakdown: top 2 reasons
  const exitBreakdown = metrics?.exit_reason_breakdown ?? {};
  const exitEntries   = Object.entries(exitBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const exitText      = exitEntries.length > 0
    ? exitEntries.map(([k, v]) => `${k.replace(/_/g, " ")} ${v}%`).join(" · ")
    : "—";

  // Profit factor color
  const pfNum   = parseFloat(metrics?.profit_factor ?? "0");
  const pfColor = metrics?.profit_factor === "∞" ? "#4ade80" : pfNum >= 1.5 ? "#4ade80" : pfNum >= 1 ? "#f5d547" : "#f87171";

  // Stats — HERO 4 first, COMPACT 10 after
  const stats = [
    { label: "TOTAL PnL",         value: pnlStr(livePnl),                                          color: pnlColor(livePnl) },
    { label: "RETURN %",          value: fmtPct(retPct),                                           color: pnlColor(retPct) },
    { label: "WIN RATE",          value: `${winRate.toFixed(1)}%`,                                 color: winRate >= 50 ? "#4ade80" : "#f87171" },
    { label: "PROFIT FACTOR",     value: metrics?.profit_factor ?? "—",                            color: pfColor },
    { label: "INITIAL CAPITAL",   value: `₹${(alloc).toLocaleString("en-IN")}`,                   color: "#9ca3af" },
    { label: "CURRENT CAPITAL",   value: `₹${(liveCapital).toLocaleString("en-IN")}`,             color: "#ffffff" },
    { label: "SHARPE",            value: sharpe.toFixed(2),                                        color: "#ffffff" },
    { label: "TOTAL TRADES",      value: String(lifetime),                                         color: "#ffffff" },
    { label: "OPEN NOW",          value: String(openPos.length),                                   color: openPos.length > 0 ? "#f5d547" : "#ffffff" },
    { label: "AVG WIN/LOSS",      value: metrics ? `${metrics.avg_win_avg_loss}×` : "—",          color: "#ffffff" },
    { label: "MAX DRAWDOWN",      value: metrics ? `-₹${Math.abs(metrics.max_drawdown_inr).toLocaleString("en-IN", { maximumFractionDigits: 0 })} (-${metrics.max_drawdown_pct.toFixed(1)}%)` : "—", color: metrics && metrics.max_drawdown_inr > 0 ? "#f87171" : "#9ca3af" },
    { label: "EXPECTANCY",        value: metrics ? pnlStr(metrics.expectancy) : "—",              color: metrics ? pnlColor(metrics.expectancy) : "#9ca3af" },
    { label: "MAX CONSEC LOSSES", value: metrics ? String(metrics.max_consecutive_losses) : "—",  color: metrics && metrics.max_consecutive_losses > 3 ? "#f87171" : "#ffffff" },
    { label: "EXIT BREAKDOWN",    value: exitText,                                                 color: "#9ca3af" },
  ];

  if (loading) {
    return (
      <div style={{ height: "100vh", background: "#0A0D14", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 14, color: "#374151", letterSpacing: "0.1em" }}>LOADING...</div>
      </div>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: "14px 16px", fontSize: 11, fontWeight: 700, color: "#4b5563",
    textAlign: "left", letterSpacing: "0.08em", whiteSpace: "nowrap",
    borderBottom: "1px solid #1a1f2e",
  };

  return (
    <>
      <style>{`
        @keyframes scrollBounce {
          0%, 100% { opacity: 0.4; transform: translateX(-50%) translateY(0); }
          50%       { opacity: 1;   transform: translateX(-50%) translateY(6px); }
        }
      `}</style>

      {/* Fixed strategy name — visible across all sections */}
      <div style={{
        position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)",
        fontSize: 14, fontWeight: 600, color: "#ffffff88", letterSpacing: "0.08em",
        zIndex: 300, pointerEvents: "none", whiteSpace: "nowrap",
      }}>
        {strategy?.name ?? id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
      </div>

      {/* Back link — fixed */}
      <Link href="/btc" style={{
        position: "fixed", top: 14, left: 180, zIndex: 300,
        fontSize: 20, fontWeight: 700, color: "#ffffff", opacity: 0.8,
        textDecoration: "none", letterSpacing: "0.01em",
        display: "inline-flex", alignItems: "center", gap: 8,
        transition: "opacity 0.15s",
      }}
        onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={e => (e.currentTarget.style.opacity = "0.8")}
      >
        <span style={{ fontSize: 24, lineHeight: 1 }}>←</span>
        BTC Arena
      </Link>

      <div style={{ minHeight: "100vh", background: "#0A0D14", paddingTop: 52 }}>

        {/* ═══════ SECTION 1 — OVERVIEW ═══════ */}
        <section
          style={{
            display: "flex", flexDirection: "column",
            position: "relative",
          }}
        >
          <div style={{
            display: "grid",
            gridTemplateColumns: "40% 60%",
            gridTemplateRows: "auto auto",
            alignItems: "start",
          }}>
            {/* Name + description */}
            <div style={{ gridColumn: "1 / -1", padding: "12px 80px 20px", textAlign: "center" }}>
              <h1 style={{
                fontSize: 32, fontWeight: 700, color: "#ffffff",
                margin: "0 0 8px", lineHeight: 1.1, letterSpacing: "-0.02em",
              }}>
                {strategy?.name ?? id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
              </h1>
              {strategy?.description && (
                <p style={{ fontSize: 14, color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
                  {strategy.description}
                </p>
              )}
            </div>

            {/* LEFT — KPI grid: HERO 2×2 + COMPACT 2×5 */}
            <div style={{ padding: "0 40px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* HERO 2×2 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, flex: "0 0 34%" }}>
                {stats.slice(0, 4).map(s => (
                  <div key={s.label} style={{
                    background: "rgba(255,255,255,0.05)", border: `1px solid ${accent}40`,
                    borderRadius: 8, padding: "10px 14px", minWidth: 0, minHeight: 62,
                    display: "flex", flexDirection: "column", justifyContent: "center", gap: 3,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {/* COMPACT — remaining 10 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, flex: 1 }}>
                {stats.slice(4).map(s => (
                  <div key={s.label} style={{
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8, padding: "8px 12px", minWidth: 0, minHeight: 46,
                    display: "flex", flexDirection: "column", justifyContent: "space-between",
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: s.color, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT — Spec Card */}
            <div style={{
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              padding: "0 48px 24px 40px",
            }}>
              <StrategySpecCard strategyId={id} flow />
            </div>
          </div>

        </section>

        {/* ═══════ SECTION 2 — TODAY'S TRADES + CUMULATIVE PNL ═══════ */}
        <section
          style={{
            display: "flex", flexDirection: "column", position: "relative", marginTop: 8,
          }}
        >
          <div style={{ height: 400, display: "flex", borderTop: "1px solid #1a1f2e", borderBottom: "1px solid #1a1f2e" }}>
            {/* Left 60% — Today's Trades */}
            <div style={{ flex: "0 0 60%", minWidth: 0, display: "flex", flexDirection: "column", background: "#0A0D14", borderRight: "1px solid #1a1f2e" }}>
              <div style={{ padding: "0 20px", height: 48, borderBottom: "1px solid #1a1f2e", background: "#0B0E17", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: "0.1em" }}>TODAY&apos;S TRADES</div>
                <div style={{ fontSize: 9, color: "#374151", marginTop: 1 }}>
                  {(() => {
                    const t = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
                    const n = allPositions.filter(p => p.opened_at.startsWith(t) || p.closed_at?.startsWith(t)).length;
                    return `${n} trade${n !== 1 ? "s" : ""} today`;
                  })()}
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
                {(() => {
                  const t = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
                  const todayTrades = allPositions.filter(p => p.opened_at.startsWith(t) || p.closed_at?.startsWith(t));
                  const thSt: React.CSSProperties = { padding: "6px 10px", fontSize: 9, fontWeight: 700, color: "#4b5563", letterSpacing: "0.08em", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid #1a1f2e", background: "#070A11", position: "sticky", top: 0 };
                  const tdSt: React.CSSProperties = { padding: "6px 10px", fontSize: 10, fontFamily: "monospace", whiteSpace: "nowrap", borderBottom: "1px solid #111827" };
                  if (todayTrades.length === 0) {
                    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#374151", fontSize: 12 }}>No trades today</div>;
                  }
                  return (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>{["ENTRY","EXIT","SIDE","E.$","X.$","PnL","RET%","REASON"].map(h => <th key={h} style={thSt}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {todayTrades.map(p => {
                          const net = (p.pnl_inr ?? 0) - (p.charges_inr ?? 0);
                          const c = net > 0 ? "#4ade80" : net < 0 ? "#f87171" : "#9ca3af";
                          const ret = p.qty_inr > 0 ? net / p.qty_inr * 100 : 0;
                          return (
                            <tr key={p.id}>
                              <td style={tdSt}>{fmtTime(p.opened_at)}</td>
                              <td style={tdSt}>{fmtTime(p.closed_at)}</td>
                              <td style={{ ...tdSt, color: p.side === "LONG" ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{p.side}</td>
                              <td style={tdSt}>${p.entry_price_usd.toFixed(1)}</td>
                              <td style={tdSt}>{p.exit_price_usd != null ? `${p.exit_price_usd.toFixed(1)}` : "—"}</td>
                              <td style={{ ...tdSt, color: c }}>{net >= 0 ? "+" : "-"}₹{Math.abs(net).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                              <td style={{ ...tdSt, color: c }}>{ret >= 0 ? "+" : ""}{ret.toFixed(1)}%</td>
                              <td style={{ ...tdSt, color: "#6b7280" }}>{p.status === "OPEN" ? "OPEN" : (p.exit_reason ?? "—")}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>

            {/* Right 40% — all-time cumulative PnL */}
            <div style={{ flex: "0 0 40%", minWidth: 0, display: "flex", flexDirection: "column", background: "#0A0D14" }}>
              {closedTrades.length < 5 ? (
                <>
                  <div style={{ padding: "0 20px", height: 48, borderBottom: "1px solid #1a1f2e", background: "#0B0E17", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: "0.1em" }}>CUMULATIVE PNL</div>
                    <div style={{ fontSize: 9, color: "#374151", marginTop: 1 }}>All-time · profit since start</div>
                  </div>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
                    <div style={{ color: "#6b7280", fontSize: 12, lineHeight: 1.6 }}>
                      {closedTrades.length} closed trade{closedTrades.length !== 1 ? "s" : ""} so far<br />
                      <span style={{ color: "#4b5563" }}>chart appears after 5</span>
                    </div>
                  </div>
                </>
              ) : (
                <CapitalHistoryChart strategyId={id} accent={accent} />
              )}
            </div>
          </div>

        </section>

        {/* ═══════ SECTION 3 — TRADES ═══════ */}
        <section
          style={{
            display: "flex", flexDirection: "column",
            padding: "32px 40px 80px",
          }}
        >
          {openTrades.length === 0 && closedTrades.length === 0 ? (
            <div style={{ minHeight: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 40, marginBottom: 20 }}>₿</div>
                <div style={{ fontSize: 20, color: "#374151", fontWeight: 600 }}>No trades taken yet</div>
                <div style={{ fontSize: 16, color: "#1f2937", marginTop: 8 }}>Strategy is scanning for signals</div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1 }}>

              {/* Open trades */}
              {openTrades.length > 0 && (
                <div style={{ marginBottom: 60 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                    <span className="pulse" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#f5d547" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#f5d547", letterSpacing: "0.15em" }}>OPEN TRADES</span>
                    <span style={{ fontSize: 13, color: "#4b5563" }}>· {openTrades.length} position{openTrades.length !== 1 ? "s" : ""} · live PnL every 1s</span>
                  </div>
                  <div style={{ overflowX: "auto", background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                      <thead>
                        <tr style={{ background: "#070A11" }}>
                          {["Side", "Entry (USD)", "Current (USD)", "Qty (INR)", "Leverage", "Live PnL", "SL", "Trail SL", "Duration"].map(h => (
                            <th key={h} style={thStyle}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {openTrades.map(pos => (
                          <tr key={pos.id} style={{ borderTop: "1px solid #0f1520" }}>
                            <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: pos.side === "LONG" ? "#22c55e" : "#ef4444" }}>{pos.side}</td>
                            <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280", fontFamily: "monospace" }}>${pos.entry_price_usd.toFixed(2)}</td>
                            <td style={{ padding: "12px 16px", fontSize: 12, color: "#f5d547", fontFamily: "monospace", fontWeight: 600 }}>${(pos.current_price_usd ?? pos.entry_price_usd).toFixed(2)}</td>
                            <td style={{ padding: "12px 16px", fontSize: 12, color: "#9ca3af" }}>₹{pos.qty_inr.toFixed(0)}</td>
                            <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace", color: "#a78bfa" }}>{pos.leverage != null ? `${pos.leverage}×` : "—"}</td>
                            <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: pnlColor(pos.pnl_inr ?? 0) }}>{pnlStr(pos.pnl_inr ?? 0)}</td>
                            <td style={{ padding: "12px 16px", fontSize: 12, color: "#ef4444", fontFamily: "monospace" }}>{pos.stop_loss ? `$${pos.stop_loss.toFixed(2)}` : "—"}</td>
                            <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace", color: pos.trail_sl ? "#f5d547" : "#374151" }}>{pos.trail_sl ? `$${pos.trail_sl.toFixed(2)}` : "inactive"}</td>
                            <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280" }}>{formatDuration(pos.opened_at, null)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Closed trades */}
              {closedTrades.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#4b5563", letterSpacing: "0.15em" }}>CLOSED TRADES</span>
                    <span style={{ fontSize: 13, color: "#374151" }}>· {closedTrades.length} total</span>
                  </div>
                  <div style={{ maxHeight: 260, overflowY: "auto", overflowX: "auto", border: "1px solid #1a1f2e", borderRadius: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200 }}>
                      <thead>
                        <tr style={{ background: "#070A11" }}>
                          {["Side", "Entry (USD)", "Exit (USD)", "Qty (INR)", "Leverage", "Realized (Partial)", "Gross PnL", "Charges", "Net PnL", "Exit Reason", "Duration", "Opened", "Closed"].map(h => (
                            <th key={h} style={{ ...thStyle, position: "sticky", top: 0, background: "#070A11" }}>{h}</th>
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
                              onClick={() => setExpandedTrade(prev => prev === pos.id ? null : pos.id)}
                            >
                              <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: pos.side === "LONG" ? "#22c55e" : "#ef4444" }}>{pos.side}</td>
                              <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280", fontFamily: "monospace" }}>${pos.entry_price_usd.toFixed(2)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 12, color: "#4b5563", fontFamily: "monospace" }}>{pos.exit_price_usd != null ? `$${pos.exit_price_usd.toFixed(2)}` : "—"}</td>
                              <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280" }}>₹{pos.qty_inr.toFixed(0)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace", color: "#a78bfa" }}>{pos.leverage != null ? `${pos.leverage}×` : "—"}</td>
                              <td style={{ padding: "12px 16px", fontSize: 11, fontFamily: "monospace", color: (pos.realized_pnl ?? 0) !== 0 ? "#4ade80" : "#374151" }}>
                                {(pos.realized_pnl ?? 0) !== 0 ? pnlStr(pos.realized_pnl ?? 0) : "—"}
                              </td>
                              <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace", color: "#6b7280" }}>{pnlStr(pos.pnl_inr ?? 0)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace", color: "#4b5563" }}>
                                {pos.charges_inr ? `-₹${pos.charges_inr.toFixed(2)}` : "—"}
                              </td>
                              <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: pnlColor((pos.pnl_inr ?? 0) - (pos.charges_inr ?? 0)) }}>
                                {pnlStr((pos.pnl_inr ?? 0) - (pos.charges_inr ?? 0))}
                              </td>
                              <td style={{ padding: "12px 16px", fontSize: 11, color: "#374151", whiteSpace: "nowrap" }}>{pos.exit_reason?.replace(/_/g, " ") ?? "—"}</td>
                              <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280" }}>{formatDuration(pos.opened_at, pos.closed_at)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 11, color: "#374151" }}>{fmtTime(pos.opened_at)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 11, color: "#374151" }}>{fmtTime(pos.closed_at)}</td>
                            </tr>
                            {expandedTrade === pos.id && (
                              <tr style={{ borderTop: "1px solid #0f1520" }}>
                                <td colSpan={13} style={{ padding: "20px 24px", background: "#080B12" }}>
                                  <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
                                    {pos.entry_reason && (
                                      <div style={{ flex: 1, minWidth: 260 }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 8 }}>WHY ENTERED</div>
                                        <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.7 }}>{pos.entry_reason}</div>
                                      </div>
                                    )}
                                    {(pos.exit_reason_detail ?? pos.exit_reason) && (
                                      <div style={{ flex: 1, minWidth: 260 }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 8 }}>WHY CLOSED</div>
                                        <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.7 }}>{pos.exit_reason_detail ?? pos.exit_reason?.replace(/_/g, " ")}</div>
                                      </div>
                                    )}
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
            </div>
          )}
        </section>
      </div>
    </>
  );
}
