"use client";

import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  createChart, CandlestickSeries, LineSeries, AreaSeries, ColorType, createSeriesMarkers,
} from "lightweight-charts";
import type {
  IChartApi, ISeriesApi, IPriceLine, UTCTimestamp,
  ISeriesMarkersPluginApi, SeriesMarker, Time,
} from "lightweight-charts";
import { supabase } from "@/lib/supabase/client";

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
  qty_inr: number; pnl_inr: number; stop_loss: number | null; trail_sl: number | null;
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
type OhlcCandle = { time: number; open: number; high: number; low: number; close: number };
type BtcIndicatorData = {
  ema9?:  Array<{ time: number; value: number }>;
  ema21?: Array<{ time: number; value: number }>;
  ema20?: Array<{ time: number; value: number }>;
  ema50?: Array<{ time: number; value: number }>;
  vwap?:  Array<{ time: number; value: number }>;
  supertrendUp?:   Array<{ time: number; value: number | null }>;
  supertrendDown?: Array<{ time: number; value: number | null }>;
  orbHigh?: number; orbLow?: number;
  crossovers?: Array<{ time: number; type: "bullish" | "bearish" }>;
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

// ── Strategy Config ────────────────────────────────────────────────

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
    "Timeframe: 30-second candles",
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
    "BTC VWAP Momentum Scalper — Runs 24/7",
    "Timeframe: 1-minute candles | Same VWAP + RSI + volume logic as equity",
    "",
    "Entry — LONG (bullish bounce):",
    "  BTC price closes above VWAP after touching it",
    "  RSI between 40–60 | Tick volume above 20-candle average",
    "  Previous candle made a higher low",
    "",
    "Entry — SHORT (bearish rejection):",
    "  BTC price closes below VWAP after touching it",
    "  RSI between 40–60 | Tick volume above 20-candle average",
    "  Previous candle made a lower high",
    "",
    "SL: 2×ATR normal · Trail: 1% ratchet trail from peak price",
    "VWAP cross exit: opposite signal closes open position",
    "Max: 1 LONG + 1 SHORT per day",
  ],
};

// Per-strategy rules font size (fit content in ~610px available height)
const RULES_FONT: Record<string, number> = {
  btc_ema_crossover:  25,
  btc_orion:          27,
  btc_ema_confluence: 18,
  btc_supertrend:     22,
  btc_vwap_scalper:   15,
};

// Per-strategy default chart interval
const CHART_INTERVAL: Record<string, string> = {
  btc_ema_crossover:  "30s",
  btc_orion:          "15m",
  btc_ema_confluence: "30s",
  btc_supertrend:     "5m",
  btc_vwap_scalper:   "1m",
};

// ── Formatters ─────────────────────────────────────────────────────

function fmtINR(n: number) { return Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
function pnlStr(n: number) { return `${n >= 0 ? "+" : "-"}₹${fmtINR(n)}`; }
function pnlColor(n: number) { return n > 0 ? "#4ade80" : n < 0 ? "#f87171" : "#ffffff"; }
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}
function fmtPct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }
function formatDuration(openedAt: string, closedAt: string | null) {
  const ms = Math.max(0, (closedAt ? new Date(closedAt) : new Date()).getTime() - new Date(openedAt).getTime());
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── CapitalHistoryChart ──────────────────────────────────────────────────────

function CapitalHistoryChart({ strategyId, accent }: { strategyId: string; accent: string }) {
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
      lineColor: accent,
      topColor: `${accent}44`,
      bottomColor: `${accent}08`,
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
    });
    seriesRef.current = series;
    return () => { chart.remove(); chartRef.current = seriesRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch(`${BACKEND}/api/btc-capital-history?strategy=${strategyId}`)
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
  }, [strategyId]);

  const isUp = currentCapital >= initialCapital;
  const diffPct = initialCapital > 0 ? ((currentCapital - initialCapital) / initialCapital) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 24px", height: 48, borderBottom: "1px solid #1a1f2e", background: "#0B0E17", flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#4b5563", letterSpacing: "0.1em" }}>CAPITAL HISTORY</span>
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
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}

// ── BtcIndicatorChart ──────────────────────────────────────────────

function BtcIndicatorChart({
  strategyId,
  defaultInterval,
  positions,
  fullscreen = false,
  onPriceUpdate,
}: {
  strategyId: string;
  defaultInterval: string;
  positions: BtcPosition[];
  fullscreen?: boolean;
  onPriceUpdate?: (price: number, prev: number) => void;
}) {
  const accent = ACCENT[strategyId] ?? "#6b7280";

  const allIntervals = ["30s", "1m", "5m", "15m"] as const;
  type TF = typeof allIntervals[number];
  const [timeframe, setTimeframe] = useState<TF>(defaultInterval as TF);

  const mainContainerRef = useRef<HTMLDivElement>(null);
  const chartRef         = useRef<IChartApi | null>(null);
  const candleSeriesRef  = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema9Ref          = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref         = useRef<ISeriesApi<"Line"> | null>(null);
  const ema20Ref         = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref         = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef          = useRef<ISeriesApi<"Line"> | null>(null);
  const stUpRef          = useRef<ISeriesApi<"Line"> | null>(null);
  const stDownRef        = useRef<ISeriesApi<"Line"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const orbHighLineRef   = useRef<IPriceLine | null>(null);
  const orbLowLineRef    = useRef<IPriceLine | null>(null);
  const lastCandleTimeRef = useRef<number>(0);

  const needsEMAcross  = strategyId === "btc_ema_crossover";
  const needsEMAconf   = strategyId === "btc_ema_confluence";
  const needsVWAP      = ["btc_orion", "btc_ema_confluence", "btc_vwap_scalper"].includes(strategyId);
  const needsST        = strategyId === "btc_supertrend";
  const needsORB       = strategyId === "btc_orion";

  // Init main chart
  useEffect(() => {
    if (!mainContainerRef.current) return;
    const chart = createChart(mainContainerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0A0D14" },
        textColor: "#6b7280",
        fontSize: fullscreen ? 11 : 10,
      },
      grid: { vertLines: { color: "#1a1f2e" }, horzLines: { color: "#1a1f2e" } },
      rightPriceScale: { borderColor: "#1a1f2e", autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: {
        borderColor: "#1a1f2e", timeVisible: true,
        secondsVisible: defaultInterval === "30s" || defaultInterval === "1m",
        fixLeftEdge: false, rightOffset: 5,
      },
      crosshair: { mode: 1 },
      handleScroll: true, handleScale: true,
    });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (chartRef.current && mainContainerRef.current)
        chartRef.current.applyOptions({ width: mainContainerRef.current.clientWidth });
    });
    ro.observe(mainContainerRef.current);
    (chart as unknown as { _ro: ResizeObserver })._ro = ro;

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
      lastValueVisible: true, priceLineVisible: true,
    });
    if (needsEMAcross) {
      ema9Ref.current  = chart.addSeries(LineSeries, { color: "#3B82F6", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: "EMA9" });
      ema21Ref.current = chart.addSeries(LineSeries, { color: "#F97316", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: "EMA21" });
    }
    if (needsEMAconf) {
      ema20Ref.current = chart.addSeries(LineSeries, { color: "#3B82F6", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: "EMA20" });
      ema50Ref.current = chart.addSeries(LineSeries, { color: "#F97316", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: "EMA50" });
    }
    if (needsVWAP) {
      vwapRef.current = chart.addSeries(LineSeries, { color: "#A855F7", lineWidth: 1, lineStyle: 1, lastValueVisible: false, priceLineVisible: false, title: "VWAP" });
    }
    if (needsST) {
      stUpRef.current   = chart.addSeries(LineSeries, { color: "#22c55e", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, title: "ST Up" });
      stDownRef.current = chart.addSeries(LineSeries, { color: "#ef4444", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, title: "ST Down" });
    }

    return () => {
      (chart as unknown as { _ro?: ResizeObserver })._ro?.disconnect();
      chart.remove();
      chartRef.current = candleSeriesRef.current = ema9Ref.current = ema21Ref.current
        = ema20Ref.current = ema50Ref.current = vwapRef.current
        = stUpRef.current = stDownRef.current
        = orbHighLineRef.current = orbLowLineRef.current
        = markersPluginRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear on timeframe change
  useEffect(() => {
    candleSeriesRef.current?.setData([]);
    ema9Ref.current?.setData([]);
    ema21Ref.current?.setData([]);
    ema20Ref.current?.setData([]);
    ema50Ref.current?.setData([]);
    vwapRef.current?.setData([]);
    stUpRef.current?.setData([]);
    stDownRef.current?.setData([]);
    lastCandleTimeRef.current = 0;
    chartRef.current?.timeScale().applyOptions({ secondsVisible: timeframe === "30s" || timeframe === "1m" });
  }, [timeframe]);

  // Poll candles + indicators
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const [cr, ir] = await Promise.all([
          fetch(`${BACKEND}/api/btc/candles?interval=${timeframe}`),
          fetch(`${BACKEND}/api/btc/indicators?strategy=${strategyId}`),
        ]);
        if (!cr.ok || !ir.ok) return;
        const rawCandles: OhlcCandle[] = await cr.json();
        const ind: BtcIndicatorData   = await ir.json();
        if (cancelled || !candleSeriesRef.current) return;

        const candles = rawCandles
          .filter(c => c.open > 0 && c.high >= c.low && c.close > 0)
          .map(c => ({
            time: (c.time > 1e10 ? Math.floor(c.time / 1000) : c.time) as UTCTimestamp,
            open: c.open, high: c.high, low: c.low, close: c.close,
          }));

        if (candles.length > 0) {
          const newest = candles[candles.length - 1].time as number;
          const isNewCandle = newest !== lastCandleTimeRef.current;
          if (isNewCandle) {
            lastCandleTimeRef.current = newest;
            candleSeriesRef.current.setData(candles);
            chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
            chartRef.current?.timeScale().scrollToRealTime();
          } else {
            // Update in-progress candle tick-by-tick
            candleSeriesRef.current.update(candles[candles.length - 1]);
          }
          if (onPriceUpdate) {
            const last = candles[candles.length - 1].close;
            const prev = candles.length > 1 ? candles[candles.length - 2].close : last;
            onPriceUpdate(last, prev);
          }

          const toTS = (t: number) => (t > 1e10 ? Math.floor(t / 1000) : t) as UTCTimestamp;

          // Trade markers — entry + exit per closed trade, entry only for open
          const markers: SeriesMarker<UTCTimestamp>[] = [];
          for (const pos of positions) {
            markers.push({
              time: (new Date(pos.opened_at).getTime() / 1000) as UTCTimestamp,
              position: pos.side === "LONG" ? "belowBar" : "aboveBar" as const,
              color: pos.side === "LONG" ? "#22c55e" : "#ef4444",
              shape: pos.side === "LONG" ? "arrowUp" : "arrowDown" as const,
              text: `${pos.side} $${pos.entry_price_usd.toFixed(0)}`,
            });
            if (pos.status === "CLOSED" && pos.closed_at && pos.exit_price_usd != null) {
              markers.push({
                time: (new Date(pos.closed_at).getTime() / 1000) as UTCTimestamp,
                position: pos.side === "LONG" ? "aboveBar" : "belowBar" as const,
                color: pos.side === "LONG" ? "#22c55e" : "#ef4444",
                shape: pos.side === "LONG" ? "arrowDown" : "arrowUp" as const,
                text: `EXIT $${pos.exit_price_usd.toFixed(0)}`,
              });
            }
          }
          markers.sort((a, b) => (a.time as number) - (b.time as number));
          if (!markersPluginRef.current)
            markersPluginRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
          else
            markersPluginRef.current.setMarkers(markers);

          if (ema9Ref.current && ind.ema9?.length)
            ema9Ref.current.setData(ind.ema9.map(p => ({ time: toTS(p.time), value: p.value })));
          if (ema21Ref.current && ind.ema21?.length)
            ema21Ref.current.setData(ind.ema21.map(p => ({ time: toTS(p.time), value: p.value })));
          if (ema20Ref.current && ind.ema20?.length)
            ema20Ref.current.setData(ind.ema20.map(p => ({ time: toTS(p.time), value: p.value })));
          if (ema50Ref.current && ind.ema50?.length)
            ema50Ref.current.setData(ind.ema50.map(p => ({ time: toTS(p.time), value: p.value })));
          if (vwapRef.current && ind.vwap?.length)
            vwapRef.current.setData(ind.vwap.map(p => ({ time: toTS(p.time), value: p.value })));

          if (stUpRef.current && stDownRef.current && ind.supertrendUp && ind.supertrendDown) {
            const up   = ind.supertrendUp.filter((p): p is { time: number; value: number } => p.value !== null).map(p => ({ time: toTS(p.time), value: p.value }));
            const down = ind.supertrendDown.filter((p): p is { time: number; value: number } => p.value !== null).map(p => ({ time: toTS(p.time), value: p.value }));
            if (up.length)   stUpRef.current.setData(up);
            if (down.length) stDownRef.current.setData(down);
          }

          if (needsORB && candleSeriesRef.current) {
            const orbH = ind.orbHigh ?? 0, orbL = ind.orbLow ?? 0;
            if (orbH > 0) {
              if (!orbHighLineRef.current) orbHighLineRef.current = candleSeriesRef.current.createPriceLine({ price: orbH, color: "#22c55e", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "ORB H" });
              else orbHighLineRef.current.applyOptions({ price: orbH });
            }
            if (orbL > 0) {
              if (!orbLowLineRef.current) orbLowLineRef.current = candleSeriesRef.current.createPriceLine({ price: orbL, color: "#ef4444", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "ORB L" });
              else orbLowLineRef.current.applyOptions({ price: orbL });
            }
          }
        }
      } catch (err) { console.warn(`[btc-chart:${strategyId}]`, err); }
    };
    fetchAll();
    const iv = setInterval(fetchAll, 1_000); // BTC is 24/7
    return () => { cancelled = true; clearInterval(iv); };
  }, [strategyId, timeframe, positions, needsORB, onPriceUpdate]);

  const tfBtns = allIntervals.filter(tf => {
    if (strategyId === "btc_vwap_scalper") return ["1m", "5m"].includes(tf);
    if (strategyId === "btc_supertrend")   return ["1m", "5m", "15m"].includes(tf);
    if (strategyId === "btc_orion")        return ["5m", "15m"].includes(tf);
    return true;
  });

  if (fullscreen) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0A0D14" }}>
        {/* Header: legend + TF */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", height: 48, borderBottom: "1px solid #1a1f2e", background: "#0B0E17",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "#6b7280" }}>
            {needsEMAcross && <><span style={{ color: "#3B82F6" }}>▬</span><span>EMA9</span><span style={{ color: "#F97316" }}>▬</span><span>EMA21</span></>}
            {needsEMAconf  && <><span style={{ color: "#3B82F6" }}>▬</span><span>EMA20</span><span style={{ color: "#F97316" }}>▬</span><span>EMA50</span></>}
            {needsVWAP     && <><span style={{ color: "#A855F7" }}>⋯</span><span>VWAP</span></>}
            {needsST       && <><span style={{ color: "#22c55e" }}>▬</span><span>ST Up</span><span style={{ color: "#ef4444" }}>▬</span><span>ST Down</span></>}
            {needsORB      && <><span style={{ color: "#22c55e" }}>╌</span><span>ORB H</span><span style={{ color: "#ef4444" }}>╌</span><span>ORB L</span></>}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {tfBtns.map(tf => (
              <button key={tf} onClick={() => setTimeframe(tf)} style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer",
                letterSpacing: "0.05em", transition: "all 0.15s",
                border: `1px solid ${timeframe === tf ? accent : "#1f2937"}`,
                background: timeframe === tf ? accent : "transparent",
                color: timeframe === tf ? "#000" : "#6b7280",
              }}>{tf}</button>
            ))}
          </div>
        </div>
        <div ref={mainContainerRef} style={{ flex: 1, minHeight: 0 }} />
      </div>
    );
  }

  return (
    <div style={{ background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1a1f2e" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.1em" }}>BTC/USD</span>
        <div style={{ display: "flex", gap: 4 }}>
          {tfBtns.map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} style={{
              padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${timeframe === tf ? accent : "#1f2937"}`,
              background: timeframe === tf ? accent : "transparent",
              color: timeframe === tf ? "#000" : "#6b7280",
            }}>{tf}</button>
          ))}
        </div>
      </div>
      <div ref={mainContainerRef} style={{ width: "100%", height: 400 }} />
    </div>
  );
}

// ── BTC Strategy Detail Page ────────────────────────────────────────

export default function BtcStrategyDetailPage() {
  const params = useParams();
  const id     = (params.id as string) ?? "";
  const accent = ACCENT[id] ?? "#6b7280";
  const rules  = RULES[id] ?? [];
  const defaultInterval = CHART_INTERVAL[id] ?? "30s";

  // Data
  const [strategy,  setStrategy]  = useState<BtcStrategy | null>(null);
  const [capital,   setCapital]   = useState<BtcCapital | null>(null);
  const [positions, setPositions] = useState<BtcPosition[]>([]);
  const [openPos,   setOpenPos]   = useState<BtcPosition[]>([]);
  const [loading,   setLoading]   = useState(true);

  // UI state
  const [activeSection, setActiveSection] = useState(0);
  const [currentPrice,  setCurrentPrice]  = useState(0);
  const [prevClose,     setPrevClose]     = useState(0);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StrategyMetrics | null>(null);

  // Refs
  const scrollRef   = useRef<HTMLDivElement>(null);
  const sec0Ref     = useRef<HTMLElement>(null);
  const sec1Ref     = useRef<HTMLElement>(null);
  const sec2Ref     = useRef<HTMLElement>(null);
  const sec3Ref     = useRef<HTMLElement>(null);
  const sectionRefs = [sec0Ref, sec1Ref, sec2Ref, sec3Ref];

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

  // ── Navigation ──

  const scrollToSection = useCallback((idx: number) => {
    sectionRefs[idx].current?.scrollIntoView({ behavior: "smooth" });
    setActiveSection(idx);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); scrollToSection(Math.min(activeSection + 1, 3)); }
      if (e.key === "ArrowUp"   || e.key === "PageUp")   { e.preventDefault(); scrollToSection(Math.max(activeSection - 1, 0)); }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [activeSection, scrollToSection]);

  // ── Derived values ──

  const alloc      = capital?.allocated_inr ?? 100_000;
  const closedPnl  = capital?.total_pnl_inr ?? 0;
  const openPnl    = openPos.reduce((s, p) => s + (p.pnl_inr ?? 0), 0);
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

  const rulesFontSize = RULES_FONT[id] ?? 20;
  const priceChange   = currentPrice - prevClose;
  const changePct     = prevClose > 0 ? (priceChange / prevClose) * 100 : 0;
  const priceColor    = priceChange > 0 ? "#4ade80" : priceChange < 0 ? "#f87171" : "#9ca3af";

  // Exit breakdown: top 2 reasons
  const exitBreakdown = metrics?.exit_reason_breakdown ?? {};
  const exitEntries = Object.entries(exitBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const exitText = exitEntries.length > 0
    ? exitEntries.map(([k, v]) => `${k.replace(/_/g, " ")} ${v}%`).join(" · ")
    : "—";

  // Profit factor color
  const pfNum = parseFloat(metrics?.profit_factor ?? "0");
  const pfColor = metrics?.profit_factor === "∞" ? "#4ade80" : pfNum >= 1.5 ? "#4ade80" : pfNum >= 1 ? "#f5d547" : "#f87171";

  const stats = [
    { label: "INITIAL CAPITAL",    value: `₹${(alloc).toLocaleString("en-IN")}`,                 color: "#9ca3af" },
    { label: "TOTAL PnL",          value: pnlStr(livePnl),                                         color: pnlColor(livePnl) },
    { label: "CURRENT CAPITAL",    value: `₹${(liveCapital).toLocaleString("en-IN")}`,            color: "#ffffff" },
    { label: "RETURN %",           value: fmtPct(retPct),                                          color: pnlColor(retPct) },
    { label: "SHARPE",             value: sharpe.toFixed(2),                                       color: "#ffffff" },
    { label: "TOTAL TRADES",       value: String(lifetime),                                        color: "#ffffff" },
    { label: "OPEN NOW",           value: String(openPos.length),                                  color: openPos.length > 0 ? "#f5d547" : "#ffffff" },
    { label: "WIN RATE",           value: `${winRate.toFixed(1)}%`,                                color: winRate >= 50 ? "#4ade80" : "#f87171" },
    { label: "PROFIT FACTOR",      value: metrics?.profit_factor ?? "—",                           color: pfColor },
    { label: "AVG WIN/LOSS",       value: metrics ? `${metrics.avg_win_avg_loss}×` : "—",         color: "#ffffff" },
    { label: "MAX DRAWDOWN",       value: metrics ? `-₹${Math.abs(metrics.max_drawdown_inr).toLocaleString("en-IN", { maximumFractionDigits: 0 })} (-${metrics.max_drawdown_pct.toFixed(1)}%)` : "—", color: metrics && metrics.max_drawdown_inr > 0 ? "#f87171" : "#9ca3af" },
    { label: "EXPECTANCY",         value: metrics ? pnlStr(metrics.expectancy) : "—",             color: metrics ? pnlColor(metrics.expectancy) : "#9ca3af" },
    { label: "MAX CONSEC LOSSES",  value: metrics ? String(metrics.max_consecutive_losses) : "—", color: metrics && metrics.max_consecutive_losses > 3 ? "#f87171" : "#ffffff" },
    { label: "EXIT BREAKDOWN",     value: exitText,                                                color: "#9ca3af" },
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

      {/* Fixed strategy name — visible across all 3 sections */}
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

      {/* Dot navigation */}
      <div style={{
        position: "fixed", right: 24, top: "50%", transform: "translateY(-50%)",
        zIndex: 200, display: "flex", flexDirection: "column", gap: 14,
      }}>
        {[0, 1, 2, 3].map(i => (
          <button key={i} onClick={() => scrollToSection(i)} title={["Overview", "Chart", "Capital History", "Trades"][i]} style={{
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

        {/* ═══════ SECTION 1 — OVERVIEW ═══════ */}
        <section
          ref={sec0Ref}
          style={{
            height: "100vh", scrollSnapAlign: "start",
            display: "flex", flexDirection: "column",
            position: "relative", overflow: "hidden",
          }}
        >
          <div style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "40% 60%",
            gridTemplateRows: "auto 1fr",
            overflow: "hidden",
          }}>
            {/* Name + description */}
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

            {/* KPI grid */}
            <div style={{ padding: "0 40px clamp(8px,1vh,14px)", overflow: "hidden" }}>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "repeat(7, 1fr)",
                gap: 6, height: "100%",
              }}>
                {stats.map(s => (
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

            {/* Strategy Logic */}
            <div style={{
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              padding: "0 48px clamp(8px,1vh,14px) 40px",
              overflow: "hidden",
            }}>
              <div style={{ fontSize: "clamp(22px, 2.8vh, 28px)", fontWeight: 700, color: accent, letterSpacing: "0.01em", marginBottom: "clamp(6px,0.8vh,12px)" }}>
                Strategy Logic
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {rules.map((line, i) => {
                  if (line === "") return <div key={i} style={{ height: 5 }} />;
                  const isIndented = line.startsWith("  ");
                  if (isIndented) {
                    return (
                      <div key={i} style={{ fontSize: rulesFontSize, lineHeight: 2.0, letterSpacing: "0.01em", color: "#9ca3af", paddingLeft: 20 }}>
                        · {line.trim()}
                      </div>
                    );
                  }
                  const colonIdx = line.indexOf(":");
                  return (
                    <div key={i} style={{ fontSize: rulesFontSize, lineHeight: 2.0, letterSpacing: "0.01em", color: "#e2e8f0" }}>
                      {colonIdx > 0
                        ? <>• <strong style={{ color: "#ffffff" }}>{line.slice(0, colonIdx)}</strong>{line.slice(colonIdx)}</>
                        : <>• {line}</>
                      }
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* NEXT pill */}
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "10px 0 18px" }}>
            <button onClick={() => scrollToSection(1)}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 999, padding: "10px 28px", color: "#ffffff", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer" }}
            >NEXT ↓</button>
          </div>
        </section>

        {/* ═══════ SECTION 2 — LIVE CHART ═══════ */}
        <section
          ref={sec1Ref}
          style={{
            height: "100vh", scrollSnapAlign: "start",
            display: "flex", flexDirection: "column",
            position: "relative",
          }}
        >
          {/* PREV pill */}
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "10px 0" }}>
            <button onClick={() => scrollToSection(0)}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 999, padding: "10px 28px", color: "#ffffff", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer" }}
            >↑ PREV</button>
          </div>

          {/* Chart top bar */}
          <div style={{
            flexShrink: 0, display: "flex", alignItems: "center",
            justifyContent: "space-between", padding: "0 24px",
            height: 60, background: "#0B0E17",
            borderBottom: "1px solid #1a1f2e", borderTop: "1px solid #1a1f2e", gap: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#F59E0B", letterSpacing: "0.08em" }}>BTC / USD</div>
            {currentPrice > 0 && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: "#ffffff", fontFamily: "monospace" }}>
                  ${currentPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </span>
                <span style={{ fontSize: 13, fontFamily: "monospace", color: priceColor, fontWeight: 600 }}>
                  {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
                </span>
              </div>
            )}
            <div />
          </div>

          {/* Chart */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <BtcIndicatorChart
              strategyId={id}
              defaultInterval={defaultInterval}
              positions={allPositions}
              fullscreen
              onPriceUpdate={(price, prev) => { setCurrentPrice(price); setPrevClose(prev); }}
            />
          </div>

          {/* NEXT pill */}
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "10px 0", borderTop: "1px solid #1a1f2e" }}>
            <button onClick={() => scrollToSection(2)}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 999, padding: "10px 28px", color: "#ffffff", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer" }}
            >NEXT ↓</button>
          </div>
        </section>

        {/* ═══════ SECTION 2.5 — CAPITAL HISTORY ═══════ */}
        <section
          ref={sec2Ref}
          style={{
            height: "100vh", scrollSnapAlign: "start",
            display: "flex", flexDirection: "column",
            position: "relative",
          }}
        >
          {/* PREV pill */}
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "10px 0" }}>
            <button onClick={() => scrollToSection(1)}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 999, padding: "10px 28px", color: "#ffffff", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer" }}
            >↑ PREV</button>
          </div>

          {/* Capital history chart */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <CapitalHistoryChart strategyId={id} accent={accent} />
          </div>

          {/* NEXT pill */}
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "10px 0", borderTop: "1px solid #1a1f2e" }}>
            <button onClick={() => scrollToSection(3)}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 999, padding: "10px 28px", color: "#ffffff", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer" }}
            >NEXT ↓</button>
          </div>
        </section>

        {/* ═══════ SECTION 3 — TRADES ═══════ */}
        <section
          ref={sec3Ref}
          style={{
            minHeight: "100vh", scrollSnapAlign: "start",
            display: "flex", flexDirection: "column",
            padding: "0 40px 80px",
          }}
        >
          {/* PREV pill */}
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "12px 0", marginBottom: 32 }}>
            <button onClick={() => scrollToSection(2)}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 999, padding: "10px 28px", color: "#ffffff", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer" }}
            >↑ PREV</button>
          </div>

          {openTrades.length === 0 && closedTrades.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
                  <div style={{ overflowX: "auto", background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
                      <thead>
                        <tr style={{ background: "#070A11" }}>
                          {["Side", "Entry (USD)", "Exit (USD)", "Qty (INR)", "Leverage", "Realized (Partial)", "Final PnL", "Exit Reason", "Duration", "Opened", "Closed"].map(h => (
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
                              <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: pnlColor(pos.pnl_inr ?? 0) }}>{pnlStr(pos.pnl_inr ?? 0)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 11, color: "#374151", whiteSpace: "nowrap" }}>{pos.exit_reason?.replace(/_/g, " ") ?? "—"}</td>
                              <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280" }}>{formatDuration(pos.opened_at, pos.closed_at)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 11, color: "#374151" }}>{fmtTime(pos.opened_at)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 11, color: "#374151" }}>{fmtTime(pos.closed_at)}</td>
                            </tr>
                            {expandedTrade === pos.id && (
                              <tr style={{ borderTop: "1px solid #0f1520" }}>
                                <td colSpan={11} style={{ padding: "20px 24px", background: "#080B12" }}>
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
