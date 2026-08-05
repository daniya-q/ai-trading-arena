"use client";

import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  createChart, AreaSeries, ColorType, createSeriesMarkers,
} from "lightweight-charts";
import type {
  IChartApi, ISeriesApi, Time,
} from "lightweight-charts";
import { supabase } from "@/lib/supabase/client";
import { accentFor } from "@/lib/strategySpec";
import StrategySpecCard from "@/components/StrategySpecCard";

const BACKEND = "https://ai-trading-arena-backend-production.up.railway.app";

// ── Types ────────────────────────────────────────────────────────

type Strategy = {
  id: string; name: string; description: string;
  status: "active" | "paused" | "placeholder"; slot_number: number;
};
type Capital = {
  strategy_id: string; allocated_capital: number; current_value: number;
  total_pnl: number; win_rate: number; sharpe_ratio: number;
  today_trades: number; lifetime_trades: number;
};
type Position = {
  id: string; strategy_id: string; symbol: string; type: string;
  entry_price: number; current_price: number; exit_price: number | null;
  quantity: number; stop_loss: number | null; trail_sl: number | null;
  pnl: number; status: "OPEN" | "CLOSED";
  opened_at: string; closed_at: string | null;
  exit_reason: string | null; exit_reason_detail: string | null;
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

// ── Strategy Config ──────────────────────────────────────────────




// ── Formatters ───────────────────────────────────────────────────

function fmtINR(n: number) { return Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
function pnlStr(n: number) { return `${n >= 0 ? "+" : "-"}₹${fmtINR(n)}`; }
function pnlColor(n: number) { return n > 0 ? "#4ade80" : n < 0 ? "#f87171" : "#ffffff"; }
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtPct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }
function formatDuration(openedAt: string, closedAt: string | null) {
  const ms = Math.max(0, (closedAt ? new Date(closedAt) : new Date()).getTime() - new Date(openedAt).getTime());
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getEntryReason(sid: string, type: string): string {
  const CE = type === "CE";
  switch (sid) {
    case "ema_crossover":  return CE ? "16 EMA crossed above 64 EMA on 30s candle — bullish crossover signal." : "16 EMA crossed below 64 EMA on 30s candle — bearish crossover signal.";
    case "ema_confluence": return CE ? "All 5 confluence filters aligned: EMA crossover · RSI < 45 · price above VWAP · volume spike · near 50–61.8% Fibonacci support." : "All 5 confluence filters aligned: EMA crossover · RSI > 55 · price below VWAP · volume spike · near 50–61.8% Fibonacci resistance.";
    case "orion":          return CE ? "Price broke above ORB High and closed above VWAP. CE OI rising at ATM (long buildup confirmed)." : "Price broke below ORB Low and closed below VWAP. PE OI rising at ATM (short buildup confirmed).";
    case "supertrend":     return CE ? "Supertrend(7,3) flipped green on 5m candle. Price crossed above the Supertrend line — bullish flip." : "Supertrend(7,3) flipped red on 5m candle. Price crossed below the Supertrend line — bearish flip.";
    case "pcr_reversal":   return CE ? "PCR exceeded 1.3 (market oversold). PE OI at ATM fell 10%+ over 30 min — confirming PE unwinding." : "PCR fell below 0.7 (market overbought). CE OI at ATM fell 10%+ over 30 min — confirming CE unwinding.";
    case "gap_orb":        return CE ? "Gap down > 0.3% at open. Fade strategy — buying CE expecting recovery to previous close." : "Gap up > 0.3% at open. Fade strategy — buying PE expecting pullback to previous close.";
    case "vwap_scalper":        return CE ? "Price pulled back to VWAP and bounced above it on 1m candle. RSI 40–60 · OI rising · higher low formed." : "Price pulled back to VWAP and rejected below it on 1m candle. RSI 40–60 · OI rising · lower high formed.";
    case "ema_crossover_asym":    return CE ? "16 EMA crossed above 64 EMA on 30s candle — entry taken immediately (2-bar exit confirmation variant)." : "16 EMA crossed below 64 EMA on 30s candle — entry taken immediately (2-bar exit confirmation variant).";
    case "ema_crossover_confirm": return CE ? "16/64 EMA bull cross confirmed over 2 consecutive 30s bars — entry taken on bar 2." : "16/64 EMA bear cross confirmed over 2 consecutive 30s bars — entry taken on bar 2.";
    case "ema_crossover_dualtf":  return CE ? "30s EMA bull cross AND 1m EMA16 > EMA64 — both timeframes aligned bullish." : "30s EMA bear cross AND 1m EMA16 < EMA64 — both timeframes aligned bearish.";
    default: return "Entry signal triggered.";
  }
}

function fallbackExitText(pos: Position): string {
  switch (pos.exit_reason) {
    case "SL_HIT":      return `Stop loss hit. Entry: ₹${pos.entry_price.toFixed(2)}. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    case "CROSSOVER":   return "Opposite EMA/Supertrend crossover detected. Position closed and flip trade opened.";
    case "TRAIL_SL":    return `Trailing stop loss triggered. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    case "HARD_CLOSE":  return "Position closed at hard close time per strategy trading window rule.";
    case "PCR_NEUTRAL": return "PCR reverted to neutral zone (0.9–1.1). Signal no longer valid.";
    case "OI_REVERSE":  return "OI buildup detected on opposite side. Signal reversed.";
    case "TARGET":
    case "GAP_FILL":    return `Gap fill target reached. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    case "VWAP_CROSS":  return `Price crossed VWAP in opposite direction. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    default:            return pos.exit_reason?.replace(/_/g, " ") ?? "—";
  }
}

// ── CapitalHistoryChart ──────────────────────────────────────────────────────


function CapitalHistoryChart({ strategyId, accent, isBtc = false }: { strategyId: string; accent: string; isBtc?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Area"> | null>(null);
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
    const series = chart.addSeries(AreaSeries, {
      lineColor:              accent,
      topColor:               `${accent}33`,
      bottomColor:            `${accent}00`,
      lineWidth:              2,
      lineType:               1,
      crosshairMarkerVisible: true,
      lastValueVisible:       true,
      priceLineVisible:       false,
    });
    seriesRef.current = series;
    series.createPriceLine({ price: 0, color: "#374151", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    return () => { chart.remove(); chartRef.current = seriesRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const endpoint = isBtc
      ? `${BACKEND}/api/btc-capital-history?strategy=${strategyId}`
      : `${BACKEND}/api/capital-history?strategy=${strategyId}`;
    fetch(endpoint)
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
  }, [strategyId, isBtc]);

  const pnlColor = livePnl >= 0 ? "#4ade80" : "#f87171";

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
            <div style={{ fontSize: 18, fontWeight: 700, color: pnlColor, fontFamily: "monospace" }}>
              {livePnl >= 0 ? "+" : ""}₹{Math.abs(livePnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
        )}
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}


// ── Strategy Detail Page (3-section fullscreen) ──────────────────

export default function StrategyDetailPage() {
  const params = useParams();
  const id     = (params.id as string) ?? "";
  const accent = accentFor(id);

  // Data
  const [strategy,  setStrategy]  = useState<Strategy | null>(null);
  const [capital,   setCapital]   = useState<Capital | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [openPos,   setOpenPos]   = useState<Position[]>([]);
  const [loading,   setLoading]   = useState(true);

  // UI state
  const [activeSection,  setActiveSection]  = useState(0);
  const [expandedTrade,  setExpandedTrade]  = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StrategyMetrics | null>(null);

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const sec0Ref   = useRef<HTMLElement>(null);
  const sec1Ref   = useRef<HTMLElement>(null);
  const sec3Ref   = useRef<HTMLElement>(null);
  const sectionRefs = [sec0Ref, sec1Ref, sec3Ref];

  // ── Data fetching (unchanged logic) ──

  const loadStrategyCapital = useCallback(async () => {
    const [sRes, cRes] = await Promise.all([
      supabase.from("strategies").select("*").eq("id", id).single(),
      supabase.from("strategy_capital").select("*").eq("strategy_id", id).single(),
    ]);
    if (sRes.data) setStrategy(sRes.data as Strategy);
    if (cRes.data) setCapital(cRes.data as Capital);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadStrategyCapital();
    const iv = setInterval(loadStrategyCapital, 15_000);
    return () => clearInterval(iv);
  }, [loadStrategyCapital]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("strategy_positions").select("*")
        .eq("strategy_id", id).order("opened_at", { ascending: false }).limit(300);
      if (data) setPositions(data as Position[]);
    };
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, [id]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("strategy_positions").select("*")
        .eq("strategy_id", id).eq("status", "OPEN");
      if (data) setOpenPos(data as Position[]);
    };
    load();
    const iv = setInterval(load, 1_000);
    return () => clearInterval(iv);
  }, [id]);

  useEffect(() => {
    fetch(`${BACKEND}/api/strategy-metrics?strategy=${id}`)
      .then(r => r.json())
      .then(d => setMetrics(d))
      .catch(() => {});
    const iv = setInterval(() => {
      fetch(`${BACKEND}/api/strategy-metrics?strategy=${id}`)
        .then(r => r.json())
        .then(d => setMetrics(d))
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(iv);
  }, [id]);

  // ── Scroll & keyboard navigation ──

  const scrollToSection = useCallback((idx: number) => {
    sectionRefs[idx].current?.scrollIntoView({ behavior: "smooth" });
    setActiveSection(idx);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // IntersectionObserver to track active section
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(e => {
          if (e.isIntersecting && e.intersectionRatio >= 0.5) {
            const idx = sectionRefs.findIndex(r => r.current === e.target);
            if (idx !== -1) setActiveSection(idx);
          }
        });
      },
      { root: container, threshold: 0.5 }
    );
    sectionRefs.forEach(r => r.current && observer.observe(r.current));
    return () => observer.disconnect();
  }, [loading]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        scrollToSection(Math.min(activeSection + 1, 2));
      }
      if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        scrollToSection(Math.max(activeSection - 1, 0));
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [activeSection, scrollToSection]);

  // ── Derived values ──
  const allocated   = capital?.allocated_capital ?? 100_000;
  const closedPnl   = capital?.total_pnl ?? 0;
  const openPnl     = openPos.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const liveCapital = allocated + closedPnl + openPnl;
  const livePnl     = liveCapital - allocated;
  const retPct      = (livePnl / allocated) * 100;
  const sharpe      = capital?.sharpe_ratio ?? 0;
  const winRate     = capital?.win_rate ?? 0;
  const today       = capital?.today_trades ?? 0;
  const lifetime    = capital?.lifetime_trades ?? 0;
  const openTrades  = openPos;
  const closedTrades = positions
    .filter(p => p.status === "CLOSED")
    .sort((a, b) => new Date(b.closed_at ?? 0).getTime() - new Date(a.closed_at ?? 0).getTime());
  const allPositions = [...openTrades, ...closedTrades];


  // ── Stats bar data ──
  // Exit breakdown: top 2 reasons
  const exitBreakdown = metrics?.exit_reason_breakdown ?? {};
  const exitEntries = Object.entries(exitBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const exitText = exitEntries.length > 0
    ? exitEntries.map(([k, v]) => `${k.replace(/_/g, " ")} ${v}%`).join(" · ")
    : "—";

  // Profit factor color
  const pfNum = parseFloat(metrics?.profit_factor ?? "0");
  const pfColor = metrics?.profit_factor === "∞" ? "#4ade80" : pfNum >= 1.5 ? "#4ade80" : pfNum >= 1 ? "#f5d547" : "#f87171";

  // Hero 4 first (top 2×2), then remaining 10 (compact 2×5)
  const stats = [
    { label: "TOTAL PnL",          value: pnlStr(livePnl),                                        color: pnlColor(livePnl) },
    { label: "RETURN %",           value: fmtPct(retPct),                                         color: pnlColor(retPct) },
    { label: "WIN RATE",           value: `${(winRate * 100).toFixed(1)}%`,                       color: winRate * 100 >= 50 ? "#4ade80" : "#f87171" },
    { label: "PROFIT FACTOR",      value: metrics?.profit_factor ?? "—",                          color: pfColor },
    // compact rows below
    { label: "INITIAL CAPITAL",    value: `₹${fmtINR(allocated)}`,                              color: "#9ca3af" },
    { label: "CURRENT CAPITAL",    value: `₹${fmtINR(liveCapital)}`,                             color: "#ffffff" },
    { label: "SHARPE",             value: sharpe.toFixed(2),                                      color: "#ffffff" },
    { label: "TOTAL TRADES",       value: String(lifetime),                                       color: "#ffffff" },
    { label: "TODAY",              value: String(today),                                           color: "#ffffff" },
    { label: "AVG WIN/LOSS",       value: metrics ? `${metrics.avg_win_avg_loss}×` : "—",        color: "#ffffff" },
    { label: "MAX DRAWDOWN",       value: metrics ? `-₹${fmtINR(metrics.max_drawdown_inr)} (-${metrics.max_drawdown_pct.toFixed(1)}%)` : "—", color: metrics && metrics.max_drawdown_inr > 0 ? "#f87171" : "#9ca3af" },
    { label: "EXPECTANCY",         value: metrics ? pnlStr(metrics.expectancy) : "—",            color: metrics ? pnlColor(metrics.expectancy) : "#9ca3af" },
    { label: "MAX CONSEC LOSSES",  value: metrics ? String(metrics.max_consecutive_losses) : "—", color: metrics && metrics.max_consecutive_losses > 3 ? "#f87171" : "#ffffff" },
    { label: "EXIT BREAKDOWN",     value: exitText,                                               color: "#9ca3af" },
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
      {/* Inject keyframe for scroll bounce */}
      <style>{`
        @keyframes scrollBounce {
          0%, 100% { opacity: 0.4; transform: translateX(-50%) translateY(0); }
          50%       { opacity: 1;   transform: translateX(-50%) translateY(6px); }
        }
      `}</style>

      {/* Fixed strategy name — visible across all 3 sections */}
      <div style={{
        position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)",
        fontSize: 14, fontWeight: 600, color: "#ffffff88", letterSpacing: "0.08em",
        zIndex: 300, pointerEvents: "none", whiteSpace: "nowrap",
      }}>
        {strategy?.name ?? id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
      </div>

      {/* Back link — fixed top left, always visible */}
      <Link href="/" style={{
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
        Indian Strategies Dashboard
      </Link>

      {/* Dot navigation — fixed right */}
      <div style={{
        position: "fixed", right: 24, top: "50%", transform: "translateY(-50%)",
        zIndex: 200, display: "flex", flexDirection: "column", gap: 14,
      }}>
        {[0, 1, 2].map(i => (
          <button key={i} onClick={() => scrollToSection(i)} title={["Overview", "Today", "All Trades"][i]} style={{
            width: activeSection === i ? 10 : 6,
            height: activeSection === i ? 10 : 6,
            borderRadius: "50%",
            background: activeSection === i ? accent : "#374151",
            border: `1px solid ${activeSection === i ? accent : "#4b5563"}`,
            cursor: "pointer", padding: 0, transition: "all 0.25s",
          }} />
        ))}
      </div>

      {/* Scroll container */}
      <div
        ref={scrollRef}
        style={{
          height: "100vh", overflowY: "auto",
          scrollSnapType: "y mandatory", scrollBehavior: "smooth",
          background: "#0A0D14",
        }}
      >

        {/* ═══════════════════════════════════════
            SECTION 1 — STRATEGY OVERVIEW
        ═══════════════════════════════════════ */}
        <section
          ref={sec0Ref}
          style={{
            height: "100vh", scrollSnapAlign: "start",
            display: "flex", flexDirection: "column",
            position: "relative", overflow: "hidden",
          }}
        >
          {/* Grid: name spans full width (row 1); KPIs + Logic side by side (row 2) */}
          <div style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "40% 60%",
            gridTemplateRows: "auto 1fr",
            overflow: "hidden",
          }}>

            {/* ── Name + description — spans both columns ── */}
            <div style={{ gridColumn: "1 / -1", padding: "clamp(40px,5vh,64px) 80px clamp(12px,1.5vh,20px)", textAlign: "center" }}>
              <h1 style={{
                fontSize: "clamp(28px, 3.5vh, 36px)", fontWeight: 700, color: "#ffffff",
                margin: "0 0 8px", lineHeight: 1.1, letterSpacing: "-0.02em",
              }}>
                {strategy?.name ?? id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
              </h1>
              {strategy?.description && (
                <p style={{ fontSize: "clamp(13px, 1.6vh, 16px)", color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
                  {strategy.description}
                </p>
              )}
            </div>

            {/* ── KPI grid — auto-placed row 2 col 1 ── */}
            <div style={{ padding: "0 40px clamp(8px,1vh,14px)", overflow: "hidden", display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Hero 2×2 — top ~35% */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr",
                gap: 6, flex: "0 0 35%",
              }}>
                {stats.slice(0, 4).map(s => (
                  <div key={s.label} style={{
                    background: "rgba(255,255,255,0.05)", border: `1px solid ${accent}33`,
                    borderRadius: 8, padding: "6px 12px",
                    display: "flex", flexDirection: "column", justifyContent: "space-between",
                  }}>
                    <div style={{ fontSize: "clamp(10px, 1.1vh, 12px)", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", paddingTop: 4 }}>{s.label}</div>
                    <div style={{ fontSize: "clamp(18px, 2.1vh, 24px)", fontWeight: 700, color: s.color, fontFamily: "monospace", paddingBottom: 4 }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {/* Compact 2×5 — remaining 10 */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "repeat(5, 1fr)",
                gap: 6, flex: 1,
              }}>
                {stats.slice(4).map(s => (
                  <div key={s.label} style={{
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8, padding: "4px 10px",
                    display: "flex", flexDirection: "column", justifyContent: "space-between",
                  }}>
                    <div style={{ fontSize: "clamp(8px, 0.9vh, 10px)", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", paddingTop: 4 }}>{s.label}</div>
                    <div style={{ fontSize: "clamp(11px, 1.3vh, 15px)", fontWeight: 700, color: s.color, fontFamily: "monospace", paddingBottom: 4 }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Strategy Spec Card — auto-placed row 2 col 2 ── */}
            <div style={{ borderLeft: "1px solid rgba(255,255,255,0.08)", padding: "0 48px clamp(8px,1vh,14px) 40px", overflow: "hidden" }}>
              <StrategySpecCard strategyId={id} />
            </div>
          </div>

          {/* NEXT ↓ pill */}
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "10px 0 18px" }}>
            <button
              onClick={() => scrollToSection(1)}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              style={{
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 999, padding: "10px 28px", color: "#ffffff",
                fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer",
              }}
            >NEXT ↓</button>
          </div>
        </section>

        {/* ═══════════════════════════════════════
            SECTION 2 — TODAY'S TRADES + CUMULATIVE PNL
        ═══════════════════════════════════════ */}
        <section
          ref={sec1Ref}
          style={{
            height: "100vh", scrollSnapAlign: "start",
            display: "flex", flexDirection: "column",
            position: "relative",
          }}
        >
          {/* ↑ PREV pill */}
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "10px 0" }}>
            <button
              onClick={() => scrollToSection(0)}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              style={{
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 999, padding: "10px 28px", color: "#ffffff",
                fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer",
              }}
            >↑ PREV</button>
          </div>

          {/* Split: Today's Trades (left) | Cumulative PnL (right) */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", borderTop: "1px solid #1a1f2e" }}>

            {/* ── Left 60%: Today's Trades ── */}
            <div style={{ flex: "0 0 60%", minWidth: 0, display: "flex", flexDirection: "column", background: "#0A0D14", borderRight: "1px solid #1a1f2e" }}>
              <div style={{ padding: "0 20px", height: 48, borderBottom: "1px solid #1a1f2e", background: "#0B0E17", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: "0.1em" }}>TODAY&apos;S TRADES</div>
                  <div style={{ fontSize: 9, color: "#374151", marginTop: 1 }}>
                    {(() => {
                      const t = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
                      const n = allPositions.filter(p => p.opened_at.startsWith(t) || p.closed_at?.startsWith(t)).length;
                      return `${n} trade${n !== 1 ? "s" : ""} today`;
                    })()}
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
                {(() => {
                  const t = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
                  const todayTrades = allPositions.filter(p => p.opened_at.startsWith(t) || p.closed_at?.startsWith(t));
                  const thSt: React.CSSProperties = { padding: "6px 10px", fontSize: 9, fontWeight: 700, color: "#4b5563", letterSpacing: "0.08em", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid #1a1f2e", background: "#070A11", position: "sticky", top: 0 };
                  const tdSt: React.CSSProperties = { padding: "6px 10px", fontSize: 10, fontFamily: "monospace", whiteSpace: "nowrap", borderBottom: "1px solid #111827" };
                  if (todayTrades.length === 0) {
                    return (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#374151", fontSize: 12 }}>
                        No trades today
                      </div>
                    );
                  }
                  return (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={thSt}>ENTRY</th>
                          <th style={thSt}>EXIT</th>
                          <th style={thSt}>E.PRICE</th>
                          <th style={thSt}>X.PRICE</th>
                          <th style={thSt}>QTY</th>
                          <th style={thSt}>PnL</th>
                          <th style={thSt}>RET%</th>
                          <th style={thSt}>REASON</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todayTrades.map(p => {
                          const pnlCol = (p.pnl ?? 0) > 0 ? "#4ade80" : (p.pnl ?? 0) < 0 ? "#f87171" : "#9ca3af";
                          const retPct = p.entry_price > 0 && p.quantity > 0 ? (p.pnl ?? 0) / (p.entry_price * p.quantity) * 100 : 0;
                          return (
                            <tr key={p.id}>
                              <td style={tdSt}>{fmtTime(p.opened_at)}</td>
                              <td style={tdSt}>{fmtTime(p.closed_at)}</td>
                              <td style={tdSt}>{p.entry_price.toFixed(2)}</td>
                              <td style={tdSt}>{p.exit_price != null ? p.exit_price.toFixed(2) : "—"}</td>
                              <td style={tdSt}>{p.quantity}</td>
                              <td style={{ ...tdSt, color: pnlCol }}>{(p.pnl ?? 0) >= 0 ? "+" : ""}₹{Math.abs(p.pnl ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                              <td style={{ ...tdSt, color: pnlCol }}>{retPct >= 0 ? "+" : ""}{retPct.toFixed(1)}%</td>
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

            {/* ── Right 40%: All-time Cumulative PnL ── */}
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

          {/* NEXT ↓ pill */}
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "10px 0", borderTop: "1px solid #1a1f2e" }}>
            <button
              onClick={() => scrollToSection(2)}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              style={{
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 999, padding: "10px 28px", color: "#ffffff",
                fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer",
              }}
            >NEXT ↓</button>
          </div>
        </section>

        {/* ═══════════════════════════════════════
            SECTION 3 — TRADES
        ═══════════════════════════════════════ */}
        <section
          ref={sec3Ref}
          style={{
            minHeight: "100vh", scrollSnapAlign: "start",
            display: "flex", flexDirection: "column",
            padding: "0 40px 80px",
          }}
        >
          {/* ↑ PREV pill */}
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "12px 0", marginBottom: 32 }}>
            <button
              onClick={() => scrollToSection(1)}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              style={{
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 999, padding: "10px 28px", color: "#ffffff",
                fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer",
              }}
            >↑ PREV</button>
          </div>

          {openTrades.length === 0 && closedTrades.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 40, marginBottom: 20 }}>📊</div>
                <div style={{ fontSize: 20, color: "#374151", fontWeight: 600 }}>No trades taken yet</div>
                <div style={{ fontSize: 16, color: "#1f2937", marginTop: 8 }}>Strategy is scanning for signals</div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1 }}>

              {/* ── Open Trades ── */}
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
                          {["Symbol", "Type", "Entry", "Current Price", "Qty", "Live PnL", "SL", "Trail SL", "Duration"].map(h => (
                            <th key={h} style={thStyle}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {openTrades.map(pos => (
                          <Fragment key={pos.id}>
                            <tr
                              onClick={() => setExpandedTrade(p => p === pos.id ? null : pos.id)}
                              style={{ borderTop: "1px solid #111827", cursor: "pointer", transition: "background 0.15s",
                                background: expandedTrade === pos.id ? `${accent}08` : "transparent" }}
                              onMouseEnter={e => { if (expandedTrade !== pos.id) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                              onMouseLeave={e => { if (expandedTrade !== pos.id) e.currentTarget.style.background = "transparent"; }}
                            >
                              <td style={{ padding: "14px 16px", fontSize: 14, color: "#c9d1d9", whiteSpace: "nowrap", fontFamily: "monospace" }}>{pos.symbol}</td>
                              <td style={{ padding: "14px 16px", fontSize: 14, fontWeight: 700, color: pos.type === "CE" ? "#22c55e" : "#ef4444" }}>{pos.type}</td>
                              <td style={{ padding: "14px 16px", fontSize: 14, color: "#6b7280", fontFamily: "monospace" }}>₹{pos.entry_price.toFixed(2)}</td>
                              <td style={{ padding: "14px 16px", fontSize: 14, color: "#f5d547", fontFamily: "monospace", fontWeight: 700 }}>₹{(pos.current_price ?? 0).toFixed(2)}</td>
                              <td style={{ padding: "14px 16px", fontSize: 14, color: "#9ca3af" }}>{pos.quantity}</td>
                              <td style={{ padding: "14px 16px", fontSize: 15, fontFamily: "monospace", fontWeight: 700, color: pnlColor(pos.pnl ?? 0) }}>{pnlStr(pos.pnl ?? 0)}</td>
                              <td style={{ padding: "14px 16px", fontSize: 14, color: "#ef4444", fontFamily: "monospace" }}>
                                {pos.stop_loss ? `₹${pos.stop_loss.toFixed(2)}` : "—"}
                              </td>
                              <td style={{ padding: "14px 16px", fontSize: 14, fontFamily: "monospace", color: pos.trail_sl ? "#f5d547" : "#374151" }}>
                                {pos.trail_sl ? `₹${pos.trail_sl.toFixed(2)}` : "—"}
                              </td>
                              <td style={{ padding: "14px 16px", fontSize: 14, color: "#6b7280" }}>{formatDuration(pos.opened_at, null)}</td>
                            </tr>
                            {expandedTrade === pos.id && (
                              <tr style={{ borderTop: "1px solid #111827" }}>
                                <td colSpan={9} style={{ padding: "20px 24px", background: "#080B12" }}>
                                  <div style={{ fontSize: 11, color: "#4b5563", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>WHY THIS TRADE WAS ENTERED</div>
                                  <div style={{ fontSize: 16, color: "#9ca3af", lineHeight: 1.8 }}>{getEntryReason(pos.strategy_id, pos.type)}</div>
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

              {/* ── Divider ── */}
              {openTrades.length > 0 && closedTrades.length > 0 && (
                <div style={{ height: 1, background: "#1a1f2e", marginBottom: 48 }} />
              )}

              {/* ── Closed Trades ── */}
              {closedTrades.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#4b5563", letterSpacing: "0.15em" }}>CLOSED TRADES</span>
                    <span style={{ fontSize: 13, color: "#374151" }}>· {closedTrades.length} completed</span>
                  </div>
                  <div style={{ overflowX: "auto", background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
                      <thead>
                        <tr style={{ background: "#070A11" }}>
                          {["Symbol", "Type", "Entry", "Exit", "Duration", "Qty", "PnL", "Return %", "Exit Reason"].map(h => (
                            <th key={h} style={thStyle}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {closedTrades.map(pos => {
                          const ret = pos.entry_price > 0
                            ? (((pos.exit_price ?? pos.entry_price) - pos.entry_price) / pos.entry_price) * 100 : 0;
                          return (
                            <Fragment key={pos.id}>
                              <tr
                                onClick={() => setExpandedTrade(p => p === pos.id ? null : pos.id)}
                                style={{ borderTop: "1px solid #111827", cursor: "pointer", transition: "background 0.15s",
                                  background: expandedTrade === pos.id ? "rgba(255,255,255,0.03)" : "transparent" }}
                                onMouseEnter={e => { if (expandedTrade !== pos.id) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                                onMouseLeave={e => { if (expandedTrade !== pos.id) e.currentTarget.style.background = "transparent"; }}
                              >
                                <td style={{ padding: "14px 16px", fontSize: 14, color: "#6b7280", whiteSpace: "nowrap", fontFamily: "monospace" }}>{pos.symbol}</td>
                                <td style={{ padding: "14px 16px", fontSize: 14, fontWeight: 700, color: pos.type === "CE" ? "#22c55e" : "#ef4444" }}>{pos.type}</td>
                                <td style={{ padding: "14px 16px", fontSize: 14, color: "#6b7280", fontFamily: "monospace" }}>₹{pos.entry_price.toFixed(2)}</td>
                                <td style={{ padding: "14px 16px", fontSize: 14, color: "#4b5563", fontFamily: "monospace" }}>
                                  {pos.exit_price != null ? `₹${pos.exit_price.toFixed(2)}` : "—"}
                                </td>
                                <td style={{ padding: "14px 16px", fontSize: 14, color: "#6b7280" }}>{formatDuration(pos.opened_at, pos.closed_at)}</td>
                                <td style={{ padding: "14px 16px", fontSize: 14, color: "#6b7280" }}>{pos.quantity}</td>
                                <td style={{ padding: "14px 16px", fontSize: 15, fontFamily: "monospace", fontWeight: 700, color: pnlColor(pos.pnl ?? 0) }}>{pnlStr(pos.pnl ?? 0)}</td>
                                <td style={{ padding: "14px 16px", fontSize: 14, fontFamily: "monospace", color: pnlColor(ret) }}>{fmtPct(ret)}</td>
                                <td style={{ padding: "14px 16px", fontSize: 13, color: "#374151", whiteSpace: "nowrap" }}>
                                  {pos.exit_reason?.replace(/_/g, " ") ?? "—"}
                                </td>
                              </tr>
                              {expandedTrade === pos.id && (
                                <tr style={{ borderTop: "1px solid #111827" }}>
                                  <td colSpan={9} style={{ padding: "20px 24px", background: "#080B12" }}>
                                    <div style={{ display: "flex", gap: 48, flexWrap: "wrap" }}>
                                      <div style={{ flex: 1, minWidth: 260 }}>
                                        <div style={{ fontSize: 11, color: "#4b5563", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>WHY THIS TRADE WAS ENTERED</div>
                                        <div style={{ fontSize: 16, color: "#6b7280", lineHeight: 1.8 }}>{getEntryReason(pos.strategy_id, pos.type)}</div>
                                      </div>
                                      <div style={{ flex: 1, minWidth: 260 }}>
                                        <div style={{ fontSize: 11, color: "#4b5563", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>WHY THIS TRADE WAS CLOSED</div>
                                        <div style={{ fontSize: 16, color: "#9ca3af", lineHeight: 1.8 }}>{pos.exit_reason_detail ?? fallbackExitText(pos)}</div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
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
