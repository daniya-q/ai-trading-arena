/**
 * AI Trading Arena — Standalone Backend Server
 *
 * Runs the AI trading cycle completely independently of the Next.js frontend.
 * All logic is self-contained: no imports from src/.
 *
 * Start:
 *   npx ts-node --project server/tsconfig.json server/trading-server.ts
 */

import path from "path";
import * as dotenv from "dotenv";

// Load .env.local before anything else
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import express from "express";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

// ══════════════════════════════════════════════════════════════
// Supabase admin client
// ══════════════════════════════════════════════════════════════

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { realtime: { transport: ws as unknown as typeof WebSocket } }
);

// ══════════════════════════════════════════════════════════════
// Bots
// ══════════════════════════════════════════════════════════════

const BOTS = [
  { id: "gpt",    name: "GPT Bot",    provider: "openai" },
  { id: "claude", name: "Claude Bot", provider: "claude" },
  { id: "gemini", name: "Gemini Bot", provider: "gemini" },
  { id: "groq",   name: "Groq Bot",   provider: "groq"   },
];

// ══════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
}

interface DbPosition {
  id: string;
  bot_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entry_price: number;
  current_price: number;
  stop_loss: number;
  take_profit: number;
  pnl: number;
  status: "OPEN" | "CLOSED";
}

interface ParsedDecision {
  action: "BUY" | "SELL" | "HOLD" | "CLOSE";
  symbol: string;
  optionType: "CE" | "PE" | null;
  strike: number | null;
  expiry: string | null;
  quantity: number;
  confidence: number;
  reasoning: string;
  strategyStatement: string;
}

interface OptionStrike {
  strike: number;
  cePremium: number;
  pePremium: number;
}

interface OptionSlice {
  expiry: string;
  dte: number;
  atm: number;
  strikes: OptionStrike[];
}

interface AvailableInstruments {
  niftyOptions: OptionSlice[];
  sensexOptions: OptionSlice[];
  bankniftyOptions: OptionSlice[];
  topStocks: Array<{ symbol: string; price: number; change: number }>;
}

// ══════════════════════════════════════════════════════════════
// In-memory candle store (NIFTY 1-min candles)
// ══════════════════════════════════════════════════════════════

const niftyCandles: Candle[] = [];
const MAX_CANDLES = 200;

let currentCandle: Candle | null = null;
let currentBucket = 0;

let lastNiftyPrice = 0;
let lastBankniftyPrice = 0;
let lastSensexPrice = 0;

function processTick(price: number, timestamp: number): void {
  const CANDLE_DURATION = 60_000;
  const bucket = Math.floor(timestamp / CANDLE_DURATION) * CANDLE_DURATION;

  if (!currentCandle) {
    currentCandle = { open: price, high: price, low: price, close: price, time: bucket };
    currentBucket = bucket;
    return;
  }

  if (bucket !== currentBucket) {
    niftyCandles.push({ ...currentCandle });
    if (niftyCandles.length > MAX_CANDLES) niftyCandles.shift();
    console.log(`[Candle] Finalized NIFTY ${new Date(currentCandle.time).toLocaleTimeString()} O:${currentCandle.open} H:${currentCandle.high} L:${currentCandle.low} C:${currentCandle.close} | total: ${niftyCandles.length}`);
    currentCandle = { open: price, high: price, low: price, close: price, time: bucket };
    currentBucket = bucket;
    return;
  }

  currentCandle.high = Math.max(currentCandle.high, price);
  currentCandle.low  = Math.min(currentCandle.low,  price);
  currentCandle.close = price;
}

// ══════════════════════════════════════════════════════════════
// Indicators
// ══════════════════════════════════════════════════════════════

function calcRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

function emaValues(values: number[], period: number): number[] {
  const mult = 2 / (period + 1);
  let ema = values[0];
  const result = [ema];
  for (let i = 1; i < values.length; i++) {
    ema = (values[i] - ema) * mult + ema;
    result.push(ema);
  }
  return result;
}

function calcEMA(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const vals = emaValues(candles.map(c => c.close), period);
  return Number(vals[vals.length - 1].toFixed(2));
}

function calcMACD(candles: Candle[]): { macd: number; signal: number; histogram: number } {
  if (candles.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const closes = candles.map(c => c.close);
  const ema12 = emaValues(closes, 12);
  const ema26 = emaValues(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const sigLine  = emaValues(macdLine, 9);
  const macd   = macdLine[macdLine.length - 1];
  const signal = sigLine[sigLine.length - 1];
  return {
    macd:      Number(macd.toFixed(2)),
    signal:    Number(signal.toFixed(2)),
    histogram: Number((macd - signal).toFixed(2)),
  };
}

function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low  - candles[i - 1].close);
    trs.push(Math.max(hl, hc, lc));
  }
  const recent = trs.slice(-period);
  return Number((recent.reduce((s, v) => s + v, 0) / period).toFixed(2));
}

function calcBollinger(candles: Candle[], period = 20, mult = 2): { upper: number; middle: number; lower: number } {
  if (candles.length < period) return { upper: 0, middle: 0, lower: 0 };
  const closes = candles.slice(-period).map(c => c.close);
  const mean = closes.reduce((s, v) => s + v, 0) / period;
  const variance = closes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period;
  const sd = Math.sqrt(variance);
  return {
    upper:  Number((mean + sd * mult).toFixed(2)),
    middle: Number(mean.toFixed(2)),
    lower:  Number((mean - sd * mult).toFixed(2)),
  };
}

function calcSupertrend(candles: Candle[], period = 10, mult = 3): { trend: string; value: number } {
  if (candles.length < period + 1) return { trend: "NEUTRAL", value: 0 };
  const atr = calcATR(candles, period);
  const latest = candles[candles.length - 1];
  const hl2 = (latest.high + latest.low) / 2;
  const upper = hl2 + mult * atr;
  const lower = hl2 - mult * atr;
  let trend: string, value: number;
  if      (latest.close > upper) { trend = "BULLISH"; value = lower; }
  else if (latest.close < lower) { trend = "BEARISH"; value = upper; }
  else {
    trend = latest.close > hl2 ? "BULLISH" : "BEARISH";
    value = trend === "BULLISH" ? lower : upper;
  }
  return { trend, value: Number(value.toFixed(2)) };
}

function analyzeStructure(candles: Candle[]): {
  trend: string; breakout: boolean; momentum: string;
  support: number; resistance: number; candleSignal: string;
} {
  if (candles.length < 30) return { trend: "NEUTRAL", breakout: false, momentum: "NEUTRAL", support: 0, resistance: 0, candleSignal: "NONE" };
  const recent = candles.slice(-20);
  const highs  = recent.map(c => c.high);
  const lows   = recent.map(c => c.low);
  const closes = recent.map(c => c.close);
  const latest   = recent[recent.length - 1];
  const previous = recent[recent.length - 2];
  const support    = Number(Math.min(...lows).toFixed(2));
  const resistance = Number(Math.max(...highs).toFixed(2));
  const first = closes[0], last = closes[closes.length - 1];
  let trend = "NEUTRAL";
  if (last > first * 1.01) trend = "BULLISH";
  if (last < first * 0.99) trend = "BEARISH";
  const move = Math.abs(latest.close - previous.close);
  let momentum = "WEAK";
  if (move > 80)  momentum = "STRONG";
  if (move > 150) momentum = "EXPLOSIVE";
  const breakout = latest.close > resistance * 0.998 || latest.close < support * 1.002;
  const body  = Math.abs(latest.close - latest.open);
  const range = latest.high - latest.low;
  let candleSignal = "NONE";
  if (latest.close > latest.open && previous.close < previous.open && latest.close > previous.open) candleSignal = "BULLISH_ENGULFING";
  if (latest.close < latest.open && previous.close > previous.open && latest.close < previous.open) candleSignal = "BEARISH_ENGULFING";
  if (range > 0 && body / range > 0.7) candleSignal = latest.close > latest.open ? "BULLISH_IMPULSE" : "BEARISH_IMPULSE";
  return { trend, breakout, momentum, support, resistance, candleSignal };
}

function detectRegime(rsi: number, atr: number, macd: number, signal: number, trend: string): string {
  if (atr > 180 && Math.abs(macd - signal) > 20) return "BREAKOUT";
  if (trend === "BULLISH" && rsi > 55) return "TRENDING_BULLISH";
  if (trend === "BEARISH" && rsi < 45) return "TRENDING_BEARISH";
  if (rsi > 75 || rsi < 25) return "REVERSAL";
  return "RANGING";
}

// ══════════════════════════════════════════════════════════════
// Market hours (IST)
// ══════════════════════════════════════════════════════════════

function isMarketOpen(): boolean {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 555 && mins <= 930; // 9:15–15:30
}

// ══════════════════════════════════════════════════════════════
// Upstox API helpers
// ══════════════════════════════════════════════════════════════

const INDEX_KEY_MAP: Record<string, "NIFTY" | "BANKNIFTY" | "SENSEX"> = {
  "NSE_INDEX:Nifty 50":  "NIFTY",
  "NSE_INDEX:Nifty Bank": "BANKNIFTY",
  "BSE_INDEX:SENSEX":    "SENSEX",
};

async function fetchIndexLTP(): Promise<Partial<Record<"NIFTY" | "BANKNIFTY" | "SENSEX", number>>> {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return {};
  const keys = ["NSE_INDEX|Nifty 50", "NSE_INDEX|Nifty Bank", "BSE_INDEX|SENSEX"]
    .map(encodeURIComponent).join(",");
  try {
    const res = await fetch(
      `https://api.upstox.com/v2/market-quote/ltp?instrument_key=${keys}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    if (!res.ok) { console.warn("[LTP] Index fetch failed:", res.status); return {}; }
    const json = await res.json() as { data?: Record<string, { last_price?: number }> };
    const prices: Partial<Record<"NIFTY" | "BANKNIFTY" | "SENSEX", number>> = {};
    for (const [key, val] of Object.entries(json.data ?? {})) {
      const sym = INDEX_KEY_MAP[key];
      if (sym && val?.last_price) prices[sym] = Number(val.last_price.toFixed(2));
    }
    return prices;
  } catch (err) {
    console.error("[LTP] Index fetch error:", err);
    return {};
  }
}

const STOCK_SYMBOLS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK"];

async function fetchStockLTPs(): Promise<Array<{ symbol: string; price: number; change: number }>> {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return [];
  const keys = STOCK_SYMBOLS.map(s => `NSE_EQ|${s}`).map(encodeURIComponent).join(",");
  try {
    const res = await fetch(
      `https://api.upstox.com/v2/market-quote/ltp?instrument_key=${keys}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    if (!res.ok) return [];
    const json = await res.json() as { data?: Record<string, { last_price?: number; close_price?: number }> };
    return STOCK_SYMBOLS
      .map(sym => {
        const quote = json.data?.[`NSE_EQ:${sym}`];
        const price = Number((quote?.last_price ?? 0).toFixed(2));
        const close = Number((quote?.close_price ?? price).toFixed(2));
        return { symbol: sym, price, change: Number((price - close).toFixed(2)) };
      })
      .filter(s => s.price > 0);
  } catch {
    return [];
  }
}

const OPTION_KEYS: Record<string, string> = {
  NIFTY:     "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  SENSEX:    "BSE_INDEX|SENSEX",
};

function getDTE(expiryStr: string): number {
  const expiry = new Date(expiryStr);
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((expiry.getTime() - today.getTime()) / 86_400_000));
}

async function fetchOptionSlice(instrument: string, expiryStr: string): Promise<OptionSlice | null> {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return null;
  const instrumentKey = OPTION_KEYS[instrument];
  if (!instrumentKey) return null;
  try {
    const url = new URL("https://api.upstox.com/v2/option/chain");
    url.searchParams.set("instrument_key", instrumentKey);
    url.searchParams.set("expiry_date", expiryStr);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      data?: Array<{
        strike_price: number;
        underlying_spot_price?: number;
        call_options?: { market_data?: { ltp?: number } };
        put_options?:  { market_data?: { ltp?: number } };
      }>;
    };
    const chain = json.data ?? [];
    if (!chain.length) return null;
    const spotPrice = chain[0].underlying_spot_price ?? 0;
    const atmStrike = chain.reduce<number>(
      (nearest, row) => Math.abs(row.strike_price - spotPrice) < Math.abs(nearest - spotPrice) ? row.strike_price : nearest,
      chain[0].strike_price
    );
    const sorted = [...chain].sort((a, b) => a.strike_price - b.strike_price);
    const atmIdx = sorted.findIndex(r => r.strike_price === atmStrike);
    const lo = Math.max(0, atmIdx - 5);
    const hi = Math.min(sorted.length - 1, atmIdx + 5);
    const strikes = sorted.slice(lo, hi + 1).map(row => ({
      strike:     row.strike_price,
      cePremium:  row.call_options?.market_data?.ltp ?? 0,
      pePremium:  row.put_options?.market_data?.ltp  ?? 0,
    }));
    return { expiry: expiryStr, dte: getDTE(expiryStr), atm: atmStrike, strikes };
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// Expiry calendar (inlined, Supabase holiday-adjusted)
// ══════════════════════════════════════════════════════════════

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const d = new Date(year, month + 1, 0);
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return d;
}

function nextNWeekdays(weekday: number, count: number): Date[] {
  const results: Date[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(today);
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  while (results.length < count) { results.push(new Date(d)); d.setDate(d.getDate() + 7); }
  return results;
}

function nextNMonthlyExpiries(weekday: number, count: number): Date[] {
  const results: Date[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let y = today.getFullYear(), m = today.getMonth();
  while (results.length < count) {
    const exp = lastWeekdayOfMonth(y, m, weekday);
    if (exp >= today) results.push(exp);
    m++; if (m > 11) { m = 0; y++; }
  }
  return results;
}

async function getHolidaySet(): Promise<Set<string>> {
  const from = new Date().toISOString().split("T")[0];
  const to   = new Date(Date.now() + 180 * 86_400_000).toISOString().split("T")[0];
  const { data } = await supabase.from("nse_holidays").select("date").gte("date", from).lte("date", to);
  return new Set((data ?? []).map((r: { date: string }) => r.date));
}

function shiftToTradingDay(date: Date, holidays: Set<string>): Date {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  while (true) {
    const day = d.getDay();
    const str = d.toISOString().split("T")[0];
    if (day !== 0 && day !== 6 && !holidays.has(str)) return d;
    d.setDate(d.getDate() - 1);
  }
}

async function getUpcomingExpiries(instrument: string): Promise<string[]> {
  const TUESDAY = 2, THURSDAY = 4;
  let raw: Date[];
  if      (instrument === "NIFTY")     raw = nextNWeekdays(TUESDAY, 2);
  else if (instrument === "SENSEX")    raw = nextNWeekdays(THURSDAY, 2);
  else                                 raw = nextNMonthlyExpiries(TUESDAY, 2);
  const holidays = await getHolidaySet().catch(() => new Set<string>());
  return raw.map(d => shiftToTradingDay(d, holidays).toISOString().split("T")[0]);
}

// ══════════════════════════════════════════════════════════════
// Fetch all instruments snapshot
// ══════════════════════════════════════════════════════════════

async function fetchInstruments(): Promise<AvailableInstruments> {
  const [nExp, sExp, bExp] = await Promise.all([
    getUpcomingExpiries("NIFTY").catch(() => [] as string[]),
    getUpcomingExpiries("SENSEX").catch(() => [] as string[]),
    getUpcomingExpiries("BANKNIFTY").catch(() => [] as string[]),
  ]);

  const [n0, n1, s0, s1, b0, b1, stocks] = await Promise.all([
    nExp[0] ? fetchOptionSlice("NIFTY",     nExp[0]) : Promise.resolve(null),
    nExp[1] ? fetchOptionSlice("NIFTY",     nExp[1]) : Promise.resolve(null),
    sExp[0] ? fetchOptionSlice("SENSEX",    sExp[0]) : Promise.resolve(null),
    sExp[1] ? fetchOptionSlice("SENSEX",    sExp[1]) : Promise.resolve(null),
    bExp[0] ? fetchOptionSlice("BANKNIFTY", bExp[0]) : Promise.resolve(null),
    bExp[1] ? fetchOptionSlice("BANKNIFTY", bExp[1]) : Promise.resolve(null),
    fetchStockLTPs(),
  ]);

  return {
    niftyOptions:     [n0, n1].filter((x): x is OptionSlice => x !== null),
    sensexOptions:    [s0, s1].filter((x): x is OptionSlice => x !== null),
    bankniftyOptions: [b0, b1].filter((x): x is OptionSlice => x !== null),
    topStocks: stocks,
  };
}

// ══════════════════════════════════════════════════════════════
// AI providers
// ══════════════════════════════════════════════════════════════

async function runAI(provider: string, prompt: string): Promise<string> {
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
      });
      const d = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      return d?.choices?.[0]?.message?.content ?? "No response";
    }

    if (provider === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
      });
      const d = await res.json() as { content?: Array<{ text?: string }> };
      return d?.content?.[0]?.text ?? "No response";
    }

    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      const d = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response";
    }

    if (provider === "groq") {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model: "llama3-70b-8192", messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
      });
      const d = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      return d?.choices?.[0]?.message?.content ?? "No response";
    }

    return "Unknown provider";
  } catch (err) {
    console.error(`[AI:${provider}] Error:`, err);
    return `Error: ${String(err)}`;
  }
}

// ══════════════════════════════════════════════════════════════
// Parse AI response
// ══════════════════════════════════════════════════════════════

function parseDecision(raw: string): ParsedDecision {
  try {
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed  = JSON.parse(cleaned);
    const rawAction = (parsed.action || parsed.decision || "HOLD").toString().toUpperCase();
    const action = (["BUY", "SELL", "HOLD", "CLOSE"].includes(rawAction)
      ? rawAction : "HOLD") as ParsedDecision["action"];
    const rawOT = parsed.optionType?.toString().toUpperCase();
    const optionType: "CE" | "PE" | null = rawOT === "CE" || rawOT === "PE" ? rawOT : null;
    return {
      action,
      symbol:           parsed.symbol    || "NIFTY",
      optionType,
      strike:           parsed.strike != null ? Number(parsed.strike) : null,
      expiry:           parsed.expiry    || null,
      quantity:         Math.max(1, Number(parsed.quantity)   || 1),
      confidence:       Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
      reasoning:        parsed.reasoning || parsed.reason || "No reasoning provided",
      strategyStatement: parsed.strategyStatement || "No strategy statement",
    };
  } catch {
    return { action: "HOLD", symbol: "NIFTY", optionType: null, strike: null, expiry: null, quantity: 1, confidence: 50, reasoning: "Parse failed", strategyStatement: "Parse error — holding cash" };
  }
}

// ══════════════════════════════════════════════════════════════
// Prompt builder
// ══════════════════════════════════════════════════════════════

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmtPnl(n: number): string {
  return (n >= 0 ? "+" : "") + "₹" + fmt(n);
}

function buildStrikesTable(strikes: OptionStrike[], atm: number): string {
  return strikes.map(s => {
    const tag = s.strike === atm ? " ◀ATM" : "";
    return `      ${String(s.strike).padStart(6)}   CE ₹${fmt(s.cePremium).padStart(8)}   PE ₹${fmt(s.pePremium).padStart(8)}${tag}`;
  }).join("\n");
}

function buildExpirySection(label: string, slices: OptionSlice[]): string {
  if (!slices.length) return `  ${label}: no data`;
  return slices.map(slice =>
    `  ▸ ${label} — Expiry: ${slice.expiry} (DTE: ${slice.dte})  ATM: ${fmt(slice.atm)}\n` +
    `    Strike     CE Premium    PE Premium\n` +
    buildStrikesTable(slice.strikes, slice.atm)
  ).join("\n\n");
}

function buildPrompt(params: {
  botName: string; botProvider: string; rank: number;
  marketRegime: string; higherTimeframeTrend: string; volatility: string;
  rsi: number; ema: number; macd: number; signal: number; atr: number;
  bb: { upper: number; middle: number; lower: number };
  supertrend: { trend: string };
  structure: { trend: string; momentum: string; breakout: boolean; support: number; resistance: number; candleSignal: string };
  niftyPrice: number; bankniftyPrice: number; sensexPrice: number;
  allocatedCapital: number; freeCash: number; todayPnL: number;
  openPositions: DbPosition[]; lessons: string[]; confidenceScore: number;
  instruments: AvailableInstruments | null;
}): string {
  const {
    botName, botProvider, rank,
    marketRegime, higherTimeframeTrend, volatility,
    rsi, ema, macd, signal, atr, bb, supertrend, structure,
    niftyPrice, bankniftyPrice, sensexPrice,
    allocatedCapital, freeCash, todayPnL,
    openPositions, lessons, confidenceScore, instruments,
  } = params;

  const todayDate   = new Date().toISOString().split("T")[0];
  const niftyOpts   = instruments ? buildExpirySection("NIFTY WEEKLY",     instruments.niftyOptions)     : "  (not loaded)";
  const sensexOpts  = instruments ? buildExpirySection("SENSEX WEEKLY",    instruments.sensexOptions)    : "  (not loaded)";
  const bnfOpts     = instruments ? buildExpirySection("BANKNIFTY MONTHLY", instruments.bankniftyOptions) : "  (not loaded)";
  const stocksSec   = instruments?.topStocks?.length
    ? instruments.topStocks.map(s => `  ${s.symbol.padEnd(14)} ₹${fmt(s.price).padStart(10)}   ${fmtPnl(s.change).padStart(10)} today`).join("\n")
    : "  (not loaded — trade index options or spot)";
  const posSec = openPositions.length
    ? openPositions.map((p, i) =>
        `  ${i + 1}. ${p.symbol} | ${p.side} ×${p.quantity}\n` +
        `     Entry: ₹${fmt(p.entry_price)}  |  Now: ₹${fmt(p.current_price)}  |  PnL: ${fmtPnl(p.pnl)}`
      ).join("\n") +
      `\n\n  Deployed: ₹${fmt(openPositions.reduce((s, p) => s + p.entry_price * p.quantity, 0))}`
    : "  No open positions — fully in cash.";
  const memSec = lessons.length
    ? lessons.slice(0, 10).map((l, i) => `  ${i + 1}. ${l.trim()}`).join("\n")
    : "  No lessons recorded yet — this is a fresh start.";

  return `You are ${botName} (${botProvider}), an autonomous AI trader in a live competition.

═══════════════════════════════════════════════════════════
  COMPETITION CONTEXT
═══════════════════════════════════════════════════════════
Four AIs compete for maximum ₹ profit from a ₹1,00,000 starting capital:
  • GPT Bot    (OpenAI)
  • Claude Bot (Anthropic)
  • Gemini Bot (Google)
  • Groq Bot   (Meta/Groq)

You are currently ranked #${rank} of 4.
Today: ${todayDate}
No strategy restrictions — you decide instrument, direction, size, and timing.
You manage your own risk.

═══════════════════════════════════════════════════════════
  MARKET SNAPSHOT
═══════════════════════════════════════════════════════════
NIFTY:     ₹${fmt(niftyPrice)}
BANKNIFTY: ₹${fmt(bankniftyPrice)}
SENSEX:    ₹${fmt(sensexPrice)}

Regime:          ${marketRegime}
HTF Trend:       ${higherTimeframeTrend}
Volatility:      ${volatility}
Supertrend:      ${supertrend.trend}
Market Trend:    ${structure.trend}  |  Momentum: ${structure.momentum}
Breakout:        ${structure.breakout}
Support:         ₹${fmt(structure.support)}
Resistance:      ₹${fmt(structure.resistance)}
Candle Signal:   ${structure.candleSignal}

RSI:     ${rsi.toFixed(2)}   (>70 overbought, <30 oversold)
EMA:     ₹${fmt(ema)}
MACD:    ${macd.toFixed(2)}  /  Signal: ${signal.toFixed(2)}  (histogram: ${(macd - signal).toFixed(2)})
ATR:     ${atr.toFixed(2)}   (daily range proxy)
Bollinger: Upper ₹${fmt(bb.upper)}  |  Mid ₹${fmt(bb.middle)}  |  Lower ₹${fmt(bb.lower)}

═══════════════════════════════════════════════════════════
  AVAILABLE INSTRUMENTS
═══════════════════════════════════════════════════════════

── NIFTY OPTIONS (weekly, expires Tuesday) ─────────────
${niftyOpts}

── SENSEX OPTIONS (weekly, expires Thursday) ───────────
${sensexOpts}

── BANKNIFTY OPTIONS (monthly, last Tuesday) ───────────
${bnfOpts}

── TOP NIFTY 50 STOCKS ─────────────────────────────────
${stocksSec}

═══════════════════════════════════════════════════════════
  YOUR STATE
═══════════════════════════════════════════════════════════
Bot:              ${botName} (${botProvider})
Allocated:        ₹${fmt(allocatedCapital)}
Free cash:        ₹${fmt(freeCash)}
Today's PnL:      ${fmtPnl(todayPnL)}
Open positions:   ${openPositions.length}
Confidence score: ${confidenceScore}/100

═══════════════════════════════════════════════════════════
  OPEN POSITIONS
═══════════════════════════════════════════════════════════
${posSec}

═══════════════════════════════════════════════════════════
  YOUR MEMORY — LAST 10 LESSONS
═══════════════════════════════════════════════════════════
${memSec}

═══════════════════════════════════════════════════════════
  DECISION REQUIRED
═══════════════════════════════════════════════════════════
Analyse all of the above carefully. Learn from your past mistakes.

Respond ONLY in valid JSON — no markdown, no extra text:

{
  "action": "BUY" | "SELL" | "HOLD" | "CLOSE",
  "symbol": "instrument name e.g. NIFTY / SENSEX / BANKNIFTY / RELIANCE",
  "optionType": "CE" | "PE" | null,
  "strike": <number or null>,
  "expiry": "YYYY-MM-DD" | null,
  "quantity": <positive integer>,
  "confidence": <0–100>,
  "reasoning": "your private analysis — not shown publicly, be detailed",
  "strategyStatement": "one sentence describing your current strategy — stored and visible to admin"
}

Rules:
• CLOSE: set symbol to the exact symbol of the position you want to close
• BUY/SELL options: optionType must be CE or PE, strike and expiry are required
• BUY/SELL spot/futures: set optionType null, strike null, expiry null
• quantity: number of units / lots (min 1)
• You have ₹${fmt(freeCash)} free — size accordingly
• Adapt your strategy based on your memory of past mistakes
`;
}

// ══════════════════════════════════════════════════════════════
// Supabase state helpers
// ══════════════════════════════════════════════════════════════

async function getBotCapital(botId: string): Promise<{ allocated_capital: number; pnl: number }> {
  const { data } = await supabase.from("capital").select("allocated_capital,pnl").eq("bot_id", botId).single();
  return (data as { allocated_capital: number; pnl: number }) ?? { allocated_capital: 100000, pnl: 0 };
}

async function getOpenPositions(botId: string): Promise<DbPosition[]> {
  const { data } = await supabase.from("positions").select("*").eq("bot_id", botId).eq("status", "OPEN");
  return (data ?? []) as DbPosition[];
}

async function getLessons(botId: string): Promise<{ lessons: string[]; confidenceScore: number }> {
  const { data } = await supabase
    .from("ai_memory")
    .select("lesson,confidence_score")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (!data?.length) return { lessons: [], confidenceScore: 50 };
  return {
    lessons: (data as Array<{ lesson: string; confidence_score: number }>).map(r => r.lesson),
    confidenceScore: (data[0] as { confidence_score: number }).confidence_score ?? 50,
  };
}

async function getLeaderboardRank(botId: string): Promise<number> {
  const { data } = await supabase.from("capital").select("bot_id,pnl").order("pnl", { ascending: false });
  if (!data?.length) return 4;
  const idx = (data as Array<{ bot_id: string }>).findIndex(r => r.bot_id === botId);
  return idx === -1 ? 4 : idx + 1;
}

async function openPosition(botId: string, decision: ParsedDecision, entryPrice: number, atr: number, symbol: string): Promise<void> {
  const stopLoss   = decision.action === "BUY" ? entryPrice - atr * 1.2 : entryPrice + atr * 1.2;
  const takeProfit = decision.action === "BUY" ? entryPrice + atr * 2   : entryPrice - atr * 2;
  const { error } = await supabase.from("positions").insert({
    bot_id:        botId,
    symbol,
    side:          decision.action,
    quantity:      decision.quantity,
    entry_price:   Number(entryPrice.toFixed(2)),
    current_price: Number(entryPrice.toFixed(2)),
    stop_loss:     Number(stopLoss.toFixed(2)),
    take_profit:   Number(takeProfit.toFixed(2)),
    pnl:           0,
    status:        "OPEN",
  });
  if (error) console.error(`[Position] Insert failed for ${botId}:`, error.message);
  else console.log(`[${botId}] OPENED ${symbol} @₹${entryPrice.toFixed(2)}`);
}

async function closePosition(position: DbPosition, currentPrice: number): Promise<void> {
  const mult = position.side === "BUY" ? 1 : -1;
  const pnl  = mult * (currentPrice - position.entry_price) * position.quantity;
  const { error } = await supabase.from("positions").update({
    status:        "CLOSED",
    current_price: currentPrice,
    pnl:           Number(pnl.toFixed(2)),
    closed_at:     new Date().toISOString(),
  }).eq("id", position.id);
  if (error) console.error(`[Position] Close failed:`, error.message);
  else console.log(`[${position.bot_id}] CLOSED ${position.symbol}  PnL: ${fmtPnl(pnl)}`);
}

async function writeStrategyLog(botId: string, strategy: string): Promise<void> {
  await supabase.from("strategy_log").insert({ bot_id: botId, strategy, trade_outcome: "PENDING", pnl: 0 });
}

// ══════════════════════════════════════════════════════════════
// Main trading cycle
// ══════════════════════════════════════════════════════════════

let cycleRunning = false;

async function runTradingCycle(): Promise<void> {
  if (cycleRunning) return;
  cycleRunning = true;

  try {
    if (niftyCandles.length < 60) {
      console.log(`[Cycle] Waiting for candles (${niftyCandles.length}/60)...`);
      return;
    }

    // ── Indicators ──
    const rsi        = calcRSI(niftyCandles);
    const ema        = calcEMA(niftyCandles);
    const macdData   = calcMACD(niftyCandles);
    const atr        = calcATR(niftyCandles);
    const bb         = calcBollinger(niftyCandles);
    const supertrend = calcSupertrend(niftyCandles);
    const structure  = analyzeStructure(niftyCandles);

    const recent50 = niftyCandles.slice(-50).map(c => c.close);
    const avg50    = recent50.reduce((s, v) => s + v, 0) / recent50.length;
    const last50   = recent50[recent50.length - 1];
    const higherTimeframeTrend = niftyCandles.length >= 50
      ? (last50 > avg50 ? "BULLISH" : last50 < avg50 ? "BEARISH" : "NEUTRAL")
      : "NEUTRAL";

    const marketRegime = detectRegime(rsi, atr, macdData.macd, macdData.signal, supertrend.trend);
    const volatility   = atr > 200 ? "HIGH" : atr > 100 ? "MEDIUM" : "LOW";

    // ── Fetch live option chains + stocks ──
    let instruments: AvailableInstruments | null = null;
    try { instruments = await fetchInstruments(); }
    catch (err) { console.warn("[Instruments] Fetch failed:", String(err)); }

    // ── Per-bot decisions ──
    for (const bot of BOTS) {
      try {
        const capital = await getBotCapital(bot.id);
        if (capital.allocated_capital < 5000) {
          console.log(`[${bot.id}] Eliminated — capital ₹${capital.allocated_capital}`);
          continue;
        }

        const openPositions = await getOpenPositions(bot.id);
        const { lessons, confidenceScore } = await getLessons(bot.id);
        const rank     = await getLeaderboardRank(bot.id);
        const deployed = openPositions.reduce((s, p) => s + p.entry_price * p.quantity, 0);
        const freeCash = capital.allocated_capital - deployed;

        const prompt = buildPrompt({
          botName:   bot.name,
          botProvider: bot.provider,
          rank,
          marketRegime,
          higherTimeframeTrend,
          volatility,
          rsi,
          ema,
          macd:   macdData.macd,
          signal: macdData.signal,
          atr,
          bb,
          supertrend,
          structure,
          niftyPrice:     lastNiftyPrice,
          bankniftyPrice: lastBankniftyPrice,
          sensexPrice:    lastSensexPrice,
          allocatedCapital: capital.allocated_capital,
          freeCash,
          todayPnL: capital.pnl,
          openPositions,
          lessons,
          confidenceScore,
          instruments,
        });

        const rawResponse = await runAI(bot.provider, prompt);
        const decision    = parseDecision(rawResponse);

        console.log(`[${bot.id}] ${decision.action} ${decision.symbol} | confidence: ${decision.confidence} | ${decision.strategyStatement.slice(0, 80)}`);

        // Fire-and-forget strategy log
        writeStrategyLog(bot.id, decision.strategyStatement).catch(() => {});

        if (decision.action === "HOLD") continue;

        // ── CLOSE ──
        if (decision.action === "CLOSE") {
          const toClose = openPositions.find(p => !decision.symbol || p.symbol === decision.symbol);
          if (toClose) {
            const closePrice = lastNiftyPrice || toClose.current_price;
            await closePosition(toClose, closePrice);
          } else {
            console.warn(`[${bot.id}] CLOSE: no match for "${decision.symbol}"`);
          }
          continue;
        }

        // ── BUY / SELL — resolve entry price ──
        let entryPrice = 0;
        let entrySymbol = decision.symbol;

        if (decision.optionType && decision.strike && decision.expiry) {
          const slices =
            decision.symbol === "NIFTY"     ? instruments?.niftyOptions     :
            decision.symbol === "SENSEX"    ? instruments?.sensexOptions    :
            instruments?.bankniftyOptions;
          const slice = slices?.find(s => s.expiry === decision.expiry);
          const row   = slice?.strikes.find(s => s.strike === decision.strike);
          const prem  = row ? (decision.optionType === "CE" ? row.cePremium : row.pePremium) : 0;
          if (!prem) {
            console.warn(`[${bot.id}] No premium for ${decision.symbol} ${decision.optionType} ${decision.strike} — skipping`);
            continue;
          }
          entryPrice  = prem;
          entrySymbol = `${decision.symbol} ${decision.optionType} ${decision.strike} ${decision.expiry}`;
        } else {
          if      (decision.symbol === "NIFTY")     entryPrice = lastNiftyPrice;
          else if (decision.symbol === "BANKNIFTY") entryPrice = lastBankniftyPrice;
          else if (decision.symbol === "SENSEX")    entryPrice = lastSensexPrice;
          else {
            const stock = instruments?.topStocks.find(s => s.symbol === decision.symbol);
            entryPrice = stock?.price ?? 0;
          }
        }

        if (entryPrice <= 0) {
          console.warn(`[${bot.id}] No price for "${entrySymbol}" — skipping`);
          continue;
        }

        await openPosition(bot.id, decision, entryPrice, atr, entrySymbol);

      } catch (botErr) {
        console.error(`[${bot.id}] Error:`, botErr);
      }
    }

    console.log(`[Cycle] Done — NIFTY ₹${lastNiftyPrice} | candles: ${niftyCandles.length}`);

  } catch (err) {
    console.error("[Cycle] Fatal:", err);
  } finally {
    cycleRunning = false;
  }
}

// ══════════════════════════════════════════════════════════════
// LTP poller — every second
// ══════════════════════════════════════════════════════════════

async function pollLTP(): Promise<void> {
  try {
    const prices = await fetchIndexLTP();
    if (prices.NIFTY) {
      lastNiftyPrice = prices.NIFTY;
      if (isMarketOpen()) processTick(prices.NIFTY, Date.now());
    }
    if (prices.BANKNIFTY) lastBankniftyPrice = prices.BANKNIFTY;
    if (prices.SENSEX)    lastSensexPrice    = prices.SENSEX;

    if (Object.keys(prices).length) {
      console.log(`[LTP] NIFTY: ${prices.NIFTY ?? "--"} | BNF: ${prices.BANKNIFTY ?? "--"} | SENSEX: ${prices.SENSEX ?? "--"}`);
    }
  } catch (err) {
    console.error("[LTP] Poll error:", err);
  }
}

// ══════════════════════════════════════════════════════════════
// Express health endpoints
// ══════════════════════════════════════════════════════════════

const app = express();
const PORT = Number(process.env.TRADING_SERVER_PORT ?? 4000);

app.get("/health", (_req, res) => {
  res.json({
    status:     "running",
    marketOpen: isMarketOpen(),
    candles:    niftyCandles.length,
    prices: {
      nifty:     lastNiftyPrice,
      banknifty: lastBankniftyPrice,
      sensex:    lastSensexPrice,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get("/candles", (_req, res) => {
  res.json({ count: niftyCandles.length, candles: niftyCandles.slice(-20) });
});

app.listen(PORT, () => {
  console.log(`\n[Server] AI Trading Arena backend running on http://localhost:${PORT}`);
  console.log(`         Health:  http://localhost:${PORT}/health`);
  console.log(`         Candles: http://localhost:${PORT}/candles\n`);
});

// ══════════════════════════════════════════════════════════════
// Boot
// ══════════════════════════════════════════════════════════════

console.log("[Server] Starting...");
console.log(`[Server] Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`[Server] Upstox token set: ${!!process.env.UPSTOX_ACCESS_TOKEN}`);

// Kick off immediately, then repeat
pollLTP();
setInterval(pollLTP, 1000);

runTradingCycle();
setInterval(runTradingCycle, 15_000);
