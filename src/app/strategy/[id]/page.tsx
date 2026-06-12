"use client";

import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  createChart, CandlestickSeries, LineSeries, ColorType, createSeriesMarkers,
} from "lightweight-charts";
import type {
  IChartApi, ISeriesApi, IPriceLine, UTCTimestamp,
  ISeriesMarkersPluginApi, SeriesMarker, Time,
} from "lightweight-charts";
import { supabase } from "@/lib/supabase/client";

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
type OhlcCandle = { time: number; open: number; high: number; low: number; close: number };
type IndicatorData = {
  ema16?: Array<{ time: number; value: number }>;
  ema64?: Array<{ time: number; value: number }>;
  crossovers?: Array<{ time: number; type: "bullish" | "bearish" }>;
  vwap?: Array<{ time: number; value: number }>;
  supertrendUp?: Array<{ time: number; value: number | null }>;
  supertrendDown?: Array<{ time: number; value: number | null }>;
  orbHigh?: number; orbLow?: number; prevDayClose?: number;
  pcr?: Array<{ time: number; value: number }>;
};

// ── Strategy Config ──────────────────────────────────────────────

const ACCENT: Record<string, string> = {
  ema_crossover: "#F59E0B", orion: "#6366F1", ema_confluence: "#10B981",
  supertrend: "#EF4444", pcr_reversal: "#8B5CF6", gap_orb: "#06B6D4", vwap_scalper: "#F97316",
};

const RULES: Record<string, string[]> = {
  ema_crossover: [
    "Instrument: Nifty 50 options · weekly expiry",
    "Timeframe: 30-second candles, forming from 9:15 AM",
    "Trading window: 10:30 AM – 3:00 PM",
    "Entry CE: 16 EMA crosses above 64 EMA → buy CE (₹60–70 premium range)",
    "Entry PE: 16 EMA crosses below 64 EMA → buy PE (₹60–70 premium range)",
    "Stop loss: 15% of premium paid (e.g. entry ₹65 → SL ₹55.25)",
    "Trail SL: activates when Nifty moves 1.5× ATR in trade direction → trail at 10% below peak premium",
    "Exit: SL hit | opposite crossover triggers flip | trail SL hit | 3:00 PM hard close",
    "Fibonacci 50–61.8% zone used as advisory entry confluence",
    "Max 1 open trade at a time",
  ],
  orion: [
    "Instruments: Nifty 50, BankNifty, Sensex options · weekly expiry",
    "ORB: High and Low of 9:15–9:30 AM first 15-min candle",
    "Entry CE: price breaks + closes above ORB High AND above VWAP AND CE OI rising (long buildup)",
    "Entry PE: price breaks + closes below ORB Low AND below VWAP AND PE OI rising (short buildup)",
    "VIX filter: skip all trades for the day if India VIX < 13",
    "Stop loss: 30% of premium paid",
    "Breakeven rule: when trade up 20%, move SL to entry price",
    "Trail SL: activates at 35% gain → trail at 15% below peak premium",
    "Hard close: 2:00 PM",
    "Max 1 trade per instrument simultaneously (can hold Nifty + BankNifty + Sensex at same time)",
  ],
  ema_confluence: [
    "Instrument: Nifty 50 options · weekly expiry",
    "Timeframe: 30-second candles, forming from 9:15 AM",
    "Trading window: 10:30 AM – 3:00 PM",
    "All 5 filters must align simultaneously for entry:",
    "  1. EMA crossover — 16 EMA crosses above/below 64 EMA",
    "  2. RSI(14) — CE entry requires RSI < 45 · PE entry requires RSI > 55",
    "  3. VWAP — CE: price must be above VWAP · PE: price must be below VWAP",
    "  4. Volume — crossover candle volume must exceed 20-candle average",
    "  5. Fibonacci — price must be near 50–61.8% retracement zone",
    "Stop loss: 15% of premium paid",
    "Trail SL: 1.5× ATR move in direction → trail at 10% below peak premium",
    "Hard close: 3:00 PM · Max 1 open trade at a time",
  ],
  supertrend: [
    "Instruments: Nifty 50 + BankNifty options · weekly expiry",
    "Timeframe: 5-minute candles",
    "Indicator: Supertrend with period=7, multiplier=3",
    "Entry CE: Supertrend flips green → price crosses above Supertrend line (bullish flip)",
    "Entry PE: Supertrend flips red → price crosses below Supertrend line (bearish flip)",
    "Stop loss: 20% of premium paid",
    "Trail SL: activates at 40% gain → trail at 12% below peak premium",
    "Exit: SL hit | Supertrend flips opposite | trail SL | 3:00 PM hard close",
    "Trading window: 9:45 AM – 2:30 PM",
    "Max 2 trades per instrument per day",
  ],
  pcr_reversal: [
    "Instrument: Nifty 50 options · weekly expiry",
    "No candles — checks option chain data every 5 minutes",
    "Entry CE: PCR > 1.3 (market oversold) AND PE OI at ATM fell 10%+ in last 30 min (unwinding)",
    "Entry PE: PCR < 0.7 (market overbought) AND CE OI at ATM fell 10%+ in last 30 min (unwinding)",
    "Stop loss: 25% of premium paid",
    "Trail SL: activates at 30% gain → trail at 12% below peak premium",
    "Exit: SL hit | PCR returns to neutral 0.9–1.1 | OI builds on opposite side | trail SL | 3:00 PM",
    "Trading window: 10:00 AM – 2:30 PM",
    "Max 3 trades per day",
  ],
  gap_orb: [
    "Instrument: Nifty 50 options · weekly expiry",
    "Gap = (Today's Open − Yesterday's Close) / Yesterday's Close × 100, calculated at 9:15 AM",
    "Gap > 0.3% up → FADE: buy PE (expect price to reverse and fill the gap)",
    "Gap > 0.3% down → FADE: buy CE (expect price to reverse and fill the gap)",
    "Gap < 0.3% → ORB BREAKOUT: trade direction of 9:15–9:30 AM range break",
    "Fade target: price returns to previous day's close level (gap filled)",
    "Stop loss: 20% of premium paid",
    "Breakout trail SL: 35% gain → trail at 12% below peak premium",
    "Morning only: no new trades after 11:30 AM",
    "Max 2 trades per day",
  ],
  vwap_scalper: [
    "VWAP + RSI Momentum Scalper — Nifty, BankNifty, Sensex options",
    "Timeframe: 1-minute candles | Window: 10:30 AM – 3:00 PM IST",
    "",
    "Entry — Buy CE (bullish bounce):",
    "  Price pulls back to VWAP then closes above it",
    "  RSI between 40–60 (neutral momentum)",
    "  OI rising on latest chain snapshot · Previous candle made a higher low",
    "  Option premium in ₹50–80 range",
    "",
    "Entry — Buy PE (bearish rejection):",
    "  Price pulls back to VWAP then closes below it",
    "  RSI between 40–60 · OI rising · Previous candle made a lower high",
    "  Option premium in ₹50–80 range",
    "",
    "SL: 20% of premium | Trail SL: at +25% → breakeven · at +35% → 12% below peak",
    "Exit priority: SL hit → Trail SL → 3:00 PM hard close → Opposite VWAP cross",
  ],
};

// Per-strategy rules font size — calculated so rules fill the right column height.
// Formula: available_for_rules = (800px − 160px) − 30px_heading = 610px
//          fontSize = available / (N_lines × lineHeight_2.0)
// vwap_scalper subtracts 15px for its 3 empty-line spacers before dividing.
const RULES_FONT: Record<string, number> = {
  ema_crossover:  25,  // 31 × 0.8 = 24.8 → 25
  orion:          25,  // 31 × 0.8
  ema_confluence: 20,  // 25 × 0.8
  supertrend:     25,  // 31 × 0.8
  pcr_reversal:   27,  // 34 × 0.8 = 27.2 → 27
  gap_orb:        25,  // 31 × 0.8
  vwap_scalper:   18,  // 23 × 0.8 = 18.4 → 18
};

const STRATEGY_CHARTS: Record<string, Array<{ index: string; interval: string }>> = {
  ema_crossover:  [{ index: "NIFTY", interval: "30s" }],
  orion:          [{ index: "NIFTY", interval: "15m" }, { index: "SENSEX", interval: "15m" }, { index: "BANKNIFTY", interval: "15m" }],
  ema_confluence: [{ index: "NIFTY", interval: "30s" }],
  supertrend:     [{ index: "NIFTY", interval: "5m" }, { index: "BANKNIFTY", interval: "5m" }],
  pcr_reversal:   [{ index: "NIFTY", interval: "30s" }],
  gap_orb:        [{ index: "NIFTY", interval: "15m" }],
  vwap_scalper:   [{ index: "NIFTY", interval: "1m" }, { index: "SENSEX", interval: "1m" }, { index: "BANKNIFTY", interval: "1m" }],
};

// ── Formatters ───────────────────────────────────────────────────

function fmtINR(n: number) { return Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
function pnlStr(n: number) { return `${n >= 0 ? "+" : "-"}₹${fmtINR(n)}`; }
function pnlColor(n: number) { return n > 0 ? "#4ade80" : n < 0 ? "#f87171" : "#ffffff"; }
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
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
    case "vwap_scalper":   return CE ? "Price pulled back to VWAP and bounced above it on 1m candle. RSI 40–60 · OI rising · higher low formed." : "Price pulled back to VWAP and rejected below it on 1m candle. RSI 40–60 · OI rising · lower high formed.";
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

// ── IndicatorChart ───────────────────────────────────────────────

function IndicatorChart({
  strategyId, index, defaultInterval, positions,
  fullscreen = false,
  onPriceUpdate,
}: {
  strategyId: string;
  index: string;
  defaultInterval: string;
  positions: Position[];
  fullscreen?: boolean;
  onPriceUpdate?: (price: number, prevClose: number) => void;
}) {
  const accent = ACCENT[strategyId] ?? "#6b7280";

  const allIntervals = ["30s", "1m", "5m", "15m"] as const;
  type TF = typeof allIntervals[number];
  const [timeframe, setTimeframe] = useState<TF>(defaultInterval as TF);
  const [lastPcr, setLastPcr]     = useState<number | null>(null);

  const mainContainerRef = useRef<HTMLDivElement>(null);
  const chartRef         = useRef<IChartApi | null>(null);
  const candleSeriesRef  = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema16Ref         = useRef<ISeriesApi<"Line"> | null>(null);
  const ema64Ref         = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef          = useRef<ISeriesApi<"Line"> | null>(null);
  const stUpRef          = useRef<ISeriesApi<"Line"> | null>(null);
  const stDownRef        = useRef<ISeriesApi<"Line"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const orbHighLineRef   = useRef<IPriceLine | null>(null);
  const orbLowLineRef    = useRef<IPriceLine | null>(null);
  const pdcLineRef       = useRef<IPriceLine | null>(null);
  const pcrContainerRef  = useRef<HTMLDivElement>(null);
  const pcrChartRef      = useRef<IChartApi | null>(null);
  const pcrSeriesRef     = useRef<ISeriesApi<"Line"> | null>(null);
  const lastCandleTimeRef = useRef<number>(0);

  const needsEMA  = ["ema_crossover", "ema_confluence"].includes(strategyId);
  const needsVWAP = ["ema_confluence", "orion", "vwap_scalper"].includes(strategyId);
  const needsST   = strategyId === "supertrend";
  const needsPCR  = strategyId === "pcr_reversal";
  const needsORB  = ["orion", "gap_orb", "vwap_scalper"].includes(strategyId);
  const needsPDC  = ["gap_orb", "orion"].includes(strategyId);

  const [isMarketOpen, setIsMarketOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      const ist = new Date(Date.now() + (5 * 60 + 30) * 60_000);
      const dow = ist.getUTCDay();
      if (dow === 0 || dow === 6) { setIsMarketOpen(false); return; }
      const m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      setIsMarketOpen(m >= 555 && m <= 930);
    };
    check();
    const iv = setInterval(check, 60_000);
    return () => clearInterval(iv);
  }, []);

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
    if (needsEMA) {
      ema16Ref.current = chart.addSeries(LineSeries, { color: "#3B82F6", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: "EMA16" });
      ema64Ref.current = chart.addSeries(LineSeries, { color: "#F97316", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: "EMA64" });
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
      chartRef.current = candleSeriesRef.current = ema16Ref.current = ema64Ref.current
        = vwapRef.current = stUpRef.current = stDownRef.current
        = orbHighLineRef.current = orbLowLineRef.current = pdcLineRef.current
        = markersPluginRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Init PCR chart
  useEffect(() => {
    if (!needsPCR || !pcrContainerRef.current) return;
    const chart = createChart(pcrContainerRef.current, {
      autoSize: true, layout: { background: { type: ColorType.Solid, color: "#0A0D14" }, textColor: "#6b7280", fontSize: 9 },
      grid: { vertLines: { color: "#1a1f2e" }, horzLines: { color: "#1a1f2e" } },
      rightPriceScale: { borderColor: "#1a1f2e" },
      timeScale: { borderColor: "#1a1f2e", timeVisible: false },
      crosshair: { mode: 1 },
    });
    pcrChartRef.current = chart;
    pcrSeriesRef.current = chart.addSeries(LineSeries, { color: "#8B5CF6", lineWidth: 1, lastValueVisible: true, priceLineVisible: false });
    return () => { chart.remove(); pcrChartRef.current = pcrSeriesRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear on timeframe change
  useEffect(() => {
    candleSeriesRef.current?.setData([]);
    ema16Ref.current?.setData([]);
    ema64Ref.current?.setData([]);
    vwapRef.current?.setData([]);
    stUpRef.current?.setData([]);
    stDownRef.current?.setData([]);
    lastCandleTimeRef.current = 0;
    chartRef.current?.timeScale().applyOptions({ secondsVisible: timeframe === "30s" || timeframe === "1m" });
  }, [timeframe]);

  // Poll
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const [cr, ir] = await Promise.all([
          fetch(`${BACKEND}/api/candles?index=${index}&interval=${timeframe}`),
          fetch(`${BACKEND}/api/indicators?strategy=${strategyId}&index=${index}`),
        ]);
        if (!cr.ok || !ir.ok) return;
        const rawCandles: OhlcCandle[] = await cr.json();
        const ind: IndicatorData = await ir.json();
        if (cancelled || !candleSeriesRef.current) return;

        const candles = rawCandles
          .filter(c => c.open > 0 && c.high >= c.low && c.close > 0)
          .map(c => ({
            time: (c.time > 1e10 ? Math.floor(c.time / 1000) : c.time) as UTCTimestamp,
            open: c.open, high: c.high, low: c.low, close: c.close,
          }));

        if (candles.length > 0) {
          const newest = candles[candles.length - 1].time as number;
          if (newest !== lastCandleTimeRef.current) {
            lastCandleTimeRef.current = newest;
            candleSeriesRef.current.setData(candles);
            chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
            chartRef.current?.timeScale().scrollToRealTime();
            // surface price to parent
            if (onPriceUpdate) {
              const last = candles[candles.length - 1].close;
              const prev = candles.length > 1 ? candles[candles.length - 2].close : last;
              onPriceUpdate(last, prev);
            }
          }

          const toTS = (t: number) => (t > 1e10 ? Math.floor(t / 1000) : t) as UTCTimestamp;
          const markers: SeriesMarker<UTCTimestamp>[] = positions.map(pos => ({
            time: (new Date(pos.opened_at).getTime() / 1000) as UTCTimestamp,
            position: pos.type === "CE" ? "belowBar" : "aboveBar" as const,
            color: pos.type === "CE" ? "#22c55e" : "#ef4444",
            shape: pos.type === "CE" ? "arrowUp" : "arrowDown" as const,
            text: `${pos.type} ${pos.entry_price.toFixed(0)}`,
          }));
          markers.sort((a, b) => (a.time as number) - (b.time as number));
          if (!markersPluginRef.current)
            markersPluginRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
          else
            markersPluginRef.current.setMarkers(markers);

          if (ema16Ref.current && ind.ema16?.length)
            ema16Ref.current.setData(ind.ema16.map(p => ({ time: toTS(p.time), value: p.value })));
          if (ema64Ref.current && ind.ema64?.length)
            ema64Ref.current.setData(ind.ema64.map(p => ({ time: toTS(p.time), value: p.value })));
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
          if (needsPDC && candleSeriesRef.current) {
            const pdc = ind.prevDayClose ?? 0;
            if (pdc > 0) {
              if (!pdcLineRef.current) pdcLineRef.current = candleSeriesRef.current.createPriceLine({ price: pdc, color: "#6b7280", lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: "PDC" });
              else pdcLineRef.current.applyOptions({ price: pdc });
            }
          }
          if (pcrSeriesRef.current && ind.pcr?.length) {
            const pcrData = ind.pcr.map(p => ({ time: toTS(p.time), value: p.value })).sort((a, b) => (a.time as number) - (b.time as number));
            pcrSeriesRef.current.setData(pcrData);
            if (pcrData.length) setLastPcr(pcrData[pcrData.length - 1].value);
          }
        }
      } catch (err) { console.warn(`[chart:${index}:${strategyId}]`, err); }
    };
    fetchAll();
    const iv = setInterval(fetchAll, isMarketOpen ? 1_000 : 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [index, timeframe, strategyId, positions, needsORB, needsPDC, isMarketOpen, onPriceUpdate]);

  const tfBtns = allIntervals.filter(tf => {
    if (strategyId === "vwap_scalper") return ["1m", "5m"].includes(tf);
    if (strategyId === "supertrend")   return ["1m", "5m", "15m"].includes(tf);
    if (["orion", "gap_orb"].includes(strategyId)) return ["5m", "15m"].includes(tf);
    return true;
  });

  if (fullscreen) {
    // Fullscreen mode — fills parent flex container
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0A0D14" }}>
        {/* Compact header: legend left, TF right */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", height: 48, borderBottom: "1px solid #1a1f2e", background: "#0B0E17",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "#6b7280" }}>
            {needsEMA && <><span style={{ color: "#3B82F6" }}>▬</span><span>EMA16</span><span style={{ color: "#F97316" }}>▬</span><span>EMA64</span></>}
            {needsVWAP && <><span style={{ color: "#A855F7" }}>⋯</span><span>VWAP</span></>}
            {needsST && <><span style={{ color: "#22c55e" }}>▬</span><span>ST Up</span><span style={{ color: "#ef4444" }}>▬</span><span>ST Down</span></>}
            {needsORB && <><span style={{ color: "#22c55e" }}>╌</span><span>ORB H</span><span style={{ color: "#ef4444" }}>╌</span><span>ORB L</span></>}
            {needsPDC && <><span style={{ color: "#6b7280" }}>┄</span><span>PDC</span></>}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {tfBtns.map(tf => (
              <button key={tf} onClick={() => setTimeframe(tf)} style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", letterSpacing: "0.05em", transition: "all 0.15s",
                border: `1px solid ${timeframe === tf ? accent : "#1f2937"}`,
                background: timeframe === tf ? accent : "transparent",
                color: timeframe === tf ? "#000" : "#6b7280",
              }}>{tf}</button>
            ))}
          </div>
        </div>

        {/* Chart fills remaining space */}
        <div ref={mainContainerRef} style={{ flex: 1, minHeight: 0 }} />

        {/* PCR panel */}
        {needsPCR && (
          <>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "4px 20px", borderTop: "1px solid #1a1f2e", background: "#080B12" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#374151", letterSpacing: "0.1em" }}>PCR</span>
              {lastPcr !== null && (
                <span style={{ fontSize: 14, fontFamily: "monospace", fontWeight: 700, color: lastPcr > 1.3 ? "#22c55e" : lastPcr < 0.7 ? "#ef4444" : "#9ca3af" }}>
                  {lastPcr.toFixed(2)}
                </span>
              )}
            </div>
            <div ref={pcrContainerRef} style={{ flexShrink: 0, height: 80 }} />
          </>
        )}
      </div>
    );
  }

  // Card mode (not used in this page, kept for compatibility)
  return (
    <div style={{ background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1a1f2e" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.1em" }}>{index}</span>
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
      {needsPCR && (
        <>
          <div style={{ padding: "4px 14px", display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid #1a1f2e", background: "#080B12" }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#374151" }}>PCR</span>
            {lastPcr !== null && <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600, color: lastPcr > 1.3 ? "#22c55e" : lastPcr < 0.7 ? "#ef4444" : "#9ca3af" }}>{lastPcr.toFixed(2)}</span>}
          </div>
          <div ref={pcrContainerRef} style={{ width: "100%", height: 80 }} />
        </>
      )}
    </div>
  );
}

// ── ScrollHint ───────────────────────────────────────────────────

function ScrollHint() {
  return (
    <div style={{
      position: "absolute", bottom: 32, left: "50%", transform: "translateX(-50%)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
      color: "#374151", fontSize: 11, letterSpacing: "0.1em", userSelect: "none",
      animation: "scrollBounce 2s ease-in-out infinite",
    }}>
      <span>SCROLL</span>
      <span style={{ fontSize: 16 }}>↓</span>
    </div>
  );
}

// ── Strategy Detail Page (3-section fullscreen) ──────────────────

export default function StrategyDetailPage() {
  const params = useParams();
  const id     = (params.id as string) ?? "";
  const accent = ACCENT[id] ?? "#6b7280";
  const rules  = RULES[id] ?? [];
  const charts = STRATEGY_CHARTS[id] ?? [{ index: "NIFTY", interval: "30s" }];

  // Data
  const [strategy,  setStrategy]  = useState<Strategy | null>(null);
  const [capital,   setCapital]   = useState<Capital | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [openPos,   setOpenPos]   = useState<Position[]>([]);
  const [loading,   setLoading]   = useState(true);

  // UI state
  const [activeSection,  setActiveSection]  = useState(0);
  const [activeChartIdx, setActiveChartIdx] = useState(0);
  const [currentPrice,   setCurrentPrice]   = useState(0);
  const [prevClose,      setPrevClose]      = useState(0);
  const [expandedTrade,  setExpandedTrade]  = useState<string | null>(null);

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const sec0Ref   = useRef<HTMLElement>(null);
  const sec1Ref   = useRef<HTMLElement>(null);
  const sec2Ref   = useRef<HTMLElement>(null);
  const sectionRefs = [sec0Ref, sec1Ref, sec2Ref];

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

  const rulesFontSize = RULES_FONT[id] ?? 24;
  const chartConfig  = charts[activeChartIdx] ?? charts[0];
  const priceChange  = currentPrice - prevClose;
  const changePct    = prevClose > 0 ? (priceChange / prevClose) * 100 : 0;
  const priceColor   = priceChange > 0 ? "#4ade80" : priceChange < 0 ? "#f87171" : "#9ca3af";

  // ── Stats bar data ──
  const stats = [
    { label: "INITIAL CAPITAL", value: `₹${fmtINR(allocated)}`,      color: "#9ca3af" },
    { label: "TOTAL PnL",       value: pnlStr(livePnl),               color: pnlColor(livePnl) },
    { label: "CURRENT CAPITAL", value: `₹${fmtINR(liveCapital)}`,     color: "#ffffff" },
    { label: "RETURN",          value: fmtPct(retPct),                 color: pnlColor(retPct) },
    { label: "SHARPE",          value: sharpe.toFixed(2),              color: "#ffffff" },
    { label: "TOTAL TRADES",    value: String(lifetime),               color: "#ffffff" },
    { label: "TODAY",           value: String(today),                  color: "#ffffff" },
    { label: "WIN RATE",        value: `${winRate.toFixed(1)}%`,       color: winRate >= 50 ? "#4ade80" : "#f87171" },
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
          <button key={i} onClick={() => scrollToSection(i)} title={["Overview", "Chart", "Trades"][i]} style={{
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
            <div style={{ padding: "0 40px clamp(8px,1vh,14px)", overflow: "hidden" }}>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "repeat(4, 1fr)",
                gap: 8, height: "100%",
              }}>
                {stats.map(s => (
                  <div key={s.label} style={{
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10, padding: "clamp(10px,1.2vh,16px) 14px",
                    display: "flex", flexDirection: "column", justifyContent: "space-between",
                  }}>
                    <div style={{ fontSize: "clamp(22px, 2.4vh, 26px)", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", paddingTop: 12 }}>{s.label}</div>
                    <div style={{ fontSize: "clamp(22px, 2.4vh, 26px)", fontWeight: 700, color: s.color, fontFamily: "monospace", paddingBottom: 12 }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Strategy Logic + rules — auto-placed row 2 col 2 ── */}
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
            SECTION 2 — LIVE CHART
        ═══════════════════════════════════════ */}
        <section
          ref={sec1Ref}
          style={{
            height: "100vh", scrollSnapAlign: "start",
            display: "flex", flexDirection: "column",
            position: "relative",
          }}
        >
          {/* ↑ PREV pill strip */}
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

          {/* Chart top bar */}
          <div style={{
            flexShrink: 0, display: "flex", alignItems: "center",
            justifyContent: "space-between", padding: "0 24px",
            height: 60, background: "#0B0E17", borderBottom: "1px solid #1a1f2e",
            borderTop: "1px solid #1a1f2e", gap: 16,
          }}>
            {/* Index tabs */}
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {charts.map((cfg, i) => (
                <button key={cfg.index} onClick={() => { setActiveChartIdx(i); setCurrentPrice(0); setPrevClose(0); }} style={{
                  padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  cursor: "pointer", letterSpacing: "0.08em", transition: "all 0.15s",
                  border: `1px solid ${activeChartIdx === i ? accent : "#1f2937"}`,
                  background: activeChartIdx === i ? `${accent}18` : "transparent",
                  color: activeChartIdx === i ? accent : "#4b5563",
                }}>{cfg.index}</button>
              ))}
            </div>

            {/* Current price */}
            {currentPrice > 0 && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: "#ffffff", fontFamily: "monospace" }}>
                  {currentPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
                <span style={{ fontSize: 13, fontFamily: "monospace", color: priceColor, fontWeight: 600 }}>
                  {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
                </span>
              </div>
            )}

            {/* Spacer */}
            <div />
          </div>

          {/* Chart fills remaining height */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <IndicatorChart
              key={chartConfig.index}
              strategyId={id}
              index={chartConfig.index}
              defaultInterval={chartConfig.interval}
              positions={allPositions}
              fullscreen
              onPriceUpdate={(price, prev) => { setCurrentPrice(price); setPrevClose(prev); }}
            />
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
          ref={sec2Ref}
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
