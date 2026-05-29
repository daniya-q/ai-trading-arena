"use strict";
// RAILWAY_CACHE_BUST: 2026-05-25
/**
 * AI Trading Arena — Standalone Backend Server
 *
 * Runs the AI trading cycle completely independently of the Next.js frontend.
 * All logic is self-contained: no imports from src/.
 *
 * Start:
 *   npx ts-node --project server/tsconfig.json server/trading-server.ts
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const dotenv = __importStar(require("dotenv"));
// Load .env.local before anything else
dotenv.config({ path: path_1.default.resolve(process.cwd(), ".env.local") });
const express_1 = __importDefault(require("express"));
const supabase_js_1 = require("@supabase/supabase-js");
const ws_1 = __importDefault(require("ws"));
// ══════════════════════════════════════════════════════════════
// Supabase admin client
// ══════════════════════════════════════════════════════════════
const supabase = (0, supabase_js_1.createClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { realtime: { transport: ws_1.default } });
// ══════════════════════════════════════════════════════════════
// Bots
// ══════════════════════════════════════════════════════════════
const BOTS = [
    { id: "gpt", name: "GPT Bot", provider: "openai" },
    { id: "claude", name: "Claude Bot", provider: "claude" },
    { id: "gemini", name: "Gemini Bot", provider: "gemini" },
    { id: "groq", name: "Groq Bot", provider: "groq" },
];
// ══════════════════════════════════════════════════════════════
// In-memory candle stores
// ══════════════════════════════════════════════════════════════
const MAX_CANDLES = 200;
// ── NIFTY 1-sec candles ──
const niftyCandles = [];
let currentCandle = null;
let currentBucket = 0;
let lastNiftyPrice = 0;
let lastBankniftyPrice = 0;
let lastSensexPrice = 0;
// ── BTC 1-sec candles ──
const btcCandles = [];
let btcCurrentCandle = null;
let btcCurrentBucket = 0;
let btcPrice = 0;
let lastBtcLogTime = 0;
// USD/INR exchange rate cache
let cachedUsdToInr = 84;
let lastUsdInrFetch = 0;
function processBtcTick(price, timestamp) {
    const CANDLE_DURATION = 1000;
    const bucket = Math.floor(timestamp / CANDLE_DURATION) * CANDLE_DURATION;
    if (!btcCurrentCandle) {
        btcCurrentCandle = { open: price, high: price, low: price, close: price, time: bucket };
        btcCurrentBucket = bucket;
        return;
    }
    if (bucket !== btcCurrentBucket) {
        btcCandles.push({ ...btcCurrentCandle });
        if (btcCandles.length > MAX_CANDLES)
            btcCandles.shift();
        btcCurrentCandle = { open: price, high: price, low: price, close: price, time: bucket };
        btcCurrentBucket = bucket;
        return;
    }
    btcCurrentCandle.high = Math.max(btcCurrentCandle.high, price);
    btcCurrentCandle.low = Math.min(btcCurrentCandle.low, price);
    btcCurrentCandle.close = price;
}
function processTick(price, timestamp) {
    const CANDLE_DURATION = 1000;
    const bucket = Math.floor(timestamp / CANDLE_DURATION) * CANDLE_DURATION;
    if (!currentCandle) {
        currentCandle = { open: price, high: price, low: price, close: price, time: bucket };
        currentBucket = bucket;
        return;
    }
    if (bucket !== currentBucket) {
        niftyCandles.push({ ...currentCandle });
        if (niftyCandles.length > MAX_CANDLES)
            niftyCandles.shift();
        console.log(`[Candle] Finalized NIFTY ${new Date(currentCandle.time).toLocaleTimeString()} O:${currentCandle.open} H:${currentCandle.high} L:${currentCandle.low} C:${currentCandle.close} | total: ${niftyCandles.length}`);
        currentCandle = { open: price, high: price, low: price, close: price, time: bucket };
        currentBucket = bucket;
        return;
    }
    currentCandle.high = Math.max(currentCandle.high, price);
    currentCandle.low = Math.min(currentCandle.low, price);
    currentCandle.close = price;
}
// ══════════════════════════════════════════════════════════════
// Indicators
// ══════════════════════════════════════════════════════════════
function calcRSI(candles, period = 14) {
    if (candles.length < period + 1)
        return 50;
    let gains = 0, losses = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const diff = candles[i].close - candles[i - 1].close;
        if (diff > 0)
            gains += diff;
        else
            losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0)
        return 100;
    return Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}
function emaValues(values, period) {
    const mult = 2 / (period + 1);
    let ema = values[0];
    const result = [ema];
    for (let i = 1; i < values.length; i++) {
        ema = (values[i] - ema) * mult + ema;
        result.push(ema);
    }
    return result;
}
function calcEMA(candles, period = 20) {
    if (candles.length < period)
        return 0;
    const vals = emaValues(candles.map(c => c.close), period);
    return Number(vals[vals.length - 1].toFixed(2));
}
function calcMACD(candles) {
    if (candles.length < 35)
        return { macd: 0, signal: 0, histogram: 0 };
    const closes = candles.map(c => c.close);
    const ema12 = emaValues(closes, 12);
    const ema26 = emaValues(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const sigLine = emaValues(macdLine, 9);
    const macd = macdLine[macdLine.length - 1];
    const signal = sigLine[sigLine.length - 1];
    return {
        macd: Number(macd.toFixed(2)),
        signal: Number(signal.toFixed(2)),
        histogram: Number((macd - signal).toFixed(2)),
    };
}
function calcATR(candles, period = 14) {
    if (candles.length < period + 1)
        return 0;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const hl = candles[i].high - candles[i].low;
        const hc = Math.abs(candles[i].high - candles[i - 1].close);
        const lc = Math.abs(candles[i].low - candles[i - 1].close);
        trs.push(Math.max(hl, hc, lc));
    }
    const recent = trs.slice(-period);
    return Number((recent.reduce((s, v) => s + v, 0) / period).toFixed(2));
}
function calcBollinger(candles, period = 20, mult = 2) {
    if (candles.length < period)
        return { upper: 0, middle: 0, lower: 0 };
    const closes = candles.slice(-period).map(c => c.close);
    const mean = closes.reduce((s, v) => s + v, 0) / period;
    const variance = closes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period;
    const sd = Math.sqrt(variance);
    return {
        upper: Number((mean + sd * mult).toFixed(2)),
        middle: Number(mean.toFixed(2)),
        lower: Number((mean - sd * mult).toFixed(2)),
    };
}
function calcSupertrend(candles, period = 10, mult = 3) {
    if (candles.length < period + 1)
        return { trend: "NEUTRAL", value: 0 };
    const atr = calcATR(candles, period);
    const latest = candles[candles.length - 1];
    const hl2 = (latest.high + latest.low) / 2;
    const upper = hl2 + mult * atr;
    const lower = hl2 - mult * atr;
    let trend, value;
    if (latest.close > upper) {
        trend = "BULLISH";
        value = lower;
    }
    else if (latest.close < lower) {
        trend = "BEARISH";
        value = upper;
    }
    else {
        trend = latest.close > hl2 ? "BULLISH" : "BEARISH";
        value = trend === "BULLISH" ? lower : upper;
    }
    return { trend, value: Number(value.toFixed(2)) };
}
function analyzeStructure(candles) {
    if (candles.length < 30)
        return { trend: "NEUTRAL", breakout: false, momentum: "NEUTRAL", support: 0, resistance: 0, candleSignal: "NONE" };
    const recent = candles.slice(-20);
    const highs = recent.map(c => c.high);
    const lows = recent.map(c => c.low);
    const closes = recent.map(c => c.close);
    const latest = recent[recent.length - 1];
    const previous = recent[recent.length - 2];
    const support = Number(Math.min(...lows).toFixed(2));
    const resistance = Number(Math.max(...highs).toFixed(2));
    const first = closes[0], last = closes[closes.length - 1];
    let trend = "NEUTRAL";
    if (last > first * 1.01)
        trend = "BULLISH";
    if (last < first * 0.99)
        trend = "BEARISH";
    const move = Math.abs(latest.close - previous.close);
    let momentum = "WEAK";
    if (move > 80)
        momentum = "STRONG";
    if (move > 150)
        momentum = "EXPLOSIVE";
    const breakout = latest.close > resistance * 0.998 || latest.close < support * 1.002;
    const body = Math.abs(latest.close - latest.open);
    const range = latest.high - latest.low;
    let candleSignal = "NONE";
    if (latest.close > latest.open && previous.close < previous.open && latest.close > previous.open)
        candleSignal = "BULLISH_ENGULFING";
    if (latest.close < latest.open && previous.close > previous.open && latest.close < previous.open)
        candleSignal = "BEARISH_ENGULFING";
    if (range > 0 && body / range > 0.7)
        candleSignal = latest.close > latest.open ? "BULLISH_IMPULSE" : "BEARISH_IMPULSE";
    return { trend, breakout, momentum, support, resistance, candleSignal };
}
function detectRegime(rsi, atr, macd, signal, trend) {
    if (atr > 180 && Math.abs(macd - signal) > 20)
        return "BREAKOUT";
    if (trend === "BULLISH" && rsi > 55)
        return "TRENDING_BULLISH";
    if (trend === "BEARISH" && rsi < 45)
        return "TRENDING_BEARISH";
    if (rsi > 75 || rsi < 25)
        return "REVERSAL";
    return "RANGING";
}
// ══════════════════════════════════════════════════════════════
// Market hours (IST)
// ══════════════════════════════════════════════════════════════
function isMarketOpen() {
    const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const day = ist.getDay();
    if (day === 0 || day === 6)
        return false;
    const mins = ist.getHours() * 60 + ist.getMinutes();
    return mins >= 555 && mins <= 930; // 9:15–15:30
}
// ══════════════════════════════════════════════════════════════
// Upstox API helpers
// ══════════════════════════════════════════════════════════════
const INDEX_KEY_MAP = {
    "NSE_INDEX:Nifty 50": "NIFTY",
    "NSE_INDEX:Nifty Bank": "BANKNIFTY",
    "BSE_INDEX:SENSEX": "SENSEX",
};
async function fetchIndexLTP() {
    const token = process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN;
    if (!token)
        return {};
    const keys = ["NSE_INDEX|Nifty 50", "NSE_INDEX|Nifty Bank", "BSE_INDEX|SENSEX"]
        .map(encodeURIComponent).join(",");
    try {
        const res = await fetch(`https://api.upstox.com/v2/market-quote/ltp?instrument_key=${keys}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
        if (!res.ok) {
            console.warn("[LTP] Index fetch failed:", res.status);
            return {};
        }
        const json = await res.json();
        const prices = {};
        for (const [key, val] of Object.entries(json.data ?? {})) {
            const sym = INDEX_KEY_MAP[key];
            if (sym && val?.last_price)
                prices[sym] = Number(val.last_price.toFixed(2));
        }
        return prices;
    }
    catch (err) {
        console.error("[LTP] Index fetch error:", err);
        return {};
    }
}
const STOCK_SYMBOLS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK"];
async function fetchStockLTPs() {
    const token = process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN;
    if (!token)
        return [];
    const keys = STOCK_SYMBOLS.map(s => `NSE_EQ|${s}`).map(encodeURIComponent).join(",");
    try {
        const res = await fetch(`https://api.upstox.com/v2/market-quote/ltp?instrument_key=${keys}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
        if (!res.ok)
            return [];
        const json = await res.json();
        return STOCK_SYMBOLS
            .map(sym => {
            const quote = json.data?.[`NSE_EQ:${sym}`];
            const price = Number((quote?.last_price ?? 0).toFixed(2));
            const close = Number((quote?.close_price ?? price).toFixed(2));
            return { symbol: sym, price, change: Number((price - close).toFixed(2)) };
        })
            .filter(s => s.price > 0);
    }
    catch {
        return [];
    }
}
const OPTION_KEYS = {
    NIFTY: "NSE_INDEX|Nifty 50",
    BANKNIFTY: "NSE_INDEX|Nifty Bank",
    SENSEX: "BSE_INDEX|SENSEX",
};
function getDTE(expiryStr) {
    const expiry = new Date(expiryStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((expiry.getTime() - today.getTime()) / 86400000));
}
async function fetchOptionSlice(instrument, expiryStr) {
    const token = process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN;
    if (!token)
        return null;
    const instrumentKey = OPTION_KEYS[instrument];
    if (!instrumentKey)
        return null;
    try {
        const url = new URL("https://api.upstox.com/v2/option/chain");
        url.searchParams.set("instrument_key", instrumentKey);
        url.searchParams.set("expiry_date", expiryStr);
        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        if (!res.ok)
            return null;
        const json = await res.json();
        const chain = json.data ?? [];
        if (!chain.length)
            return null;
        const spotPrice = chain[0].underlying_spot_price ?? 0;
        const atmStrike = chain.reduce((nearest, row) => Math.abs(row.strike_price - spotPrice) < Math.abs(nearest - spotPrice) ? row.strike_price : nearest, chain[0].strike_price);
        const sorted = [...chain].sort((a, b) => a.strike_price - b.strike_price);
        const atmIdx = sorted.findIndex(r => r.strike_price === atmStrike);
        const lo = Math.max(0, atmIdx - 5);
        const hi = Math.min(sorted.length - 1, atmIdx + 5);
        const strikes = sorted.slice(lo, hi + 1).map(row => ({
            strike: row.strike_price,
            cePremium: row.call_options?.market_data?.ltp ?? 0,
            pePremium: row.put_options?.market_data?.ltp ?? 0,
        }));
        return { expiry: expiryStr, dte: getDTE(expiryStr), atm: atmStrike, strikes };
    }
    catch {
        return null;
    }
}
// ══════════════════════════════════════════════════════════════
// Kraken WebSocket — XBT/USD live price feed
// ══════════════════════════════════════════════════════════════
function connectBinanceWS() {
    const socket = new ws_1.default("wss://ws.kraken.com");
    socket.on("open", () => {
        console.log("[BTC] Kraken WebSocket connected — subscribing to XBT/USD trades");
        socket.send(JSON.stringify({
            event: "subscribe",
            pair: ["XBT/USD"],
            subscription: { name: "trade" },
        }));
    });
    socket.on("message", (data) => {
        try {
            // Kraken trade message: [channelID, [[price, vol, time, side, orderType, misc], ...], "trade", "XBT/USD"]
            const msg = JSON.parse(data.toString());
            if (!Array.isArray(msg) || msg[3] !== "XBT/USD")
                return;
            const trades = msg[1];
            if (!Array.isArray(trades) || !trades[0])
                return;
            const price = parseFloat(trades[0][0]);
            if (!price)
                return;
            btcPrice = price;
            processBtcTick(price, Date.now());
            if (Date.now() - lastBtcLogTime > 5000) {
                console.log(`[BTC] Price: $${btcPrice.toFixed(2)}`);
                lastBtcLogTime = Date.now();
            }
        }
        catch (err) {
            console.error("[BTC] WS parse error:", err);
        }
    });
    socket.on("error", (err) => {
        console.error("[BTC] WS error:", err.message);
    });
    socket.on("close", () => {
        console.warn("[BTC] WS closed — reconnecting in 5s...");
        setTimeout(connectBinanceWS, 5000);
    });
}
// ══════════════════════════════════════════════════════════════
// USD/INR exchange rate
// ══════════════════════════════════════════════════════════════
async function refreshUsdToInr() {
    try {
        const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
        if (!res.ok)
            return;
        const json = await res.json();
        const rate = json.rates?.INR;
        if (rate && rate > 0) {
            cachedUsdToInr = rate;
            lastUsdInrFetch = Date.now();
            console.log(`[FX] USD/INR updated: ${rate.toFixed(2)}`);
        }
    }
    catch {
        console.warn(`[FX] USD/INR fetch failed — using fallback ₹${cachedUsdToInr}`);
    }
}
function getUsdToInr() {
    if (Date.now() - lastUsdInrFetch > 3600000) {
        refreshUsdToInr().catch(() => { });
    }
    return cachedUsdToInr;
}
// ══════════════════════════════════════════════════════════════
// Expiry calendar (inlined, Supabase holiday-adjusted)
// ══════════════════════════════════════════════════════════════
function lastWeekdayOfMonth(year, month, weekday) {
    const d = new Date(year, month + 1, 0);
    while (d.getDay() !== weekday)
        d.setDate(d.getDate() - 1);
    return d;
}
function nextNWeekdays(weekday, count) {
    const results = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(today);
    d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
    while (results.length < count) {
        results.push(new Date(d));
        d.setDate(d.getDate() + 7);
    }
    return results;
}
function nextNMonthlyExpiries(weekday, count) {
    const results = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let y = today.getFullYear(), m = today.getMonth();
    while (results.length < count) {
        const exp = lastWeekdayOfMonth(y, m, weekday);
        if (exp >= today)
            results.push(exp);
        m++;
        if (m > 11) {
            m = 0;
            y++;
        }
    }
    return results;
}
async function getHolidaySet() {
    const from = new Date().toISOString().split("T")[0];
    const to = new Date(Date.now() + 180 * 86400000).toISOString().split("T")[0];
    const { data } = await supabase.from("nse_holidays").select("date").gte("date", from).lte("date", to);
    return new Set((data ?? []).map((r) => r.date));
}
function shiftToTradingDay(date, holidays) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    while (true) {
        const day = d.getDay();
        const str = d.toISOString().split("T")[0];
        if (day !== 0 && day !== 6 && !holidays.has(str))
            return d;
        d.setDate(d.getDate() - 1);
    }
}
async function getUpcomingExpiries(instrument) {
    const TUESDAY = 2, THURSDAY = 4;
    let raw;
    if (instrument === "NIFTY")
        raw = nextNWeekdays(TUESDAY, 2);
    else if (instrument === "SENSEX")
        raw = nextNWeekdays(THURSDAY, 2);
    else
        raw = nextNMonthlyExpiries(TUESDAY, 2);
    const holidays = await getHolidaySet().catch(() => new Set());
    return raw.map(d => shiftToTradingDay(d, holidays).toISOString().split("T")[0]);
}
// ══════════════════════════════════════════════════════════════
// Fetch all instruments snapshot
// ══════════════════════════════════════════════════════════════
async function fetchInstruments() {
    const [nExp, sExp, bExp] = await Promise.all([
        getUpcomingExpiries("NIFTY").catch(() => []),
        getUpcomingExpiries("SENSEX").catch(() => []),
        getUpcomingExpiries("BANKNIFTY").catch(() => []),
    ]);
    const [n0, n1, s0, s1, b0, b1, stocks] = await Promise.all([
        nExp[0] ? fetchOptionSlice("NIFTY", nExp[0]) : Promise.resolve(null),
        nExp[1] ? fetchOptionSlice("NIFTY", nExp[1]) : Promise.resolve(null),
        sExp[0] ? fetchOptionSlice("SENSEX", sExp[0]) : Promise.resolve(null),
        sExp[1] ? fetchOptionSlice("SENSEX", sExp[1]) : Promise.resolve(null),
        bExp[0] ? fetchOptionSlice("BANKNIFTY", bExp[0]) : Promise.resolve(null),
        bExp[1] ? fetchOptionSlice("BANKNIFTY", bExp[1]) : Promise.resolve(null),
        fetchStockLTPs(),
    ]);
    return {
        niftyOptions: [n0, n1].filter((x) => x !== null),
        sensexOptions: [s0, s1].filter((x) => x !== null),
        bankniftyOptions: [b0, b1].filter((x) => x !== null),
        topStocks: stocks,
    };
}
// ══════════════════════════════════════════════════════════════
// AI providers
// ══════════════════════════════════════════════════════════════
async function runAI(provider, prompt) {
    try {
        if (provider === "openai") {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
            });
            const d = await res.json();
            return d?.choices?.[0]?.message?.content ?? "No response";
        }
        if (provider === "claude") {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
                body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
            });
            const d = await res.json();
            return d?.content?.[0]?.text ?? "No response";
        }
        if (provider === "gemini") {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            });
            const d = await res.json();
            return d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response";
        }
        if (provider === "groq") {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
                body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.7, response_format: { type: "json_object" } }),
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error(`[AI:groq] API error ${res.status} ${res.statusText}:`, errText);
                return "No response";
            }
            const d = await res.json();
            return d?.choices?.[0]?.message?.content ?? "No response";
        }
        return "Unknown provider";
    }
    catch (err) {
        console.error(`[AI:${provider}] Error:`, err);
        return `Error: ${String(err)}`;
    }
}
// ══════════════════════════════════════════════════════════════
// Parse AI response
// ══════════════════════════════════════════════════════════════
function parseDecision(raw) {
    try {
        const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        const rawAction = (parsed.action || parsed.decision || "HOLD").toString().toUpperCase();
        const action = (["BUY", "SELL", "HOLD", "CLOSE"].includes(rawAction)
            ? rawAction : "HOLD");
        const rawOT = parsed.optionType?.toString().toUpperCase();
        const optionType = rawOT === "CE" || rawOT === "PE" ? rawOT : null;
        return {
            action,
            symbol: parsed.symbol || "NIFTY",
            optionType,
            strike: parsed.strike != null ? Number(parsed.strike) : null,
            expiry: parsed.expiry || null,
            quantity: Math.max(1, Number(parsed.quantity) || 1),
            confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
            reasoning: parsed.reasoning || parsed.reason || "No reasoning provided",
            strategyStatement: parsed.strategyStatement || "No strategy statement",
        };
    }
    catch {
        return { action: "HOLD", symbol: "NIFTY", optionType: null, strike: null, expiry: null, quantity: 1, confidence: 50, reasoning: "Parse failed", strategyStatement: "Parse error — holding cash" };
    }
}
// ══════════════════════════════════════════════════════════════
// Prompt builder
// ══════════════════════════════════════════════════════════════
function fmt(n) {
    return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmtPnl(n) {
    return (n >= 0 ? "+" : "") + "₹" + fmt(n);
}
function buildStrikesTable(strikes, atm) {
    return strikes.map(s => {
        const tag = s.strike === atm ? " ◀ATM" : "";
        return `      ${String(s.strike).padStart(6)}   CE ₹${fmt(s.cePremium).padStart(8)}   PE ₹${fmt(s.pePremium).padStart(8)}${tag}`;
    }).join("\n");
}
function buildExpirySection(label, slices) {
    if (!slices.length)
        return `  ${label}: no data`;
    return slices.map(slice => `  ▸ ${label} — Expiry: ${slice.expiry} (DTE: ${slice.dte})  ATM: ${fmt(slice.atm)}\n` +
        `    Strike     CE Premium    PE Premium\n` +
        buildStrikesTable(slice.strikes, slice.atm)).join("\n\n");
}
function buildPrompt(params) {
    const { botName, botProvider, rank, marketRegime, higherTimeframeTrend, volatility, rsi, ema, macd, signal, atr, bb, supertrend, structure, niftyPrice, bankniftyPrice, sensexPrice, allocatedCapital, freeCash, todayPnL, openPositions, lessons, confidenceScore, instruments, } = params;
    const todayDate = new Date().toISOString().split("T")[0];
    const niftyOpts = instruments ? buildExpirySection("NIFTY WEEKLY", instruments.niftyOptions) : "  (not loaded)";
    const sensexOpts = instruments ? buildExpirySection("SENSEX WEEKLY", instruments.sensexOptions) : "  (not loaded)";
    const bnfOpts = instruments ? buildExpirySection("BANKNIFTY MONTHLY", instruments.bankniftyOptions) : "  (not loaded)";
    const stocksSec = instruments?.topStocks?.length
        ? instruments.topStocks.map(s => `  ${s.symbol.padEnd(14)} ₹${fmt(s.price).padStart(10)}   ${fmtPnl(s.change).padStart(10)} today`).join("\n")
        : "  (not loaded — trade index options or spot)";
    const posSec = openPositions.length
        ? openPositions.map((p, i) => `  ${i + 1}. ${p.symbol} | ${p.side} ×${p.quantity}\n` +
            `     Entry: ₹${fmt(p.entry_price)}  |  Now: ₹${fmt(p.current_price)}  |  PnL: ${fmtPnl(p.pnl)}`).join("\n") +
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
// BTC prompt builder
// ══════════════════════════════════════════════════════════════
function buildBtcPrompt(params) {
    const { btcPrice: price, freeCash, openPositions } = params;
    const posStr = openPositions.length
        ? openPositions.map((p, i) => `#${i + 1}: ${p.quantity.toFixed(6)} BTC @ $${p.entry_price.toFixed(2)}`).join(", ")
        : "none";
    return `You are competing against 3 other AIs for maximum profit trading BTC/USDT spot. You have ₹1,00,000 total capital. You can hold multiple BTC positions simultaneously — each BUY opens a new position using some of your free cash. SELL closes ALL your open positions. Your free cash: ₹${freeCash.toFixed(2)}. Your open positions: ${posStr}. Current BTC price: $${price.toFixed(2)}. Use whatever strategy and risk management you want. Goal: maximum ₹ profit. Respond in JSON: { "action": "BUY"|"SELL"|"HOLD", "quantity_inr": number, "reasoning": string }`;
}
// ══════════════════════════════════════════════════════════════
// Supabase state helpers
// ══════════════════════════════════════════════════════════════
async function getBotCapital(botId) {
    const { data } = await supabase.from("capital").select("allocated_capital,pnl").eq("bot_id", botId).single();
    return data ?? { allocated_capital: 100000, pnl: 0 };
}
async function getOpenPositions(botId) {
    const { data } = await supabase.from("positions").select("*").eq("bot_id", botId).eq("status", "OPEN");
    return (data ?? []);
}
async function getLessons(botId) {
    const { data } = await supabase
        .from("ai_memory")
        .select("lesson,confidence_score")
        .eq("bot_id", botId)
        .order("created_at", { ascending: false })
        .limit(10);
    if (!data?.length)
        return { lessons: [], confidenceScore: 50 };
    return {
        lessons: data.map(r => r.lesson),
        confidenceScore: data[0].confidence_score ?? 50,
    };
}
async function getLeaderboardRank(botId) {
    const { data } = await supabase.from("capital").select("bot_id,pnl").order("pnl", { ascending: false });
    if (!data?.length)
        return 4;
    const idx = data.findIndex(r => r.bot_id === botId);
    return idx === -1 ? 4 : idx + 1;
}
async function getBtcCapital(botId) {
    const { data } = await supabase
        .from("btc_capital")
        .select("allocated_capital,pnl")
        .eq("bot_id", botId)
        .single();
    return data ?? { allocated_capital: 100000, pnl: 0 };
}
async function getOpenBtcPositions(botId) {
    const { data } = await supabase
        .from("btc_positions")
        .select("*")
        .eq("bot_id", botId)
        .eq("status", "OPEN");
    return (data ?? []);
}
async function openPosition(botId, decision, entryPrice, atr, symbol) {
    const stopLoss = decision.action === "BUY" ? entryPrice - atr * 1.2 : entryPrice + atr * 1.2;
    const takeProfit = decision.action === "BUY" ? entryPrice + atr * 2 : entryPrice - atr * 2;
    const { error } = await supabase.from("positions").insert({
        bot_id: botId,
        symbol,
        side: decision.action,
        quantity: decision.quantity,
        entry_price: Number(entryPrice.toFixed(2)),
        current_price: Number(entryPrice.toFixed(2)),
        stop_loss: Number(stopLoss.toFixed(2)),
        take_profit: Number(takeProfit.toFixed(2)),
        pnl: 0,
        status: "OPEN",
    });
    if (error)
        console.error(`[Position] Insert failed for ${botId}:`, error.message);
    else
        console.log(`[${botId}] OPENED ${symbol} @₹${entryPrice.toFixed(2)}`);
}
async function closePosition(position, currentPrice) {
    const mult = position.side === "BUY" ? 1 : -1;
    const pnl = mult * (currentPrice - position.entry_price) * position.quantity;
    const { error } = await supabase.from("positions").update({
        status: "CLOSED",
        current_price: currentPrice,
        pnl: Number(pnl.toFixed(2)),
        closed_at: new Date().toISOString(),
    }).eq("id", position.id);
    if (error)
        console.error(`[Position] Close failed:`, error.message);
    else
        console.log(`[${position.bot_id}] CLOSED ${position.symbol}  PnL: ${fmtPnl(pnl)}`);
}
async function writeStrategyLog(botId, strategy) {
    await supabase.from("strategy_log").insert({ bot_id: botId, strategy, trade_outcome: "PENDING", pnl: 0 });
}
// ══════════════════════════════════════════════════════════════
// Main trading cycle
// ══════════════════════════════════════════════════════════════
let cycleRunning = false;
async function runTradingCycle() {
    if (cycleRunning)
        return;
    cycleRunning = true;
    try {
        if (niftyCandles.length < 60) {
            console.log(`[Cycle] Waiting for candles (${niftyCandles.length}/60)...`);
            return;
        }
        // ── Indicators ──
        const rsi = calcRSI(niftyCandles);
        const ema = calcEMA(niftyCandles);
        const macdData = calcMACD(niftyCandles);
        const atr = calcATR(niftyCandles);
        const bb = calcBollinger(niftyCandles);
        const supertrend = calcSupertrend(niftyCandles);
        const structure = analyzeStructure(niftyCandles);
        const recent50 = niftyCandles.slice(-50).map(c => c.close);
        const avg50 = recent50.reduce((s, v) => s + v, 0) / recent50.length;
        const last50 = recent50[recent50.length - 1];
        const higherTimeframeTrend = niftyCandles.length >= 50
            ? (last50 > avg50 ? "BULLISH" : last50 < avg50 ? "BEARISH" : "NEUTRAL")
            : "NEUTRAL";
        const marketRegime = detectRegime(rsi, atr, macdData.macd, macdData.signal, supertrend.trend);
        const volatility = atr > 200 ? "HIGH" : atr > 100 ? "MEDIUM" : "LOW";
        // ── Fetch live option chains + stocks ──
        let instruments = null;
        try {
            instruments = await fetchInstruments();
        }
        catch (err) {
            console.warn("[Instruments] Fetch failed:", String(err));
        }
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
                const rank = await getLeaderboardRank(bot.id);
                const deployed = openPositions.reduce((s, p) => s + p.entry_price * p.quantity, 0);
                const freeCash = capital.allocated_capital - deployed;
                const prompt = buildPrompt({
                    botName: bot.name,
                    botProvider: bot.provider,
                    rank,
                    marketRegime,
                    higherTimeframeTrend,
                    volatility,
                    rsi,
                    ema,
                    macd: macdData.macd,
                    signal: macdData.signal,
                    atr,
                    bb,
                    supertrend,
                    structure,
                    niftyPrice: lastNiftyPrice,
                    bankniftyPrice: lastBankniftyPrice,
                    sensexPrice: lastSensexPrice,
                    allocatedCapital: capital.allocated_capital,
                    freeCash,
                    todayPnL: capital.pnl,
                    openPositions,
                    lessons,
                    confidenceScore,
                    instruments,
                });
                const rawResponse = await runAI(bot.provider, prompt);
                const decision = parseDecision(rawResponse);
                console.log(`[${bot.id}] ${decision.action} ${decision.symbol} | confidence: ${decision.confidence} | ${decision.strategyStatement.slice(0, 80)}`);
                // Fire-and-forget strategy log
                writeStrategyLog(bot.id, decision.strategyStatement).catch(() => { });
                if (decision.action === "HOLD")
                    continue;
                // ── CLOSE ──
                if (decision.action === "CLOSE") {
                    const toClose = openPositions.find(p => !decision.symbol || p.symbol === decision.symbol);
                    if (toClose) {
                        const closePrice = lastNiftyPrice || toClose.current_price;
                        await closePosition(toClose, closePrice);
                    }
                    else {
                        console.warn(`[${bot.id}] CLOSE: no match for "${decision.symbol}"`);
                    }
                    continue;
                }
                // ── BUY / SELL — resolve entry price ──
                let entryPrice = 0;
                let entrySymbol = decision.symbol;
                if (decision.optionType && decision.strike && decision.expiry) {
                    const slices = decision.symbol === "NIFTY" ? instruments?.niftyOptions :
                        decision.symbol === "SENSEX" ? instruments?.sensexOptions :
                            instruments?.bankniftyOptions;
                    const slice = slices?.find(s => s.expiry === decision.expiry);
                    const row = slice?.strikes.find(s => s.strike === decision.strike);
                    const prem = row ? (decision.optionType === "CE" ? row.cePremium : row.pePremium) : 0;
                    if (!prem) {
                        console.warn(`[${bot.id}] No premium for ${decision.symbol} ${decision.optionType} ${decision.strike} — skipping`);
                        continue;
                    }
                    entryPrice = prem;
                    entrySymbol = `${decision.symbol} ${decision.optionType} ${decision.strike} ${decision.expiry}`;
                }
                else {
                    if (decision.symbol === "NIFTY")
                        entryPrice = lastNiftyPrice;
                    else if (decision.symbol === "BANKNIFTY")
                        entryPrice = lastBankniftyPrice;
                    else if (decision.symbol === "SENSEX")
                        entryPrice = lastSensexPrice;
                    else {
                        const stock = instruments?.topStocks.find(s => s.symbol === decision.symbol);
                        entryPrice = stock?.price ?? 0;
                    }
                }
                if (entryPrice <= 0) {
                    console.warn(`[${bot.id}] No price for "${entrySymbol}" — skipping`);
                    continue;
                }
                // ── Position sizing: cannot spend more than freeCash ──
                const cost = entryPrice * decision.quantity;
                if (cost > freeCash) {
                    decision.quantity = Math.floor(freeCash / entryPrice);
                    console.warn(`[${bot.id}] Quantity capped — cost ₹${cost.toFixed(2)} > freeCash ₹${freeCash.toFixed(2)} → qty reduced to ${decision.quantity}`);
                }
                if (decision.quantity < 1) {
                    console.warn(`[${bot.id}] Insufficient cash (₹${freeCash.toFixed(2)}) to buy 1 unit of "${entrySymbol}" @₹${entryPrice.toFixed(2)} — skipping`);
                    continue;
                }
                await openPosition(bot.id, decision, entryPrice, atr, entrySymbol);
            }
            catch (botErr) {
                console.error(`[${bot.id}] Error:`, botErr);
            }
        }
        console.log(`[Cycle] Done — NIFTY ₹${lastNiftyPrice} | candles: ${niftyCandles.length}`);
    }
    catch (err) {
        console.error("[Cycle] Fatal:", err);
    }
    finally {
        cycleRunning = false;
    }
}
// ══════════════════════════════════════════════════════════════
// BTC trading cycle — every 60s, 24/7
// ══════════════════════════════════════════════════════════════
let btcCycleRunning = false;
async function runBtcTradingCycle() {
    if (btcCycleRunning)
        return;
    btcCycleRunning = true;
    try {
        if (btcCandles.length < 60) {
            console.log(`[BTC Cycle] Waiting for candles (${btcCandles.length}/60)...`);
            return;
        }
        if (!btcPrice) {
            console.log("[BTC Cycle] No BTC price yet — skipping");
            return;
        }
        for (const bot of BOTS) {
            try {
                console.log(`[BTC:${bot.id}] Starting cycle...`);
                const capital = await getBtcCapital(bot.id);
                const openPositions = await getOpenBtcPositions(bot.id);
                // entry_inr for each position = quantity * entry_price (no separate column)
                const deployed = openPositions.reduce((sum, p) => sum + p.quantity * p.entry_price, 0);
                const freeCash = capital.allocated_capital - deployed;
                console.log(`[BTC:${bot.id}] capital=₹${capital.allocated_capital} deployed=₹${deployed.toFixed(2)} freeCash=₹${freeCash.toFixed(2)} openPos=${openPositions.length}`);
                const prompt = buildBtcPrompt({
                    botName: bot.name,
                    botProvider: bot.provider,
                    btcPrice,
                    capitalInr: capital.allocated_capital,
                    freeCash,
                    totalPnl: capital.pnl,
                    openPositions,
                });
                const rawResponse = await runAI(bot.provider, prompt);
                console.log(`[BTC:${bot.id}] ── RAW RESPONSE (${rawResponse.length} chars) ──`);
                console.log(rawResponse);
                console.log(`[BTC:${bot.id}] ── END RAW RESPONSE ──`);
                // Parse BTC decision
                let action = "HOLD";
                let quantity_inr = 0;
                let reasoning = "No reasoning";
                try {
                    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
                    const cleaned = jsonMatch ? jsonMatch[0] : rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
                    console.log(`[BTC:${bot.id}] Cleaned JSON string: ${cleaned}`);
                    const parsed = JSON.parse(cleaned);
                    console.log(`[BTC:${bot.id}] Parsed fields — action: "${parsed.action}" | quantity_inr: ${parsed.quantity_inr} | reasoning: "${String(parsed.reasoning ?? "").slice(0, 120)}"`);
                    const rawAct = (parsed.action ?? "HOLD").toString().toUpperCase();
                    action = (["BUY", "SELL", "HOLD"].includes(rawAct) ? rawAct : "HOLD");
                    if (!["BUY", "SELL", "HOLD"].includes(rawAct)) {
                        console.warn(`[BTC:${bot.id}] Unrecognised action "${rawAct}" — defaulting to HOLD`);
                    }
                    quantity_inr = Math.max(0, Number(parsed.quantity_inr) || 0);
                    reasoning = parsed.reasoning ?? "No reasoning";
                }
                catch (parseErr) {
                    console.error(`[BTC:${bot.id}] JSON parse FAILED:`, parseErr);
                    console.error(`[BTC:${bot.id}] Failed raw string was: ${rawResponse.slice(0, 500)}`);
                    action = "HOLD";
                }
                console.log(`[BTC:${bot.id}] ── DECISION: ${action} | quantity_inr=₹${quantity_inr} | freeCash=₹${freeCash.toFixed(2)} | maxBuy=₹${(freeCash * 0.1).toFixed(2)}`);
                console.log(`[BTC:${bot.id}] Reasoning: ${reasoning.slice(0, 200)}`);
                if (action === "HOLD") {
                    console.log(`[BTC:${bot.id}] HOLD — skipping this cycle`);
                    continue;
                }
                // ── SELL: close all open BTC positions ──
                if (action === "SELL") {
                    if (!openPositions.length) {
                        console.log(`[BTC:${bot.id}] SELL — no open positions to close`);
                        continue;
                    }
                    const usdInr = getUsdToInr();
                    let totalRealised = 0;
                    for (const pos of openPositions) {
                        const pnl = (btcPrice - pos.entry_price) * pos.quantity * usdInr;
                        const sellValue = btcPrice * pos.quantity * usdInr;
                        const sellCharges = Number((sellValue * 0.001 * 1.18 + sellValue * 0.01).toFixed(2)); // fee + GST + 1% TDS
                        const netPnl = Number((pnl - sellCharges - (pos.charges ?? 0)).toFixed(2));
                        totalRealised += netPnl;
                        console.log(`[BTC:${bot.id}] PnL = ($${btcPrice.toFixed(2)} - $${pos.entry_price.toFixed(2)}) × ${pos.quantity.toFixed(8)} × ₹${usdInr.toFixed(2)} = ₹${pnl.toFixed(2)} | sellCharges: ₹${sellCharges} | buyCharges: ₹${pos.charges ?? 0} | netPnl: ₹${netPnl.toFixed(2)}`);
                        const { error } = await supabase.from("btc_positions").update({
                            status: "CLOSED",
                            current_price: Number(btcPrice.toFixed(2)),
                            pnl: netPnl,
                            closed_at: new Date().toISOString(),
                        }).eq("id", pos.id);
                        if (error)
                            console.error(`[BTC:${bot.id}] Close failed:`, error.message, JSON.stringify(error));
                        else
                            console.log(`[BTC:${bot.id}] CLOSED ${pos.quantity.toFixed(6)} BTC @ $${btcPrice.toFixed(2)}  Net PnL: ${netPnl >= 0 ? "+" : ""}₹${netPnl.toFixed(2)}`);
                    }
                    // Recompute totals from ALL closed positions for this bot
                    const { data: allClosed } = await supabase
                        .from("btc_positions")
                        .select("pnl,charges")
                        .eq("bot_id", bot.id)
                        .eq("status", "CLOSED");
                    const allClosedArr = (allClosed ?? []);
                    const totalPnl = allClosedArr.reduce((s, p) => s + Number(p.pnl), 0);
                    const wins = allClosedArr.filter(p => Number(p.pnl) > 0).length;
                    const winRate = allClosedArr.length > 0 ? wins / allClosedArr.length : 0;
                    const newCapital = Number((100000 + totalPnl).toFixed(2));
                    const { error: capErr } = await supabase.from("btc_capital").update({
                        allocated_capital: newCapital,
                        pnl: Number(totalPnl.toFixed(2)),
                        win_rate: Number(winRate.toFixed(4)),
                        updated_at: new Date().toISOString(),
                    }).eq("bot_id", bot.id);
                    if (capErr)
                        console.error(`[BTC:${bot.id}] btc_capital update failed:`, capErr.message);
                    else
                        console.log(`[BTC:${bot.id}] Capital updated to ₹${newCapital.toFixed(2)} (net PnL after charges: ₹${totalPnl.toFixed(2)} | win rate: ${(winRate * 100).toFixed(1)}%)`);
                    continue;
                }
                // ── BUY: open a long position ──
                if (action === "BUY") {
                    // Cap each trade at 10% of free cash
                    let spendInr = Math.min(quantity_inr, freeCash * 0.1);
                    if (spendInr > freeCash)
                        spendInr = freeCash;
                    if (spendInr < 100) {
                        console.warn(`[BTC:${bot.id}] Insufficient cash ₹${freeCash.toFixed(2)} (need ≥₹100) — skipping BUY`);
                        continue;
                    }
                    // Convert INR → BTC using live USD/INR rate
                    const usdInr = getUsdToInr();
                    const btcPriceInr = btcPrice * usdInr;
                    const btcQty = spendInr / btcPriceInr;
                    const buyCharges = Number((spendInr * 0.001 * 1.18).toFixed(2)); // 0.1% fee + 18% GST
                    console.log(`[BTC:${bot.id}] BUY sizing: ₹${spendInr.toFixed(2)} ÷ ($${btcPrice.toFixed(2)} × ₹${usdInr.toFixed(2)}) = ${btcQty.toFixed(8)} BTC | charges: ₹${buyCharges}`);
                    const insertPayload = {
                        bot_id: bot.id,
                        symbol: "BTC/USDT",
                        side: "BUY",
                        quantity: Number(btcQty.toFixed(8)),
                        entry_price: Number(btcPrice.toFixed(2)),
                        current_price: Number(btcPrice.toFixed(2)),
                        stop_loss: 0,
                        take_profit: 0,
                        pnl: 0,
                        charges: buyCharges,
                        reasoning: reasoning.slice(0, 1000),
                        status: "OPEN",
                        opened_at: new Date().toISOString(),
                    };
                    console.log(`[BTC:${bot.id}] Inserting btc_positions:`, JSON.stringify(insertPayload));
                    const { error, data: inserted } = await supabase.from("btc_positions").insert(insertPayload).select();
                    if (error) {
                        console.error(`[BTC:${bot.id}] Insert FAILED — code: ${error.code} | message: ${error.message} | details: ${error.details} | hint: ${error.hint}`);
                    }
                    else {
                        console.log(`[BTC:${bot.id}] BOUGHT ${btcQty.toFixed(6)} BTC @ $${btcPrice.toFixed(2)} (₹${spendInr.toFixed(2)}) | inserted id: ${inserted?.[0]?.id}`);
                    }
                }
            }
            catch (botErr) {
                console.error(`[BTC:${bot.id}] Error:`, botErr);
            }
        }
        console.log(`[BTC Cycle] Done — $${btcPrice.toFixed(2)} | candles: ${btcCandles.length}`);
    }
    catch (err) {
        console.error("[BTC Cycle] Fatal:", err);
    }
    finally {
        btcCycleRunning = false;
    }
}
// ══════════════════════════════════════════════════════════════
// LTP poller — every second
// ══════════════════════════════════════════════════════════════
async function pollLTP() {
    try {
        const prices = await fetchIndexLTP();
        if (prices.NIFTY) {
            lastNiftyPrice = prices.NIFTY;
            if (isMarketOpen())
                processTick(prices.NIFTY, Date.now());
        }
        if (prices.BANKNIFTY)
            lastBankniftyPrice = prices.BANKNIFTY;
        if (prices.SENSEX)
            lastSensexPrice = prices.SENSEX;
        if (Object.keys(prices).length) {
            console.log(`[LTP] NIFTY: ${prices.NIFTY ?? "--"} | BNF: ${prices.BANKNIFTY ?? "--"} | SENSEX: ${prices.SENSEX ?? "--"}`);
        }
    }
    catch (err) {
        console.error("[LTP] Poll error:", err);
    }
}
// ══════════════════════════════════════════════════════════════
// Upstox token management
// ══════════════════════════════════════════════════════════════
async function loadTokenFromSupabase() {
    try {
        const { data, error } = await supabase
            .from("config")
            .select("value")
            .eq("key", "UPSTOX_ACCESS_TOKEN")
            .single();
        if (error || !data?.value) {
            console.log("[Token] No token found in Supabase config");
            return;
        }
        process.env.UPSTOX_ACCESS_TOKEN = data.value;
        console.log("[Token] Loaded token from Supabase config");
    }
    catch (err) {
        console.error("[Token] Failed to load from Supabase:", err);
    }
}
let lastTokenRequestDate = "";
function scheduleTokenRequest() {
    setInterval(() => {
        const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        const day = ist.getDay();
        if (day === 0 || day === 6)
            return; // skip weekends
        const hh = String(ist.getHours()).padStart(2, "0");
        const mm = String(ist.getMinutes()).padStart(2, "0");
        const today = ist.toISOString().split("T")[0];
        if (`${hh}:${mm}` !== "08:30" || lastTokenRequestDate === today)
            return;
        lastTokenRequestDate = today;
        fetch("https://api.upstox.com/v3/login/auth/token/request/7NAEVR", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_secret: process.env.UPSTOX_API_SECRET }),
        })
            .then(() => console.log("[Token] Approval request sent — check Upstox app to approve"))
            .catch((err) => console.error("[Token] Failed to send approval request:", err));
    }, 60000);
}
// ══════════════════════════════════════════════════════════════
// Express health endpoints
// ══════════════════════════════════════════════════════════════
const app = (0, express_1.default)();
app.use(express_1.default.json());
const PORT = Number(process.env.PORT ?? process.env.TRADING_SERVER_PORT ?? 4000);
app.get("/ping", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
});
app.get("/health", (_req, res) => {
    res.json({
        status: "running",
        marketOpen: isMarketOpen(),
        candles: niftyCandles.length,
        prices: {
            nifty: lastNiftyPrice,
            banknifty: lastBankniftyPrice,
            sensex: lastSensexPrice,
        },
        timestamp: new Date().toISOString(),
    });
});
app.get("/candles", (_req, res) => {
    res.json({ count: niftyCandles.length, candles: niftyCandles.slice(-20) });
});
app.get("/btc/status", (_req, res) => {
    res.json({ btcPrice, btcCandles: btcCandles.length, activeBots: BOTS.length });
});
app.post("/api/upstox/token-webhook", async (req, res) => {
    const { access_token, message_type } = req.body;
    if (message_type !== "access_token" || !access_token) {
        res.json({ received: true });
        return;
    }
    // Update in-memory token immediately
    process.env.UPSTOX_ACCESS_TOKEN = access_token;
    // Persist to Supabase config table
    const { error } = await supabase
        .from("config")
        .upsert({ key: "UPSTOX_ACCESS_TOKEN", value: access_token }, { onConflict: "key" });
    if (error) {
        console.error("[Token] Failed to save to Supabase:", error.message);
    }
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
console.log(`[Server] Upstox token set: ${!!process.env.UPSTOX_ACCESS_TOKEN}`);
if (process.env.UPSTOX_ANALYTICS_TOKEN) {
    console.log("[Token] Using Analytics Token for market data (expires 2027)");
}
else {
    console.warn("[Token] UPSTOX_ANALYTICS_TOKEN not set — falling back to UPSTOX_ACCESS_TOKEN for market data");
}
// Load Upstox token from Supabase config (overwrites .env value if present)
loadTokenFromSupabase().catch(console.error);
// Fetch live USD/INR rate immediately; getUsdToInr() will lazy-refresh every hour
refreshUsdToInr().catch(console.error);
// Schedule daily 8:30 AM IST token approval request
scheduleTokenRequest();
// Kick off immediately, then repeat
pollLTP();
setInterval(pollLTP, 1000);
runTradingCycle();
setInterval(runTradingCycle, 15000);
// BTC — Binance live feed + trading cycle
connectBinanceWS();
runBtcTradingCycle();
setInterval(runBtcTradingCycle, 15 * 60 * 1000);
