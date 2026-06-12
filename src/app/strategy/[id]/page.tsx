"use client";

import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createChart, CandlestickSeries, LineSeries, ColorType, createSeriesMarkers } from "lightweight-charts";
import type { IChartApi, ISeriesApi, IPriceLine, UTCTimestamp, ISeriesMarkersPluginApi, SeriesMarker, Time } from "lightweight-charts";
import { supabase } from "@/lib/supabase/client";

const BACKEND = "https://ai-trading-arena-backend-production.up.railway.app";

// ── Types ────────────────────────────────────────────────────────

type Strategy = {
  id: string;
  name: string;
  description: string;
  status: "active" | "paused" | "placeholder";
  slot_number: number;
};

type Capital = {
  strategy_id: string;
  allocated_capital: number;
  current_value: number;
  total_pnl: number;
  win_rate: number;
  sharpe_ratio: number;
  today_trades: number;
  lifetime_trades: number;
};

type Position = {
  id: string;
  strategy_id: string;
  symbol: string;
  type: string;
  entry_price: number;
  current_price: number;
  exit_price: number | null;
  quantity: number;
  stop_loss: number | null;
  trail_sl: number | null;
  pnl: number;
  status: "OPEN" | "CLOSED";
  opened_at: string;
  closed_at: string | null;
  exit_reason: string | null;
  exit_reason_detail: string | null;
};

type OhlcCandle = { time: number; open: number; high: number; low: number; close: number };

type IndicatorData = {
  ema16?: Array<{ time: number; value: number }>;
  ema64?: Array<{ time: number; value: number }>;
  crossovers?: Array<{ time: number; type: "bullish" | "bearish" }>;
  vwap?: Array<{ time: number; value: number }>;
  supertrendUp?: Array<{ time: number; value: number | null }>;
  supertrendDown?: Array<{ time: number; value: number | null }>;
  orbHigh?: number;
  orbLow?: number;
  prevDayClose?: number;
  pcr?: Array<{ time: number; value: number }>;
};

// ── Strategy Config ──────────────────────────────────────────────

const ACCENT: Record<string, string> = {
  ema_crossover:  "#F59E0B",
  orion:          "#6366F1",
  ema_confluence: "#10B981",
  supertrend:     "#EF4444",
  pcr_reversal:   "#8B5CF6",
  gap_orb:        "#06B6D4",
  vwap_scalper:   "#F97316",
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
    "Exit: SL hit | Supertrend flips opposite (close + open opposite) | trail SL | 3:00 PM hard close",
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
    "· VWAP + RSI Momentum Scalper — Nifty, BankNifty, Sensex options",
    "· Timeframe: 1-minute candles | Window: 10:30 AM – 3:00 PM IST",
    "",
    "Entry — Buy CE (bullish bounce):",
    "  · Price pulls back to VWAP then closes above it",
    "  · RSI between 40–60 (neutral momentum)",
    "  · OI rising on latest chain snapshot (volume proxy)",
    "  · Previous candle made a higher low",
    "  · Option premium in ₹50–80 range",
    "",
    "Entry — Buy PE (bearish rejection):",
    "  · Price pulls back to VWAP then closes below it",
    "  · RSI between 40–60",
    "  · OI rising on latest chain snapshot",
    "  · Previous candle made a lower high",
    "  · Option premium in ₹50–80 range",
    "",
    "Expiry days: Tuesday (Nifty + BankNifty) · Thursday (Sensex)",
    "Normal day rules:",
    "  · SL: 20% of premium | Max 1 position per index at a time",
    "  · Trail SL: at +25% premium → move SL to breakeven",
    "  · At +35% → trail at 12% below peak premium",
    "",
    "Exit priority: SL hit → Trail SL hit → 3:00 PM hard close → Opposite VWAP cross",
  ],
};

const STRATEGY_CHARTS: Record<string, Array<{ index: string; interval: string }>> = {
  ema_crossover:  [{ index: "NIFTY",     interval: "30s" }],
  orion:          [{ index: "NIFTY",     interval: "15m" }, { index: "SENSEX", interval: "15m" }, { index: "BANKNIFTY", interval: "15m" }],
  ema_confluence: [{ index: "NIFTY",     interval: "30s" }],
  supertrend:     [{ index: "NIFTY",     interval: "5m"  }, { index: "BANKNIFTY", interval: "5m" }],
  pcr_reversal:   [{ index: "NIFTY",     interval: "30s" }],
  gap_orb:        [{ index: "NIFTY",     interval: "15m" }],
  vwap_scalper:   [{ index: "NIFTY",     interval: "1m"  }, { index: "SENSEX", interval: "1m"  }, { index: "BANKNIFTY", interval: "1m" }],
};

// ── Formatters ───────────────────────────────────────────────────

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
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function formatDuration(openedAt: string, closedAt: string | null): string {
  const start = new Date(openedAt).getTime();
  const end   = closedAt ? new Date(closedAt).getTime() : Date.now();
  const ms    = Math.max(0, end - start);
  const h     = Math.floor(ms / 3_600_000);
  const m     = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getEntryReason(strategyId: string, type: string): string {
  switch (strategyId) {
    case "ema_crossover":
      return type === "CE"
        ? "16 EMA crossed above 64 EMA on 30s candle. Bullish crossover signal triggered."
        : "16 EMA crossed below 64 EMA on 30s candle. Bearish crossover signal triggered.";
    case "ema_confluence":
      return type === "CE"
        ? "All 5 confluence filters aligned: 16 EMA crossed above 64 EMA · RSI < 45 · price above VWAP · volume above 20-candle avg · price near 50–61.8% Fibonacci support zone."
        : "All 5 confluence filters aligned: 16 EMA crossed below 64 EMA · RSI > 55 · price below VWAP · volume above 20-candle avg · price near 50–61.8% Fibonacci resistance zone.";
    case "orion":
      return type === "CE"
        ? "Price broke and closed above ORB High. Price confirmed above VWAP. CE OI rising at ATM strike (long buildup confirmed)."
        : "Price broke and closed below ORB Low. Price confirmed below VWAP. PE OI rising at ATM strike (short buildup confirmed).";
    case "supertrend":
      return type === "CE"
        ? "Supertrend(7,3) flipped green on 5m candle. Price crossed above the Supertrend line — bullish directional flip."
        : "Supertrend(7,3) flipped red on 5m candle. Price crossed below the Supertrend line — bearish directional flip.";
    case "pcr_reversal":
      return type === "CE"
        ? "PCR exceeded 1.3 (market oversold). PE OI at ATM strike fell 10%+ over last 30 min — confirming PE unwinding. Reversal to upside expected."
        : "PCR fell below 0.7 (market overbought). CE OI at ATM strike fell 10%+ over last 30 min — confirming CE unwinding. Reversal to downside expected.";
    case "gap_orb":
      return type === "CE"
        ? "Gap down > 0.3% detected at open. Fade strategy — buying CE expecting price to recover back toward previous day's close."
        : "Gap up > 0.3% detected at open. Fade strategy — buying PE expecting price to pull back toward previous day's close.";
    case "vwap_scalper":
      return type === "CE"
        ? "Price pulled back to VWAP and bounced above it on 1m candle. RSI 40–60 (neutral), OI rising, previous candle made a higher low — bullish VWAP reclaim entry."
        : "Price pulled back to VWAP and rejected below it on 1m candle. RSI 40–60 (neutral), OI rising, previous candle made a lower high — bearish VWAP rejection entry.";
    default:
      return "Entry signal triggered.";
  }
}

function fallbackExitText(pos: Position): string {
  switch (pos.exit_reason) {
    case "SL_HIT":      return `Stop loss hit. Entry: ₹${pos.entry_price.toFixed(2)}. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    case "CROSSOVER":   return "Opposite EMA/Supertrend crossover detected. Position closed and flip trade opened.";
    case "TRAIL_SL":    return `Trailing stop loss triggered. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    case "HARD_CLOSE":  return "Position closed at hard close time per the strategy's trading window rule.";
    case "PCR_NEUTRAL": return "PCR reverted to neutral zone (0.9–1.1). Signal no longer valid.";
    case "OI_REVERSE":  return "OI buildup detected on the opposite side. Signal reversed.";
    case "TARGET":
    case "GAP_FILL":    return `Gap fill target reached. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    case "VWAP_CROSS":  return `Price crossed VWAP in opposite direction. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    default:            return pos.exit_reason?.replace(/_/g, " ") ?? "—";
  }
}

// ── IndicatorChart ───────────────────────────────────────────────

function IndicatorChart({
  strategyId,
  index,
  defaultInterval,
  positions,
}: {
  strategyId: string;
  index: string;
  defaultInterval: string;
  positions: Position[];
}) {
  const accent = ACCENT[strategyId] ?? "#6b7280";

  const allIntervals = ["30s", "1m", "5m", "15m"] as const;
  type TF = typeof allIntervals[number];
  const [timeframe, setTimeframe] = useState<TF>(defaultInterval as TF);

  // Chart refs
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const chartRef         = useRef<IChartApi | null>(null);
  const candleSeriesRef  = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema16Ref         = useRef<ISeriesApi<"Line"> | null>(null);
  const ema64Ref         = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef          = useRef<ISeriesApi<"Line"> | null>(null);
  const stUpRef          = useRef<ISeriesApi<"Line"> | null>(null);
  const stDownRef        = useRef<ISeriesApi<"Line"> | null>(null);

  // Markers plugin ref
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // Price line refs
  const orbHighLineRef = useRef<IPriceLine | null>(null);
  const orbLowLineRef  = useRef<IPriceLine | null>(null);
  const pdcLineRef     = useRef<IPriceLine | null>(null);

  // PCR refs
  const pcrContainerRef = useRef<HTMLDivElement>(null);
  const pcrChartRef     = useRef<IChartApi | null>(null);
  const pcrSeriesRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const [lastPcr, setLastPcr] = useState<number | null>(null);

  const needsEMA  = ["ema_crossover", "ema_confluence"].includes(strategyId);
  const needsVWAP = ["ema_confluence", "orion", "vwap_scalper"].includes(strategyId);
  const needsST   = strategyId === "supertrend";
  const needsPCR  = strategyId === "pcr_reversal";
  const needsORB  = ["orion", "gap_orb", "vwap_scalper"].includes(strategyId);
  const needsPDC  = ["gap_orb", "orion"].includes(strategyId);

  // last candle time to skip redundant setData
  const lastCandleTimeRef = useRef<number>(0);

  // Market-open check (IST weekday + 9:15–15:30)
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
        secondsVisible: defaultInterval === "30s" || defaultInterval === "1m",
        fixLeftEdge: false,
        rightOffset: 5,
      },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    // ResizeObserver: keep chart width in sync with container
    const ro = new ResizeObserver(() => {
      if (chartRef.current && mainContainerRef.current) {
        chartRef.current.applyOptions({ width: mainContainerRef.current.clientWidth });
      }
    });
    ro.observe(mainContainerRef.current);
    // store for cleanup
    (chart as unknown as { _ro: ResizeObserver })._ro = ro;

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor:         "#22c55e",
      downColor:       "#ef4444",
      borderUpColor:   "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor:     "#22c55e",
      wickDownColor:   "#ef4444",
      lastValueVisible: true,
      priceLineVisible: true,
    });

    if (needsEMA) {
      ema16Ref.current = chart.addSeries(LineSeries, {
        color: "#3B82F6",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        title: "EMA16",
      });
      ema64Ref.current = chart.addSeries(LineSeries, {
        color: "#F97316",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        title: "EMA64",
      });
    }

    if (needsVWAP) {
      vwapRef.current = chart.addSeries(LineSeries, {
        color: "#A855F7",
        lineWidth: 1,
        lineStyle: 1, // dashed
        lastValueVisible: false,
        priceLineVisible: false,
        title: "VWAP",
      });
    }

    if (needsST) {
      stUpRef.current = chart.addSeries(LineSeries, {
        color: "#22c55e",
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        title: "ST Up",
      });
      stDownRef.current = chart.addSeries(LineSeries, {
        color: "#ef4444",
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        title: "ST Down",
      });
    }

    return () => {
      (chart as unknown as { _ro?: ResizeObserver })._ro?.disconnect();
      chart.remove();
      chartRef.current         = null;
      candleSeriesRef.current  = null;
      ema16Ref.current         = null;
      ema64Ref.current         = null;
      vwapRef.current          = null;
      stUpRef.current          = null;
      stDownRef.current        = null;
      orbHighLineRef.current   = null;
      orbLowLineRef.current    = null;
      pdcLineRef.current       = null;
      markersPluginRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Init PCR chart
  useEffect(() => {
    if (!needsPCR || !pcrContainerRef.current) return;
    const chart = createChart(pcrContainerRef.current, {
      autoSize: true,
      height: 80,
      layout: {
        background: { type: ColorType.Solid, color: "#0A0D14" },
        textColor: "#6b7280",
        fontSize: 9,
      },
      grid: {
        vertLines: { color: "#1a1f2e" },
        horzLines: { color: "#1a1f2e" },
      },
      rightPriceScale: { borderColor: "#1a1f2e" },
      timeScale: { borderColor: "#1a1f2e", timeVisible: false },
      crosshair: { mode: 1 },
    });
    pcrChartRef.current  = chart;
    pcrSeriesRef.current = chart.addSeries(LineSeries, {
      color: "#8B5CF6",
      lineWidth: 1,
      lastValueVisible: true,
      priceLineVisible: false,
    });
    return () => {
      chart.remove();
      pcrChartRef.current  = null;
      pcrSeriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear data when timeframe changes
  useEffect(() => {
    if (candleSeriesRef.current) candleSeriesRef.current.setData([]);
    if (ema16Ref.current)  ema16Ref.current.setData([]);
    if (ema64Ref.current)  ema64Ref.current.setData([]);
    if (vwapRef.current)   vwapRef.current.setData([]);
    if (stUpRef.current)   stUpRef.current.setData([]);
    if (stDownRef.current) stDownRef.current.setData([]);
    lastCandleTimeRef.current = 0;
    chartRef.current?.timeScale().applyOptions({
      secondsVisible: timeframe === "30s" || timeframe === "1m",
    });
  }, [timeframe]);

  // Poll data — 1s when market open, 60s when closed
  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const [candleRes, indRes] = await Promise.all([
          fetch(`${BACKEND}/api/candles?index=${index}&interval=${timeframe}`),
          fetch(`${BACKEND}/api/indicators?strategy=${strategyId}&index=${index}`),
        ]);
        if (!candleRes.ok || !indRes.ok) return;
        const rawCandles: OhlcCandle[] = await candleRes.json();
        const ind: IndicatorData       = await indRes.json();

        if (cancelled || !candleSeriesRef.current) return;

        const candles = rawCandles
          .filter(c => c.open > 0 && c.high >= c.low && c.close > 0)
          .map(c => ({
            time:  (c.time > 1e10 ? Math.floor(c.time / 1000) : c.time) as UTCTimestamp,
            open:  c.open,
            high:  c.high,
            low:   c.low,
            close: c.close,
          }));

        if (candles.length > 0) {
          const newestTime = candles[candles.length - 1].time as number;
          const changed    = newestTime !== lastCandleTimeRef.current;
          if (changed) {
            lastCandleTimeRef.current = newestTime;
            candleSeriesRef.current.setData(candles);
            chartRef.current?.timeScale().scrollToRealTime();
          }

          // Entry markers via createSeriesMarkers plugin
          const markers: SeriesMarker<UTCTimestamp>[] = positions.map(pos => ({
            time: (new Date(pos.opened_at).getTime() / 1000) as UTCTimestamp,
            position: pos.type === "CE" ? "belowBar" : "aboveBar" as const,
            color: pos.type === "CE" ? "#22c55e" : "#ef4444",
            shape: pos.type === "CE" ? "arrowUp" : "arrowDown" as const,
            text: `${pos.type} ${pos.entry_price.toFixed(0)}`,
          }));
          markers.sort((a, b) => (a.time as number) - (b.time as number));

          if (!markersPluginRef.current) {
            markersPluginRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
          } else {
            markersPluginRef.current.setMarkers(markers);
          }
        }

        // EMA
        if (ema16Ref.current && ind.ema16?.length) {
          ema16Ref.current.setData(
            ind.ema16.map(p => ({
              time:  (p.time > 1e10 ? Math.floor(p.time / 1000) : p.time) as UTCTimestamp,
              value: p.value,
            }))
          );
        }
        if (ema64Ref.current && ind.ema64?.length) {
          ema64Ref.current.setData(
            ind.ema64.map(p => ({
              time:  (p.time > 1e10 ? Math.floor(p.time / 1000) : p.time) as UTCTimestamp,
              value: p.value,
            }))
          );
        }

        // VWAP
        if (vwapRef.current && ind.vwap?.length) {
          vwapRef.current.setData(
            ind.vwap.map(p => ({
              time:  (p.time > 1e10 ? Math.floor(p.time / 1000) : p.time) as UTCTimestamp,
              value: p.value,
            }))
          );
        }

        // Supertrend — split into up/down with null gaps at direction changes
        if (stUpRef.current && stDownRef.current && ind.supertrendUp && ind.supertrendDown) {
          const stUp = ind.supertrendUp
            .filter((p): p is { time: number; value: number } => p.value !== null)
            .map(p => ({
              time:  (p.time > 1e10 ? Math.floor(p.time / 1000) : p.time) as UTCTimestamp,
              value: p.value,
            }));
          const stDown = ind.supertrendDown
            .filter((p): p is { time: number; value: number } => p.value !== null)
            .map(p => ({
              time:  (p.time > 1e10 ? Math.floor(p.time / 1000) : p.time) as UTCTimestamp,
              value: p.value,
            }));
          if (stUp.length)   stUpRef.current.setData(stUp);
          if (stDown.length) stDownRef.current.setData(stDown);
        }

        // ORB High/Low price lines
        if (needsORB && candleSeriesRef.current) {
          const orbH = ind.orbHigh ?? 0;
          const orbL = ind.orbLow  ?? 0;
          if (orbH > 0) {
            if (!orbHighLineRef.current) {
              orbHighLineRef.current = candleSeriesRef.current.createPriceLine({
                price: orbH, color: "#22c55e", lineWidth: 1, lineStyle: 2,
                axisLabelVisible: true, title: "ORB H",
              });
            } else {
              orbHighLineRef.current.applyOptions({ price: orbH });
            }
          }
          if (orbL > 0) {
            if (!orbLowLineRef.current) {
              orbLowLineRef.current = candleSeriesRef.current.createPriceLine({
                price: orbL, color: "#ef4444", lineWidth: 1, lineStyle: 2,
                axisLabelVisible: true, title: "ORB L",
              });
            } else {
              orbLowLineRef.current.applyOptions({ price: orbL });
            }
          }
        }

        // prevDayClose price line
        if (needsPDC && candleSeriesRef.current) {
          const pdc = ind.prevDayClose ?? 0;
          if (pdc > 0) {
            if (!pdcLineRef.current) {
              pdcLineRef.current = candleSeriesRef.current.createPriceLine({
                price: pdc, color: "#6b7280", lineWidth: 1, lineStyle: 3,
                axisLabelVisible: true, title: "PDC",
              });
            } else {
              pdcLineRef.current.applyOptions({ price: pdc });
            }
          }
        }

        // PCR chart
        if (pcrSeriesRef.current && ind.pcr?.length) {
          const pcrData = ind.pcr
            .map(p => ({
              time:  (p.time > 1e10 ? Math.floor(p.time / 1000) : p.time) as UTCTimestamp,
              value: p.value,
            }))
            .sort((a, b) => (a.time as number) - (b.time as number));
          pcrSeriesRef.current.setData(pcrData);
          if (pcrData.length > 0) {
            setLastPcr(pcrData[pcrData.length - 1].value);
          }
        }

      } catch (err) {
        console.warn(`[IndicatorChart:${index}:${strategyId}] error:`, err);
      }
    };

    fetchAll();
    const pollMs = isMarketOpen ? 1_000 : 60_000;
    const iv = setInterval(fetchAll, pollMs);
    return () => { cancelled = true; clearInterval(iv); };
  }, [index, timeframe, strategyId, positions, needsORB, needsPDC, isMarketOpen]);

  const tfBtns = allIntervals.filter(tf => {
    // Only show relevant intervals
    if (strategyId === "vwap_scalper") return ["1m", "5m"].includes(tf);
    if (strategyId === "supertrend")   return ["1m", "5m", "15m"].includes(tf);
    if (["orion", "gap_orb"].includes(strategyId)) return ["5m", "15m"].includes(tf);
    return ["30s", "1m", "5m", "15m"].includes(tf);
  });

  return (
    <div style={{
      background: "#0B0E17",
      border: "1px solid #1a1f2e",
      borderRadius: 12,
      overflow: "hidden",
      marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 14px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #1a1f2e",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.1em" }}>
            {index}
          </span>
          {needsEMA && (
            <span style={{ fontSize: 10, color: "#6b7280" }}>
              <span style={{ color: "#3B82F6" }}>▬</span> EMA16&nbsp;
              <span style={{ color: "#F97316" }}>▬</span> EMA64
            </span>
          )}
          {needsVWAP && (
            <span style={{ fontSize: 10, color: "#A855F7" }}>⋯ VWAP</span>
          )}
          {needsST && (
            <span style={{ fontSize: 10, color: "#6b7280" }}>
              <span style={{ color: "#22c55e" }}>▬</span> ST Up&nbsp;
              <span style={{ color: "#ef4444" }}>▬</span> ST Down
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {tfBtns.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              style={{
                padding: "2px 8px",
                borderRadius: 20,
                border: `1px solid ${timeframe === tf ? accent : "#1f2937"}`,
                background: timeframe === tf ? accent : "transparent",
                color: timeframe === tf ? "#000000" : "#6b7280",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
                letterSpacing: "0.05em",
                transition: "all 0.15s",
              }}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Main chart */}
      <div ref={mainContainerRef} style={{ width: "100%", height: 400 }} />

      {/* PCR panel */}
      {needsPCR && (
        <>
          <div style={{
            padding: "4px 14px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderTop: "1px solid #1a1f2e",
            borderBottom: "1px solid #1a1f2e",
            background: "#080B12",
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em" }}>PCR</span>
            {lastPcr !== null && (
              <span style={{
                fontSize: 12,
                fontFamily: "monospace",
                fontWeight: 600,
                color: lastPcr > 1.3 ? "#22c55e" : lastPcr < 0.7 ? "#ef4444" : "#9ca3af",
              }}>
                {lastPcr.toFixed(2)}
              </span>
            )}
          </div>
          <div ref={pcrContainerRef} style={{ width: "100%", height: 80 }} />
        </>
      )}
    </div>
  );
}

// ── Strategy Detail Page ─────────────────────────────────────────

export default function StrategyDetailPage() {
  const params = useParams();
  const id     = (params.id as string) ?? "";
  const accent = ACCENT[id] ?? "#6b7280";
  const rules  = RULES[id] ?? [];
  const charts = STRATEGY_CHARTS[id] ?? [{ index: "NIFTY", interval: "30s" }];

  const [strategy,  setStrategy]  = useState<Strategy | null>(null);
  const [capital,   setCapital]   = useState<Capital | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [openPos,   setOpenPos]   = useState<Position[]>([]);
  const [rulesOpen, setRulesOpen] = useState(true);
  const [loading,   setLoading]   = useState(true);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);

  // Load strategy + capital (15s)
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

  // Load all positions (15s)
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("strategy_positions")
        .select("*")
        .eq("strategy_id", id)
        .order("opened_at", { ascending: false })
        .limit(300);
      if (data) setPositions(data as Position[]);
    };
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, [id]);

  // Live open positions (1s PnL update)
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("strategy_positions")
        .select("*")
        .eq("strategy_id", id)
        .eq("status", "OPEN");
      if (data) setOpenPos(data as Position[]);
    };
    load();
    const iv = setInterval(load, 1_000);
    return () => clearInterval(iv);
  }, [id]);

  const allocated  = capital?.allocated_capital ?? 100_000;
  const closedPnl  = capital?.total_pnl ?? 0;
  const openPnl    = openPos.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const liveCapital = allocated + closedPnl + openPnl;
  const livePnl    = liveCapital - allocated;
  const retPct     = (livePnl / allocated) * 100;
  const sharpe     = capital?.sharpe_ratio ?? 0;
  const winRate    = capital?.win_rate ?? 0;
  const today      = capital?.today_trades ?? 0;
  const lifetime   = capital?.lifetime_trades ?? 0;

  const closedTrades = positions
    .filter(p => p.status === "CLOSED")
    .sort((a, b) => new Date(b.closed_at ?? 0).getTime() - new Date(a.closed_at ?? 0).getTime());

  // Merge openPos (1s) into display list
  const openTrades = openPos;

  const thStyle: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 9,
    fontWeight: 600,
    color: "#374151",
    textAlign: "left",
    letterSpacing: "0.08em",
    whiteSpace: "nowrap",
  };

  if (loading) {
    return (
      <div className="page-content" style={{ background: "#0A0D14", minHeight: "100vh", padding: "18px 16px 32px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 12, color: "#374151" }}>Loading strategy...</div>
      </div>
    );
  }

  return (
    <div className="page-content" style={{ background: "#0A0D14", minHeight: "100vh", padding: "18px 16px 32px" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/" style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "#6b7280",
          marginBottom: 12,
          textDecoration: "none",
        }}>
          ← Indian Strategies Dashboard
        </Link>
        <div className="breadcrumb" style={{ textAlign: "center", fontSize: 9, color: "#374151", letterSpacing: "0.12em", marginBottom: 4 }}>
          AI TRADING ARENA · SEASON 1 · PAPER TRADING
        </div>
        <h1 style={{
          fontSize: 28,
          fontWeight: 700,
          color: accent,
          textAlign: "center",
          margin: 0,
        }}>
          {strategy?.slot_number != null ? `Strategy ${strategy.slot_number} — ` : ""}{strategy?.name ?? id.replace(/_/g, " ").toUpperCase()}
        </h1>
        {strategy?.description && (
          <p style={{ fontSize: 12, color: "#6b7280", textAlign: "center", margin: "6px 0 0" }}>
            {strategy.description}
          </p>
        )}
      </div>

      {/* ── Stats bar (8 cols) ── */}
      <div className="detail-stats-bar" style={{
        background: "#0B0E17",
        border: "1px solid #1a1f2e",
        borderTop: `3px solid ${accent}`,
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 16,
      }}>
        {[
          { label: "INITIAL CAPITAL", value: `₹${fmtINR(allocated)}`,         color: "#9ca3af" },
          { label: "TOTAL PnL",       value: pnlStr(livePnl),                  color: pnlColor(livePnl) },
          { label: "CURRENT CAPITAL", value: `₹${fmtINR(liveCapital)}`,        color: "#ffffff" },
          { label: "RETURN",          value: fmtPct(retPct),                    color: pnlColor(retPct) },
          { label: "SHARPE",          value: sharpe.toFixed(2),                 color: "#ffffff" },
          { label: "TOTAL TRADES",    value: String(lifetime),                  color: "#ffffff" },
          { label: "TODAY",           value: String(today),                     color: "#ffffff" },
          { label: "WIN RATE",        value: `${winRate.toFixed(1)}%`,          color: winRate >= 50 ? "#4ade80" : "#f87171" },
        ].map((s, i) => (
          <div key={s.label} style={{
            padding: "14px 12px",
            borderLeft: i > 0 ? "1px solid #1a1f2e" : undefined,
          }}>
            <div style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.1em", marginBottom: 5, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Strategy Rules ── */}
      <div style={{
        background: "#0B0E17",
        border: "1px solid #1a1f2e",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 16,
      }}>
        <div
          onClick={() => setRulesOpen(v => !v)}
          style={{
            padding: "10px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: "#4b5563", letterSpacing: "0.1em" }}>
            STRATEGY RULES
          </span>
          <span style={{ fontSize: 10, color: "#374151" }}>{rulesOpen ? "▲ COLLAPSE" : "▼ EXPAND"}</span>
        </div>
        {rulesOpen && rules.length > 0 && (
          <div style={{ padding: "0 20px 16px", borderTop: "1px solid #0f1520" }}>
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
                  {line === "" ? <br /> : isIndented ? line.trim() : `· ${line}`}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Charts ── */}
      <div style={{ marginBottom: 16 }}>
        {charts.map(cfg => (
          <IndicatorChart
            key={`${cfg.index}-${cfg.interval}`}
            strategyId={id}
            index={cfg.index}
            defaultInterval={cfg.interval}
            positions={[...openTrades, ...closedTrades]}
          />
        ))}
      </div>

      {/* ── Open Trades ── */}
      {openTrades.length > 0 && (
        <div style={{
          background: "#0B0E17",
          border: "1px solid #1a1f2e",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 16,
        }}>
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
            <span
              className="pulse"
              style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#f5d547", flexShrink: 0 }}
            />
            OPEN TRADES ({openTrades.length}) · live PnL updates every 1s
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr style={{ background: "#070A11" }}>
                  {["Symbol", "Type", "Entry Price", "Entry Time", "Qty", "Current Price", "Live PnL", "Stop Loss", "Trail SL", "Duration"].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openTrades.map(pos => (
                  <Fragment key={pos.id}>
                    <tr style={{ borderTop: "1px solid #0f1520", background: "rgba(245,213,71,0.01)", cursor: "pointer" }}
                      onClick={() => setExpandedTrade(prev => prev === pos.id ? null : pos.id)}>
                      <td style={{ padding: "7px 10px", fontSize: 11, color: "#c9d1d9", whiteSpace: "nowrap" }}>{pos.symbol}</td>
                      <td style={{ padding: "7px 8px", fontSize: 11, fontWeight: 700, color: pos.type === "CE" ? "#22c55e" : "#ef4444" }}>{pos.type}</td>
                      <td style={{ padding: "7px 8px", fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>₹{pos.entry_price.toFixed(2)}</td>
                      <td style={{ padding: "7px 8px", fontSize: 10, color: "#4b5563" }}>{fmtTime(pos.opened_at)}</td>
                      <td style={{ padding: "7px 8px", fontSize: 11, color: "#9ca3af" }}>{pos.quantity}</td>
                      <td style={{ padding: "7px 8px", fontSize: 11, color: "#f5d547", fontFamily: "monospace", fontWeight: 600 }}>₹{(pos.current_price ?? 0).toFixed(2)}</td>
                      <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: pnlColor(pos.pnl ?? 0) }}>{pnlStr(pos.pnl ?? 0)}</td>
                      <td style={{ padding: "7px 8px", fontSize: 11, color: "#ef4444", fontFamily: "monospace" }}>
                        {pos.stop_loss ? `₹${pos.stop_loss.toFixed(2)}` : "—"}
                      </td>
                      <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", color: pos.trail_sl ? "#f5d547" : "#374151" }}>
                        {pos.trail_sl ? `₹${pos.trail_sl.toFixed(2)}` : "inactive"}
                      </td>
                      <td style={{ padding: "7px 8px", fontSize: 10, color: "#6b7280" }}>{formatDuration(pos.opened_at, null)}</td>
                    </tr>
                    {expandedTrade === pos.id && (
                      <tr style={{ borderTop: "1px solid #0f1520" }}>
                        <td colSpan={10} style={{ padding: "14px 20px", background: "#080B12" }}>
                          <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>
                            <strong style={{ fontSize: 9, color: "#374151", letterSpacing: "0.1em" }}>WHY THIS TRADE WAS ENTERED: </strong>
                            {getEntryReason(pos.strategy_id, pos.type)}
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

      {/* ── Closed Trades ── */}
      {closedTrades.length > 0 && (
        <div style={{
          background: "#0B0E17",
          border: "1px solid #1a1f2e",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 16,
        }}>
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
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ background: "#070A11" }}>
                  {["Symbol", "Type", "Entry", "Exit", "Entry Time", "Exit Time", "Duration", "Qty", "PnL", "Return %", "Exit Reason"].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closedTrades.map(pos => {
                  const ret = pos.entry_price > 0
                    ? ((( pos.exit_price ?? pos.entry_price) - pos.entry_price) / pos.entry_price) * 100
                    : 0;
                  return (
                    <Fragment key={pos.id}>
                      <tr style={{ borderTop: "1px solid #0f1520", cursor: "pointer", background: expandedTrade === pos.id ? "rgba(255,255,255,0.02)" : "transparent" }}
                        onClick={() => setExpandedTrade(prev => prev === pos.id ? null : pos.id)}>
                        <td style={{ padding: "7px 10px", fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>{pos.symbol}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontWeight: 700, color: pos.type === "CE" ? "#22c55e" : "#ef4444" }}>{pos.type}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>₹{pos.entry_price.toFixed(2)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#4b5563", fontFamily: "monospace" }}>
                          {pos.exit_price != null ? `₹${pos.exit_price.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#374151" }}>{fmtTime(pos.opened_at)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#374151" }}>{fmtTime(pos.closed_at)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#6b7280" }}>{formatDuration(pos.opened_at, pos.closed_at)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#6b7280" }}>{pos.quantity}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: pnlColor(pos.pnl ?? 0) }}>
                          {pnlStr(pos.pnl ?? 0)}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", color: pnlColor(ret) }}>
                          {fmtPct(ret)}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#374151", whiteSpace: "nowrap" }}>
                          {pos.exit_reason?.replace(/_/g, " ") ?? "—"}
                        </td>
                      </tr>
                      {expandedTrade === pos.id && (
                        <tr style={{ borderTop: "1px solid #0f1520" }}>
                          <td colSpan={11} style={{ padding: "14px 20px", background: "#080B12" }}>
                            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                              <div style={{ flex: 1, minWidth: 220 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 7 }}>WHY THIS TRADE WAS ENTERED</div>
                                <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.7 }}>{getEntryReason(pos.strategy_id, pos.type)}</div>
                              </div>
                              <div style={{ flex: 1, minWidth: 220 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 7 }}>WHY THIS TRADE WAS CLOSED</div>
                                <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>{pos.exit_reason_detail ?? fallbackExitText(pos)}</div>
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

      {openTrades.length === 0 && closedTrades.length === 0 && !loading && (
        <div style={{ padding: "36px 20px", textAlign: "center", fontSize: 12, color: "#1f2937" }}>
          No trades yet for this strategy.
        </div>
      )}
    </div>
  );
}
