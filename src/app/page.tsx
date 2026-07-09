"use client";

import { Fragment, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { createChart, HistogramSeries, AreaSeries, ColorType, createSeriesMarkers } from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";

const BACKEND = "https://ai-trading-arena-backend-production.up.railway.app";

// ── Types ──────────────────────────────────────────────────────

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
  charges: number | null;
  status: "OPEN" | "CLOSED";
  opened_at: string;
  closed_at: string | null;
  exit_reason: string | null;
  exit_reason_detail: string | null;
};

type IndexQuote = { ltp: number; change: number; changePct: number };

type OhlcCandle = { time: number; open: number; high: number; low: number; close: number };

type CapitalPoint = { date: string; capital: number };
type CorrelationData = {
  strategies: string[];
  matrix: (number | null)[][] | null;
  insufficient?: boolean;
};
type CardMetrics = { profit_factor: string; max_drawdown_inr: number };

// ── Strategy Config ─────────────────────────────────────────────

const ACCENT: Record<string, string> = {
  ema_crossover:         "#F59E0B",
  orion:                 "#6366F1",
  ema_confluence:        "#10B981",
  supertrend:            "#EF4444",
  pcr_reversal:          "#8B5CF6",
  gap_orb:               "#06B6D4",
  vwap_scalper:          "#F97316",
  ema_crossover_1m:      "#EC4899",
  ema_crossover_asym:        "#34D399",
  ema_crossover_confirm:     "#60A5FA",
  ema_crossover_dualtf:      "#A78BFA",
  ema_crossover_1m_run:      "#84CC16",
  ema_crossover_1m_runtrail: "#14B8A6",
  expiry_powerhour_dir:      "#F43F5E",  // rose
  expiry_powerhour_straddle: "#0EA5E9",  // sky
};

const RULES: Record<string, string[]> = {
  ema_crossover: [
    "Instrument: Nifty 50 options · weekly expiry",
    "Timeframe: 30-second candles, forming from 9:15 AM",
    "Trading window: 10:30 AM – 3:18 PM",
    "Entry CE: 16 EMA crosses above 64 EMA → buy CE (₹60–70 premium range)",
    "Entry PE: 16 EMA crosses below 64 EMA → buy PE (₹60–70 premium range)",
    "Stop loss: 15% of premium paid (e.g. entry ₹65 → SL ₹55.25)",
    "Target: 30% of premium (1:2 RR) — full exit on hit",
    "Trail SL: activates when Nifty moves 1.5× ATR in trade direction → trail at 10% below peak premium",
    "Exit: SL hit | target hit | opposite crossover triggers flip | trail SL hit | 3:18 PM hard close",
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
    "Target: 45% of premium (1:1.5 RR) — full exit on hit",
    "Breakeven rule: when trade up 20%, move SL to entry price",
    "Trail SL: activates at 35% gain → trail at 15% below peak premium",
    "Hard close: 3:18 PM (entries close at 2:00 PM — position can run to 3:18 PM)",
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
    "Target: 30% of premium (1:2 RR) — full exit on hit",
    "Trail SL: 1.5× ATR move in direction → trail at 10% below peak premium",
    "Hard close: 3:18 PM · Max 1 open trade at a time",
  ],
  supertrend: [
    "Instruments: Nifty 50 + BankNifty options · weekly expiry",
    "Timeframe: 5-minute candles",
    "Indicator: Supertrend with period=7, multiplier=3",
    "Entry CE: Supertrend flips green → price crosses above Supertrend line (bullish flip)",
    "Entry PE: Supertrend flips red → price crosses below Supertrend line (bearish flip)",
    "Stop loss: 20% of premium paid",
    "Target: 40% of premium (1:2 RR) — full exit on hit",
    "Trail SL: activates at 40% gain → trail at 12% below peak premium",
    "Exit: SL hit | target hit | Supertrend flips opposite (close + open opposite) | trail SL | 3:18 PM hard close",
    "Trading window: 9:45 AM – 2:30 PM",
    "Max 2 trades per instrument per day",
  ],
  pcr_reversal: [
    "Instrument: Nifty 50 options · weekly expiry",
    "No candles — checks option chain data every 5 minutes",
    "Entry CE: PCR > 1.3 (market oversold) AND PE OI at ATM fell 10%+ in last 30 min (unwinding)",
    "Entry PE: PCR < 0.7 (market overbought) AND CE OI at ATM fell 10%+ in last 30 min (unwinding)",
    "Stop loss: 15% of premium paid",
    "Target: 37.5% of premium (1:2.5 RR) — full exit on hit",
    "Trail SL: activates at 30% gain → trail at 12% below peak premium",
    "Exit: SL hit | target hit | PCR returns to neutral 0.9–1.1 | OI builds on opposite side | trail SL | 3:18 PM",
    "Trading window: 10:00 AM – 2:30 PM",
    "Max 3 trades per day",
  ],
  gap_orb: [
    "Instrument: Nifty 50 options · weekly expiry",
    "Gap = (Today's Open − Yesterday's Close) / Yesterday's Close × 100, calculated at 9:15 AM",
    "Gap > 0.3% up → FADE: buy PE (expect price to reverse and fill the gap)",
    "Gap > 0.3% down → FADE: buy CE (expect price to reverse and fill the gap)",
    "Gap < 0.3% → ORB BREAKOUT: trade direction of 9:15–9:30 AM range break",
    "Fade target: price returns to previous day's close level (gap filled) — primary exit",
    "Breakout target: 40% of premium (1:2 RR) — full exit on hit (fallback if gap fill doesn't apply)",
    "Stop loss: 20% of premium paid",
    "Breakout trail SL: 35% gain → trail at 12% below peak premium",
    "Morning only: no new trades after 11:30 AM | Hard close: 3:18 PM",
    "Max 2 trades per day",
  ],
  ema_crossover_1m: [
    "Instrument: Nifty 50 options · weekly expiry",
    "Timeframe: 1-minute candles, forming from 9:15 AM",
    "Trading window: 9:45 AM – 3:20 PM",
    "Entry CE: 16 EMA crosses above 64 EMA → buy CE (₹60–70 premium range, closest strike to spot)",
    "Entry PE: 16 EMA crosses below 64 EMA → buy PE (₹60–70 premium range, closest strike to spot)",
    "Stop loss: 15% of premium paid",
    "Target: 30% of premium (1:2 RR) — full exit on hit",
    "Trail SL: activates when price moves 1.5× ATR in trade direction → trail at 10% below peak premium",
    "Exit: SL hit | target hit | opposite crossover triggers flip | trail SL hit | 3:20 PM hard close",
    "Max 1 open trade at a time",
  ],
  vwap_scalper: [
    "· VWAP + RSI Momentum Scalper — Nifty, BankNifty, Sensex options",
    "· Timeframe: 1-minute candles | Window: 10:30 AM – 3:18 PM IST",
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
    "Danger windows (11:30 12:30 13:00 14:00 14:45 15:00 IST):",
    "  · SL tightens to 10% | Position size halved",
    "  · Open positions: trail SL tightened to 5% below current price",
    "",
    "Normal day rules:",
    "  · SL: 20% of premium | Target: 30% of premium (1:1.5 RR) | Max 1 position per index at a time",
    "  · Trail SL: at +25% premium → move SL to breakeven",
    "  · At +35% → trail at 12% below peak premium",
    "",
    "Expiry danger rules:",
    "  · SL: 10% of premium | Target: 15% of premium (1:1.5 RR) | Position size halved",
    "",
    "Exit priority: SL hit → Target hit → Trail SL hit → 3:18 PM hard close → Opposite VWAP cross",
  ],
  ema_crossover_asym: [
    "Control clone of S1 (EMA Crossover) with one change: exit confirmation",
    "Instrument: Nifty 50 options · weekly expiry",
    "Timeframe: 30-second candles | Window: 9:45 AM – 3:20 PM",
    "Entry: 16/64 EMA cross — acts IMMEDIATELY (same as S1)",
    "Exit/flip: opposite EMA cross must hold for 2 consecutive 30s bar closes before acting",
    "  Bar 1: opposite cross detected → signal logged, no action taken",
    "  Bar 2: if EMA direction still holds → execute close + open opposite",
    "  If EMA reverts before bar 2 → flip cancelled, logged as 'flip_reverted'",
    "SL: 15% | Target: 30% | Trail: +20% activates → 10% below peak | Hard close 3:20 PM",
  ],
  ema_crossover_confirm: [
    "Control clone of S1 (EMA Crossover) — 2-bar confirmation on BOTH entry and exit",
    "Instrument: Nifty 50 options · weekly expiry",
    "Timeframe: 30-second candles | Window: 9:45 AM – 3:20 PM",
    "Entry: cross detected → wait for 2nd consecutive 30s bar confirming direction → enter",
    "Exit/flip: opposite cross detected → wait for 2nd bar confirming → close + flip",
    "  If EMA reverts before bar 2 → action cancelled, logged as reverted",
    "SL: 15% | Target: 30% | Trail: +20% activates → 10% below peak | Hard close 3:20 PM",
  ],
  ema_crossover_dualtf: [
    "Control clone of S1 — requires agreement from both 30s AND 1-minute EMA 16/64",
    "Instrument: Nifty 50 options · weekly expiry",
    "Timeframe: 30-second candles + 1-minute candles | Window: 9:45 AM – 3:20 PM",
    "Entry CE: 30s 16 EMA crosses above 64 EMA AND 1m 16 EMA is above 1m 64 EMA",
    "Entry PE: 30s 16 EMA crosses below 64 EMA AND 1m 16 EMA is below 1m 64 EMA",
    "Exit/flip: opposite 30s cross AND 1m EMA direction agrees with new side",
    "  If 1m disagrees → signal blocked, logged as '1m_ema_disagrees'",
    "SL: 15% | Target: 30% | Trail: +20% activates → 10% below peak | Hard close 3:20 PM",
  ],
  ema_crossover_1m_run: [
    "Instrument: Nifty 50 options · weekly expiry",
    "Timeframe: 1-minute candles, forming from 9:15 AM",
    "Trading window: 9:45 AM – 3:20 PM",
    "Entry CE: 16 EMA crosses above 64 EMA → buy CE (₹60–70 premium range, closest strike to spot)",
    "Entry PE: 16 EMA crosses below 64 EMA → buy PE (₹60–70 premium range, closest strike to spot)",
    "Stop loss: 15% of premium paid",
    "NO profit target — position runs until SL, crossover, or hard close",
    "NO trail SL — hard SL only",
    "Exit: SL hit | opposite crossover triggers flip | 3:20 PM hard close",
    "Max 1 open trade at a time",
  ],
  ema_crossover_1m_runtrail: [
    "Instrument: Nifty 50 options · weekly expiry",
    "Timeframe: 1-minute candles, forming from 9:15 AM",
    "Trading window: 9:45 AM – 3:20 PM",
    "Entry CE: 16 EMA crosses above 64 EMA → buy CE (₹60–70 premium range, closest strike to spot)",
    "Entry PE: 16 EMA crosses below 64 EMA → buy PE (₹60–70 premium range, closest strike to spot)",
    "Stop loss: 15% of premium paid",
    "NO profit target — position runs until trail SL, SL, crossover, or hard close",
    "Trail SL: activates at +20% profit → trails 10% below peak premium (ratchet-only, never loosens)",
    "Exit: SL hit | trail SL hit | opposite crossover triggers flip | 3:20 PM hard close",
    "Max 1 open trade at a time",
  ],
  expiry_powerhour_dir: [
    "Instrument: Nifty 50 weekly options expiring same day",
    "Active ONLY on Nifty expiry day (Tuesday, not a holiday)",
    "Entry: 2:45 PM — single decision point per day",
    "Direction: drift(2:45−2:30) > 0 → buy CE; < 0 → buy PE; = 0 → skip",
    "Strike: nearest-to-spot in ₹15–30 premium band",
    "Sizing: capital × 60%, max-loss cap at 40% SL = ₹8,000",
    "Stop loss: 40% of premium paid",
    "No target — winners run until trail SL or hard close",
    "Trail SL: activates at +50% gain → trails 20% below peak (ratchet)",
    "Hard close: 3:18 PM",
    "No re-entry after exit; one trade per expiry day",
  ],
  expiry_powerhour_straddle: [
    "Instrument: Nifty 50 weekly options expiring same day",
    "Active ONLY on Nifty expiry day (Tuesday, not a holiday)",
    "Entry: 2:45 PM — buy both CE and PE in ₹15–30 band",
    "If either side has no valid ₹15–30 strike, skip entire day",
    "Each leg sized at capital × 30%, max-loss cap per leg = ₹4,000",
    "Combined worst case ≈ ₹8,000",
    "Each leg managed independently (own SL/trail/close)",
    "Stop loss per leg: 40% of premium paid",
    "Trail SL per leg: activates at +50% gain → trails 20% below peak",
    "Hard close: 3:18 PM",
    "No re-entry; one straddle per expiry day",
  ],
};

function getEntryReason(strategyId: string, type: string): string {
  switch (strategyId) {
    case "ema_crossover":
      return type === "CE"
        ? "16 EMA crossed above 64 EMA on 30s candle. Bullish crossover signal triggered."
        : "16 EMA crossed below 64 EMA on 30s candle. Bearish crossover signal triggered.";
    case "ema_crossover_1m":
      return type === "CE"
        ? "16 EMA crossed above 64 EMA on 1m candle. Bullish crossover signal triggered."
        : "16 EMA crossed below 64 EMA on 1m candle. Bearish crossover signal triggered.";
    case "ema_crossover_1m_run":
      return type === "CE"
        ? "16 EMA crossed above 64 EMA on 1m candle. Let-It-Run variant — no target, SL-only exit."
        : "16 EMA crossed below 64 EMA on 1m candle. Let-It-Run variant — no target, SL-only exit.";
    case "ema_crossover_1m_runtrail":
      return type === "CE"
        ? "16 EMA crossed above 64 EMA on 1m candle. Run+Trail variant — no target, trail SL activates at +20%."
        : "16 EMA crossed below 64 EMA on 1m candle. Run+Trail variant — no target, trail SL activates at +20%.";
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
    case "expiry_powerhour_dir":
      return type === "CE"
        ? "NIFTY expiry day 2:45 PM — drift (spot 2:45 minus spot 2:30) positive → bought CE in ₹15–30 premium band nearest to spot."
        : "NIFTY expiry day 2:45 PM — drift (spot 2:45 minus spot 2:30) negative → bought PE in ₹15–30 premium band nearest to spot.";
    case "expiry_powerhour_straddle":
      return type === "CE"
        ? "NIFTY expiry day 2:45 PM straddle — CE leg opened. Both CE and PE in ₹15–30 band found; each leg managed independently."
        : "NIFTY expiry day 2:45 PM straddle — PE leg opened. Both CE and PE in ₹15–30 band found; each leg managed independently.";
    default:
      return "Entry signal triggered.";
  }
}

function fallbackExitText(pos: Position): string {
  switch (pos.exit_reason) {
    case "SL_HIT":
      return `Stop loss hit. Entry: ₹${pos.entry_price.toFixed(2)}. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    case "CROSSOVER":
      return "Opposite EMA/Supertrend crossover detected. Position closed and flip trade opened.";
    case "TRAIL_SL":
      return `Trailing stop loss triggered. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    case "HARD_CLOSE":
      return "Position closed at hard close time per the strategy's trading window rule.";
    case "PCR_NEUTRAL":
      return "PCR reverted to neutral zone (0.9–1.1). Signal no longer valid.";
    case "OI_REVERSE":
      return "OI buildup detected on the opposite side. Signal reversed.";
    case "TARGET":
    case "GAP_FILL":
      return `Gap fill target reached. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    case "VWAP_CROSS":
      return `Price crossed VWAP in opposite direction. Exit: ₹${(pos.exit_price ?? 0).toFixed(2)}.`;
    default:
      return pos.exit_reason?.replace(/_/g, " ") ?? "—";
  }
}

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
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
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

// ── IST time hook ───────────────────────────────────────────────

function useISTTime(): string {
  const [time, setTime] = useState("--:--:--");
  useEffect(() => {
    const tick = () => {
      const ist = new Date(Date.now() + (5 * 60 + 30) * 60_000);
      const h = String(ist.getUTCHours()).padStart(2, "0");
      const m = String(ist.getUTCMinutes()).padStart(2, "0");
      const s = String(ist.getUTCSeconds()).padStart(2, "0");
      setTime(`${h}:${m}:${s}`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);
  return time;
}

// ── Market open hook (IST time + weekday + NSE holidays) ────────

function useMarketOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = async () => {
      const ist = new Date(Date.now() + (5 * 60 + 30) * 60_000);
      const dow = ist.getUTCDay();
      if (dow === 0 || dow === 6) { setOpen(false); return; }
      const m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      if (m < 555 || m > 930) { setOpen(false); return; }
      const today = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
      const { data } = await supabase.from("nse_holidays").select("date").eq("date", today).limit(1);
      setOpen((data?.length ?? 0) === 0);
    };
    check();
    const iv = setInterval(check, 60_000);
    return () => clearInterval(iv);
  }, []);
  return open;
}

// ── TopBar ─────────────────────────────────────────────────────

const INDEX_LABELS: Record<string, string> = {
  NIFTY:     "NIFTY",
  BANKNIFTY: "BANK NIFTY",
  SENSEX:    "SENSEX",
  VIX:       "INDIA VIX",
};

function TopBar() {
  const istTime = useISTTime();
  const isOpen  = useMarketOpen();
  const [indices, setIndices] = useState<Record<string, IndexQuote>>({});

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch(`${BACKEND}/api/indices`)
        .then(r => r.json())
        .then(d => {
          console.log("[indices] response:", d);
          if (!cancelled) setIndices(d as Record<string, IndexQuote>);
        })
        .catch(err => console.error("[indices] fetch error:", err));
    };
    poll();
    const iv = setInterval(poll, 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

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
        <span
          className={isOpen ? "pulse" : ""}
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isOpen ? "#22c55e" : "#ef4444",
            boxShadow: isOpen ? "0 0 8px #22c55e88" : "none",
            flexShrink: 0,
          }}
        />
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: isOpen ? "#22c55e" : "#ef4444",
          letterSpacing: "0.1em",
          whiteSpace: "nowrap",
        }}>
          {isOpen ? "MARKET OPEN" : "MARKET CLOSED"}
        </span>
      </div>

      {/* Index prices */}
      <div className="top-bar-indices" style={{ display: "flex", gap: 28, flexWrap: "wrap", justifyContent: "center", flex: 1 }}>
        {(["NIFTY", "BANKNIFTY", "SENSEX"] as const).map(idx => {
          const q      = indices[idx];
          const ltp    = q?.ltp ?? 0;
          const change = q?.change ?? 0;
          const pct    = q?.changePct ?? 0;
          const color  = change > 0 ? "#22c55e" : change < 0 ? "#f87171" : "#6b7280";
          return (
            <div key={idx} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", marginBottom: 2, fontWeight: 600 }}>
                {INDEX_LABELS[idx]}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#ffffff", fontFamily: "monospace", lineHeight: 1 }}>
                {ltp > 0 ? ltp.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
              </div>
              <div style={{ fontSize: 12, color, fontFamily: "monospace", marginTop: 2 }}>
                {ltp > 0
                  ? `${change >= 0 ? "+" : ""}${change.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`
                  : "—"}
              </div>
            </div>
          );
        })}
        {/* VIX — level-colored, no change display */}
        {(() => {
          const vix = indices["VIX"]?.ltp ?? 0;
          const vixColor = vix === 0 ? "#6b7280" : vix < 13 ? "#22c55e" : vix < 17 ? "#f5d547" : "#f87171";
          return (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", marginBottom: 2, fontWeight: 600 }}>
                INDIA VIX
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: vixColor, fontFamily: "monospace", lineHeight: 1 }}>
                {vix > 0 ? vix.toFixed(2) : "—"}
              </div>
              <div style={{ fontSize: 10, color: vix === 0 ? "#374151" : vixColor, marginTop: 2, letterSpacing: "0.06em" }}>
                {vix === 0 ? "" : vix < 13 ? "LOW" : vix < 17 ? "MODERATE" : "HIGH"}
              </div>
            </div>
          );
        })()}
      </div>

      {/* IST Clock */}
      <div style={{ textAlign: "right", minWidth: 100 }}>
        <div style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.1em", marginBottom: 2, fontWeight: 600 }}>
          IST TIME
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#ffffff", fontFamily: "monospace" }}>
          {istTime}
        </div>
      </div>
    </div>
  );
}

// ── Capital Summary Bar ─────────────────────────────────────────

function CapitalSummaryBar({ capitals, openPositions, positions }: { capitals: Capital[]; openPositions: Position[]; positions: Position[] }) {
  const STARTING = useMemo(() =>
    capitals.reduce((sum, c) => sum + (c.allocated_capital ?? 100_000), 0),
    [capitals]
  );

  const totalCurrent = useMemo(() => {
    return capitals.reduce((sum, cap) => {
      const openPnl = openPositions
        .filter(p => p.strategy_id === cap.strategy_id)
        .reduce((s, p) => s + (p.pnl ?? 0), 0);
      return sum + cap.allocated_capital + (cap.total_pnl ?? 0) + openPnl;
    }, 0);
  }, [capitals, openPositions]);

  const { daysPnl, daysReturn, avgPnlToday } = useMemo(() => {
    const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const todayClosed = positions.filter(p => p.status === "CLOSED" && p.closed_at?.startsWith(todayIST));
    const todayClosedPnl = todayClosed.reduce((s, p) => s + (p.pnl ?? 0), 0);
    const liveOpenPnl = openPositions.reduce((s, p) => s + (p.pnl ?? 0), 0);
    const daysPnl = todayClosedPnl + liveOpenPnl;
    const avgPnlToday = todayClosed.length > 0 ? todayClosedPnl / todayClosed.length : null;
    return { daysPnl, daysReturn: STARTING > 0 ? (daysPnl / STARTING) * 100 : 0, avgPnlToday };
  }, [positions, openPositions, STARTING]);

  const totalPnl  = totalCurrent - STARTING;
  const returnPct = STARTING > 0 ? (totalPnl / STARTING) * 100 : 0;
  const pColor    = totalPnl > 0 ? "#4ade80" : totalPnl < 0 ? "#f87171" : "#9ca3af";
  const rColor    = returnPct > 0 ? "#4ade80" : returnPct < 0 ? "#f87171" : "#9ca3af";
  const dpColor   = daysPnl > 0 ? "#4ade80" : daysPnl < 0 ? "#f87171" : "#9ca3af";
  const drColor   = daysReturn > 0 ? "#4ade80" : daysReturn < 0 ? "#f87171" : "#9ca3af";
  const apColor   = avgPnlToday != null ? (avgPnlToday > 0 ? "#4ade80" : avgPnlToday < 0 ? "#f87171" : "#9ca3af") : "#4b5563";

  const stats = [
    { label: "STARTING CAPITAL",    value: `₹${STARTING.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,    color: "#9ca3af" },
    { label: "TOTAL CAPITAL",       value: `₹${totalCurrent.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: "#ffffff" },
    { label: "TOTAL PnL",           value: `${totalPnl >= 0 ? "+" : ""}₹${Math.abs(totalPnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: pColor },
    { label: "TOTAL RETURN",        value: `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2)}%`,                   color: rColor  },
    { label: "DAY'S PnL",           value: `${daysPnl >= 0 ? "+" : ""}₹${Math.abs(daysPnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: dpColor },
    { label: "DAY'S RETURN",        value: `${daysReturn >= 0 ? "+" : ""}${daysReturn.toFixed(2)}%`,                 color: drColor },
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

// ── OpenTradesPanel ─────────────────────────────────────────────

function OpenTradesPanel({
  openPositions,
  strategies,
}: {
  openPositions: Position[];
  strategies: Strategy[];
}) {
  const rows = [...openPositions].sort(
    (a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime()
  );
  const thStyle: React.CSSProperties = {
    padding: "8px 12px", fontSize: 10, fontWeight: 700, color: "#4b5563",
    textAlign: "left" as const, letterSpacing: "0.08em",
    whiteSpace: "nowrap" as const, borderBottom: "1px solid #1a1f2e",
    background: "#070A11",
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "#0B0E17", border: "1px solid #1a1f2e", borderRadius: 12, overflow: "hidden",
    }}>
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
        padding: "10px 16px", borderBottom: "1px solid #1a1f2e",
      }}>
        <span className="pulse" style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#f5d547", boxShadow: "0 0 6px #f5d54788", flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#f5d547", letterSpacing: "0.1em" }}>
          LIVE OPEN TRADES
        </span>
        <span style={{ fontSize: 10, color: "#374151", marginLeft: "auto" }}>
          {openPositions.length} open · 1s refresh
        </span>
      </div>

      {openPositions.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 4 }}>No open trades</div>
            <div style={{ fontSize: 10, color: "#1f2937" }}>Market open: 10:30 AM – 3:00 PM IST</div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                {["Strategy", "Symbol", "Type", "Entry ₹", "Qty", "Entry Time", "Current ₹", "Live PnL", "SL", "Target", "Trail SL"].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(pos => {
                const stratName = strategies.find(s => s.id === pos.strategy_id)?.name ?? pos.strategy_id;
                return (
                  <tr key={pos.id} style={{ borderTop: "1px solid #0f1520" }}>
                    <td style={{ padding: "8px 12px", fontSize: 12, color: ACCENT[pos.strategy_id] ?? "#9ca3af", fontWeight: 600, whiteSpace: "nowrap" }}>{stratName}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "#c9d1d9", whiteSpace: "nowrap" }}>{pos.symbol}</td>
                    <td style={{ padding: "8px 8px", fontSize: 12, fontWeight: 700, color: pos.type === "CE" ? "#22c55e" : "#ef4444" }}>{pos.type}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace", color: "#6b7280" }}>₹{pos.entry_price.toFixed(2)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace", color: "#9ca3af" }}>{pos.quantity}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "#4b5563" }}>{fmtTime(pos.opened_at)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace", color: "#f5d547", fontWeight: 600 }}>₹{(pos.current_price ?? 0).toFixed(2)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: pnlColor(pos.pnl ?? 0) }}>{pnlStr(pos.pnl ?? 0)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, fontFamily: "monospace", color: "#ef4444" }}>
                      {pos.stop_loss ? `₹${pos.stop_loss.toFixed(1)}` : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 11, fontFamily: "monospace", color: "#22c55e" }}>
                      {(() => {
                        const TGT: Record<string, number> = {
                          ema_crossover: 0.30, orion: 0.45, ema_confluence: 0.30,
                          supertrend: 0.40, pcr_reversal: 0.375, gap_orb: 0.40, vwap_scalper: 0.30,
                        };
                        let tgtPct = TGT[pos.strategy_id] ?? 0.30;
                        if (pos.strategy_id === "vwap_scalper" && pos.stop_loss) {
                          const slPct = (pos.entry_price - pos.stop_loss) / pos.entry_price;
                          if (slPct > 0) tgtPct = slPct * 1.5;
                        }
                        const tgtPrice = Math.ceil(pos.entry_price * (1 + tgtPct) * 10) / 10;
                        const pctLabel = tgtPct * 100 % 1 === 0 ? `+${(tgtPct * 100).toFixed(0)}%` : `+${(tgtPct * 100).toFixed(1)}%`;
                        return `₹${tgtPrice.toFixed(1)} (${pctLabel})`;
                      })()}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 11, fontFamily: "monospace", color: pos.trail_sl ? "#f5d547" : "#374151" }}>
                      {pos.trail_sl
                        ? `₹${pos.trail_sl.toFixed(1)}`
                        : (() => {
                            const ACTIVATION: Record<string, number> = {
                              ema_crossover: 0.20, ema_confluence: 0.20,
                              orion: 0.20, supertrend: 0.35,
                              pcr_reversal: 0.35, gap_orb: 0.35, vwap_scalper: 0.25,
                            };
                            const pct = ACTIVATION[pos.strategy_id] ?? 0.35;
                            const price = Math.ceil(pos.entry_price * (1 + pct) * 10) / 10;
                            return `Activates +${(pct * 100).toFixed(0)}% (₹${price.toFixed(1)})`;
                          })()}
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

// ── ClosedTodayPanel ───────────────────────────────────────────

function ClosedTodayPanel({
  positions,
  strategies,
}: {
  positions: Position[];
  strategies: Strategy[];
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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 950 }}>
            <thead>
              <tr>
                {["#", "Strategy", "Symbol", "Type", "Entry ₹", "Exit ₹", "Qty", "Gross PnL", "Charges", "Net PnL", "Exit Reason", "Time Closed"].map(h => (
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
                    <td style={{ padding: "7px 10px", fontSize: 11, color: "#c9d1d9", whiteSpace: "nowrap" }}>{pos.symbol}</td>
                    <td style={{ padding: "7px 8px", fontSize: 12, fontWeight: 700, color: pos.type === "CE" ? "#22c55e" : "#ef4444" }}>{pos.type}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", color: "#6b7280" }}>₹{pos.entry_price.toFixed(2)}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", color: "#9ca3af" }}>₹{(pos.exit_price ?? 0).toFixed(2)}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", color: "#6b7280" }}>{pos.quantity}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", color: "#6b7280" }}>{pnlStr(pos.pnl ?? 0)}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", color: "#4b5563" }}>-₹{(pos.charges ?? 0).toFixed(2)}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: pnlColor((pos.pnl ?? 0) - (pos.charges ?? 0)) }}>{pnlStr((pos.pnl ?? 0) - (pos.charges ?? 0))}</td>
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

// ── LockedCard ─────────────────────────────────────────────────


function LockedCard({ strategy }: { strategy: Strategy }) {
  return (
    <div style={{
      background: "#080B12",
      border: "1px solid #1f2937",
      borderRadius: 12,
      padding: "20px 16px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 90,
      gap: 6,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#4b5563", letterSpacing: "0.1em" }}>
        SLOT {strategy.slot_number}
      </div>
      <div style={{ fontSize: 11, color: "#374151" }}>COMING SOON</div>
    </div>
  );
}

// ── StrategyCard (compact, clickable) ──────────────────────────

function StrategyCard({
  strategy,
  capital,
  liveCapital,
  positions,
  onClick,
}: {
  strategy: Strategy;
  capital: Capital | undefined;
  liveCapital: number;
  positions: Position[];
  onClick: () => void;
}) {
  const accent    = ACCENT[strategy.id] ?? "#6b7280";
  const allocated = capital?.allocated_capital ?? 100000;
  const livePnl   = liveCapital - allocated;
  const retPct    = (livePnl / allocated) * 100;
  const sharpe    = capital?.sharpe_ratio ?? 0;
  const life      = capital?.lifetime_trades ?? 0;

  // All today KPIs computed client-side from positions — avoids dependency on
  // capital.today_trades which is in-memory on the server and resets on restart.
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const todayAll = positions.filter(p =>
    p.strategy_id === strategy.id &&
    new Date(p.opened_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === todayIST
  ).length;
  const todayClosed = positions.filter(p =>
    p.strategy_id === strategy.id &&
    p.status === "CLOSED" &&
    new Date(p.opened_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === todayIST
  );
  const todayPnl    = todayClosed.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const todayCount  = todayClosed.length;
  const avgPnlToday = todayCount > 0 ? todayPnl / todayCount : null;
  const lifetimePnl = capital?.total_pnl ?? 0;
  const avgPnlLife  = life > 0 ? lifetimePnl / life : null;
  const openCount   = positions.filter(p => p.strategy_id === strategy.id && p.status === "OPEN").length;
  const winRateStr  = life > 0 ? `${((capital?.win_rate ?? 0) * 100).toFixed(0)}%` : "—";

  const [metrics, setMetrics] = useState<CardMetrics | null>(null);
  useEffect(() => {
    const fetchMetrics = () => {
      fetch(`${BACKEND}/api/strategy-metrics?strategy=${strategy.id}`)
        .then(r => r.json())
        .then(d => setMetrics({ profit_factor: d.profit_factor ?? "N/A", max_drawdown_inr: d.max_drawdown_inr ?? 0 }))
        .catch(() => {});
    };
    fetchMetrics();
    const iv = setInterval(fetchMetrics, 60_000);
    return () => clearInterval(iv);
  }, [strategy.id]);

  const pfVal = metrics?.profit_factor ?? "N/A";
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
          <div style={{ fontSize: 10, color: "#4b5563", letterSpacing: "0.06em", marginTop: 3, whiteSpace: "nowrap" }}>
            VIEW →
          </div>
        </div>
      </div>

      {/* Stats grid — row 1: Capital/PnL/Return, row 2: Sharpe/Today/Lifetime */}
      <div className="grid-stats" style={{ borderTop: `1px solid ${accent}30` }}>
        {[
          { label: "CAPITAL",   value: `₹${fmtINR(liveCapital)}`,                             color: "#ffffff",                                    weight: 600 },
          { label: "TOTAL PnL", value: pnlStr(livePnl),                                       color: pnlColor(livePnl),                               weight: 700 },
          { label: "RETURN",    value: fmtPct(retPct),                                        color: pnlColor(retPct),                                weight: 600 },
          { label: "SHARPE",    value: sharpe.toFixed(2),                                     color: "#ffffff",                                       weight: 600 },
          { label: "WIN RATE",  value: winRateStr,                                            color: "#ffffff",                                       weight: 600 },
          { label: "TODAY",     value: String(todayAll),                                      color: "#ffffff",                                       weight: 600 },
          { label: "LIFETIME",  value: String(life),                                          color: "#ffffff",                                       weight: 600 },
          { label: "OPEN",      value: String(openCount),                                     color: openCount > 0 ? "#f5d547" : "#4b5563",          weight: 600 },
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

      {/* Row 4: Today's PnL | Avg PnL Today | Avg PnL Overall */}
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

// ── TradePopup ─────────────────────────────────────────────────

function TradePopup({
  strategy,
  capital,
  liveCapital,
  positions,
  onClose,
}: {
  strategy: Strategy;
  capital: Capital | undefined;
  liveCapital: number;
  positions: Position[];
  onClose: () => void;
}) {
  const accent    = ACCENT[strategy.id] ?? "#6b7280";
  const rules     = RULES[strategy.id] ?? [];
  const allocated = capital?.allocated_capital ?? 100000;
  const livePnl   = liveCapital - allocated;
  const retPct    = (livePnl / allocated) * 100;
  const sharpe    = capital?.sharpe_ratio ?? 0;
  const today     = capital?.today_trades ?? 0;
  const life      = capital?.lifetime_trades ?? 0;

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
        {/* ── Header ── */}
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

        {/* ── Section A: Strategy Rules (accordion) ── */}
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

        {/* ── Section B: Stats bar ── */}
        <div className="grid-popup-stats" style={{ borderBottom: "1px solid #111827" }}>
          {[
            { label: "CAPITAL",   value: `₹${fmtINR(liveCapital)}`, color: "#e5e7eb" },
            { label: "TOTAL PnL", value: pnlStr(livePnl),            color: pnlColor(livePnl) },
            { label: "RETURN",    value: fmtPct(retPct),             color: pnlColor(retPct) },
            { label: "SHARPE",    value: sharpe.toFixed(2),          color: "#e5e7eb" },
            { label: "TODAY",     value: String(today),               color: "#e5e7eb" },
            { label: "LIFETIME",  value: String(life),                color: "#e5e7eb" },
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

        {/* ── Section C: Trade Log ── */}

        {/* Open trades */}
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
              <span
                className="pulse"
                style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#f5d547", flexShrink: 0 }}
              />
              OPEN TRADES ({openTrades.length}) · live updates every 5s
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: "#070A11" }}>
                    {["Symbol", "Type", "Entry", "Current", "Qty", "Live PnL", "Opened", "Stop Loss", "Trail SL"].map(h => (
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
                          background: expandedTrade === pos.id
                            ? `${accent}08`
                            : "rgba(245,213,71,0.01)",
                          cursor: "pointer",
                        }}
                        onClick={() => toggleTrade(pos.id)}
                      >
                        <td style={{ padding: "7px 10px", fontSize: 11, color: "#c9d1d9", whiteSpace: "nowrap" }}>{pos.symbol}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontWeight: 700, color: pos.type === "CE" ? "#22c55e" : "#ef4444" }}>{pos.type}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>₹{pos.entry_price.toFixed(2)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#f5d547", fontFamily: "monospace", fontWeight: 600 }}>₹{(pos.current_price ?? 0).toFixed(2)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#9ca3af" }}>{pos.quantity}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: pnlColor(pos.pnl ?? 0) }}>{pnlStr(pos.pnl ?? 0)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#4b5563" }}>{fmtTime(pos.opened_at)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#ef4444", fontFamily: "monospace" }}>
                          {pos.stop_loss ? `₹${pos.stop_loss.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", color: pos.trail_sl ? "#f5d547" : "#374151" }}>
                          {pos.trail_sl ? `₹${pos.trail_sl.toFixed(2)}` : "inactive"}
                        </td>
                      </tr>
                      {expandedTrade === pos.id && (
                        <tr style={{ borderTop: "1px solid #0f1520" }}>
                          <td colSpan={9} style={{ padding: "14px 20px", background: "#080B12" }}>
                            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                              <div style={{ flex: 1, minWidth: 220 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 7 }}>WHY THIS TRADE WAS ENTERED</div>
                                <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>{getEntryReason(pos.strategy_id, pos.type)}</div>
                              </div>
                              <div style={{ minWidth: 160 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 7 }}>STOP LOSS</div>
                                <div style={{ fontSize: 12, color: "#ef4444", fontFamily: "monospace" }}>
                                  {pos.stop_loss ? `₹${pos.stop_loss.toFixed(2)}` : "Not set"}
                                </div>
                              </div>
                              <div style={{ minWidth: 200 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 7 }}>TRAILING STOP LOSS</div>
                                <div style={{ fontSize: 12, fontFamily: "monospace", color: pos.trail_sl ? "#f5d547" : "#374151" }}>
                                  {pos.trail_sl ? `Active — ₹${pos.trail_sl.toFixed(2)}` : "Not yet activated"}
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

        {/* Closed trades */}
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
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                <thead>
                  <tr style={{ background: "#070A11" }}>
                    {["Symbol", "Type", "Entry", "Exit", "Qty", "Gross PnL", "Charges", "Net PnL", "Exit Reason", "Opened", "Closed"].map(h => (
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
                        <td style={{ padding: "7px 10px", fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>{pos.symbol}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontWeight: 700, color: pos.type === "CE" ? "#22c55e" : "#ef4444" }}>{pos.type}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>₹{pos.entry_price.toFixed(2)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#4b5563", fontFamily: "monospace" }}>
                          {pos.exit_price != null ? `₹${pos.exit_price.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, color: "#6b7280" }}>{pos.quantity}</td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", color: "#6b7280" }}>
                          {pnlStr(pos.pnl ?? 0)}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", color: "#4b5563" }}>
                          {pos.charges ? `-₹${pos.charges.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: pnlColor((pos.pnl ?? 0) - (pos.charges ?? 0)) }}>
                          {pnlStr((pos.pnl ?? 0) - (pos.charges ?? 0))}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#374151", whiteSpace: "nowrap" }}>
                          {pos.exit_reason?.replace(/_/g, " ") ?? "—"}
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#374151" }}>{fmtTime(pos.opened_at)}</td>
                        <td style={{ padding: "7px 8px", fontSize: 10, color: "#374151" }}>{fmtTime(pos.closed_at)}</td>
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
                                <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>
                                  {pos.exit_reason_detail ?? fallbackExitText(pos)}
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

// ── CorrelationHeatmap ──────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<string, string> = {
  ema_crossover: "EMA ×",
  orion: "ORION",
  ema_confluence: "EMA Conf",
  supertrend: "Supertrend",
  pcr_reversal: "PCR Rev",
  gap_orb: "GAP ORB",
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

function CorrelationHeatmap() {
  const [data, setData] = useState<CorrelationData | null>(null);
  useEffect(() => {
    fetch(`${BACKEND}/api/correlation`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {});
    const iv = setInterval(() => {
      fetch(`${BACKEND}/api/correlation`)
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
        STRATEGY CORRELATION
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
                    {STRATEGY_LABELS[s] ?? s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strats.map((si, i) => (
                <tr key={si}>
                  <td style={{ padding: "4px 8px", color: "#6b7280", fontWeight: 600, fontSize: 10, whiteSpace: "nowrap" }}>
                    {STRATEGY_LABELS[si] ?? si}
                  </td>
                  {strats.map((_sj, j) => {
                    const v = matrix[i]?.[j] ?? null;
                    return (
                      <td key={j} style={{
                        padding: "2px 3px", textAlign: "center", minWidth: 52, height: 32,
                        background: corrColor(v),
                        border: "1px solid rgba(255,255,255,0.04)",
                        borderRadius: 4,
                        color: corrTextColor(v),
                        fontFamily: "monospace",
                        fontSize: 11,
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

// ── CombinedCapitalHistory ──────────────────────────────────────────────────

function CombinedCapitalHistory({ startingCapital }: { startingCapital: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Area"> | null>(null);
  const [livePnl,  setLivePnl]  = useState(0);
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
    fetch(`${BACKEND}/api/capital-history`)
      .then(r => r.json())
      .then((data: CapitalPoint[]) => {
        if (!seriesRef.current || !data?.length) return;
        const BASELINE = startingCapital || 700_000;
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
  }, [startingCapital]);

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

// ── Dashboard Page ─────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [strategies,    setStrategies]    = useState<Strategy[]>([]);
  const [capitals,      setCapitals]      = useState<Capital[]>([]);
  const [positions,     setPositions]     = useState<Position[]>([]);
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [lastUpdate,    setLastUpdate]    = useState<Date | null>(null);
  const [error,         setError]         = useState<string | null>(null);

  // Main 15s refresh
  const refresh = useCallback(async () => {
    const [sRes, cRes, pRes] = await Promise.all([
      supabase.from("strategies").select("*").order("slot_number"),
      supabase.from("strategy_capital").select("*"),
      supabase.from("strategy_positions").select("*").order("opened_at", { ascending: false }).limit(300),
    ]);
    if (sRes.error || cRes.error || pRes.error) {
      setError(sRes.error?.message ?? cRes.error?.message ?? pRes.error?.message ?? "Unknown");
      return;
    }
    setError(null);
    setStrategies((sRes.data ?? []) as Strategy[]);
    setCapitals((cRes.data ?? []) as Capital[]);
    setPositions((pRes.data ?? []) as Position[]);
    setLastUpdate(new Date());
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, [refresh]);

  // 1s open positions poll — keeps live trades panel and capital fresh
  useEffect(() => {
    const fetchOpen = async () => {
      const { data } = await supabase
        .from("strategy_positions")
        .select("*")
        .eq("status", "OPEN");
      if (data) setOpenPositions(data as Position[]);
    };
    fetchOpen();
    const iv = setInterval(fetchOpen, 1_000);
    return () => clearInterval(iv);
  }, []);

  const computeLiveCapital = useCallback((strategyId: string): number => {
    const cap = capitals.find(c => c.strategy_id === strategyId);
    const allocated = cap?.allocated_capital ?? 100000;
    const closedPnl = cap?.total_pnl ?? 0;
    const openPnl   = openPositions
      .filter(p => p.strategy_id === strategyId)
      .reduce((sum, p) => sum + (p.pnl ?? 0), 0);
    return allocated + closedPnl + openPnl;
  }, [capitals, openPositions]);

  const active = strategies.filter(s => s.status !== "placeholder").sort((a, b) => a.slot_number - b.slot_number);
  const locked = strategies.filter(s => s.status === "placeholder").sort((a, b) => a.slot_number - b.slot_number);

  return (
    <div className="page-content" style={{ background: "#0A0D14", minHeight: "100vh" }}>
      <div style={{ padding: "18px 16px 12px" }}>
        {/* Page header */}
        <div style={{ marginBottom: 12, textAlign: "center" }}>
          <div className="breadcrumb" style={{ textAlign: "center" }}>
            AI TRADING ARENA · SEASON 1 · PAPER TRADING
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 700, margin: "6px 0 0", color: "#e5e7eb" }}>
            Indian Strategies Dashboard
          </h1>
          <div style={{ fontSize: 9, color: "#374151", marginTop: 6 }}>
            {lastUpdate
              ? `UPDATED ${lastUpdate.toLocaleTimeString()} · AUTO-REFRESH 15s`
              : "CONNECTING..."}
          </div>
        </div>

        <TopBar />
        <CapitalSummaryBar capitals={capitals} openPositions={openPositions} positions={positions} />

        {/* Live Open Trades panel */}
        <div style={{ height: 360 }}>
          <OpenTradesPanel openPositions={openPositions} strategies={strategies} />
        </div>

        {/* Closed Today panel */}
        <ClosedTodayPanel positions={positions} strategies={strategies} />
      </div>

      {/* Strategy Cards */}
      <div style={{ padding: "12px 16px 32px" }}>
        {error && (
          <div style={{
            marginBottom: 12, padding: "9px 12px",
            background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)",
            color: "#ef4444", fontSize: 11,
          }}>
            Supabase error: {error} —{" "}
            <span style={{ color: "#4b5563" }}>
              Run migration 003_strategy_tables.sql in your Supabase dashboard first.
            </span>
          </div>
        )}

        {active.length > 0 && (
          <div className="grid-eq">
            {active.map(s => (
              <StrategyCard
                key={s.id}
                strategy={s}
                capital={capitals.find(c => c.strategy_id === s.id)}
                liveCapital={computeLiveCapital(s.id)}
                positions={positions}
                onClick={() => router.push('/strategy/' + s.id)}
              />
            ))}
          </div>
        )}

        {locked.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(locked.length, 4)}, 1fr)`,
            gap: 16, marginTop: 16,
          }}>
            {locked.map(s => <LockedCard key={s.id} strategy={s} />)}
          </div>
        )}

        {strategies.length === 0 && !error && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 8 }}>
            <div style={{ fontSize: 12, color: "#374151" }}>Waiting for data...</div>
            <div style={{ fontSize: 10, color: "#1f2937" }}>
              Run supabase/migrations/003_strategy_tables.sql if tables are missing.
            </div>
          </div>
        )}

        {/* Combined Capital History */}
        <CombinedCapitalHistory startingCapital={capitals.reduce((s, c) => s + (c.allocated_capital ?? 100_000), 0)} />

        {/* Correlation Heatmap */}
        <CorrelationHeatmap />
      </div>
    </div>
  );
}
