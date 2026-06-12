"use client";

import { Fragment, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { supabase } from "@/lib/supabase/client";

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
};

type OhlcCandle = { time: number; open: number; high: number; low: number; close: number };

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
    const tick = () => setUtcTime(
      new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC"
    );
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

      {/* UTC Clock */}
      <div style={{ textAlign: "right", minWidth: 100 }}>
        <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", marginBottom: 2, fontWeight: 600 }}>UTC TIME</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#ffffff", fontFamily: "monospace" }}>{utcTime}</div>
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

// ── BtcCandleChart ─────────────────────────────────────────────

function BtcCandleChart({ flexFill = false }: { flexFill?: boolean }) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const chartRef        = useRef<IChartApi | null>(null);
  const seriesRef       = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastCandleTime  = useRef<number>(0);
  const [timeframe, setTimeframe] = useState<"30s" | "1m" | "5m" | "15m">("30s");

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0A0D14" },
        textColor: "#6b7280",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "#1a1f2e" },
        horzLines: { color: "#1a1f2e" },
      },
      rightPriceScale: {
        borderColor: "#1a1f2e",
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#1a1f2e",
        timeVisible: true,
        secondsVisible: true,
        fixLeftEdge: false,
        rightOffset: 5,
      },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
      lastValueVisible: true, priceLineVisible: true,
    });

    const ro = new ResizeObserver(() => {
      if (chartRef.current && containerRef.current)
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.timeScale().applyOptions({ secondsVisible: timeframe === "30s" });
    seriesRef.current?.setData([]);
    lastCandleTime.current = 0;
  }, [timeframe]);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(`${BACKEND}/api/btc/candles?interval=${timeframe}`);
        if (!res.ok) return;
        const raw: OhlcCandle[] = await res.json();
        if (cancelled || !seriesRef.current) return;
        const data = raw
          .filter(c => c.open > 0 && c.high >= c.low && c.close > 0)
          .map(c => ({
            time:  (c.time > 1e10 ? Math.floor(c.time / 1000) : c.time) as UTCTimestamp,
            open: c.open, high: c.high, low: c.low, close: c.close,
          }));
        if (data.length === 0) return;
        const newestTime = data[data.length - 1].time as number;
        if (newestTime === lastCandleTime.current) return;
        lastCandleTime.current = newestTime;
        seriesRef.current.setData(data);
        chartRef.current?.timeScale().scrollToRealTime();
      } catch (err) { console.warn("[btc-candles]", err); }
    };
    fetchData();
    const iv = setInterval(fetchData, 1_000); // BTC is 24/7
    return () => { cancelled = true; clearInterval(iv); };
  }, [timeframe]);

  return (
    <div style={{
      background: "#0B0E17",
      border: "1px solid #1a1f2e",
      borderRadius: 12,
      overflow: "hidden",
      ...(flexFill ? { display: "flex", flexDirection: "column" as const, height: "100%" } : {}),
    }}>
      <div style={{
        padding: "8px 14px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #1a1f2e",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B", letterSpacing: "0.1em" }}>BTC / USD</span>
        <div style={{ display: "flex", gap: 4 }}>
          {(["30s", "1m", "5m", "15m"] as const).map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} style={{
              padding: "2px 8px",
              borderRadius: 20,
              border: `1px solid ${timeframe === tf ? "#F59E0B" : "#1f2937"}`,
              background: timeframe === tf ? "#F59E0B" : "transparent",
              color: timeframe === tf ? "#000000" : "#6b7280",
              fontSize: 10, fontWeight: 600, cursor: "pointer",
              letterSpacing: "0.05em", transition: "all 0.15s",
            }}>{tf}</button>
          ))}
        </div>
      </div>
      <div ref={containerRef} style={flexFill ? { flex: 1, height: 0 } : { width: "100%", height: 350 }} />
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

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollToSection = (idx: number) =>
    containerRef.current?.scrollTo({ top: idx * window.innerHeight, behavior: "smooth" });

  const openPositions = positions.filter(p => p.status === "OPEN");

  return (
    <div
      ref={containerRef}
      className="page-content"
      style={{
        background: "#0A0D14",
        height: "100vh",
        overflowY: "scroll",
        scrollSnapType: "y mandatory",
      }}
    >
      {/* ── SECTION 1: BTC overview + Chart ── */}
      <div style={{
        height: "100vh",
        scrollSnapAlign: "start",
        display: "flex",
        flexDirection: "column",
        padding: "18px 16px 0",
        overflow: "hidden",
      }}>
        {/* Page header */}
        <div style={{ flexShrink: 0, marginBottom: 12, textAlign: "center" }}>
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

        {/* BTC TopBar */}
        <div style={{ flexShrink: 0 }}>
          <BtcTopBar />
        </div>

        {/* Capital Summary */}
        <div style={{ flexShrink: 0 }}>
          <BtcCapitalSummaryBar capitals={capitals} openPositions={openPositions} btcPrice={btcPrice} />
        </div>

        {/* BTC Chart — fills remaining height */}
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <BtcCandleChart flexFill />
        </div>

        {/* NEXT pill */}
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "10px 0 16px" }}>
          <button
            onClick={() => scrollToSection(1)}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 999,
              padding: "10px 28px",
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              cursor: "pointer",
            }}
          >
            NEXT ↓
          </button>
        </div>
      </div>

      {/* ── SECTION 2: Strategy Cards ── */}
      <div style={{
        minHeight: "100vh",
        scrollSnapAlign: "start",
        padding: "14px 16px 32px",
      }}>
        {/* PREV pill */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <button
            onClick={() => scrollToSection(0)}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 999,
              padding: "10px 28px",
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              cursor: "pointer",
            }}
          >
            ↑ PREV
          </button>
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

        {/* Strategy cards */}
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

        {/* Empty state */}
        {strategies.length === 0 && !error && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 8 }}>
            <div style={{ fontSize: 12, color: "#374151" }}>Waiting for data...</div>
            <div style={{ fontSize: 10, color: "#1f2937" }}>
              Run supabase/migrations/005_btc_rebuild.sql if tables are missing.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
