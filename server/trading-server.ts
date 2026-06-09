// RAILWAY_CACHE_BUST: 2026-06-09
/**
 * AI Trading Arena — Strategy-based Trading Server
 *
 * Rule-based strategy execution for 6 quantitative strategies.
 * BTC trading (Kraken WS + AI bots) unchanged.
 *
 * Start:
 *   npx ts-node --project server/tsconfig.json server/trading-server.ts
 */

import path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import express from "express";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

// ══════════════════════════════════════════════════════════════
// Supabase
// ══════════════════════════════════════════════════════════════

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { realtime: { transport: ws as unknown as typeof WebSocket } }
);

// ══════════════════════════════════════════════════════════════
// BTC bots (unchanged)
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
  open:  number;
  high:  number;
  low:   number;
  close: number;
  time:  number; // ms epoch
}

interface BtcPosition {
  id:        string;
  bot_id:    string;
  entry_price: number;
  quantity:  number;
  pnl:       number;
  charges?:  number;
  leverage?: number;
  direction?: string;
  stop_loss?: number;
  take_profit?: number;
  status:    "OPEN" | "CLOSED";
}

interface BtcCapitalRow {
  allocated_capital: number;
  pnl: number;
}

interface OptionChainRow {
  strike:     number;
  cePremium:  number;
  pePremium:  number;
  ceOI:       number;
  peOI:       number;
}

interface FullOptionChain {
  expiry:     string;
  spotPrice:  number;
  atmStrike:  number;
  rows:       OptionChainRow[];
  pcr:        number; // total PE OI / total CE OI
  timestamp:  number;
}

interface StrategyPosition {
  id:           string;
  strategy_id:  string;
  symbol:       string;
  type:         string;
  side:         string;
  entry_price:  number;
  current_price: number;
  exit_price:   number | null;
  quantity:     number;
  stop_loss:    number | null;
  trail_sl:     number | null;
  pnl:          number;
  status:       string;
  opened_at:    string;
}

// ══════════════════════════════════════════════════════════════
// In-memory market state
// ══════════════════════════════════════════════════════════════

let lastNiftyPrice     = 0;
let lastBankniftyPrice = 0;
let lastSensexPrice    = 0;
let lastVix            = 0;

// BTC (unchanged)
let btcPrice       = 0;
let lastBtcLogTime = 0;

// USD/INR
let cachedUsdToInr   = 84;
let lastUsdInrFetch  = 0;

// ── Multi-interval candle stores ─────────────────────────────
// Key: "NIFTY_30s" | "NIFTY_5m" | "NIFTY_15m" | "BANKNIFTY_5m" | "BANKNIFTY_15m"

interface CandleStore {
  candles: Candle[];
  current: Candle | null;
  bucket:  number;
}

const candleStores: Record<string, CandleStore> = {};
const MAX_CANDLES = 500;

// BTC 1s candle store
const btcCandles: Candle[]    = [];
let btcCurrentCandle: Candle | null = null;
let btcCurrentBucket = 0;

// ── Option chain cache ───────────────────────────────────────
// Key: "NIFTY" | "BANKNIFTY" | "SENSEX"
// Stores last 12 snapshots (1 hour at 5-min polling)
const optionChainHistory: Record<string, FullOptionChain[]> = {};

// Fast lookup: symbol → current LTP
// Key format: "NIFTY 2026-06-12 23400 CE"
const optionPriceCache: Record<string, number> = {};

// Peak premiums for open positions (in-memory, intraday only)
const peakPremiums: Record<string, number> = {}; // posId → peak premium

// ── Daily gap state (Strategy 6) ────────────────────────────
let dailyGapPct  = 0;
let gapCalcDate  = "";
let orbHigh: Record<string, number> = {}; // "NIFTY" → ORB high
let orbLow:  Record<string, number> = {}; // "NIFTY" → ORB low
let orbSet:  Record<string, boolean> = {};
let prevDayClose: Record<string, number> = {}; // "NIFTY" → prev day close

// ── Per-strategy daily trade counters ───────────────────────
const dailyTradeCounts: Record<string, number> = {};
let tradeDateStr = "";

// ══════════════════════════════════════════════════════════════
// Utility: IST time
// ══════════════════════════════════════════════════════════════

function getIST(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function istMins(): number {
  const d = getIST();
  return d.getHours() * 60 + d.getMinutes();
}

function todayIST(): string {
  const d = getIST();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function isMarketOpen(): boolean {
  const d = getIST();
  if (d.getDay() === 0 || d.getDay() === 6) return false;
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= 555 && m <= 930; // 9:15–15:30
}

// Reset daily counters at start of day
function checkDailyReset(): void {
  const today = todayIST();
  if (tradeDateStr !== today) {
    tradeDateStr = today;
    for (const k of Object.keys(dailyTradeCounts)) dailyTradeCounts[k] = 0;
    // Reset ORB state
    for (const k of Object.keys(orbSet)) orbSet[k] = false;
    gapCalcDate = "";
    console.log(`[Daily] Reset for ${today}`);
  }
}

// ══════════════════════════════════════════════════════════════
// Candle builders
// ══════════════════════════════════════════════════════════════

const INTERVALS: Record<string, number> = {
  "30s": 30_000,
  "5m":  5 * 60_000,
  "15m": 15 * 60_000,
};

function processTick(price: number, symbol: string, tsMs: number): void {
  for (const [interval, duration] of Object.entries(INTERVALS)) {
    const key    = `${symbol}_${interval}`;
    const bucket = Math.floor(tsMs / duration) * duration;

    if (!candleStores[key]) {
      candleStores[key] = { candles: [], current: null, bucket: 0 };
    }
    const store = candleStores[key];

    if (!store.current) {
      store.current = { open: price, high: price, low: price, close: price, time: bucket };
      store.bucket  = bucket;
      continue;
    }

    if (bucket !== store.bucket) {
      store.candles.push({ ...store.current });
      if (store.candles.length > MAX_CANDLES) store.candles.shift();
      store.current = { open: price, high: price, low: price, close: price, time: bucket };
      store.bucket  = bucket;
      continue;
    }

    store.current.high  = Math.max(store.current.high, price);
    store.current.low   = Math.min(store.current.low,  price);
    store.current.close = price;
  }
}

function getCandles(symbol: string, interval: string): Candle[] {
  const store = candleStores[`${symbol}_${interval}`];
  if (!store) return [];
  const all = [...store.candles];
  if (store.current) all.push({ ...store.current });
  return all;
}

// BTC 1s candle (unchanged)
function processBtcTick(price: number, timestamp: number): void {
  const CANDLE_DURATION = 1_000;
  const bucket = Math.floor(timestamp / CANDLE_DURATION) * CANDLE_DURATION;
  if (!btcCurrentCandle) {
    btcCurrentCandle = { open: price, high: price, low: price, close: price, time: bucket };
    btcCurrentBucket = bucket;
    return;
  }
  if (bucket !== btcCurrentBucket) {
    btcCandles.push({ ...btcCurrentCandle });
    if (btcCandles.length > MAX_CANDLES) btcCandles.shift();
    btcCurrentCandle = { open: price, high: price, low: price, close: price, time: bucket };
    btcCurrentBucket = bucket;
    return;
  }
  btcCurrentCandle.high  = Math.max(btcCurrentCandle.high, price);
  btcCurrentCandle.low   = Math.min(btcCurrentCandle.low,  price);
  btcCurrentCandle.close = price;
}

// ══════════════════════════════════════════════════════════════
// Indicators
// ══════════════════════════════════════════════════════════════

function emaValues(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const mult = 2 / (period + 1);
  let ema = values[0];
  const result = [ema];
  for (let i = 1; i < values.length; i++) {
    ema = (values[i] - ema) * mult + ema;
    result.push(ema);
  }
  return result;
}

function calcEMA(candles: Candle[], period: number): number {
  if (candles.length < period) return 0;
  const vals = emaValues(candles.map(c => c.close), period);
  return vals[vals.length - 1];
}

function calcRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i-1].close;
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low  - candles[i-1].close)
    ));
  }
  const recent = trs.slice(-period);
  return recent.reduce((s, v) => s + v, 0) / period;
}

function calcVWAP(candles: Candle[]): number {
  // No volume data from LTP; approximate VWAP as average of typical price (H+L+C)/3
  // from 9:15 AM IST
  const dayStart = new Date(getIST());
  dayStart.setHours(9, 15, 0, 0);
  const t = dayStart.getTime() - (new Date().getTime() - Date.now()); // local epoch equivalent
  // Use candle.time directly (it's UTC ms)
  const todayCandles = candles.filter(c => {
    const ist = new Date(new Date(c.time).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    return ist.getHours() * 60 + ist.getMinutes() >= 555;
  });
  if (!todayCandles.length) return candles[candles.length - 1]?.close ?? 0;
  const sum = todayCandles.reduce((s, c) => s + (c.high + c.low + c.close) / 3, 0);
  return sum / todayCandles.length;
}

function calcFibLevels(high: number, low: number): Record<string, number> {
  const r = high - low;
  return {
    "0":    low,
    "23.6": low + r * 0.236,
    "38.2": low + r * 0.382,
    "50":   low + r * 0.5,
    "61.8": low + r * 0.618,
    "78.6": low + r * 0.786,
    "100":  high,
  };
}

// Proper Supertrend with flip detection
function calcSupertrendSeries(
  candles: Candle[],
  period: number,
  multiplier: number
): Array<{ value: number; dir: "up" | "down" }> {
  if (candles.length < period + 1) return [];

  // True Range
  const tr: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low  - candles[i-1].close)
    ));
  }

  // Wilder smoothed ATR
  const atr: number[] = new Array(candles.length).fill(0);
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period;
  }

  // Basic bands
  const basicUpper: number[] = new Array(candles.length).fill(0);
  const basicLower: number[] = new Array(candles.length).fill(0);
  for (let i = period; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    basicUpper[i] = hl2 + multiplier * atr[i];
    basicLower[i] = hl2 - multiplier * atr[i];
  }

  // Adjusted bands
  const finalUpper = [...basicUpper];
  const finalLower = [...basicLower];
  for (let i = period + 1; i < candles.length; i++) {
    finalUpper[i] = (basicUpper[i] < finalUpper[i-1] || candles[i-1].close > finalUpper[i-1])
      ? basicUpper[i] : finalUpper[i-1];
    finalLower[i] = (basicLower[i] > finalLower[i-1] || candles[i-1].close < finalLower[i-1])
      ? basicLower[i] : finalLower[i-1];
  }

  // Supertrend direction
  const result: Array<{ value: number; dir: "up" | "down" }> = new Array(candles.length).fill({ value: 0, dir: "up" as const });
  result[period] = { value: finalUpper[period], dir: "down" };

  for (let i = period + 1; i < candles.length; i++) {
    const prevDir = result[i-1].dir;
    let value: number, dir: "up" | "down";
    if (prevDir === "down") {
      if (candles[i].close > finalUpper[i]) { value = finalLower[i]; dir = "up"; }
      else                                   { value = finalUpper[i]; dir = "down"; }
    } else {
      if (candles[i].close < finalLower[i]) { value = finalUpper[i]; dir = "down"; }
      else                                   { value = finalLower[i]; dir = "up"; }
    }
    result[i] = { value, dir };
  }

  return result.slice(period);
}

// ══════════════════════════════════════════════════════════════
// Upstox API
// ══════════════════════════════════════════════════════════════

const OPTION_KEYS: Record<string, string> = {
  NIFTY:     "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  SENSEX:    "BSE_INDEX|SENSEX",
};

function upstoxToken(): string {
  return process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN || "";
}

async function fetchIndexLTP(): Promise<Partial<Record<"NIFTY" | "BANKNIFTY" | "SENSEX" | "VIX", number>>> {
  const token = upstoxToken();
  if (!token) return {};
  const rawKeys = [
    "NSE_INDEX|Nifty 50",
    "NSE_INDEX|Nifty Bank",
    "BSE_INDEX|SENSEX",
    "NSE_INDEX|India VIX",
  ];
  const keys = rawKeys.map(encodeURIComponent).join(",");
  try {
    const res = await fetch(
      `https://api.upstox.com/v2/market-quote/ltp?instrument_key=${keys}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    if (!res.ok) return {};
    const json = await res.json() as { data?: Record<string, { last_price?: number }> };
    const keyMap: Record<string, "NIFTY" | "BANKNIFTY" | "SENSEX" | "VIX"> = {
      "NSE_INDEX:Nifty 50":    "NIFTY",
      "NSE_INDEX:Nifty Bank":  "BANKNIFTY",
      "BSE_INDEX:SENSEX":      "SENSEX",
      "NSE_INDEX:India VIX":   "VIX",
    };
    const prices: Partial<Record<"NIFTY" | "BANKNIFTY" | "SENSEX" | "VIX", number>> = {};
    for (const [k, v] of Object.entries(json.data ?? {})) {
      const sym = keyMap[k];
      if (sym && v?.last_price) prices[sym] = Number(v.last_price.toFixed(2));
    }
    return prices;
  } catch (err) {
    console.error("[LTP] Fetch error:", err);
    return {};
  }
}

// Expiry helpers
function getDTE(expiryStr: string): number {
  const expiry = new Date(expiryStr); expiry.setHours(0,0,0,0);
  const today  = new Date();          today.setHours(0,0,0,0);
  return Math.max(0, Math.round((expiry.getTime() - today.getTime()) / 86_400_000));
}

function nextWeekday(weekday: number): Date {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(today);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
  return d;
}

async function getWeeklyExpiry(index: string): Promise<string> {
  // NIFTY weekly: Tuesday; SENSEX: Thursday; BANKNIFTY: use nearest Tuesday
  const weekday = index === "SENSEX" ? 4 : 2;
  const d = nextWeekday(weekday);
  return d.toISOString().split("T")[0];
}

async function fetchFullOptionChain(index: string, expiry: string): Promise<FullOptionChain | null> {
  const token = upstoxToken();
  if (!token) return null;
  const instrKey = OPTION_KEYS[index];
  if (!instrKey) return null;
  try {
    const url = new URL("https://api.upstox.com/v2/option/chain");
    url.searchParams.set("instrument_key", instrKey);
    url.searchParams.set("expiry_date", expiry);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      data?: Array<{
        strike_price:       number;
        underlying_spot_price?: number;
        call_options?: { market_data?: { ltp?: number; oi?: number } };
        put_options?:  { market_data?: { ltp?: number; oi?: number } };
      }>;
    };
    const chain = json.data ?? [];
    if (!chain.length) return null;
    const spotPrice = chain[0].underlying_spot_price ?? 0;
    const atmStrike = chain.reduce<number>(
      (nearest, row) =>
        Math.abs(row.strike_price - spotPrice) < Math.abs(nearest - spotPrice)
          ? row.strike_price : nearest,
      chain[0].strike_price
    );

    let totalCE_OI = 0, totalPE_OI = 0;
    const rows: OptionChainRow[] = chain.map(row => {
      const ceOI  = row.call_options?.market_data?.oi  ?? 0;
      const peOI  = row.put_options?.market_data?.oi   ?? 0;
      totalCE_OI += ceOI;
      totalPE_OI += peOI;
      return {
        strike:    row.strike_price,
        cePremium: row.call_options?.market_data?.ltp ?? 0,
        pePremium: row.put_options?.market_data?.ltp  ?? 0,
        ceOI,
        peOI,
      };
    });

    // Update price cache
    const expiryFmt = formatExpiryDDMMM(expiry);
    for (const row of rows) {
      if (row.cePremium > 0)
        optionPriceCache[`${index} ${expiryFmt} ${row.strike} CE`] = row.cePremium;
      if (row.pePremium > 0)
        optionPriceCache[`${index} ${expiryFmt} ${row.strike} PE`] = row.pePremium;
    }

    const pcr = totalCE_OI > 0 ? totalPE_OI / totalCE_OI : 1;
    return { expiry, spotPrice, atmStrike, rows, pcr, timestamp: Date.now() };
  } catch (err) {
    console.error(`[OptionChain:${index}] Error:`, err);
    return null;
  }
}

function formatExpiryDDMMM(dateStr: string): string {
  const d = new Date(dateStr);
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${String(d.getDate()).padStart(2,"0")}${months[d.getMonth()]}`;
}

function getLatestChain(index: string): FullOptionChain | null {
  const hist = optionChainHistory[index];
  if (!hist?.length) return null;
  return hist[hist.length - 1];
}

function getATMOption(
  chain: FullOptionChain,
  type: "CE" | "PE",
  premMin = 60,
  premMax = 70
): { strike: number; premium: number; symbol: string } | null {
  const field = type === "CE" ? "cePremium" : "pePremium";
  const target = (premMin + premMax) / 2;
  const candidates = chain.rows
    .filter(r => r[field] >= premMin && r[field] <= premMax)
    .sort((a, b) => Math.abs(a[field] - target) - Math.abs(b[field] - target));
  if (!candidates.length) return null;
  const best = candidates[0];
  const expiryFmt = formatExpiryDDMMM(chain.expiry);
  return {
    strike:  best.strike,
    premium: best[field],
    symbol:  `NIFTY ${expiryFmt} ${best.strike} ${type}`,
  };
}

function getATMOptionForIndex(
  chain: FullOptionChain,
  index: string,
  type: "CE" | "PE",
  premMin = 60,
  premMax = 70
): { strike: number; premium: number; symbol: string } | null {
  const field = type === "CE" ? "cePremium" : "pePremium";
  const target = (premMin + premMax) / 2;
  const candidates = chain.rows
    .filter(r => r[field] >= premMin && r[field] <= premMax)
    .sort((a, b) => Math.abs(a[field] - target) - Math.abs(b[field] - target));
  if (!candidates.length) return null;
  const best = candidates[0];
  const expiryFmt = formatExpiryDDMMM(chain.expiry);
  return {
    strike:  best.strike,
    premium: best[field],
    symbol:  `${index} ${expiryFmt} ${best.strike} ${type}`,
  };
}

function getCurrentPrice(symbol: string): number {
  return optionPriceCache[symbol] ?? 0;
}

// OI change: compare latest snapshot vs snapshot N minutes ago
function getOIChangeForATM(index: string, type: "CE" | "PE", minutesAgo: number): { current: number; previous: number; pctChange: number } | null {
  const hist = optionChainHistory[index];
  if (!hist || hist.length < 2) return null;
  const latest = hist[hist.length - 1];
  const cutoff = latest.timestamp - minutesAgo * 60_000;
  const old    = hist.find(h => h.timestamp <= cutoff) ?? hist[0];
  const atmStr = latest.atmStrike;
  const latestRow = latest.rows.find(r => r.strike === atmStr);
  const oldRow    = old.rows.find(r => r.strike === atmStr);
  if (!latestRow || !oldRow) return null;
  const current  = type === "CE" ? latestRow.ceOI  : latestRow.peOI;
  const previous = type === "CE" ? oldRow.ceOI     : oldRow.peOI;
  const pctChange = previous > 0 ? ((current - previous) / previous) * 100 : 0;
  return { current, previous, pctChange };
}

// ══════════════════════════════════════════════════════════════
// Option chain poller — every 60 seconds
// ══════════════════════════════════════════════════════════════

async function pollOptionChain(): Promise<void> {
  if (!isMarketOpen()) return;
  const indices = ["NIFTY", "BANKNIFTY", "SENSEX"];
  for (const index of indices) {
    try {
      const expiry = await getWeeklyExpiry(index);
      const chain  = await fetchFullOptionChain(index, expiry);
      if (!chain) continue;
      if (!optionChainHistory[index]) optionChainHistory[index] = [];
      optionChainHistory[index].push(chain);
      if (optionChainHistory[index].length > 12) optionChainHistory[index].shift();
      console.log(`[Chain:${index}] PCR: ${chain.pcr.toFixed(2)} | ATM: ${chain.atmStrike} | VIX: ${lastVix.toFixed(1)}`);
    } catch (err) {
      console.error(`[Chain:${index}] Error:`, err);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Strategy DB helpers
// ══════════════════════════════════════════════════════════════

async function getOpenStrategyPositions(strategyId: string): Promise<StrategyPosition[]> {
  const { data } = await supabase
    .from("strategy_positions")
    .select("*")
    .eq("strategy_id", strategyId)
    .eq("status", "OPEN");
  return (data ?? []) as StrategyPosition[];
}

async function openStrategyPosition(
  strategyId: string,
  pos: Omit<StrategyPosition, "id" | "opened_at" | "exit_price" | "strategy_id">
): Promise<void> {
  const { error } = await supabase.from("strategy_positions").insert({
    strategy_id:   strategyId,
    symbol:        pos.symbol,
    type:          pos.type,
    side:          pos.side ?? "LONG",
    entry_price:   pos.entry_price,
    current_price: pos.entry_price,
    exit_price:    null,
    quantity:      pos.quantity,
    stop_loss:     pos.stop_loss,
    trail_sl:      null,
    pnl:           0,
    status:        "OPEN",
    opened_at:     new Date().toISOString(),
  });
  if (error) {
    console.error(`[DB] openStrategyPosition(${strategyId}) error:`, error.message);
  } else {
    dailyTradeCounts[strategyId] = (dailyTradeCounts[strategyId] ?? 0) + 1;
    console.log(`[${strategyId}] OPENED ${pos.type} ${pos.symbol} @ ₹${pos.entry_price} | SL: ₹${pos.stop_loss}`);
  }
}

async function closeStrategyPosition(
  posId: string,
  exitPrice: number,
  reason: string
): Promise<void> {
  const { data: pos } = await supabase
    .from("strategy_positions")
    .select("entry_price, quantity, strategy_id, symbol")
    .eq("id", posId)
    .single();
  if (!pos) return;

  const p = pos as { entry_price: number; quantity: number; strategy_id: string; symbol: string };
  const pnl = (exitPrice - p.entry_price) * p.quantity;

  const { error } = await supabase.from("strategy_positions").update({
    status:     "CLOSED",
    exit_price: exitPrice,
    current_price: exitPrice,
    pnl:        Number(pnl.toFixed(2)),
    closed_at:  new Date().toISOString(),
    exit_reason: reason,
  }).eq("id", posId);

  if (error) {
    console.error(`[DB] closeStrategyPosition(${posId}) error:`, error.message);
  } else {
    console.log(`[${p.strategy_id}] CLOSED ${p.symbol} @ ₹${exitPrice} | PnL: ${pnl >= 0 ? "+" : ""}₹${pnl.toFixed(2)} | ${reason}`);
    delete peakPremiums[posId];
    await updateStrategyCapital(p.strategy_id);
  }
}

async function updateStrategyCapital(strategyId: string): Promise<void> {
  const { data } = await supabase
    .from("strategy_positions")
    .select("pnl, status")
    .eq("strategy_id", strategyId);

  const positions = (data ?? []) as Array<{ pnl: number; status: string }>;
  const closed    = positions.filter(p => p.status === "CLOSED");
  const totalPnl  = closed.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const wins      = closed.filter(p => (p.pnl ?? 0) > 0).length;
  const winRate   = closed.length > 0 ? wins / closed.length : 0;
  const currentVal = 100000 + totalPnl;

  // Simple Sharpe: (return / std) using daily trade PnLs
  let sharpe = 0;
  if (closed.length >= 2) {
    const pnls  = closed.map(p => p.pnl ?? 0);
    const mean  = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    const std   = Math.sqrt(pnls.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / pnls.length);
    sharpe = std > 0 ? mean / std : 0;
  }

  await supabase.from("strategy_capital").update({
    total_pnl:       Number(totalPnl.toFixed(2)),
    current_value:   Number(currentVal.toFixed(2)),
    peak_capital:    Number(Math.max(currentVal, 100000).toFixed(2)),
    win_rate:        Number(winRate.toFixed(4)),
    sharpe_ratio:    Number(sharpe.toFixed(4)),
    today_trades:    dailyTradeCounts[strategyId] ?? 0,
    lifetime_trades: closed.length,
    updated_at:      new Date().toISOString(),
  }).eq("strategy_id", strategyId);
}

// ══════════════════════════════════════════════════════════════
// Position Monitor — runs every 30s
// ══════════════════════════════════════════════════════════════

async function monitorOpenPositions(): Promise<void> {
  if (!isMarketOpen()) return;

  const { data } = await supabase
    .from("strategy_positions")
    .select("*")
    .eq("status", "OPEN");
  if (!data?.length) return;

  const HARD_CLOSE_MINS: Record<string, number> = {
    ema_crossover:  900,  // 15:00
    orion:          840,  // 14:00
    ema_confluence: 900,
    supertrend:     900,
    pcr_reversal:   900,
    gap_orb:        900,
  };

  const currentMins = istMins();

  for (const raw of data) {
    const pos = raw as StrategyPosition;
    const currentPrice = getCurrentPrice(pos.symbol);
    if (!currentPrice || currentPrice <= 0) continue;

    // Track peak
    if (!peakPremiums[pos.id] || currentPrice > peakPremiums[pos.id]) {
      peakPremiums[pos.id] = currentPrice;
    }
    const peak = peakPremiums[pos.id];

    const pnl = (currentPrice - pos.entry_price) * pos.quantity;

    // Update current price + pnl in DB (best effort, fire-and-forget)
    void supabase.from("strategy_positions").update({
      current_price: Number(currentPrice.toFixed(2)),
      pnl:           Number(pnl.toFixed(2)),
    }).eq("id", pos.id);

    // ── Hard close ──
    const hc = HARD_CLOSE_MINS[pos.strategy_id];
    if (hc && currentMins >= hc) {
      await closeStrategyPosition(pos.id, currentPrice, "HARD_CLOSE");
      continue;
    }

    // ── Trail SL activation ──
    // Strategy 1 & 3: 1.5×ATR move in direction → trail at 10% below peak
    // Strategy 2: up 35% → trail at 15% below peak
    // Strategy 4: up 40% → trail at 12% below peak
    // Strategy 5: up 30% → trail at 12% below peak
    // Strategy 6 (breakout): up 35% → trail at 12% below peak
    const pnlPct = (currentPrice - pos.entry_price) / pos.entry_price;

    let trailActivationPct = 0.35;
    let trailPct           = 0.12;
    if (pos.strategy_id === "ema_crossover" || pos.strategy_id === "ema_confluence") {
      trailActivationPct = 0.20; // approximate 1.5×ATR as 20% move
      trailPct           = 0.10;
    } else if (pos.strategy_id === "orion") {
      trailActivationPct = 0.35;
      trailPct           = 0.15;
    }

    if (pnlPct >= trailActivationPct) {
      const newTrail = peak * (1 - trailPct);
      if (!pos.trail_sl || newTrail > pos.trail_sl) {
        await supabase.from("strategy_positions").update({ trail_sl: Number(newTrail.toFixed(2)) }).eq("id", pos.id);
        pos.trail_sl = newTrail; // update local copy
      }
    }

    // ── SL hit ──
    if (pos.stop_loss && currentPrice <= pos.stop_loss) {
      await closeStrategyPosition(pos.id, currentPrice, "SL_HIT");
      continue;
    }

    // ── Trail SL hit ──
    if (pos.trail_sl && currentPrice <= pos.trail_sl) {
      await closeStrategyPosition(pos.id, currentPrice, "TRAIL_SL");
      continue;
    }

    // ── Strategy 2 Orion breakeven: up 20% → move SL to breakeven ──
    if (pos.strategy_id === "orion" && pnlPct >= 0.20 && pos.stop_loss && pos.stop_loss < pos.entry_price) {
      await supabase.from("strategy_positions").update({ stop_loss: pos.entry_price }).eq("id", pos.id);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Strategy 1 — EMA Crossover (30s candles, starts 10:30 AM)
// ══════════════════════════════════════════════════════════════

let s1PrevFast = 0;
let s1PrevSlow = 0;

async function runStrategy1(): Promise<void> {
  if (!isMarketOpen()) return;
  const mins = istMins();
  if (mins < 630 || mins >= 900) return; // 10:30–15:00

  const candles = getCandles("NIFTY", "30s");
  if (candles.length < 66) return;

  const closes   = candles.map(c => c.close);
  const fastArr  = emaValues(closes, 16);
  const slowArr  = emaValues(closes, 64);
  const fastCurr = fastArr[fastArr.length - 1];
  const slowCurr = slowArr[slowArr.length - 1];
  const fastPrev = s1PrevFast || fastArr[fastArr.length - 2];
  const slowPrev = s1PrevSlow || slowArr[slowArr.length - 2];

  const bullCross = fastPrev <= slowPrev && fastCurr > slowCurr;
  const bearCross = fastPrev >= slowPrev && fastCurr < slowCurr;

  s1PrevFast = fastCurr;
  s1PrevSlow = slowCurr;

  if (!bullCross && !bearCross) return;

  const optType   = bullCross ? "CE" : "PE";
  const openPos   = await getOpenStrategyPositions("ema_crossover");

  // If opposite type open → close it first (FLIP)
  for (const pos of openPos) {
    if (pos.type !== optType) {
      const cp = getCurrentPrice(pos.symbol);
      if (cp > 0) await closeStrategyPosition(pos.id, cp, "CROSSOVER");
    } else {
      return; // already in same direction trade
    }
  }

  const chain = getLatestChain("NIFTY");
  if (!chain) return;

  const option = getATMOption(chain, optType, 60, 70);
  if (!option) { console.log(`[S1] No ATM ${optType} in ₹60-70 range`); return; }

  const atr = calcATR(candles, 14);
  // Use Fibonacci confluence check (50–61.8% zone)
  const recentHighs = candles.slice(-100).map(c => c.high);
  const recentLows  = candles.slice(-100).map(c => c.low);
  const fibH = Math.max(...recentHighs);
  const fibL = Math.min(...recentLows);
  const fib  = calcFibLevels(fibH, fibL);
  const price = lastNiftyPrice;
  const nearFib = price >= fib["50"] * 0.998 && price <= fib["61.8"] * 1.002;
  if (!nearFib && Math.abs(price - fib["50"]) / fib["50"] > 0.003) {
    // Confluence not met but still trade — fib is advisory for this strategy
  }

  await openStrategyPosition("ema_crossover", {
    symbol:       option.symbol,
    type:         optType,
    side:         "LONG",
    entry_price:  option.premium,
    current_price: option.premium,
    quantity:     50,
    stop_loss:    Number((option.premium * 0.85).toFixed(2)),
    trail_sl:     null,
    pnl:          0,
    status:       "OPEN",
  });
  void atr; // used for trailing SL monitoring
}

// ══════════════════════════════════════════════════════════════
// Strategy 2 — Orion (ORB + VWAP + OI, 9:30–14:00)
// ══════════════════════════════════════════════════════════════

// Max 1 trade per instrument simultaneously
const orionOpenInstruments = new Set<string>();

async function runStrategy2(): Promise<void> {
  if (!isMarketOpen()) return;
  const mins = istMins();
  if (mins < 570 || mins >= 840) return; // 9:30–14:00

  // VIX filter
  if (lastVix > 0 && lastVix < 13) {
    console.log(`[S2] VIX ${lastVix} < 13 — skipping trades today`);
    return;
  }

  // ORB setup at 9:30 (after 15-min opening candle)
  const instruments = ["NIFTY", "BANKNIFTY", "SENSEX"];
  for (const index of instruments) {
    await runOrionForIndex(index, mins);
  }
}

async function runOrionForIndex(index: string, mins: number): Promise<void> {
  const candles15m = getCandles(index, "15m");
  if (candles15m.length < 1) return;

  // Set ORB from first completed 15m candle (9:15–9:30 candle)
  if (!orbSet[index] && candles15m.length >= 1) {
    const orbCandle = candles15m[0];
    const orbTime = new Date(orbCandle.time);
    const istH = new Date(orbTime.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    if (istH.getHours() === 9 && istH.getMinutes() === 15) {
      orbHigh[index] = orbCandle.high;
      orbLow[index]  = orbCandle.low;
      orbSet[index]  = true;
      console.log(`[S2:${index}] ORB set — High: ${orbHigh[index]} | Low: ${orbLow[index]}`);
    }
  }
  if (!orbSet[index]) return;

  // Already have an open trade for this instrument
  if (orionOpenInstruments.has(index)) {
    // Check if we need to close it due to Orion's specific exit conditions
    const openPos = await getOpenStrategyPositions("orion");
    const indexPos = openPos.find(p => p.symbol.startsWith(index));
    if (indexPos) {
      // Exit if time is >= 14:00
      if (mins >= 840) {
        const cp = getCurrentPrice(indexPos.symbol);
        if (cp > 0) {
          await closeStrategyPosition(indexPos.id, cp, "HARD_CLOSE");
          orionOpenInstruments.delete(index);
        }
      }
    } else {
      orionOpenInstruments.delete(index);
    }
    return;
  }

  const price = index === "NIFTY" ? lastNiftyPrice : index === "BANKNIFTY" ? lastBankniftyPrice : lastSensexPrice;
  if (!price) return;

  const candles = getCandles(index, "15m");
  const vwap    = calcVWAP(candles);
  const chain   = getLatestChain(index);
  if (!chain) return;

  const orbH = orbHigh[index] ?? 0;
  const orbL = orbLow[index]  ?? 0;

  // Entry: CE
  const ceBreakout  = price > orbH;
  const aboveVwap   = price > vwap;
  const ceOIchange  = getOIChangeForATM(index, "CE", 5);
  const ceOIrising  = ceOIchange ? ceOIchange.pctChange > 0 : true; // bullish OI buildup

  // Entry: PE
  const peBreakout  = price < orbL;
  const belowVwap   = price < vwap;
  const peOIchange  = getOIChangeForATM(index, "PE", 5);
  const peOIrising  = peOIchange ? peOIchange.pctChange > 0 : true;

  let optType: "CE" | "PE" | null = null;
  if (ceBreakout && aboveVwap && ceOIrising)  optType = "CE";
  else if (peBreakout && belowVwap && peOIrising) optType = "PE";
  if (!optType) return;

  const option = getATMOptionForIndex(chain, index, optType, 60, 70);
  if (!option) { console.log(`[S2:${index}] No ATM ${optType} in ₹60-70`); return; }

  await openStrategyPosition("orion", {
    symbol:       option.symbol,
    type:         optType,
    side:         "LONG",
    entry_price:  option.premium,
    current_price: option.premium,
    quantity:     index === "NIFTY" ? 50 : index === "BANKNIFTY" ? 15 : 20,
    stop_loss:    Number((option.premium * 0.70).toFixed(2)), // 30% SL
    trail_sl:     null,
    pnl:          0,
    status:       "OPEN",
  });
  orionOpenInstruments.add(index);
}

// ══════════════════════════════════════════════════════════════
// Strategy 3 — EMA Confluence (30s, 10:30–15:00)
// ══════════════════════════════════════════════════════════════

let s3PrevFast = 0;
let s3PrevSlow = 0;

async function runStrategy3(): Promise<void> {
  if (!isMarketOpen()) return;
  const mins = istMins();
  if (mins < 630 || mins >= 900) return;

  const candles = getCandles("NIFTY", "30s");
  if (candles.length < 66) return;

  const openPos = await getOpenStrategyPositions("ema_confluence");
  if (openPos.length >= 1) return; // max 1 open

  const closes   = candles.map(c => c.close);
  const fastArr  = emaValues(closes, 16);
  const slowArr  = emaValues(closes, 64);
  const fastCurr = fastArr[fastArr.length - 1];
  const slowCurr = slowArr[slowArr.length - 1];
  const fastPrev = s3PrevFast || fastArr[fastArr.length - 2];
  const slowPrev = s3PrevSlow || slowArr[slowArr.length - 2];

  const bullCross = fastPrev <= slowPrev && fastCurr > slowCurr;
  const bearCross = fastPrev >= slowPrev && fastCurr < slowCurr;

  s3PrevFast = fastCurr;
  s3PrevSlow = slowCurr;

  if (!bullCross && !bearCross) return;

  const optType = bullCross ? "CE" : "PE";

  // Filter 1: RSI
  const rsi = calcRSI(candles, 14);
  if (optType === "CE" && rsi >= 45) return;
  if (optType === "PE" && rsi <= 55) return;

  // Filter 2: VWAP
  const vwap = calcVWAP(candles);
  if (optType === "CE" && lastNiftyPrice <= vwap) return;
  if (optType === "PE" && lastNiftyPrice >= vwap) return;

  // Filter 3: Volume proxy — we don't have volume data; treat as passing
  // (Cannot get volume from LTP-only feed)

  // Filter 4: Fibonacci zone
  const recentHighs = candles.slice(-100).map(c => c.high);
  const recentLows  = candles.slice(-100).map(c => c.low);
  const fib  = calcFibLevels(Math.max(...recentHighs), Math.min(...recentLows));
  const price = lastNiftyPrice;
  const inFibZone = price >= fib["50"] * 0.998 && price <= fib["61.8"] * 1.002;
  if (!inFibZone) return;

  const chain = getLatestChain("NIFTY");
  if (!chain) return;

  const option = getATMOption(chain, optType, 60, 70);
  if (!option) return;

  await openStrategyPosition("ema_confluence", {
    symbol:       option.symbol,
    type:         optType,
    side:         "LONG",
    entry_price:  option.premium,
    current_price: option.premium,
    quantity:     50,
    stop_loss:    Number((option.premium * 0.85).toFixed(2)),
    trail_sl:     null,
    pnl:          0,
    status:       "OPEN",
  });
}

// ══════════════════════════════════════════════════════════════
// Strategy 4 — Supertrend (5m candles, 9:45–14:30)
// ══════════════════════════════════════════════════════════════

const s4DailyTrades: Record<string, number> = {};

async function runStrategy4(): Promise<void> {
  if (!isMarketOpen()) return;
  const mins = istMins();
  if (mins < 585 || mins >= 870) return; // 9:45–14:30

  const indices: Array<"NIFTY" | "BANKNIFTY"> = ["NIFTY", "BANKNIFTY"];
  for (const index of indices) {
    await runSupertrendForIndex(index);
  }
}

async function runSupertrendForIndex(index: "NIFTY" | "BANKNIFTY"): Promise<void> {
  const candles5m = getCandles(index, "5m");
  if (candles5m.length < 10) return;

  const openPos = await getOpenStrategyPositions("supertrend");
  const indexPos = openPos.filter(p => p.symbol.startsWith(index));
  const todayKey = `${index}_${todayIST()}`;
  const dayTrades = s4DailyTrades[todayKey] ?? 0;
  if (dayTrades >= 2) return; // max 2 trades per instrument per day

  const series = calcSupertrendSeries(candles5m, 7, 3);
  if (series.length < 2) return;

  const currDir = series[series.length - 1].dir;
  const prevDir = series[series.length - 2].dir;
  const flipped = currDir !== prevDir;

  if (!flipped) {
    // If we have an open position and Supertrend just flipped → close it (handled below too)
    return;
  }

  // Close opposite position
  for (const pos of indexPos) {
    const wrongType = currDir === "up" ? "PE" : "CE";
    if (pos.type === wrongType) {
      const cp = getCurrentPrice(pos.symbol);
      if (cp > 0) await closeStrategyPosition(pos.id, cp, "CROSSOVER");
    }
  }

  if (indexPos.length >= 1) return; // already have one in this direction

  const optType: "CE" | "PE" = currDir === "up" ? "CE" : "PE";
  const chain = getLatestChain(index);
  if (!chain) return;

  const option = getATMOptionForIndex(chain, index, optType, 60, 70);
  if (!option) return;

  await openStrategyPosition("supertrend", {
    symbol:       option.symbol,
    type:         optType,
    side:         "LONG",
    entry_price:  option.premium,
    current_price: option.premium,
    quantity:     index === "NIFTY" ? 50 : 15,
    stop_loss:    Number((option.premium * 0.80).toFixed(2)), // 20% SL
    trail_sl:     null,
    pnl:          0,
    status:       "OPEN",
  });

  s4DailyTrades[todayKey] = dayTrades + 1;
}

// ══════════════════════════════════════════════════════════════
// Strategy 5 — PCR Reversal (5-min checks, 10:00–14:30)
// ══════════════════════════════════════════════════════════════

async function runStrategy5(): Promise<void> {
  if (!isMarketOpen()) return;
  const mins = istMins();
  if (mins < 600 || mins >= 870) return; // 10:00–14:30

  const today = todayIST();
  const dayKey = `pcr_reversal_${today}`;
  if ((dailyTradeCounts[dayKey] ?? 0) >= 3) return;

  const openPos = await getOpenStrategyPositions("pcr_reversal");
  if (openPos.length >= 1) return;

  const chain = getLatestChain("NIFTY");
  if (!chain) return;

  const pcr = chain.pcr;

  let optType: "CE" | "PE" | null = null;

  if (pcr > 1.3) {
    // Oversold — buy CE if PE OI is unwinding at ATM
    const peOIChange = getOIChangeForATM("NIFTY", "PE", 30);
    if (peOIChange && peOIChange.pctChange <= -10) {
      optType = "CE";
    }
  } else if (pcr < 0.7) {
    // Overbought — buy PE if CE OI is unwinding at ATM
    const ceOIChange = getOIChangeForATM("NIFTY", "CE", 30);
    if (ceOIChange && ceOIChange.pctChange <= -10) {
      optType = "PE";
    }
  }

  if (!optType) return;

  const option = getATMOption(chain, optType, 60, 70);
  if (!option) return;

  await openStrategyPosition("pcr_reversal", {
    symbol:       option.symbol,
    type:         optType,
    side:         "LONG",
    entry_price:  option.premium,
    current_price: option.premium,
    quantity:     50,
    stop_loss:    Number((option.premium * 0.75).toFixed(2)), // 25% SL
    trail_sl:     null,
    pnl:          0,
    status:       "OPEN",
  });

  dailyTradeCounts[dayKey] = (dailyTradeCounts[dayKey] ?? 0) + 1;
}

// PCR reversal also monitors for its own exit conditions (PCR neutral / OI reversal)
async function monitorPCRPositions(): Promise<void> {
  if (!isMarketOpen()) return;
  const openPos = await getOpenStrategyPositions("pcr_reversal");
  if (!openPos.length) return;

  const chain = getLatestChain("NIFTY");
  if (!chain) return;

  const pcr = chain.pcr;

  for (const pos of openPos) {
    // PCR back to neutral zone
    if (pcr >= 0.9 && pcr <= 1.1) {
      const cp = getCurrentPrice(pos.symbol);
      if (cp > 0) await closeStrategyPosition(pos.id, cp, "PCR_NEUTRAL");
      continue;
    }
    // OI buildup on opposite side — detect reversal
    const opposite: "CE" | "PE" = pos.type === "CE" ? "PE" : "CE";
    const oiChange = getOIChangeForATM("NIFTY", opposite, 5);
    if (oiChange && oiChange.pctChange > 10) {
      // Opposite side building up → exit
      const cp = getCurrentPrice(pos.symbol);
      if (cp > 0) await closeStrategyPosition(pos.id, cp, "OI_REVERSE");
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Strategy 6 — Gap + ORB (morning only, before 11:30)
// ══════════════════════════════════════════════════════════════

async function runStrategy6(): Promise<void> {
  if (!isMarketOpen()) return;
  const mins = istMins();
  if (mins >= 690) return; // no new trades after 11:30 AM

  const today = todayIST();
  const dayKey = `gap_orb_${today}`;
  if ((dailyTradeCounts[dayKey] ?? 0) >= 2) return;

  const openPos = await getOpenStrategyPositions("gap_orb");
  if (openPos.length >= 1) return;

  // Calculate gap at 9:15 AM
  if (!gapCalcDate || gapCalcDate !== today) {
    // Try to get yesterday's close from candle history
    const allCandles = getCandles("NIFTY", "15m");
    if (allCandles.length < 2) return;
    // Yesterday's close: last candle from previous session
    // Approximate: use the first candle open as today's open
    const todayOpen = allCandles[0]?.open ?? lastNiftyPrice;
    // We don't have yesterday's close from LTP polling alone
    // Use prevDayClose if we have it; otherwise try from the oldest candle
    const pdc = prevDayClose["NIFTY"];
    if (!pdc || pdc === 0) {
      // Not enough data — skip gap calculation
      return;
    }
    dailyGapPct = ((todayOpen - pdc) / pdc) * 100;
    gapCalcDate = today;
    console.log(`[S6] Gap: ${dailyGapPct.toFixed(2)}% | TodayOpen: ${todayOpen} | PrevClose: ${pdc}`);
  }

  // ORB setup (9:15–9:30 AM candle)
  if (!orbSet["NIFTY"]) return;
  const orbH = orbHigh["NIFTY"] ?? 0;
  const orbL = orbLow["NIFTY"]  ?? 0;
  const price = lastNiftyPrice;

  const chain = getLatestChain("NIFTY");
  if (!chain) return;

  let optType: "CE" | "PE" | null = null;

  if (Math.abs(dailyGapPct) < 0.3) {
    // Small gap → ORB breakout
    if (price > orbH)      optType = "CE";
    else if (price < orbL) optType = "PE";
  } else if (dailyGapPct > 0.3) {
    // Gap up > 0.3% → FADE → buy PE (expect gap to fill)
    const pdc = prevDayClose["NIFTY"] ?? 0;
    if (pdc > 0 && price > pdc && price < orbH) optType = "PE";
  } else {
    // Gap down > 0.3% → FADE → buy CE
    const pdc = prevDayClose["NIFTY"] ?? 0;
    if (pdc > 0 && price < pdc && price > orbL) optType = "CE";
  }

  if (!optType) return;

  const option = getATMOption(chain, optType, 60, 70);
  if (!option) return;

  await openStrategyPosition("gap_orb", {
    symbol:       option.symbol,
    type:         optType,
    side:         "LONG",
    entry_price:  option.premium,
    current_price: option.premium,
    quantity:     50,
    stop_loss:    Number((option.premium * 0.80).toFixed(2)), // 20% SL
    trail_sl:     null,
    pnl:          0,
    status:       "OPEN",
  });

  dailyTradeCounts[dayKey] = (dailyTradeCounts[dayKey] ?? 0) + 1;
}

// Gap fill exit for gap trades
async function monitorGapOrbPositions(): Promise<void> {
  if (!isMarketOpen()) return;
  const openPos = await getOpenStrategyPositions("gap_orb");
  if (!openPos.length) return;

  const pdc = prevDayClose["NIFTY"] ?? 0;
  if (!pdc) return;
  const price = lastNiftyPrice;

  for (const pos of openPos) {
    if (Math.abs(dailyGapPct) >= 0.3) {
      // Fade trade — exit at gap fill (price reaches prev day close)
      const isFade_PE = pos.type === "PE" && dailyGapPct > 0;
      const isFade_CE = pos.type === "CE" && dailyGapPct < 0;
      if ((isFade_PE && price <= pdc) || (isFade_CE && price >= pdc)) {
        const cp = getCurrentPrice(pos.symbol);
        if (cp > 0) await closeStrategyPosition(pos.id, cp, "TARGET");
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// LTP poller — every second
// ══════════════════════════════════════════════════════════════

async function pollLTP(): Promise<void> {
  try {
    const prices = await fetchIndexLTP();
    const ts     = Date.now();

    if (prices.NIFTY) {
      lastNiftyPrice = prices.NIFTY;
      processTick(prices.NIFTY, "NIFTY", ts);
      // Update prev day close using earliest recorded price (very rough)
      if (!prevDayClose["NIFTY"] && getCandles("NIFTY", "15m").length > 0) {
        // Do nothing here — it's approximated from candles when available
      }
    }
    if (prices.BANKNIFTY) {
      lastBankniftyPrice = prices.BANKNIFTY;
      processTick(prices.BANKNIFTY, "BANKNIFTY", ts);
    }
    if (prices.SENSEX) {
      lastSensexPrice = prices.SENSEX;
      processTick(prices.SENSEX, "SENSEX", ts);
    }
    if (prices.VIX) lastVix = prices.VIX;

    if (Object.keys(prices).length) {
      console.log(`[LTP] NIFTY: ${prices.NIFTY ?? "--"} | BNF: ${prices.BANKNIFTY ?? "--"} | VIX: ${prices.VIX ?? "--"}`);
    }
  } catch (err) {
    console.error("[LTP] Poll error:", err);
  }
}

// ══════════════════════════════════════════════════════════════
// Main equity strategy loop — every 30s
// ══════════════════════════════════════════════════════════════

let strategyRunning = false;

async function runEquityStrategies(): Promise<void> {
  if (strategyRunning) return;
  strategyRunning = true;
  try {
    checkDailyReset();
    if (!isMarketOpen()) return;
    await Promise.allSettled([
      runStrategy1(),
      runStrategy2(),
      runStrategy3(),
      runStrategy4(),
      runStrategy5(),
      runStrategy6(),
    ]);
    await Promise.allSettled([
      monitorOpenPositions(),
      monitorPCRPositions(),
      monitorGapOrbPositions(),
    ]);
  } catch (err) {
    console.error("[Equity] Strategy loop error:", err);
  } finally {
    strategyRunning = false;
  }
}

// ══════════════════════════════════════════════════════════════
// USD/INR exchange rate
// ══════════════════════════════════════════════════════════════

async function refreshUsdToInr(): Promise<void> {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    if (!res.ok) return;
    const json = await res.json() as { rates?: Record<string, number> };
    const rate  = json.rates?.INR;
    if (rate && rate > 0) {
      cachedUsdToInr  = rate;
      lastUsdInrFetch = Date.now();
      console.log(`[FX] USD/INR: ${rate.toFixed(2)}`);
    }
  } catch {
    console.warn(`[FX] USD/INR fetch failed — using ₹${cachedUsdToInr}`);
  }
}

function getUsdToInr(): number {
  if (Date.now() - lastUsdInrFetch > 3_600_000) refreshUsdToInr().catch(() => {});
  return cachedUsdToInr;
}

// ══════════════════════════════════════════════════════════════
// AI providers (for BTC bots — unchanged)
// ══════════════════════════════════════════════════════════════

async function runAI(provider: string, prompt: string): Promise<string> {
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body:    JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
      });
      const d = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      return d?.choices?.[0]?.message?.content ?? "No response";
    }
    if (provider === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
        body:    JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
      });
      const d = await res.json() as { content?: Array<{ text?: string }> };
      return d?.content?.[0]?.text ?? "No response";
    }
    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
      );
      const d = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response";
    }
    if (provider === "groq") {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body:    JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.7, response_format: { type: "json_object" } }),
      });
      if (!res.ok) return "No response";
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
// BTC prompt builder (unchanged)
// ══════════════════════════════════════════════════════════════

function buildBtcPrompt(params: {
  botName: string;
  botProvider: string;
  btcPrice: number;
  capitalInr: number;
  freeCash: number;
  totalPnl: number;
  openPositions: BtcPosition[];
}): string {
  const { btcPrice, capitalInr, freeCash, totalPnl, openPositions } = params;
  const posStr = openPositions.length === 0
    ? "none"
    : openPositions.map(p =>
        `${p.direction ?? "LONG"} ${p.quantity.toFixed(6)}BTC @ $${p.entry_price} ${p.leverage ?? 1}x leverage (SL:${p.stop_loss} TP:${p.take_profit})`
      ).join(", ");
  return `You are an aggressive BTC/USDT futures trader competing against 3 other AIs for maximum ₹ profit. You have ₹${capitalInr.toFixed(2)} total capital. Free cash: ₹${freeCash.toFixed(2)}. Current BTC price: $${btcPrice.toFixed(2)}. Open positions: ${posStr}. Total PnL so far: ₹${totalPnl.toFixed(2)}.

You can:
- Go LONG (profit if price goes up)
- Go SHORT (profit if price goes down)
- Use leverage from 1x to 100x
- Set your own Stop Loss and Take Profit levels

Rules:
- OPEN opens a new position (LONG or SHORT)
- CLOSE closes ALL your open positions
- HOLD does nothing
- Max 10% of free cash per trade (before leverage)
- Be aggressive, use leverage wisely

Respond ONLY in JSON:
{
  "action": "OPEN"|"CLOSE"|"HOLD",
  "direction": "LONG"|"SHORT",
  "leverage": <number 1-100>,
  "quantity_inr": <INR amount to use as margin>,
  "stop_loss": <price in USD>,
  "take_profit": <price in USD>,
  "reasoning": "<your detailed trade logic>"
}`;
}

// ══════════════════════════════════════════════════════════════
// BTC Supabase helpers (unchanged)
// ══════════════════════════════════════════════════════════════

async function getBtcCapital(botId: string): Promise<BtcCapitalRow> {
  const { data } = await supabase
    .from("btc_capital")
    .select("allocated_capital,pnl")
    .eq("bot_id", botId)
    .single();
  return (data as BtcCapitalRow) ?? { allocated_capital: 100000, pnl: 0 };
}

async function getOpenBtcPositions(botId: string): Promise<BtcPosition[]> {
  const { data } = await supabase
    .from("btc_positions")
    .select("*")
    .eq("bot_id", botId)
    .eq("status", "OPEN");
  return (data ?? []) as BtcPosition[];
}

// ══════════════════════════════════════════════════════════════
// BTC trading cycle — every 15 min, 24/7 (unchanged)
// ══════════════════════════════════════════════════════════════

let btcCycleRunning = false;

async function runBtcTradingCycle(): Promise<void> {
  if (btcCycleRunning) return;
  btcCycleRunning = true;
  try {
    if (btcCandles.length < 60) { console.log(`[BTC Cycle] Waiting for candles (${btcCandles.length}/60)...`); return; }
    if (!btcPrice)               { console.log("[BTC Cycle] No BTC price yet — skipping"); return; }

    for (const bot of BOTS) {
      try {
        console.log(`[BTC:${bot.id}] Starting cycle...`);
        const capital       = await getBtcCapital(bot.id);
        const openPositions = await getOpenBtcPositions(bot.id);
        const deployed      = openPositions.reduce((sum, p) => sum + p.quantity * p.entry_price, 0);
        const freeCash      = capital.allocated_capital - deployed;
        console.log(`[BTC:${bot.id}] capital=₹${capital.allocated_capital} freeCash=₹${freeCash.toFixed(2)} openPos=${openPositions.length}`);

        const prompt      = buildBtcPrompt({ botName: bot.name, botProvider: bot.provider, btcPrice, capitalInr: capital.allocated_capital, freeCash, totalPnl: capital.pnl, openPositions });
        const rawResponse = await runAI(bot.provider, prompt);
        console.log(`[BTC:${bot.id}] ── RAW RESPONSE (${rawResponse.length} chars) ──`);
        console.log(rawResponse);
        console.log(`[BTC:${bot.id}] ── END RAW RESPONSE ──`);

        let action: "OPEN" | "CLOSE" | "HOLD" = "HOLD";
        let quantity_inr = 0, reasoning = "No reasoning";
        let direction: "LONG" | "SHORT" = "LONG";
        let leverage = 1, stop_loss = 0, take_profit = 0;

        try {
          const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
          const cleaned   = jsonMatch ? jsonMatch[0] : rawResponse.replace(/```json/g,"").replace(/```/g,"").trim();
          console.log(`[BTC:${bot.id}] Cleaned JSON: ${cleaned}`);
          const parsed = JSON.parse(cleaned) as { action?: string; direction?: string; leverage?: number; quantity_inr?: number; stop_loss?: number; take_profit?: number; reasoning?: string };
          console.log(`[BTC:${bot.id}] Parsed — action: "${parsed.action}" dir: ${parsed.direction} lev: ${parsed.leverage} qty_inr: ${parsed.quantity_inr}`);
          const rawAct = (parsed.action ?? "HOLD").toString().toUpperCase();
          const actMap: Record<string, "OPEN" | "CLOSE" | "HOLD"> = { OPEN:"OPEN", BUY:"OPEN", CLOSE:"CLOSE", SELL:"CLOSE", HOLD:"HOLD" };
          action       = actMap[rawAct] ?? "HOLD";
          quantity_inr = Math.max(0, Number(parsed.quantity_inr) || 0);
          reasoning    = parsed.reasoning ?? "No reasoning";
          direction    = (parsed.direction ?? "LONG").toString().toUpperCase() === "SHORT" ? "SHORT" : "LONG";
          leverage     = Math.min(100, Math.max(1, Number(parsed.leverage) || 1));
          stop_loss    = Number(parsed.stop_loss)   || 0;
          take_profit  = Number(parsed.take_profit) || 0;
        } catch (parseErr) {
          console.error(`[BTC:${bot.id}] JSON parse FAILED:`, parseErr);
          action = "HOLD";
        }

        console.log(`[BTC:${bot.id}] ── DECISION: ${action} ${direction} × ${leverage}x | qty_inr=₹${quantity_inr} | SL:$${stop_loss} TP:$${take_profit}`);
        console.log(`[BTC:${bot.id}] Reasoning: ${reasoning.slice(0, 200)}`);
        if (action === "HOLD") { console.log(`[BTC:${bot.id}] HOLD — skipping`); continue; }

        // CLOSE
        if (action === "CLOSE") {
          if (!openPositions.length) { console.log(`[BTC:${bot.id}] CLOSE — no open positions`); continue; }
          const usdInr = getUsdToInr();
          let totalRealised = 0;
          for (const pos of openPositions) {
            const lev = pos.leverage ?? 1;
            const dir = pos.direction ?? "LONG";
            const grossPnl     = dir === "SHORT" ? (pos.entry_price - btcPrice) * pos.quantity * lev * usdInr : (btcPrice - pos.entry_price) * pos.quantity * lev * usdInr;
            const sellValue    = btcPrice * pos.quantity * usdInr;
            const closeCharges = Number((sellValue * lev * 0.001 * 1.18 + sellValue * 0.01).toFixed(2));
            const netPnl       = Number((grossPnl - closeCharges - (pos.charges ?? 0)).toFixed(2));
            totalRealised     += netPnl;
            console.log(`[BTC:${bot.id}] ${dir} × ${lev}x grossPnl: ₹${grossPnl.toFixed(2)} | netPnl: ₹${netPnl.toFixed(2)}`);
            const { error } = await supabase.from("btc_positions").update({ status: "CLOSED", current_price: Number(btcPrice.toFixed(2)), pnl: netPnl, closed_at: new Date().toISOString() }).eq("id", pos.id);
            if (error) console.error(`[BTC:${bot.id}] Close failed:`, error.message);
            else console.log(`[BTC:${bot.id}] CLOSED ${dir} @ $${btcPrice.toFixed(2)}  Net PnL: ${netPnl >= 0?"+":""}₹${netPnl.toFixed(2)}`);
          }
          void totalRealised;
          const { data: allClosed } = await supabase.from("btc_positions").select("pnl,charges").eq("bot_id", bot.id).eq("status","CLOSED");
          const allClosedArr = (allClosed ?? []) as Array<{ pnl: number; charges: number }>;
          const totalPnl2    = allClosedArr.reduce((s, p) => s + Number(p.pnl), 0);
          const wins2        = allClosedArr.filter(p => Number(p.pnl) > 0).length;
          const winRate2     = allClosedArr.length > 0 ? wins2 / allClosedArr.length : 0;
          const newCapital   = Number((100000 + totalPnl2).toFixed(2));
          const { error: capErr } = await supabase.from("btc_capital").update({ allocated_capital: newCapital, pnl: Number(totalPnl2.toFixed(2)), win_rate: Number(winRate2.toFixed(4)), updated_at: new Date().toISOString() }).eq("bot_id", bot.id);
          if (capErr) console.error(`[BTC:${bot.id}] btc_capital update failed:`, capErr.message);
          else console.log(`[BTC:${bot.id}] Capital updated to ₹${newCapital.toFixed(2)}`);
          continue;
        }

        // OPEN
        if (action === "OPEN") {
          let spendInr = Math.min(quantity_inr, freeCash * 0.1);
          if (spendInr > freeCash) spendInr = freeCash;
          if (spendInr < 100) { console.warn(`[BTC:${bot.id}] Insufficient cash ₹${freeCash.toFixed(2)} — skipping`); continue; }
          const usdInr      = getUsdToInr();
          const btcPriceInr = btcPrice * usdInr;
          const btcQty      = spendInr / btcPriceInr;
          const openCharges = Number((spendInr * leverage * 0.001 * 1.18).toFixed(2));
          console.log(`[BTC:${bot.id}] OPEN ${direction} × ${leverage}x | ₹${spendInr.toFixed(2)} margin = ${btcQty.toFixed(8)} BTC | charges: ₹${openCharges}`);
          const insertPayload = { bot_id: bot.id, symbol: "BTC/USDT", side: direction === "LONG" ? "BUY" : "SELL", direction, leverage, quantity: Number(btcQty.toFixed(8)), entry_price: Number(btcPrice.toFixed(2)), current_price: Number(btcPrice.toFixed(2)), stop_loss, take_profit, pnl: 0, charges: openCharges, reasoning: reasoning.slice(0, 1000), status: "OPEN", opened_at: new Date().toISOString() };
          console.log(`[BTC:${bot.id}] Inserting btc_positions...`);
          const { error, data: inserted } = await supabase.from("btc_positions").insert(insertPayload).select();
          if (error) console.error(`[BTC:${bot.id}] Insert FAILED — ${error.message}`);
          else console.log(`[BTC:${bot.id}] OPENED ${direction} ${btcQty.toFixed(6)} BTC × ${leverage}x @ $${btcPrice.toFixed(2)} | id: ${(inserted as Array<{id: string}>)?.[0]?.id}`);
        }
      } catch (botErr) {
        console.error(`[BTC:${bot.id}] Error:`, botErr);
      }
    }
    console.log(`[BTC Cycle] Done — $${btcPrice.toFixed(2)} | candles: ${btcCandles.length}`);
  } catch (err) {
    console.error("[BTC Cycle] Fatal:", err);
  } finally {
    btcCycleRunning = false;
  }
}

// ══════════════════════════════════════════════════════════════
// Kraken WebSocket — XBT/USD live price feed (unchanged)
// ══════════════════════════════════════════════════════════════

function connectBinanceWS(): void {
  const socket = new ws("wss://ws.kraken.com");
  socket.on("open", () => {
    console.log("[BTC] Kraken WebSocket connected — subscribing to XBT/USD trades");
    socket.send(JSON.stringify({ event: "subscribe", pair: ["XBT/USD"], subscription: { name: "trade" } }));
  });
  socket.on("message", (data: ws.RawData) => {
    try {
      const msg = JSON.parse(data.toString()) as unknown[];
      if (!Array.isArray(msg) || msg[3] !== "XBT/USD") return;
      const trades = msg[1] as string[][];
      if (!Array.isArray(trades) || !trades[0]) return;
      const price = parseFloat(trades[0][0]);
      if (!price) return;
      btcPrice = price;
      processBtcTick(price, Date.now());
      if (Date.now() - lastBtcLogTime > 5_000) {
        console.log(`[BTC] Price: $${btcPrice.toFixed(2)}`);
        lastBtcLogTime = Date.now();
      }
    } catch (err) {
      console.error("[BTC] WS parse error:", err);
    }
  });
  socket.on("error", (err: Error) => console.error("[BTC] WS error:", err.message));
  socket.on("close", () => { console.warn("[BTC] WS closed — reconnecting in 5s..."); setTimeout(connectBinanceWS, 5_000); });
}

// ══════════════════════════════════════════════════════════════
// Upstox token management (unchanged)
// ══════════════════════════════════════════════════════════════

async function loadTokenFromSupabase(): Promise<void> {
  try {
    const { data, error } = await supabase.from("config").select("value").eq("key","UPSTOX_ACCESS_TOKEN").single();
    if (error || !data?.value) { console.log("[Token] No token in Supabase config"); return; }
    process.env.UPSTOX_ACCESS_TOKEN = (data as { value: string }).value;
    console.log("[Token] Loaded from Supabase config");
  } catch (err) {
    console.error("[Token] Load failed:", err);
  }
}

let lastTokenRequestDate = "";

function scheduleTokenRequest(): void {
  setInterval(() => {
    const ist = getIST();
    if (ist.getDay() === 0 || ist.getDay() === 6) return;
    const hh  = String(ist.getHours()).padStart(2,"0");
    const mm  = String(ist.getMinutes()).padStart(2,"0");
    const today = todayIST();
    if (`${hh}:${mm}` !== "08:30" || lastTokenRequestDate === today) return;
    lastTokenRequestDate = today;
    fetch("https://api.upstox.com/v3/login/auth/token/request/7NAEVR", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ client_secret: process.env.UPSTOX_API_SECRET }),
    })
      .then(() => console.log("[Token] Approval request sent"))
      .catch((err: Error) => console.error("[Token] Request failed:", err));
  }, 60_000);
}

// ══════════════════════════════════════════════════════════════
// Express server
// ══════════════════════════════════════════════════════════════

const app  = express();
app.use(express.json());
const PORT = Number(process.env.PORT ?? process.env.TRADING_SERVER_PORT ?? 8080);

app.get("/ping", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.get("/health", (_req, res) => {
  res.json({
    status:     "running",
    marketOpen: isMarketOpen(),
    prices: {
      nifty:     lastNiftyPrice,
      banknifty: lastBankniftyPrice,
      sensex:    lastSensexPrice,
      vix:       lastVix,
    },
    candles: {
      nifty_30s:  getCandles("NIFTY", "30s").length,
      nifty_5m:   getCandles("NIFTY", "5m").length,
      nifty_15m:  getCandles("NIFTY", "15m").length,
      bnf_5m:     getCandles("BANKNIFTY", "5m").length,
    },
    optionChain: {
      nifty:     getLatestChain("NIFTY")?.pcr?.toFixed(2) ?? "N/A",
      banknifty: getLatestChain("BANKNIFTY")?.pcr?.toFixed(2) ?? "N/A",
    },
    timestamp: new Date().toISOString(),
  });
});

app.get("/candles", (_req, res) => {
  res.json({
    nifty_30s:  getCandles("NIFTY", "30s").slice(-20),
    nifty_5m:   getCandles("NIFTY", "5m").slice(-10),
  });
});

app.get("/btc/status", (_req, res) => {
  res.json({ btcPrice, btcCandles: btcCandles.length, activeBots: BOTS.length });
});

app.post("/api/upstox/token-webhook", async (req, res) => {
  const { access_token, message_type } = req.body as {
    access_token?: string;
    message_type?: string;
  };
  if (message_type !== "access_token" || !access_token) {
    res.json({ received: true });
    return;
  }
  process.env.UPSTOX_ACCESS_TOKEN = access_token;
  const { error } = await supabase.from("config").upsert({ key: "UPSTOX_ACCESS_TOKEN", value: access_token }, { onConflict: "key" });
  if (error) console.error("[Token] Failed to save to Supabase:", error.message);
  console.log("[Token] New Upstox token received and activated");
  res.json({ received: true });
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
console.log(`[Server] Upstox token: ${!!process.env.UPSTOX_ACCESS_TOKEN}`);
if (process.env.UPSTOX_ANALYTICS_TOKEN) {
  console.log("[Token] Analytics Token active (expires 2027)");
} else {
  console.warn("[Token] UPSTOX_ANALYTICS_TOKEN not set — using OAuth token for market data");
}

loadTokenFromSupabase().catch(console.error);
refreshUsdToInr().catch(console.error);
scheduleTokenRequest();

// LTP every second
pollLTP();
setInterval(pollLTP, 1_000);

// Option chain every 60 seconds
pollOptionChain();
setInterval(pollOptionChain, 60_000);

// Equity strategy loop every 30 seconds
runEquityStrategies();
setInterval(runEquityStrategies, 30_000);

// BTC
connectBinanceWS();
runBtcTradingCycle();
setInterval(runBtcTradingCycle, 15 * 60_000);
