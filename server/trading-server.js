"use strict";
// RAILWAY_CACHE_BUST: 2026-06-10b
/**
 * AI Trading Arena — Strategy-based Trading Server
 *
 * Rule-based strategy execution for 6 equity strategies + 4 BTC strategies.
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
dotenv.config({ path: path_1.default.resolve(process.cwd(), ".env.local") });
// ── Global error handlers — prevent process crash on unhandled rejections ──
process.on("uncaughtException", (err) => {
    console.error("[Server] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
    console.error("[Server] Unhandled rejection:", reason);
});
process.on("SIGTERM", () => {
    console.log("[Server] SIGTERM received — shutting down");
    process.exit(0);
});
const express_1 = __importDefault(require("express"));
const supabase_js_1 = require("@supabase/supabase-js");
const ws_1 = __importDefault(require("ws"));
// ══════════════════════════════════════════════════════════════
// Supabase
// ══════════════════════════════════════════════════════════════
const supabase = (0, supabase_js_1.createClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { realtime: { transport: ws_1.default } });
// ══════════════════════════════════════════════════════════════
// In-memory market state
// ══════════════════════════════════════════════════════════════
let lastNiftyPrice = 0;
let lastBankniftyPrice = 0;
let lastSensexPrice = 0;
let lastGiftNiftyPrice = 0;
let lastVix = 0;
// BTC (unchanged)
let btcPrice = 0;
let ethPrice = 0;
let lastBtcLogTime = 0;
// USD/INR
let cachedUsdToInr = 84;
let lastUsdInrFetch = 0;
const candleStores = {};
const MAX_CANDLES = 500;
// ── Option chain cache ───────────────────────────────────────
// Key: "NIFTY" | "BANKNIFTY" | "SENSEX"
// Stores last 12 snapshots (1 hour at 5-min polling)
const optionChainHistory = {};
// Fast lookup: symbol → current LTP
// Key format: "NIFTY 2026-06-12 23400 CE"
const optionPriceCache = {};
// Peak premiums for open positions (in-memory, intraday only)
const peakPremiums = {}; // posId → peak premium
// ── Daily gap state (Strategy 6) ────────────────────────────
let dailyGapPct = 0;
let gapCalcDate = "";
let orbHigh = {}; // "NIFTY" → ORB high
let orbLow = {}; // "NIFTY" → ORB low
let orbSet = {};
let prevDayClose = {}; // "NIFTY" → prev day close
// ── Per-strategy daily trade counters ───────────────────────
const dailyTradeCounts = {};
let tradeDateStr = "";
// ══════════════════════════════════════════════════════════════
// Utility: IST time
// ══════════════════════════════════════════════════════════════
function getIST() {
    // UTC+5:30 — avoids toLocaleString ICU dependency on Railway
    return new Date(Date.now() + (5 * 60 + 30) * 60000);
}
function istMins() {
    const d = getIST();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function todayIST() {
    const d = getIST();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function isMarketOpen() {
    const d = getIST();
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6)
        return false;
    const m = d.getUTCHours() * 60 + d.getUTCMinutes();
    return m >= 555 && m <= 930; // 9:15–15:30
}
// Reset daily counters at start of day
function checkDailyReset() {
    const today = todayIST();
    if (tradeDateStr !== today) {
        tradeDateStr = today;
        for (const k of Object.keys(dailyTradeCounts))
            dailyTradeCounts[k] = 0;
        // Reset ORB state
        for (const k of Object.keys(orbSet))
            orbSet[k] = false;
        // Clear expiry day cache
        for (const k of Object.keys(expiryDayCache))
            delete expiryDayCache[k];
        gapCalcDate = "";
        console.log(`[Daily] Reset for ${today}`);
    }
}
// ── Expiry / danger window helpers ────────────────────────────
const expiryDayCache = {};
async function isExpiryDay(index) {
    const today = todayIST();
    const cacheKey = `${today}_${index}`;
    if (expiryDayCache[cacheKey] !== undefined)
        return expiryDayCache[cacheKey];
    const dayOfWeek = getIST().getUTCDay(); // 0=Sun,2=Tue,4=Thu
    const targetDay = (index === "SENSEX") ? 4 : 2; // SENSEX=Thu, others=Tue
    if (dayOfWeek !== targetDay) {
        expiryDayCache[cacheKey] = false;
        return false;
    }
    const { data } = await supabase.from("nse_holidays").select("date").eq("date", today).limit(1);
    const result = (data?.length ?? 0) === 0; // not a holiday → expiry day
    expiryDayCache[cacheKey] = result;
    return result;
}
// Danger windows: 11:30 12:30 13:00 14:00 14:45 15:00 IST (in minutes from midnight)
const DANGER_WINDOW_MINS = [690, 750, 780, 840, 885, 900];
function isDangerWindow() {
    const m = istMins();
    return DANGER_WINDOW_MINS.some(dw => m >= dw && m < dw + 15);
}
function isOIRising(index) {
    const history = optionChainHistory[index];
    if (!history || history.length < 2)
        return true;
    const latest = history[history.length - 1];
    const prev = history[history.length - 2];
    const latestOI = latest.rows.reduce((s, r) => s + r.ceOI + r.peOI, 0);
    const prevOI = prev.rows.reduce((s, r) => s + r.ceOI + r.peOI, 0);
    return latestOI >= prevOI;
}
// ══════════════════════════════════════════════════════════════
// Candle builders
// ══════════════════════════════════════════════════════════════
const INTERVALS = {
    "30s": 30000,
    "1m": 60000,
    "5m": 5 * 60000,
    "15m": 15 * 60000,
};
function processTick(price, symbol, tsMs) {
    for (const [interval, duration] of Object.entries(INTERVALS)) {
        const key = `${symbol}_${interval}`;
        const bucket = Math.floor(tsMs / duration) * duration;
        if (!candleStores[key]) {
            candleStores[key] = { candles: [], current: null, bucket: 0 };
        }
        const store = candleStores[key];
        if (!store.current) {
            store.current = { open: price, high: price, low: price, close: price, time: bucket, ticks: 1 };
            store.bucket = bucket;
            continue;
        }
        if (bucket !== store.bucket) {
            store.candles.push({ ...store.current });
            if (store.candles.length > MAX_CANDLES)
                store.candles.shift();
            store.current = { open: price, high: price, low: price, close: price, time: bucket, ticks: 1 };
            store.bucket = bucket;
            continue;
        }
        store.current.high = Math.max(store.current.high, price);
        store.current.low = Math.min(store.current.low, price);
        store.current.close = price;
        store.current.ticks = (store.current.ticks ?? 0) + 1;
    }
}
function getCandles(symbol, interval) {
    const store = candleStores[`${symbol}_${interval}`];
    if (!store)
        return [];
    const all = [...store.candles];
    if (store.current)
        all.push({ ...store.current });
    return all;
}
// ══════════════════════════════════════════════════════════════
// Indicators
// ══════════════════════════════════════════════════════════════
function emaValues(values, period) {
    if (values.length === 0)
        return [];
    const mult = 2 / (period + 1);
    let ema = values[0];
    const result = [ema];
    for (let i = 1; i < values.length; i++) {
        ema = (values[i] - ema) * mult + ema;
        result.push(ema);
    }
    return result;
}
function calcEMA(candles, period) {
    if (candles.length < period)
        return 0;
    const vals = emaValues(candles.map(c => c.close), period);
    return vals[vals.length - 1];
}
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
    return 100 - 100 / (1 + avgGain / avgLoss);
}
function calcATR(candles, period = 14) {
    if (candles.length < period + 1)
        return 0;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
    }
    const recent = trs.slice(-period);
    return recent.reduce((s, v) => s + v, 0) / period;
}
function calcVWAP(candles) {
    // Only use today's session (9:15 AM IST onwards) — must anchor to today's DATE
    // not just time-of-day, otherwise multi-day historical candles skew the VWAP
    const istD2 = getIST();
    const istMidnight2 = Date.UTC(istD2.getUTCFullYear(), istD2.getUTCMonth(), istD2.getUTCDate()) - (5 * 60 + 30) * 60000;
    const sessionStart = istMidnight2 + (9 * 60 + 15) * 60000; // 9:15 AM IST today
    const todayCandles = candles.filter(c => c.time >= sessionStart);
    if (!todayCandles.length)
        return candles[candles.length - 1]?.close ?? 0;
    const sum = todayCandles.reduce((s, c) => s + (c.high + c.low + c.close) / 3, 0);
    return sum / todayCandles.length;
}
function calcFibLevels(high, low) {
    const r = high - low;
    return {
        "0": low,
        "23.6": low + r * 0.236,
        "38.2": low + r * 0.382,
        "50": low + r * 0.5,
        "61.8": low + r * 0.618,
        "78.6": low + r * 0.786,
        "100": high,
    };
}
// Proper Supertrend with flip detection
function calcSupertrendSeries(candles, period, multiplier) {
    if (candles.length < period + 1)
        return [];
    // True Range
    const tr = [0];
    for (let i = 1; i < candles.length; i++) {
        tr.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
    }
    // Wilder smoothed ATR
    const atr = new Array(candles.length).fill(0);
    let sum = 0;
    for (let i = 1; i <= period; i++)
        sum += tr[i];
    atr[period] = sum / period;
    for (let i = period + 1; i < candles.length; i++) {
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
    // Basic bands
    const basicUpper = new Array(candles.length).fill(0);
    const basicLower = new Array(candles.length).fill(0);
    for (let i = period; i < candles.length; i++) {
        const hl2 = (candles[i].high + candles[i].low) / 2;
        basicUpper[i] = hl2 + multiplier * atr[i];
        basicLower[i] = hl2 - multiplier * atr[i];
    }
    // Adjusted bands
    const finalUpper = [...basicUpper];
    const finalLower = [...basicLower];
    for (let i = period + 1; i < candles.length; i++) {
        finalUpper[i] = (basicUpper[i] < finalUpper[i - 1] || candles[i - 1].close > finalUpper[i - 1])
            ? basicUpper[i] : finalUpper[i - 1];
        finalLower[i] = (basicLower[i] > finalLower[i - 1] || candles[i - 1].close < finalLower[i - 1])
            ? basicLower[i] : finalLower[i - 1];
    }
    // Supertrend direction
    const result = new Array(candles.length).fill({ value: 0, dir: "up" });
    result[period] = { value: finalUpper[period], dir: "down" };
    for (let i = period + 1; i < candles.length; i++) {
        const prevDir = result[i - 1].dir;
        let value, dir;
        if (prevDir === "down") {
            if (candles[i].close > finalUpper[i]) {
                value = finalLower[i];
                dir = "up";
            }
            else {
                value = finalUpper[i];
                dir = "down";
            }
        }
        else {
            if (candles[i].close < finalLower[i]) {
                value = finalUpper[i];
                dir = "down";
            }
            else {
                value = finalLower[i];
                dir = "up";
            }
        }
        result[i] = { value, dir };
    }
    return result.slice(period);
}
// ══════════════════════════════════════════════════════════════
// Upstox API
// ══════════════════════════════════════════════════════════════
const OPTION_KEYS = {
    NIFTY: "NSE_INDEX|Nifty 50",
    BANKNIFTY: "NSE_INDEX|Nifty Bank",
    SENSEX: "BSE_INDEX|SENSEX",
};
function upstoxToken() {
    // Prefer daily OAuth token (set via webhook) — use analytics token only as fallback
    // Analytics token was taking priority but is returning 401; OAuth token is always fresh
    return process.env.UPSTOX_ACCESS_TOKEN || process.env.UPSTOX_ANALYTICS_TOKEN || "";
}
async function fetchIndexLTP() {
    const token = upstoxToken();
    if (!token)
        return {};
    const rawKeys = [
        "NSE_INDEX|Nifty 50",
        "NSE_INDEX|Nifty Bank",
        "BSE_INDEX|SENSEX",
        "NSE_INDEX|GIFT Nifty",
        "NSE_INDEX|India VIX",
    ];
    const keys = rawKeys.map(encodeURIComponent).join(",");
    try {
        const res = await fetch(`https://api.upstox.com/v2/market-quote/ltp?instrument_key=${keys}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
        if (!res.ok)
            return {};
        const json = await res.json();
        const keyMap = {
            "NSE_INDEX:Nifty 50": "NIFTY",
            "NSE_INDEX:Nifty Bank": "BANKNIFTY",
            "BSE_INDEX:SENSEX": "SENSEX",
            "NSE_INDEX:GIFT Nifty": "GIFT_NIFTY",
            "NSE_INDEX:India VIX": "VIX",
        };
        const prices = {};
        for (const [k, v] of Object.entries(json.data ?? {})) {
            const sym = keyMap[k];
            if (sym && v?.last_price)
                prices[sym] = Number(v.last_price.toFixed(2));
        }
        return prices;
    }
    catch (err) {
        console.error("[LTP] Fetch error:", err);
        return {};
    }
}
// Expiry helpers
function getDTE(expiryStr) {
    const expiry = new Date(expiryStr);
    expiry.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((expiry.getTime() - today.getTime()) / 86400000));
}
function nextWeekday(weekday) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(today);
    const diff = (weekday - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
    return d;
}
// Cache of expiry dates fetched from Upstox to avoid repeated API calls
const expiryCache = {};
async function getWeeklyExpiry(index) {
    // Try to fetch available expiries from Upstox and pick nearest upcoming one
    const cached = expiryCache[index];
    if (cached && Date.now() - cached.fetchedAt < 3600000) {
        return cached.expiry;
    }
    const token = upstoxToken();
    if (token) {
        try {
            const instrKey = OPTION_KEYS[index];
            const url = new URL("https://api.upstox.com/v2/option/contract");
            url.searchParams.set("instrument_key", instrKey);
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            });
            if (res.ok) {
                const json = await res.json();
                const today = todayIST();
                const expiries = (json.data ?? [])
                    .map(e => e.expiry ?? "")
                    .filter(e => e >= today)
                    .sort();
                if (expiries.length > 0) {
                    const expiry = expiries[0];
                    expiryCache[index] = { expiry, fetchedAt: Date.now() };
                    console.log(`[Expiry:${index}] Fetched from Upstox: ${expiry}`);
                    return expiry;
                }
            }
        }
        catch (err) {
            console.warn(`[Expiry:${index}] Upstox contract fetch failed:`, err);
        }
    }
    // Fallback: compute manually
    if (index === "BANKNIFTY") {
        // BANKNIFTY: monthly expiry — last Thursday of current month
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth();
        const lastDay = new Date(Date.UTC(year, month + 1, 0));
        const diff = (lastDay.getUTCDay() - 4 + 7) % 7;
        lastDay.setUTCDate(lastDay.getUTCDate() - diff);
        const today = new Date(Date.UTC(year, month, now.getUTCDate()));
        if (today > lastDay) {
            const nm = month + 1 > 11 ? 0 : month + 1;
            const ny = month + 1 > 11 ? year + 1 : year;
            const nld = new Date(Date.UTC(ny, nm + 1, 0));
            const nd = (nld.getUTCDay() - 4 + 7) % 7;
            nld.setUTCDate(nld.getUTCDate() - nd);
            return nld.toISOString().split("T")[0];
        }
        return lastDay.toISOString().split("T")[0];
    }
    // NIFTY: weekly Tuesday; SENSEX: weekly Thursday
    const weekday = index === "SENSEX" ? 4 : 2;
    const d = nextWeekday(weekday);
    return d.toISOString().split("T")[0];
}
async function fetchFullOptionChain(index, expiry) {
    const token = upstoxToken();
    if (!token)
        return null;
    const instrKey = OPTION_KEYS[index];
    if (!instrKey)
        return null;
    try {
        const url = new URL("https://api.upstox.com/v2/option/chain");
        url.searchParams.set("instrument_key", instrKey);
        url.searchParams.set("expiry_date", expiry);
        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        if (!res.ok) {
            let body = "";
            try {
                body = await res.text();
            }
            catch { /* ignore */ }
            console.error(`[OptionChain:${index}] HTTP ${res.status} ${res.statusText} | expiry=${expiry} | body: ${body.slice(0, 400)}`);
            return null;
        }
        const json = await res.json();
        const chain = json.data ?? [];
        if (!chain.length) {
            console.warn(`[OptionChain:${index}] Empty data array (expiry ${expiry}) — wrong expiry date?`);
            return null;
        }
        const spotPrice = chain[0].underlying_spot_price ?? 0;
        const atmStrike = chain.reduce((nearest, row) => Math.abs(row.strike_price - spotPrice) < Math.abs(nearest - spotPrice)
            ? row.strike_price : nearest, chain[0].strike_price);
        let totalCE_OI = 0, totalPE_OI = 0;
        const rows = chain.map(row => {
            const ceOI = row.call_options?.market_data?.oi ?? 0;
            const peOI = row.put_options?.market_data?.oi ?? 0;
            totalCE_OI += ceOI;
            totalPE_OI += peOI;
            return {
                strike: row.strike_price,
                cePremium: row.call_options?.market_data?.ltp ?? 0,
                pePremium: row.put_options?.market_data?.ltp ?? 0,
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
    }
    catch (err) {
        console.error(`[OptionChain:${index}] Error:`, err);
        return null;
    }
}
function formatExpiryDDMMM(dateStr) {
    const d = new Date(dateStr);
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return `${String(d.getDate()).padStart(2, "0")}${months[d.getMonth()]}`;
}
function getLatestChain(index) {
    const hist = optionChainHistory[index];
    if (!hist?.length)
        return null;
    return hist[hist.length - 1];
}
function getATMOption(chain, type, premMin = 60, premMax = 70) {
    const field = type === "CE" ? "cePremium" : "pePremium";
    const target = (premMin + premMax) / 2;
    const candidates = chain.rows
        .filter(r => r[field] >= premMin && r[field] <= premMax)
        .sort((a, b) => Math.abs(a[field] - target) - Math.abs(b[field] - target));
    if (!candidates.length)
        return null;
    const best = candidates[0];
    const expiryFmt = formatExpiryDDMMM(chain.expiry);
    return {
        strike: best.strike,
        premium: best[field],
        symbol: `NIFTY ${expiryFmt} ${best.strike} ${type}`,
    };
}
function getATMOptionForIndex(chain, index, type, premMin = 60, premMax = 70) {
    const field = type === "CE" ? "cePremium" : "pePremium";
    const target = (premMin + premMax) / 2;
    const candidates = chain.rows
        .filter(r => r[field] >= premMin && r[field] <= premMax)
        .sort((a, b) => Math.abs(a[field] - target) - Math.abs(b[field] - target));
    if (!candidates.length)
        return null;
    const best = candidates[0];
    const expiryFmt = formatExpiryDDMMM(chain.expiry);
    return {
        strike: best.strike,
        premium: best[field],
        symbol: `${index} ${expiryFmt} ${best.strike} ${type}`,
    };
}
function getCurrentPrice(symbol) {
    return optionPriceCache[symbol] ?? 0;
}
// OI change: compare latest snapshot vs snapshot N minutes ago
function getOIChangeForATM(index, type, minutesAgo) {
    const hist = optionChainHistory[index];
    if (!hist || hist.length < 2)
        return null;
    const latest = hist[hist.length - 1];
    const cutoff = latest.timestamp - minutesAgo * 60000;
    const old = hist.find(h => h.timestamp <= cutoff) ?? hist[0];
    const atmStr = latest.atmStrike;
    const latestRow = latest.rows.find(r => r.strike === atmStr);
    const oldRow = old.rows.find(r => r.strike === atmStr);
    if (!latestRow || !oldRow)
        return null;
    const current = type === "CE" ? latestRow.ceOI : latestRow.peOI;
    const previous = type === "CE" ? oldRow.ceOI : oldRow.peOI;
    const pctChange = previous > 0 ? ((current - previous) / previous) * 100 : 0;
    return { current, previous, pctChange };
}
// ══════════════════════════════════════════════════════════════
// Option chain poller — every 60 seconds
// ══════════════════════════════════════════════════════════════
async function pollOptionChain() {
    if (!isMarketOpen())
        return;
    const indices = ["NIFTY", "BANKNIFTY", "SENSEX"];
    for (const index of indices) {
        try {
            const expiry = await getWeeklyExpiry(index);
            const chain = await fetchFullOptionChain(index, expiry);
            if (!chain) {
                console.warn(`[Chain:${index}] No data returned (expiry ${expiry})`);
                continue;
            }
            if (!optionChainHistory[index])
                optionChainHistory[index] = [];
            optionChainHistory[index].push(chain);
            if (optionChainHistory[index].length > 12)
                optionChainHistory[index].shift();
            console.log(`[Chain:${index}] PCR: ${chain.pcr.toFixed(2)} | ATM: ${chain.atmStrike} | VIX: ${lastVix.toFixed(1)}`);
        }
        catch (err) {
            console.error(`[Chain:${index}] Error:`, err);
        }
    }
}
// ══════════════════════════════════════════════════════════════
// Strategy DB helpers
// ══════════════════════════════════════════════════════════════
async function getOpenStrategyPositions(strategyId) {
    const { data } = await supabase
        .from("strategy_positions")
        .select("*")
        .eq("strategy_id", strategyId)
        .eq("status", "OPEN");
    return (data ?? []);
}
async function openStrategyPosition(strategyId, pos) {
    const { error } = await supabase.from("strategy_positions").insert({
        strategy_id: strategyId,
        symbol: pos.symbol,
        type: pos.type,
        side: pos.side ?? "LONG",
        entry_price: pos.entry_price,
        current_price: pos.entry_price,
        exit_price: null,
        quantity: pos.quantity,
        stop_loss: pos.stop_loss,
        trail_sl: null,
        pnl: 0,
        status: "OPEN",
        opened_at: new Date().toISOString(),
    });
    if (error) {
        console.error(`[DB] openStrategyPosition(${strategyId}) error:`, error.message);
    }
    else {
        dailyTradeCounts[strategyId] = (dailyTradeCounts[strategyId] ?? 0) + 1;
        console.log(`[${strategyId}] OPENED ${pos.type} ${pos.symbol} @ ₹${pos.entry_price} | SL: ₹${pos.stop_loss}`);
    }
}
function generateExitDetail(reason, pos, exitPrice, peakPremium) {
    const ist = getIST();
    const timeStr = `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")} IST`;
    const SL_PCT = { ema_crossover: 15, ema_confluence: 15, orion: 30, supertrend: 20, pcr_reversal: 25, gap_orb: 20, vwap_scalper: 20 };
    const TRAIL_PCT = { ema_crossover: 10, ema_confluence: 10, orion: 15, supertrend: 12, pcr_reversal: 12, gap_orb: 12, vwap_scalper: 12 };
    const CLOSE_TIME = { ema_crossover: "3:00 PM", orion: "2:00 PM", ema_confluence: "3:00 PM", supertrend: "3:00 PM", pcr_reversal: "3:00 PM", gap_orb: "3:00 PM", vwap_scalper: "3:00 PM" };
    switch (reason) {
        case "SL_HIT": {
            const pct = SL_PCT[pos.strategy_id] ?? 15;
            const sl = pos.stop_loss ?? Number((pos.entry_price * (1 - pct / 100)).toFixed(2));
            return `Stop loss hit at ${timeStr}. Entry: ₹${pos.entry_price.toFixed(2)}. SL was set at ${pct}% below entry = ₹${sl.toFixed(2)}. Price dropped to ₹${exitPrice.toFixed(2)}.`;
        }
        case "CROSSOVER": {
            if (pos.strategy_id === "supertrend") {
                const flip = pos.type === "CE" ? "red (bearish)" : "green (bullish)";
                return `Supertrend flipped ${flip} at ${timeStr}. Opposite signal triggered — position closed.`;
            }
            const cross = pos.type === "CE" ? "16 EMA crossed below 64 EMA" : "16 EMA crossed above 64 EMA";
            return `${cross} at ${timeStr}. Opposite crossover signal — position closed and flip trade entered.`;
        }
        case "TRAIL_SL": {
            const tpct = TRAIL_PCT[pos.strategy_id] ?? 10;
            const peak = peakPremium ?? (pos.trail_sl != null ? Number((pos.trail_sl / (1 - tpct / 100)).toFixed(2)) : null);
            const trail = pos.trail_sl ?? (peak != null ? Number((peak * (1 - tpct / 100)).toFixed(2)) : null);
            if (peak != null && trail != null) {
                return `Trailing stop loss triggered at ${timeStr}. Premium peaked at ₹${peak.toFixed(2)}, trail SL was ${tpct}% below peak = ₹${trail.toFixed(2)}. Price dropped to ₹${exitPrice.toFixed(2)}.`;
            }
            return `Trailing stop loss triggered at ${timeStr}. Price dropped to ₹${exitPrice.toFixed(2)}.`;
        }
        case "HARD_CLOSE":
            return `Position closed at ${CLOSE_TIME[pos.strategy_id] ?? "3:00 PM"} per the hard close rule.`;
        case "PCR_NEUTRAL":
            return `PCR reverted to neutral zone (0.9–1.1) at ${timeStr}. Mean-reversion complete — signal no longer valid.`;
        case "OI_REVERSE": {
            const opposite = pos.type === "CE" ? "PE" : "CE";
            return `${opposite} OI buildup detected at ${timeStr}. Opposite side strengthening — position closed to avoid reversal.`;
        }
        case "TARGET":
        case "GAP_FILL":
            return `Gap fill target reached at ${timeStr}. Price returned to previous day's close level. Trade objective achieved at ₹${exitPrice.toFixed(2)}.`;
        case "VWAP_CROSS":
            return `Price crossed VWAP in opposite direction at ${timeStr}. ${pos.type === "CE" ? "Price fell below" : "Price rose above"} VWAP — exit signal triggered at ₹${exitPrice.toFixed(2)}.`;
        default:
            return `Position closed at ${timeStr}. Reason: ${reason}. Exit: ₹${exitPrice.toFixed(2)}.`;
    }
}
async function closeStrategyPosition(posId, exitPrice, reason) {
    const { data: pos } = await supabase
        .from("strategy_positions")
        .select("entry_price, quantity, strategy_id, symbol, type, stop_loss, trail_sl")
        .eq("id", posId)
        .single();
    if (!pos)
        return;
    const p = pos;
    const pnl = (exitPrice - p.entry_price) * p.quantity;
    const detail = generateExitDetail(reason, p, exitPrice, peakPremiums[posId]);
    const { error } = await supabase.from("strategy_positions").update({
        status: "CLOSED",
        exit_price: exitPrice,
        current_price: exitPrice,
        pnl: Number(pnl.toFixed(2)),
        closed_at: new Date().toISOString(),
        exit_reason: reason,
        exit_reason_detail: detail,
    }).eq("id", posId);
    if (error) {
        console.error(`[DB] closeStrategyPosition(${posId}) error:`, error.message);
    }
    else {
        console.log(`[${p.strategy_id}] CLOSED ${p.symbol} @ ₹${exitPrice} | PnL: ${pnl >= 0 ? "+" : ""}₹${pnl.toFixed(2)} | ${reason}`);
        delete peakPremiums[posId];
        await updateStrategyCapital(p.strategy_id);
    }
}
async function updateStrategyCapital(strategyId) {
    const { data } = await supabase
        .from("strategy_positions")
        .select("pnl, status")
        .eq("strategy_id", strategyId);
    const positions = (data ?? []);
    const closed = positions.filter(p => p.status === "CLOSED");
    const totalPnl = closed.reduce((s, p) => s + (p.pnl ?? 0), 0);
    const wins = closed.filter(p => (p.pnl ?? 0) > 0).length;
    const winRate = closed.length > 0 ? wins / closed.length : 0;
    const currentVal = 100000 + totalPnl;
    // Simple Sharpe: (return / std) using daily trade PnLs
    let sharpe = 0;
    if (closed.length >= 2) {
        const pnls = closed.map(p => p.pnl ?? 0);
        const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
        const std = Math.sqrt(pnls.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / pnls.length);
        sharpe = std > 0 ? mean / std : 0;
    }
    await supabase.from("strategy_capital").update({
        total_pnl: Number(totalPnl.toFixed(2)),
        current_value: Number(currentVal.toFixed(2)),
        peak_capital: Number(Math.max(currentVal, 100000).toFixed(2)),
        win_rate: Number(winRate.toFixed(4)),
        sharpe_ratio: Number(sharpe.toFixed(4)),
        today_trades: dailyTradeCounts[strategyId] ?? 0,
        lifetime_trades: closed.length,
        updated_at: new Date().toISOString(),
    }).eq("strategy_id", strategyId);
}
// ══════════════════════════════════════════════════════════════
// Position Monitor — runs every 30s
// ══════════════════════════════════════════════════════════════
async function monitorOpenPositions() {
    if (!isMarketOpen())
        return;
    const { data } = await supabase
        .from("strategy_positions")
        .select("*")
        .eq("status", "OPEN");
    if (!data?.length)
        return;
    const HARD_CLOSE_MINS = {
        ema_crossover: 900, // 15:00
        orion: 840, // 14:00
        ema_confluence: 900,
        supertrend: 900,
        pcr_reversal: 900,
        gap_orb: 900,
        vwap_scalper: 900, // 15:00
    };
    const currentMins = istMins();
    for (const raw of data) {
        const pos = raw;
        const currentPrice = getCurrentPrice(pos.symbol);
        if (!currentPrice || currentPrice <= 0)
            continue;
        // Track peak
        if (!peakPremiums[pos.id] || currentPrice > peakPremiums[pos.id]) {
            peakPremiums[pos.id] = currentPrice;
        }
        const peak = peakPremiums[pos.id];
        const pnl = (currentPrice - pos.entry_price) * pos.quantity;
        // Update current price + pnl in DB (best effort, fire-and-forget)
        void supabase.from("strategy_positions").update({
            current_price: Number(currentPrice.toFixed(2)),
            pnl: Number(pnl.toFixed(2)),
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
        let trailPct = 0.12;
        if (pos.strategy_id === "ema_crossover" || pos.strategy_id === "ema_confluence") {
            trailActivationPct = 0.20; // approximate 1.5×ATR as 20% move
            trailPct = 0.10;
        }
        else if (pos.strategy_id === "orion") {
            trailActivationPct = 0.35;
            trailPct = 0.15;
        }
        else if (pos.strategy_id === "vwap_scalper") {
            // Tier 1: 25% gain → move SL to breakeven
            if (pnlPct >= 0.25 && pos.stop_loss && pos.stop_loss < pos.entry_price) {
                await supabase.from("strategy_positions").update({ stop_loss: pos.entry_price }).eq("id", pos.id);
            }
            trailActivationPct = 0.35;
            trailPct = 0.12;
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
async function runStrategy1() {
    if (!isMarketOpen())
        return;
    const mins = istMins();
    if (mins < 630 || mins >= 900)
        return; // 10:30–15:00
    const candles = getCandles("NIFTY", "30s");
    if (candles.length < 66) {
        console.log(`[S1] Waiting for candles — have ${candles.length}/66`);
        return;
    }
    const closes = candles.map(c => c.close);
    const fastArr = emaValues(closes, 16);
    const slowArr = emaValues(closes, 64);
    const fastCurr = fastArr[fastArr.length - 1];
    const slowCurr = slowArr[slowArr.length - 1];
    const fastPrev = s1PrevFast || fastArr[fastArr.length - 2];
    const slowPrev = s1PrevSlow || slowArr[slowArr.length - 2];
    const bullCross = fastPrev <= slowPrev && fastCurr > slowCurr;
    const bearCross = fastPrev >= slowPrev && fastCurr < slowCurr;
    s1PrevFast = fastCurr;
    s1PrevSlow = slowCurr;
    const crossTag = bullCross ? "BULL-CROSS↑" : bearCross ? "BEAR-CROSS↓" : "no-cross";
    const atr = calcATR(candles, 14);
    console.log(`[S1] candles=${candles.length} EMA16=${fastCurr.toFixed(1)} EMA64=${slowCurr.toFixed(1)} ATR=${atr.toFixed(1)} | ${crossTag}`);
    if (!bullCross && !bearCross)
        return;
    const optType = bullCross ? "CE" : "PE";
    const openPos = await getOpenStrategyPositions("ema_crossover");
    for (const pos of openPos) {
        if (pos.type !== optType) {
            const cp = getCurrentPrice(pos.symbol);
            if (cp > 0)
                await closeStrategyPosition(pos.id, cp, "CROSSOVER");
        }
        else {
            console.log(`[S1] Already in ${optType} — skipping`);
            return;
        }
    }
    const chain = getLatestChain("NIFTY");
    if (!chain) {
        console.log(`[S1] No option chain data`);
        return;
    }
    const fld = optType === "CE" ? "cePremium" : "pePremium";
    const allPrem = chain.rows.map(r => r[fld]).filter(p => p > 0).sort((a, b) => a - b);
    const option = getATMOption(chain, optType, 60, 70);
    if (!option) {
        console.log(`[S1] SIGNAL ${optType} — no option in ₹60-70 (chain range ₹${allPrem[0]?.toFixed(0) ?? "?"}-${allPrem[allPrem.length - 1]?.toFixed(0) ?? "?"})`);
        return;
    }
    const s1Capital = await getEquityCurrentValue("ema_crossover");
    const s1Quantity = Math.max(1, Math.floor((s1Capital * 0.60) / option.premium));
    console.log(`[S1] SIGNAL ${optType} → ${option.symbol} @ ₹${option.premium} — capital=₹${Math.round(s1Capital).toLocaleString("en-IN")} qty=${s1Quantity} — opening trade`);
    await openStrategyPosition("ema_crossover", {
        symbol: option.symbol,
        type: optType,
        side: "LONG",
        entry_price: option.premium,
        current_price: option.premium,
        quantity: s1Quantity,
        stop_loss: Number((option.premium * 0.85).toFixed(2)),
        trail_sl: null,
        pnl: 0,
        status: "OPEN",
    });
}
// ══════════════════════════════════════════════════════════════
// Strategy 2 — Orion (ORB + VWAP + OI, 9:30–14:00)
// ══════════════════════════════════════════════════════════════
// Max 1 trade per instrument simultaneously
const orionOpenInstruments = new Set();
async function runStrategy2() {
    if (!isMarketOpen())
        return;
    const mins = istMins();
    if (mins < 570 || mins >= 840)
        return; // 9:30–14:00
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
async function runOrionForIndex(index, mins) {
    const candles15m = getCandles(index, "15m");
    if (candles15m.length < 1) {
        console.log(`[S2:${index}] No 15m candles yet`);
        return;
    }
    // Set ORB from the 9:15–9:30 AM candle of TODAY.
    // Search the full array for today's 9:15 candle — candles[0] breaks when
    // historical data is seeded because it points to a candle from days ago.
    if (!orbSet[index]) {
        const istDorb = getIST();
        const istMidOrb = Date.UTC(istDorb.getUTCFullYear(), istDorb.getUTCMonth(), istDorb.getUTCDate()) - (5 * 60 + 30) * 60000;
        const orb915Ms = istMidOrb + (9 * 60 + 15) * 60000; // 9:15 AM IST today in UTC epoch
        const orbCandle = candles15m.find(c => c.time === orb915Ms);
        if (orbCandle) {
            orbHigh[index] = orbCandle.high;
            orbLow[index] = orbCandle.low;
            orbSet[index] = true;
            console.log(`[S2:${index}] ORB set — H:${orbHigh[index]} L:${orbLow[index]}`);
        }
        else {
            const todayFirst = candles15m.filter(c => c.time >= istMidOrb)[0];
            const hint = todayFirst
                ? `earliest today candle: ${new Date(todayFirst.time + (5 * 60 + 30) * 60000).toISOString().slice(11, 16)} IST`
                : "no today candles yet";
            console.log(`[S2:${index}] ORB not set — 9:15 candle not found (${hint})`);
        }
    }
    if (!orbSet[index])
        return;
    // Already have an open trade for this instrument
    if (orionOpenInstruments.has(index)) {
        const openPos = await getOpenStrategyPositions("orion");
        const indexPos = openPos.find(p => p.symbol.startsWith(index));
        if (indexPos) {
            if (mins >= 840) {
                const cp = getCurrentPrice(indexPos.symbol);
                if (cp > 0) {
                    await closeStrategyPosition(indexPos.id, cp, "HARD_CLOSE");
                    orionOpenInstruments.delete(index);
                }
            }
        }
        else {
            orionOpenInstruments.delete(index);
        }
        return;
    }
    const price = index === "NIFTY" ? lastNiftyPrice : index === "BANKNIFTY" ? lastBankniftyPrice : lastSensexPrice;
    if (!price) {
        console.log(`[S2:${index}] No price data`);
        return;
    }
    const candles = getCandles(index, "15m");
    const vwap = calcVWAP(candles);
    const chain = getLatestChain(index);
    if (!chain) {
        console.log(`[S2:${index}] No option chain`);
        return;
    }
    const orbH = orbHigh[index] ?? 0;
    const orbL = orbLow[index] ?? 0;
    const ceBreakout = price > orbH;
    const aboveVwap = price > vwap;
    const ceOIchange = getOIChangeForATM(index, "CE", 5);
    const ceOIrising = ceOIchange ? ceOIchange.pctChange > 0 : true;
    const peBreakout = price < orbL;
    const belowVwap = price < vwap;
    const peOIchange = getOIChangeForATM(index, "PE", 5);
    const peOIrising = peOIchange ? peOIchange.pctChange > 0 : true;
    const ceOIStr = ceOIchange ? `${ceOIchange.pctChange >= 0 ? "+" : ""}${ceOIchange.pctChange.toFixed(1)}%` : "no-hist";
    const peOIStr = peOIchange ? `${peOIchange.pctChange >= 0 ? "+" : ""}${peOIchange.pctChange.toFixed(1)}%` : "no-hist";
    console.log(`[S2:${index}] price=${price.toFixed(0)} ORB H:${orbH} L:${orbL} VWAP=${vwap.toFixed(0)} | CE:brk=${ceBreakout} avwap=${aboveVwap} OI=${ceOIStr} | PE:brk=${peBreakout} bvwap=${belowVwap} OI=${peOIStr}`);
    let optType = null;
    if (ceBreakout && aboveVwap && ceOIrising)
        optType = "CE";
    else if (peBreakout && belowVwap && peOIrising)
        optType = "PE";
    if (!optType)
        return;
    const fld = optType === "CE" ? "cePremium" : "pePremium";
    const allPrem = chain.rows.map(r => r[fld]).filter(p => p > 0).sort((a, b) => a - b);
    const option = getATMOptionForIndex(chain, index, optType, 60, 70);
    if (!option) {
        console.log(`[S2:${index}] SIGNAL ${optType} — no option in ₹60-70 (chain ₹${allPrem[0]?.toFixed(0) ?? "?"}-${allPrem[allPrem.length - 1]?.toFixed(0) ?? "?"})`);
        return;
    }
    const s2Capital = await getEquityCurrentValue("orion");
    const s2Quantity = Math.max(1, Math.floor((s2Capital * 0.30) / option.premium));
    console.log(`[S2:${index}] SIGNAL ${optType} → ${option.symbol} @ ₹${option.premium} — capital=₹${Math.round(s2Capital).toLocaleString("en-IN")} qty=${s2Quantity} — opening trade`);
    await openStrategyPosition("orion", {
        symbol: option.symbol,
        type: optType,
        side: "LONG",
        entry_price: option.premium,
        current_price: option.premium,
        quantity: s2Quantity,
        stop_loss: Number((option.premium * 0.70).toFixed(2)), // 30% SL
        trail_sl: null,
        pnl: 0,
        status: "OPEN",
    });
    orionOpenInstruments.add(index);
}
// ══════════════════════════════════════════════════════════════
// Strategy 3 — EMA Confluence (30s, 10:30–15:00)
// ══════════════════════════════════════════════════════════════
let s3PrevFast = 0;
let s3PrevSlow = 0;
async function runStrategy3() {
    if (!isMarketOpen())
        return;
    const mins = istMins();
    if (mins < 630 || mins >= 900)
        return;
    const candles = getCandles("NIFTY", "30s");
    if (candles.length < 66) {
        console.log(`[S3] Waiting for candles — have ${candles.length}/66`);
        return;
    }
    const openPos = await getOpenStrategyPositions("ema_confluence");
    if (openPos.length >= 1) {
        console.log(`[S3] Position already open (${openPos[0].symbol}) — skipping`);
        return;
    }
    const closes = candles.map(c => c.close);
    const fastArr = emaValues(closes, 16);
    const slowArr = emaValues(closes, 64);
    const fastCurr = fastArr[fastArr.length - 1];
    const slowCurr = slowArr[slowArr.length - 1];
    const fastPrev = s3PrevFast || fastArr[fastArr.length - 2];
    const slowPrev = s3PrevSlow || slowArr[slowArr.length - 2];
    const bullCross = fastPrev <= slowPrev && fastCurr > slowCurr;
    const bearCross = fastPrev >= slowPrev && fastCurr < slowCurr;
    s3PrevFast = fastCurr;
    s3PrevSlow = slowCurr;
    const rsi = calcRSI(candles, 14);
    const vwap = calcVWAP(candles);
    const crossTag = bullCross ? "BULL-CROSS↑" : bearCross ? "BEAR-CROSS↓" : "no-cross";
    console.log(`[S3] candles=${candles.length} EMA16=${fastCurr.toFixed(1)} EMA64=${slowCurr.toFixed(1)} RSI=${rsi.toFixed(1)} VWAP=${vwap.toFixed(0)} price=${lastNiftyPrice.toFixed(0)} | ${crossTag}`);
    if (!bullCross && !bearCross)
        return;
    const optType = bullCross ? "CE" : "PE";
    // Filter 1: RSI
    const rsiOk = optType === "CE" ? rsi < 45 : rsi > 55;
    if (!rsiOk) {
        console.log(`[S3] BLOCKED: RSI=${rsi.toFixed(1)} (CE needs <45, PE needs >55)`);
        return;
    }
    // Filter 2: VWAP
    const vwapOk = optType === "CE" ? lastNiftyPrice > vwap : lastNiftyPrice < vwap;
    if (!vwapOk) {
        console.log(`[S3] BLOCKED: VWAP price=${lastNiftyPrice.toFixed(0)} vwap=${vwap.toFixed(0)}`);
        return;
    }
    // Filter 3: Fibonacci zone
    const recentHighs = candles.slice(-100).map(c => c.high);
    const recentLows = candles.slice(-100).map(c => c.low);
    const fib = calcFibLevels(Math.max(...recentHighs), Math.min(...recentLows));
    const price = lastNiftyPrice;
    const inFibZone = price >= fib["50"] * 0.998 && price <= fib["61.8"] * 1.002;
    if (!inFibZone) {
        console.log(`[S3] BLOCKED: Fib zone price=${price.toFixed(0)} fib50=${fib["50"].toFixed(0)} fib61.8=${fib["61.8"].toFixed(0)}`);
        return;
    }
    const chain = getLatestChain("NIFTY");
    if (!chain) {
        console.log(`[S3] No option chain`);
        return;
    }
    const fld = optType === "CE" ? "cePremium" : "pePremium";
    const allPrem = chain.rows.map(r => r[fld]).filter(p => p > 0).sort((a, b) => a - b);
    const option = getATMOption(chain, optType, 60, 70);
    if (!option) {
        console.log(`[S3] SIGNAL ${optType} — no option in ₹60-70 (chain ₹${allPrem[0]?.toFixed(0) ?? "?"}-${allPrem[allPrem.length - 1]?.toFixed(0) ?? "?"})`);
        return;
    }
    const s3Capital = await getEquityCurrentValue("ema_confluence");
    const s3Quantity = Math.max(1, Math.floor((s3Capital * 0.60) / option.premium));
    console.log(`[S3] SIGNAL ${optType} → ${option.symbol} @ ₹${option.premium} — capital=₹${Math.round(s3Capital).toLocaleString("en-IN")} qty=${s3Quantity} — opening trade`);
    await openStrategyPosition("ema_confluence", {
        symbol: option.symbol,
        type: optType,
        side: "LONG",
        entry_price: option.premium,
        current_price: option.premium,
        quantity: s3Quantity,
        stop_loss: Number((option.premium * 0.85).toFixed(2)),
        trail_sl: null,
        pnl: 0,
        status: "OPEN",
    });
}
// ══════════════════════════════════════════════════════════════
// Strategy 4 — Supertrend (5m candles, 9:45–14:30)
// ══════════════════════════════════════════════════════════════
const s4DailyTrades = {};
async function runStrategy4() {
    if (!isMarketOpen())
        return;
    const mins = istMins();
    if (mins < 585 || mins >= 870)
        return; // 9:45–14:30
    const indices = ["NIFTY", "BANKNIFTY"];
    for (const index of indices) {
        await runSupertrendForIndex(index);
    }
}
async function runSupertrendForIndex(index) {
    const candles5m = getCandles(index, "5m");
    if (candles5m.length < 10) {
        console.log(`[S4:${index}] Waiting for 5m candles — have ${candles5m.length}/10`);
        return;
    }
    const openPos = await getOpenStrategyPositions("supertrend");
    const indexPos = openPos.filter(p => p.symbol.startsWith(index));
    const todayKey = `${index}_${todayIST()}`;
    const dayTrades = s4DailyTrades[todayKey] ?? 0;
    if (dayTrades >= 2) {
        console.log(`[S4:${index}] Daily limit reached (${dayTrades}/2)`);
        return;
    }
    const series = calcSupertrendSeries(candles5m, 7, 3);
    if (series.length < 2) {
        console.log(`[S4:${index}] Supertrend series too short (${series.length})`);
        return;
    }
    const currST = series[series.length - 1];
    const prevST = series[series.length - 2];
    const flipped = currST.dir !== prevST.dir;
    console.log(`[S4:${index}] candles=${candles5m.length} ST=${currST.dir}(line=${currST.value.toFixed(0)}) prev=${prevST.dir} | ${flipped ? "FLIP!" : "no-flip"} | dayTrades=${dayTrades}/2 openPos=${indexPos.length}`);
    if (!flipped)
        return;
    for (const pos of indexPos) {
        const wrongType = currST.dir === "up" ? "PE" : "CE";
        if (pos.type === wrongType) {
            const cp = getCurrentPrice(pos.symbol);
            if (cp > 0)
                await closeStrategyPosition(pos.id, cp, "CROSSOVER");
        }
    }
    if (indexPos.length >= 1) {
        console.log(`[S4:${index}] Position exists — skipping new entry`);
        return;
    }
    const optType = currST.dir === "up" ? "CE" : "PE";
    const chain = getLatestChain(index);
    if (!chain) {
        console.log(`[S4:${index}] No option chain`);
        return;
    }
    const fld = optType === "CE" ? "cePremium" : "pePremium";
    const allPrem = chain.rows.map(r => r[fld]).filter(p => p > 0).sort((a, b) => a - b);
    const option = getATMOptionForIndex(chain, index, optType, 60, 70);
    if (!option) {
        console.log(`[S4:${index}] SIGNAL ${optType} — no option in ₹60-70 (chain ₹${allPrem[0]?.toFixed(0) ?? "?"}-${allPrem[allPrem.length - 1]?.toFixed(0) ?? "?"})`);
        return;
    }
    const s4Capital = await getEquityCurrentValue("supertrend");
    const s4Quantity = Math.max(1, Math.floor((s4Capital * 0.30) / option.premium));
    console.log(`[S4:${index}] SIGNAL ${optType} → ${option.symbol} @ ₹${option.premium} — capital=₹${Math.round(s4Capital).toLocaleString("en-IN")} qty=${s4Quantity} — opening trade`);
    await openStrategyPosition("supertrend", {
        symbol: option.symbol,
        type: optType,
        side: "LONG",
        entry_price: option.premium,
        current_price: option.premium,
        quantity: s4Quantity,
        stop_loss: Number((option.premium * 0.80).toFixed(2)),
        trail_sl: null,
        pnl: 0,
        status: "OPEN",
    });
    s4DailyTrades[todayKey] = dayTrades + 1;
}
// ══════════════════════════════════════════════════════════════
// Strategy 5 — PCR Reversal (5-min checks, 10:00–14:30)
// ══════════════════════════════════════════════════════════════
async function runStrategy5() {
    if (!isMarketOpen())
        return;
    const mins = istMins();
    if (mins < 600 || mins >= 870)
        return; // 10:00–14:30
    const today = todayIST();
    const dayKey = `pcr_reversal_${today}`;
    const dayCount = dailyTradeCounts[dayKey] ?? 0;
    if (dayCount >= 3) {
        console.log(`[S5] Daily limit reached (${dayCount}/3)`);
        return;
    }
    const openPos = await getOpenStrategyPositions("pcr_reversal");
    if (openPos.length >= 1) {
        console.log(`[S5] Position open (${openPos[0].symbol}) — skipping`);
        return;
    }
    const chain = getLatestChain("NIFTY");
    if (!chain) {
        console.log(`[S5] No option chain`);
        return;
    }
    const pcr = chain.pcr;
    const peOI30 = getOIChangeForATM("NIFTY", "PE", 30);
    const ceOI30 = getOIChangeForATM("NIFTY", "CE", 30);
    const peOIStr = peOI30 ? `${peOI30.pctChange >= 0 ? "+" : ""}${peOI30.pctChange.toFixed(1)}%` : "no-hist";
    const ceOIStr = ceOI30 ? `${ceOI30.pctChange >= 0 ? "+" : ""}${ceOI30.pctChange.toFixed(1)}%` : "no-hist";
    console.log(`[S5] PCR=${pcr.toFixed(2)} (need >1.3 or <0.7) | PE-OI-30m=${peOIStr} CE-OI-30m=${ceOIStr} (need <-10%) | trades=${dayCount}/3`);
    let optType = null;
    if (pcr > 1.3) {
        if (peOI30 && peOI30.pctChange <= -10)
            optType = "CE";
        else
            console.log(`[S5] PCR oversold but PE-OI unwind insufficient (${peOIStr})`);
    }
    else if (pcr < 0.7) {
        if (ceOI30 && ceOI30.pctChange <= -10)
            optType = "PE";
        else
            console.log(`[S5] PCR overbought but CE-OI unwind insufficient (${ceOIStr})`);
    }
    if (!optType)
        return;
    const option = getATMOption(chain, optType, 60, 70);
    if (!option)
        return;
    const s5Capital = await getEquityCurrentValue("pcr_reversal");
    const s5Quantity = Math.max(1, Math.floor((s5Capital * 0.60) / option.premium));
    console.log(`[S5] SIGNAL ${optType} → ${option.symbol} @ ₹${option.premium} — capital=₹${Math.round(s5Capital).toLocaleString("en-IN")} qty=${s5Quantity} — opening trade`);
    await openStrategyPosition("pcr_reversal", {
        symbol: option.symbol,
        type: optType,
        side: "LONG",
        entry_price: option.premium,
        current_price: option.premium,
        quantity: s5Quantity,
        stop_loss: Number((option.premium * 0.75).toFixed(2)), // 25% SL
        trail_sl: null,
        pnl: 0,
        status: "OPEN",
    });
    dailyTradeCounts[dayKey] = (dailyTradeCounts[dayKey] ?? 0) + 1;
}
// PCR reversal also monitors for its own exit conditions (PCR neutral / OI reversal)
async function monitorPCRPositions() {
    if (!isMarketOpen())
        return;
    const openPos = await getOpenStrategyPositions("pcr_reversal");
    if (!openPos.length)
        return;
    const chain = getLatestChain("NIFTY");
    if (!chain)
        return;
    const pcr = chain.pcr;
    for (const pos of openPos) {
        // PCR back to neutral zone
        if (pcr >= 0.9 && pcr <= 1.1) {
            const cp = getCurrentPrice(pos.symbol);
            if (cp > 0)
                await closeStrategyPosition(pos.id, cp, "PCR_NEUTRAL");
            continue;
        }
        // OI buildup on opposite side — detect reversal
        const opposite = pos.type === "CE" ? "PE" : "CE";
        const oiChange = getOIChangeForATM("NIFTY", opposite, 5);
        if (oiChange && oiChange.pctChange > 10) {
            // Opposite side building up → exit
            const cp = getCurrentPrice(pos.symbol);
            if (cp > 0)
                await closeStrategyPosition(pos.id, cp, "OI_REVERSE");
        }
    }
}
// ══════════════════════════════════════════════════════════════
// Strategy 6 — Gap + ORB (morning only, before 11:30)
// ══════════════════════════════════════════════════════════════
async function runStrategy6() {
    if (!isMarketOpen())
        return;
    const mins = istMins();
    if (mins >= 690)
        return; // no new trades after 11:30 AM
    const today = todayIST();
    const dayKey = `gap_orb_${today}`;
    const dayCount = dailyTradeCounts[dayKey] ?? 0;
    if (dayCount >= 2) {
        console.log(`[S6] Daily limit reached (${dayCount}/2)`);
        return;
    }
    const openPos = await getOpenStrategyPositions("gap_orb");
    if (openPos.length >= 1) {
        console.log(`[S6] Position open (${openPos[0].symbol}) — skipping`);
        return;
    }
    const pdc = prevDayClose["NIFTY"] ?? 0;
    // Calculate gap at 9:15 AM
    if (!gapCalcDate || gapCalcDate !== today) {
        const allCandles = getCandles("NIFTY", "15m");
        if (allCandles.length < 2) {
            console.log(`[S6] Waiting for 15m candles (${allCandles.length}) to calc gap`);
            return;
        }
        if (!pdc || pdc === 0) {
            console.log(`[S6] prevDayClose=0 — cannot calc gap (server has no PDC data)`);
            return;
        }
        const todayOpen = allCandles[0]?.open ?? lastNiftyPrice;
        dailyGapPct = ((todayOpen - pdc) / pdc) * 100;
        gapCalcDate = today;
        console.log(`[S6] Gap calculated: ${dailyGapPct.toFixed(2)}% | open=${todayOpen} PDC=${pdc}`);
    }
    if (!orbSet["NIFTY"]) {
        console.log(`[S6] ORB not set yet`);
        return;
    }
    const orbH = orbHigh["NIFTY"] ?? 0;
    const orbL = orbLow["NIFTY"] ?? 0;
    const price = lastNiftyPrice;
    const chain = getLatestChain("NIFTY");
    if (!chain) {
        console.log(`[S6] No option chain`);
        return;
    }
    let optType = null;
    let reason = "";
    if (Math.abs(dailyGapPct) < 0.3) {
        if (price > orbH) {
            optType = "CE";
            reason = `ORB breakout CE (price=${price.toFixed(0)} > H=${orbH})`;
        }
        else if (price < orbL) {
            optType = "PE";
            reason = `ORB breakout PE (price=${price.toFixed(0)} < L=${orbL})`;
        }
        else
            reason = `inside ORB (price=${price.toFixed(0)} H=${orbH} L=${orbL})`;
    }
    else if (dailyGapPct > 0.3) {
        if (pdc > 0 && price > pdc && price < orbH) {
            optType = "PE";
            reason = `gap-up fade PE`;
        }
        else
            reason = `gap-up fade: price=${price.toFixed(0)} PDC=${pdc} H=${orbH} — conditions not met`;
    }
    else {
        if (pdc > 0 && price < pdc && price > orbL) {
            optType = "CE";
            reason = `gap-down fade CE`;
        }
        else
            reason = `gap-down fade: price=${price.toFixed(0)} PDC=${pdc} L=${orbL} — conditions not met`;
    }
    console.log(`[S6] gap=${dailyGapPct.toFixed(2)}% ORB H=${orbH} L=${orbL} | ${reason}`);
    if (!optType)
        return;
    const option = getATMOption(chain, optType, 60, 70);
    if (!option)
        return;
    const s6Capital = await getEquityCurrentValue("gap_orb");
    const s6Quantity = Math.max(1, Math.floor((s6Capital * 0.60) / option.premium));
    console.log(`[S6] SIGNAL ${optType} → ${option.symbol} @ ₹${option.premium} — capital=₹${Math.round(s6Capital).toLocaleString("en-IN")} qty=${s6Quantity} — opening trade`);
    await openStrategyPosition("gap_orb", {
        symbol: option.symbol,
        type: optType,
        side: "LONG",
        entry_price: option.premium,
        current_price: option.premium,
        quantity: s6Quantity,
        stop_loss: Number((option.premium * 0.80).toFixed(2)), // 20% SL
        trail_sl: null,
        pnl: 0,
        status: "OPEN",
    });
    dailyTradeCounts[dayKey] = (dailyTradeCounts[dayKey] ?? 0) + 1;
}
// Gap fill exit for gap trades
async function monitorGapOrbPositions() {
    if (!isMarketOpen())
        return;
    const openPos = await getOpenStrategyPositions("gap_orb");
    if (!openPos.length)
        return;
    const pdc = prevDayClose["NIFTY"] ?? 0;
    if (!pdc)
        return;
    const price = lastNiftyPrice;
    for (const pos of openPos) {
        if (Math.abs(dailyGapPct) >= 0.3) {
            // Fade trade — exit at gap fill (price reaches prev day close)
            const isFade_PE = pos.type === "PE" && dailyGapPct > 0;
            const isFade_CE = pos.type === "CE" && dailyGapPct < 0;
            if ((isFade_PE && price <= pdc) || (isFade_CE && price >= pdc)) {
                const cp = getCurrentPrice(pos.symbol);
                if (cp > 0)
                    await closeStrategyPosition(pos.id, cp, "TARGET");
            }
        }
    }
}
// ══════════════════════════════════════════════════════════════
// Strategy 7 — VWAP Momentum Scalper (1m candles, 10:30–15:00)
// ══════════════════════════════════════════════════════════════
async function runStrategy7() {
    for (const index of ["NIFTY", "BANKNIFTY", "SENSEX"]) {
        await runVwapScalperForIndex(index);
    }
}
async function runVwapScalperForIndex(index) {
    if (!isMarketOpen())
        return;
    const mins = istMins();
    if (mins < 630 || mins >= 900)
        return; // 10:30–15:00
    const candles = getCandles(index, "1m");
    const MIN_CANDLES = 22;
    if (candles.length < MIN_CANDLES) {
        console.log(`[S7:${index}] candles=${candles.length}/${MIN_CANDLES} — waiting`);
        return;
    }
    const vwap = calcVWAP(candles);
    const rsi = calcRSI(candles, 14);
    const atr = calcATR(candles, 14);
    const curr = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const prev2 = candles[candles.length - 3];
    const oiRising = isOIRising(index);
    const aboveVwap = curr.close > vwap;
    // Bullish: pullback to VWAP then bounce above
    const bullish = prev.close <= vwap && curr.close > vwap
        && rsi >= 40 && rsi <= 60
        && oiRising
        && prev.low > prev2.low;
    // Bearish: pullback to VWAP then reject below
    const bearish = prev.close >= vwap && curr.close < vwap
        && rsi >= 40 && rsi <= 60
        && oiRising
        && prev.high < prev2.high;
    const signalTag = bullish ? "bull-bounce" : bearish ? "bear-reject" : "no-signal";
    console.log(`[S7:${index}] candles=${candles.length} VWAP=${vwap.toFixed(0)} price=${curr.close.toFixed(0)} RSI=${rsi.toFixed(0)} OI=${oiRising ? "rising" : "flat"} | ${aboveVwap ? "above" : "below"}-vwap | ${signalTag}`);
    if (!bullish && !bearish)
        return;
    const openPositions = await getOpenStrategyPositions("vwap_scalper");
    const indexOpen = openPositions.filter(p => p.symbol.startsWith(index));
    if (indexOpen.length > 0)
        return;
    const type = bullish ? "CE" : "PE";
    const expiryDay = await isExpiryDay(index);
    const danger = expiryDay && isDangerWindow();
    const chain = getLatestChain(index);
    if (!chain) {
        console.log(`[S7:${index}] No option chain data`);
        return;
    }
    const option = getATMOptionForIndex(chain, index, type, 50, 80);
    if (!option) {
        console.log(`[S7:${index}] No option in ₹50-80 range`);
        return;
    }
    const slPct = danger ? 0.10 : 0.20;
    const s7Capital = await getEquityCurrentValue("vwap_scalper");
    const s7BaseQty = Math.max(1, Math.floor((s7Capital * 0.30) / option.premium));
    const qty = danger ? Math.max(1, Math.floor(s7BaseQty / 2)) : s7BaseQty;
    const sl = Number((option.premium * (1 - slPct)).toFixed(2));
    const entryNote = `VWAP ${type === "CE" ? "bounce above" : "reject below"} | RSI=${rsi.toFixed(0)} | ATR=${atr.toFixed(0)}${danger ? " | EXPIRY DANGER" : ""}`;
    console.log(`[S7:${index}] SIGNAL ${type} — premium ₹${option.premium} | capital=₹${Math.round(s7Capital).toLocaleString("en-IN")} qty=${qty}${danger ? " [EXPIRY DANGER half-size]" : ""} | SL=${sl}`);
    await openStrategyPosition("vwap_scalper", {
        symbol: option.symbol,
        type,
        side: "LONG",
        entry_price: option.premium,
        current_price: option.premium,
        quantity: qty,
        stop_loss: sl,
        trail_sl: null,
        pnl: 0,
        status: "OPEN",
    });
    void entryNote; // suppress unused warning
}
async function monitorVwapPositions() {
    if (!isMarketOpen())
        return;
    const openPositions = await getOpenStrategyPositions("vwap_scalper");
    if (!openPositions.length)
        return;
    for (const pos of openPositions) {
        const index = pos.symbol.startsWith("BANKNIFTY")
            ? "BANKNIFTY"
            : pos.symbol.startsWith("SENSEX")
                ? "SENSEX"
                : "NIFTY";
        const candles = getCandles(index, "1m");
        if (candles.length < 2)
            continue;
        const curr = candles[candles.length - 1];
        const vwap = calcVWAP(candles);
        const cp = getCurrentPrice(pos.symbol);
        if (!cp)
            continue;
        // Opposite VWAP cross exit
        if (pos.type === "CE" && curr.close < vwap) {
            await closeStrategyPosition(pos.id, cp, "VWAP_CROSS");
            continue;
        }
        if (pos.type === "PE" && curr.close > vwap) {
            await closeStrategyPosition(pos.id, cp, "VWAP_CROSS");
            continue;
        }
        // Expiry danger window: tighten trail SL to 5% below current price
        const expiryDay = await isExpiryDay(index);
        if (expiryDay && isDangerWindow()) {
            const tightSL = Number((cp * 0.95).toFixed(2));
            if (!pos.trail_sl || tightSL > pos.trail_sl) {
                await supabase.from("strategy_positions").update({ trail_sl: tightSL }).eq("id", pos.id);
            }
        }
    }
}
// ══════════════════════════════════════════════════════════════
// LTP poller — every second
// ══════════════════════════════════════════════════════════════
async function pollLTP() {
    try {
        const prices = await fetchIndexLTP();
        const ts = Date.now();
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
        if (prices.GIFT_NIFTY) {
            lastGiftNiftyPrice = prices.GIFT_NIFTY;
            if (!prevDayClose["GIFT_NIFTY"])
                prevDayClose["GIFT_NIFTY"] = prices.GIFT_NIFTY;
        }
        if (prices.VIX)
            lastVix = prices.VIX;
        if (Object.keys(prices).length) {
            console.log(`[LTP] NIFTY: ${prices.NIFTY ?? "--"} | BNF: ${prices.BANKNIFTY ?? "--"} | VIX: ${prices.VIX ?? "--"}`);
        }
    }
    catch (err) {
        console.error("[LTP] Poll error:", err);
    }
}
// ══════════════════════════════════════════════════════════════
// Main equity strategy loop — every 30s
// ══════════════════════════════════════════════════════════════
let strategyRunning = false;
let lastClosedLog = 0;
async function runEquityStrategies() {
    if (strategyRunning)
        return;
    strategyRunning = true;
    try {
        checkDailyReset();
        const mins = istMins();
        const hh = String(Math.floor(mins / 60)).padStart(2, "0");
        const mm = String(mins % 60).padStart(2, "0");
        if (!isMarketOpen()) {
            if (Date.now() - lastClosedLog > 600000) { // log once every 10 min
                console.log(`[Equity] Market closed — IST ${hh}:${mm}`);
                lastClosedLog = Date.now();
            }
            return;
        }
        console.log(`[Equity] Cycle — IST ${hh}:${mm}`);
        await Promise.allSettled([
            runStrategy1(),
            runStrategy2(),
            runStrategy3(),
            runStrategy4(),
            runStrategy5(),
            runStrategy6(),
            runStrategy7(),
        ]);
        await Promise.allSettled([
            monitorOpenPositions(),
            monitorPCRPositions(),
            monitorGapOrbPositions(),
            monitorVwapPositions(),
        ]);
    }
    catch (err) {
        console.error("[Equity] Strategy loop error:", err);
    }
    finally {
        strategyRunning = false;
    }
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
            console.log(`[FX] USD/INR: ${rate.toFixed(2)}`);
        }
    }
    catch {
        console.warn(`[FX] USD/INR fetch failed — using ₹${cachedUsdToInr}`);
    }
}
function getUsdToInr() {
    if (Date.now() - lastUsdInrFetch > 3600000)
        refreshUsdToInr().catch(() => { });
    return cachedUsdToInr;
}
// ══════════════════════════════════════════════════════════════
// Historical candle seeding — runs once on startup
// Fills candleStores so strategies fire within seconds of boot
// instead of waiting hours for live ticks to accumulate.
// ══════════════════════════════════════════════════════════════
let btcCandlesSeeded = false;
let equityCandlesSeeded = false;
/** Inject a completed historical candle directly into a CandleStore. */
function injectCandle(symbol, interval, candle) {
    const key = `${symbol}_${interval}`;
    if (!candleStores[key]) {
        candleStores[key] = { candles: [], current: null, bucket: 0 };
    }
    const store = candleStores[key];
    // Deduplicate by time bucket
    const last = store.candles[store.candles.length - 1];
    if (last && last.time === candle.time)
        return;
    store.candles.push(candle);
    if (store.candles.length > MAX_CANDLES)
        store.candles.shift();
}
/**
 * Split a 1m candle into two synthetic 30s candles using the
 * (open+close)/2 midpoint as the boundary price.
 * Sufficient for EMA / RSI / VWAP / ATR / Supertrend calculations.
 */
function split1mTo30s(symbol, c) {
    const mid = (c.open + c.close) / 2;
    injectCandle(symbol, "30s", {
        time: c.time,
        open: c.open,
        high: Math.max(c.open, mid),
        low: Math.min(c.open, mid),
        close: mid,
    });
    injectCandle(symbol, "30s", {
        time: c.time + 30000,
        open: mid,
        high: Math.max(mid, c.close),
        low: Math.min(mid, c.close),
        close: c.close,
    });
}
// ── BTC seeding via Kraken REST /0/public/OHLC ───────────────
async function seedBtcCandlesFromKraken() {
    if (btcCandlesSeeded)
        return;
    console.log("[BTC Seed] Fetching historical OHLC from Kraken...");
    const requests = [
        { interval: 1, storeKey: "1m" },
        { interval: 5, storeKey: "5m" },
        { interval: 15, storeKey: "15m" },
    ];
    for (const { interval, storeKey } of requests) {
        try {
            const res = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${interval}`);
            if (!res.ok) {
                console.warn(`[BTC Seed] Kraken ${storeKey} → HTTP ${res.status}`);
                continue;
            }
            const json = await res.json();
            if (json.error?.length) {
                console.warn(`[BTC Seed] Kraken ${storeKey} error: ${json.error.join(", ")}`);
                continue;
            }
            const resultMap = json.result ?? {};
            // Kraken key for XBT/USD is "XXBTZUSD"; fallback: first array value
            const rawData = resultMap["XXBTZUSD"]
                ?? Object.values(resultMap).find(v => Array.isArray(v));
            const pairData = Array.isArray(rawData)
                ? rawData
                : null;
            if (!pairData?.length) {
                console.warn(`[BTC Seed] Kraken ${storeKey}: empty OHLC data`);
                continue;
            }
            // Kraken always appends the current (in-progress) candle as the last row — skip it.
            // Also filter to completed buckets (belt-and-suspenders).
            const durationMs = INTERVALS[storeKey] ?? interval * 60000;
            const currentBucket = Math.floor(Date.now() / durationMs) * durationMs;
            let count = 0;
            for (let i = 0; i < pairData.length - 1; i++) {
                const row = pairData[i];
                const timeMs = row[0] * 1000;
                if (timeMs >= currentBucket)
                    continue; // skip in-progress
                const c = {
                    time: timeMs,
                    open: parseFloat(row[1]),
                    high: parseFloat(row[2]),
                    low: parseFloat(row[3]),
                    close: parseFloat(row[4]),
                };
                injectCandle("BTC", storeKey, c);
                if (storeKey === "1m")
                    split1mTo30s("BTC", c);
                count++;
            }
            const suffix = storeKey === "1m" ? ` (→ ${count * 2} × 30s)` : "";
            console.log(`[BTC Seed] BTC_${storeKey}: ${count} candles${suffix}`);
        }
        catch (err) {
            console.error(`[BTC Seed] Kraken ${storeKey} error:`, err);
        }
    }
    btcCandlesSeeded = true;
    console.log(`[BTC Seed] ✓  30s=${getCandles("BTC", "30s").length}` +
        ` 1m=${getCandles("BTC", "1m").length}` +
        ` 5m=${getCandles("BTC", "5m").length}` +
        ` 15m=${getCandles("BTC", "15m").length}`);
}
// ── Equity seeding via Upstox Historical Candle API ──────────
async function fetchUpstoxHistorical(instrKey, upstoxInterval, fromDate, toDate) {
    const token = upstoxToken();
    if (!token)
        return [];
    const encoded = encodeURIComponent(instrKey);
    const url = `https://api.upstox.com/v2/historical-candle/${encoded}/${upstoxInterval}/${toDate}/${fromDate}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
        console.warn(`[Equity Seed] Historical ${upstoxInterval} HTTP ${res.status} — ${instrKey}`);
        return [];
    }
    const json = await res.json();
    // Upstox returns newest-first → reverse to oldest-first
    return (json.data?.candles ?? []).map(row => ({
        time: new Date(row[0]).getTime(),
        open: row[1],
        high: row[2],
        low: row[3],
        close: row[4],
    })).reverse();
}
async function fetchUpstoxIntraday(instrKey, upstoxInterval) {
    const token = upstoxToken();
    if (!token)
        return [];
    const encoded = encodeURIComponent(instrKey);
    const url = `https://api.upstox.com/v2/historical-candle/intraday/${encoded}/${upstoxInterval}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
        console.warn(`[Equity Seed] Intraday ${upstoxInterval} HTTP ${res.status} — ${instrKey}`);
        return [];
    }
    const json = await res.json();
    return (json.data?.candles ?? []).map(row => ({
        time: new Date(row[0]).getTime(),
        open: row[1],
        high: row[2],
        low: row[3],
        close: row[4],
    })).reverse();
}
async function seedEquityCandlesFromUpstox() {
    if (equityCandlesSeeded)
        return;
    const token = upstoxToken();
    if (!token) {
        console.warn("[Equity Seed] No Upstox token available — skipping equity candle seed");
        return;
    }
    console.log("[Equity Seed] Fetching historical candles from Upstox...");
    const today = todayIST();
    // 10 calendar days back → covers at least 7 trading days
    const fromDate = (() => {
        const [y, m, d] = today.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d - 10));
        return [
            dt.getUTCFullYear(),
            String(dt.getUTCMonth() + 1).padStart(2, "0"),
            String(dt.getUTCDate()).padStart(2, "0"),
        ].join("-");
    })();
    // UTC epoch of IST midnight today — used to isolate yesterday vs today candles
    const istD = getIST();
    const istMidnightMs = Date.UTC(istD.getUTCFullYear(), istD.getUTCMonth(), istD.getUTCDate()) -
        (5 * 60 + 30) * 60000;
    const symbols = [
        { sym: "NIFTY", instrKey: "NSE_INDEX|Nifty 50" },
        { sym: "BANKNIFTY", instrKey: "NSE_INDEX|Nifty Bank" },
        { sym: "SENSEX", instrKey: "BSE_INDEX|SENSEX" },
    ];
    const intervals = [
        { upstox: "1minute", store: "1m", durationMs: 60000 },
        { upstox: "5minute", store: "5m", durationMs: 300000 },
        { upstox: "15minute", store: "15m", durationMs: 900000 },
    ];
    for (const { sym, instrKey } of symbols) {
        for (const { upstox, store, durationMs } of intervals) {
            try {
                // Fetch multi-day historical (gives prev-day close and recent candles)
                let candles = await fetchUpstoxHistorical(instrKey, upstox, fromDate, today);
                // During market hours also merge intraday to get the most recent bars
                if (isMarketOpen() && candles.length > 0) {
                    const intraday = await fetchUpstoxIntraday(instrKey, upstox);
                    if (intraday.length > 0) {
                        // Replace today's historical portion with fresher intraday data
                        const prevDays = candles.filter(c => c.time < istMidnightMs);
                        const seen = new Set(prevDays.map(c => c.time));
                        const newToday = intraday.filter(c => !seen.has(c.time));
                        candles = [...prevDays, ...newToday].sort((a, b) => a.time - b.time);
                    }
                }
                if (!candles.length) {
                    console.warn(`[Equity Seed] ${sym} ${store}: no data`);
                    continue;
                }
                // Only inject candles from fully completed buckets (avoid in-progress duplicates)
                const currentBucket = Math.floor(Date.now() / durationMs) * durationMs;
                const completed = candles.filter(c => c.time < currentBucket);
                const toSeed = completed.slice(-MAX_CANDLES);
                for (const c of toSeed) {
                    injectCandle(sym, store, c);
                    if (store === "1m")
                        split1mTo30s(sym, c);
                }
                // Seed prevDayClose for Strategy 6 gap calculation (1m gives finest granularity)
                if (store === "1m" && !prevDayClose[sym]) {
                    const yesterdayCandles = toSeed.filter(c => c.time < istMidnightMs);
                    if (yesterdayCandles.length > 0) {
                        prevDayClose[sym] = yesterdayCandles[yesterdayCandles.length - 1].close;
                        console.log(`[Equity Seed] ${sym} prevDayClose = ${prevDayClose[sym]}`);
                    }
                }
                const suffix = store === "1m" ? ` (→ ${toSeed.length * 2} × 30s)` : "";
                console.log(`[Equity Seed] ${sym}_${store}: ${toSeed.length} candles${suffix}`);
            }
            catch (err) {
                console.error(`[Equity Seed] ${sym} ${store} error:`, err);
            }
        }
    }
    equityCandlesSeeded = true;
    console.log(`[Equity Seed] ✓  NIFTY_30s=${getCandles("NIFTY", "30s").length}` +
        ` NIFTY_5m=${getCandles("NIFTY", "5m").length}` +
        ` NIFTY_15m=${getCandles("NIFTY", "15m").length}` +
        ` BNF_5m=${getCandles("BANKNIFTY", "5m").length}` +
        ` BNF_15m=${getCandles("BANKNIFTY", "15m").length}`);
}
// BTC strategy state
let btcOrbHigh = 0;
let btcOrbLow = 0;
let btcOrbSet = false;
const btcPeakPrices = {}; // posId → peak price
const btcDailyTradeCounts = {};
let btcTradeDateStr = "";
function checkBtcDailyReset() {
    const today = todayIST();
    if (btcTradeDateStr !== today) {
        btcTradeDateStr = today;
        for (const k of Object.keys(btcDailyTradeCounts))
            btcDailyTradeCounts[k] = 0;
        btcOrbHigh = 0;
        btcOrbLow = 0;
        btcOrbSet = false;
        console.log(`[BTC Daily] Reset for ${today}`);
    }
}
function calcBtcVWAP(candles) {
    const now = new Date();
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const todayCandles = candles.filter(c => c.time >= utcMidnight);
    if (!todayCandles.length)
        return candles[candles.length - 1]?.close ?? btcPrice;
    const sum = todayCandles.reduce((s, c) => s + (c.high + c.low + c.close) / 3, 0);
    return sum / todayCandles.length;
}
function generateBtcExitDetail(reason, side, entryPrice, exitPrice, pnlInr, stopLoss, trailSl) {
    const pnlStr = pnlInr >= 0 ? `+₹${pnlInr.toFixed(2)}` : `-₹${Math.abs(pnlInr).toFixed(2)}`;
    const ts = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
    switch (reason) {
        case "SL_HIT":
            return `Stop-loss hit at $${exitPrice.toFixed(2)} (entry $${entryPrice.toFixed(2)}, SL $${stopLoss?.toFixed(2) ?? "N/A"}) — ${pnlStr} at ${ts}`;
        case "TRAIL_SL":
            return `Trail SL triggered at $${exitPrice.toFixed(2)} (entry $${entryPrice.toFixed(2)}, trail $${trailSl?.toFixed(2) ?? "N/A"}) — ${pnlStr} at ${ts}`;
        case "CROSSOVER":
            return `Opposite EMA crossover at $${exitPrice.toFixed(2)} — ${pnlStr} at ${ts}`;
        case "SUPERTREND_FLIP":
            return `Supertrend flipped direction at $${exitPrice.toFixed(2)} — ${pnlStr} at ${ts}`;
        case "HARD_CLOSE":
            return `Hard close at $${exitPrice.toFixed(2)} — ${pnlStr} at ${ts}`;
        case "VWAP_CROSS":
            return `Price crossed VWAP in opposite direction at $${exitPrice.toFixed(2)} — ${pnlStr} at ${ts}`;
        default:
            return `Closed at $${exitPrice.toFixed(2)} — ${pnlStr} at ${ts}`;
    }
}
// ── Equity capital helper ────────────────────────────────────────
async function getEquityCurrentValue(strategyId) {
    try {
        const { data } = await supabase
            .from("strategy_capital")
            .select("current_value")
            .eq("strategy_id", strategyId)
            .single();
        if (!data)
            return 100000;
        return data.current_value ?? 100000;
    }
    catch {
        return 100000;
    }
}
// ── BTC Leverage Config ─────────────────────────────────────────
// qty_inr = current_value × 0.50 × leverage
const BTC_LEVERAGE = {
    btc_ema_crossover: 10, // 50% × 10x  =  500% effective exposure
    btc_orion: 50, // 50% × 50x  = 2500%
    btc_ema_confluence: 100, // 50% × 100x = 5000%
    btc_supertrend: 50, // 50% × 50x  = 2500%
    btc_vwap_scalper: 200, // 50% × 200x = 10000% (halved during danger windows)
};
async function getBtcCurrentValue(strategyId) {
    try {
        const { data } = await supabase
            .from("btc_strategy_capital")
            .select("allocated_inr, total_pnl_inr")
            .eq("strategy_id", strategyId)
            .single();
        if (!data)
            return 10000;
        const d = data;
        return (d.allocated_inr ?? 10000) + (d.total_pnl_inr ?? 0);
    }
    catch {
        return 10000;
    }
}
async function openBtcPosition(strategyId, side, entryPriceUsd, stopLoss, entryReason, qtyInr, leverage) {
    try {
        const { data, error } = await supabase
            .from("btc_strategy_positions")
            .insert({
            strategy_id: strategyId,
            side,
            entry_price_usd: entryPriceUsd,
            current_price_usd: entryPriceUsd,
            qty_inr: qtyInr,
            pnl_inr: 0,
            stop_loss: stopLoss,
            status: "OPEN",
            entry_reason: entryReason,
            leverage,
        })
            .select("id")
            .single();
        if (error) {
            console.error(`[BTC] Open error:`, error.message);
            return null;
        }
        const posId = data.id;
        btcPeakPrices[posId] = entryPriceUsd;
        console.log(`[BTC ${strategyId}] Opened ${side} @ $${entryPriceUsd.toFixed(2)} qty_inr=₹${Math.round(qtyInr).toLocaleString("en-IN")} (50% × ${leverage}x) SL=$${stopLoss.toFixed(2)}`);
        return posId;
    }
    catch (err) {
        console.error(`[BTC] openBtcPosition failed:`, err);
        return null;
    }
}
async function closeBtcPosition(posId, exitPriceUsd, reason) {
    try {
        const { data: pos, error: fetchErr } = await supabase
            .from("btc_strategy_positions")
            .select("strategy_id, side, entry_price_usd, qty_inr, stop_loss, trail_sl")
            .eq("id", posId)
            .single();
        if (fetchErr || !pos)
            return;
        const p = pos;
        const pnlInr = p.side === "LONG"
            ? ((exitPriceUsd - p.entry_price_usd) / p.entry_price_usd) * p.qty_inr
            : ((p.entry_price_usd - exitPriceUsd) / p.entry_price_usd) * p.qty_inr;
        const detail = generateBtcExitDetail(reason, p.side, p.entry_price_usd, exitPriceUsd, pnlInr, p.stop_loss, p.trail_sl);
        await supabase.from("btc_strategy_positions").update({
            exit_price_usd: exitPriceUsd,
            current_price_usd: exitPriceUsd,
            pnl_inr: pnlInr,
            status: "CLOSED",
            exit_reason: reason,
            exit_reason_detail: detail,
            closed_at: new Date().toISOString(),
        }).eq("id", posId);
        delete btcPeakPrices[posId];
        await updateBtcCapital(p.strategy_id, pnlInr);
        console.log(`[BTC ${p.strategy_id}] Closed ${p.side} @ $${exitPriceUsd.toFixed(2)} (${reason}) PnL ₹${pnlInr.toFixed(2)}`);
    }
    catch (err) {
        console.error(`[BTC] closeBtcPosition failed:`, err);
    }
}
async function updateBtcCapital(strategyId, pnlInr) {
    try {
        const { data } = await supabase
            .from("btc_strategy_capital")
            .select("total_pnl_inr, total_trades, winning_trades")
            .eq("strategy_id", strategyId)
            .single();
        const cap = data;
        await supabase.from("btc_strategy_capital").update({
            total_pnl_inr: (cap?.total_pnl_inr ?? 0) + pnlInr,
            total_trades: (cap?.total_trades ?? 0) + 1,
            winning_trades: (cap?.winning_trades ?? 0) + (pnlInr > 0 ? 1 : 0),
            updated_at: new Date().toISOString(),
        }).eq("strategy_id", strategyId);
    }
    catch (err) {
        console.error(`[BTC] updateBtcCapital failed:`, err);
    }
}
// ── Monitor BTC positions (SL / Trail SL) — every 5s ─────────
async function monitorBtcPositions() {
    if (!btcPrice)
        return;
    try {
        // Store live BTC price in config for frontend
        await supabase.from("config").upsert({ key: "BTC_PRICE_USD", value: btcPrice.toFixed(2) }, { onConflict: "key" });
        const { data, error } = await supabase
            .from("btc_strategy_positions")
            .select("id, strategy_id, side, entry_price_usd, qty_inr, stop_loss, trail_sl")
            .eq("status", "OPEN");
        if (error || !data)
            return;
        for (const row of data) {
            const pnlInr = row.side === "LONG"
                ? ((btcPrice - row.entry_price_usd) / row.entry_price_usd) * row.qty_inr
                : ((row.entry_price_usd - btcPrice) / row.entry_price_usd) * row.qty_inr;
            await supabase.from("btc_strategy_positions")
                .update({ current_price_usd: btcPrice, pnl_inr: pnlInr })
                .eq("id", row.id);
            // Update peak price for trail SL
            if (row.side === "LONG") {
                if (!btcPeakPrices[row.id] || btcPrice > btcPeakPrices[row.id])
                    btcPeakPrices[row.id] = btcPrice;
            }
            else {
                if (!btcPeakPrices[row.id] || btcPrice < btcPeakPrices[row.id])
                    btcPeakPrices[row.id] = btcPrice;
            }
            // Trail SL ratchet
            const trailPct = btcTrailPct(row.strategy_id);
            if (row.side === "LONG") {
                const newTrail = btcPeakPrices[row.id] * (1 - trailPct);
                if (!row.trail_sl || newTrail > row.trail_sl) {
                    await supabase.from("btc_strategy_positions").update({ trail_sl: newTrail }).eq("id", row.id);
                    row.trail_sl = newTrail;
                }
            }
            else {
                const newTrail = btcPeakPrices[row.id] * (1 + trailPct);
                if (!row.trail_sl || newTrail < row.trail_sl) {
                    await supabase.from("btc_strategy_positions").update({ trail_sl: newTrail }).eq("id", row.id);
                    row.trail_sl = newTrail;
                }
            }
            // Hard SL
            if (row.stop_loss !== null) {
                if (row.side === "LONG" && btcPrice <= row.stop_loss) {
                    await closeBtcPosition(row.id, btcPrice, "SL_HIT");
                    continue;
                }
                if (row.side === "SHORT" && btcPrice >= row.stop_loss) {
                    await closeBtcPosition(row.id, btcPrice, "SL_HIT");
                    continue;
                }
            }
            // Trail SL
            if (row.trail_sl !== null) {
                if (row.side === "LONG" && btcPrice <= row.trail_sl) {
                    await closeBtcPosition(row.id, btcPrice, "TRAIL_SL");
                    continue;
                }
                if (row.side === "SHORT" && btcPrice >= row.trail_sl) {
                    await closeBtcPosition(row.id, btcPrice, "TRAIL_SL");
                    continue;
                }
            }
            // VWAP cross exit for btc_vwap_scalper
            if (row.strategy_id === "btc_vwap_scalper") {
                const btcCandles1m = getCandles("BTC", "1m");
                if (btcCandles1m.length >= 2) {
                    const btcCurr = btcCandles1m[btcCandles1m.length - 1];
                    const btcVwap = calcBtcVWAP(btcCandles1m);
                    if (row.side === "LONG" && btcCurr.close < btcVwap) {
                        await closeBtcPosition(row.id, btcPrice, "VWAP_CROSS");
                        continue;
                    }
                    if (row.side === "SHORT" && btcCurr.close > btcVwap) {
                        await closeBtcPosition(row.id, btcPrice, "VWAP_CROSS");
                        continue;
                    }
                    // Danger window: tighten trail SL to 1% from current price
                    if (isDangerWindow()) {
                        const tightSL = row.side === "LONG"
                            ? btcPrice * 0.99
                            : btcPrice * 1.01;
                        if (row.side === "LONG" && (!row.trail_sl || tightSL > row.trail_sl)) {
                            await supabase.from("btc_strategy_positions").update({ trail_sl: tightSL }).eq("id", row.id);
                        }
                        if (row.side === "SHORT" && (!row.trail_sl || tightSL < row.trail_sl)) {
                            await supabase.from("btc_strategy_positions").update({ trail_sl: tightSL }).eq("id", row.id);
                        }
                    }
                }
            }
        }
    }
    catch (err) {
        console.error("[BTC Monitor] Error:", err);
    }
}
function btcTrailPct(strategyId) {
    const map = {
        btc_ema_crossover: 0.010,
        btc_orion: 0.005,
        btc_ema_confluence: 0.015,
        btc_supertrend: 0.008,
        btc_vwap_scalper: 0.010,
    };
    return map[strategyId] ?? 0.01;
}
// ── BTC Strategy 1: EMA Crossover ────────────────────────────
async function strategyBtcEmaCrossover() {
    const candles = getCandles("BTC", "30s");
    if (candles.length < 25) {
        console.log(`[BTC:ema_crossover] Waiting for candles (${candles.length}/25)`);
        return;
    }
    const closes = candles.map(c => c.close);
    const fastEmas = emaValues(closes, 9);
    const slowEmas = emaValues(closes, 21);
    if (fastEmas.length < 2 || slowEmas.length < 2)
        return;
    const fastNow = fastEmas[fastEmas.length - 1];
    const slowNow = slowEmas[slowEmas.length - 1];
    const fastPrev = fastEmas[fastEmas.length - 2];
    const slowPrev = slowEmas[slowEmas.length - 2];
    const atr = calcATR(candles, 14);
    if (!atr)
        return;
    const bullCross = fastNow > slowNow && fastPrev <= slowPrev;
    const bearCross = fastNow < slowNow && fastPrev >= slowPrev;
    const crossTag = bullCross ? "BULL↑" : bearCross ? "BEAR↓" : "no-cross";
    const { data: openPos } = await supabase
        .from("btc_strategy_positions")
        .select("id, side")
        .eq("strategy_id", "btc_ema_crossover")
        .eq("status", "OPEN");
    const longs = btcDailyTradeCounts["btc_ema_crossover_LONG"] ?? 0;
    const shorts = btcDailyTradeCounts["btc_ema_crossover_SHORT"] ?? 0;
    console.log(`[BTC:ema_crossover] candles=${candles.length} EMA9=${fastNow.toFixed(0)} EMA21=${slowNow.toFixed(0)} ATR=${atr.toFixed(0)} | ${crossTag} | open=${openPos?.length ?? 0} daily L=${longs}/1 S=${shorts}/1`);
    if (openPos && openPos.length > 0) {
        for (const pos of openPos) {
            if (pos.side === "LONG" && fastNow < slowNow && fastPrev >= slowPrev)
                await closeBtcPosition(pos.id, btcPrice, "CROSSOVER");
            if (pos.side === "SHORT" && fastNow > slowNow && fastPrev <= slowPrev)
                await closeBtcPosition(pos.id, btcPrice, "CROSSOVER");
        }
        return;
    }
    const leverage_ec = BTC_LEVERAGE["btc_ema_crossover"];
    if (bullCross && longs < 1) {
        const cv = await getBtcCurrentValue("btc_ema_crossover");
        const qtyInr = Math.round(cv * 0.50 * leverage_ec);
        await openBtcPosition("btc_ema_crossover", "LONG", btcPrice, btcPrice - 1.5 * atr, `EMA9(${fastNow.toFixed(0)}) crossed above EMA21(${slowNow.toFixed(0)})`, qtyInr, leverage_ec);
        btcDailyTradeCounts["btc_ema_crossover_LONG"] = longs + 1;
    }
    else if (bearCross && shorts < 1) {
        const cv = await getBtcCurrentValue("btc_ema_crossover");
        const qtyInr = Math.round(cv * 0.50 * leverage_ec);
        await openBtcPosition("btc_ema_crossover", "SHORT", btcPrice, btcPrice + 1.5 * atr, `EMA9(${fastNow.toFixed(0)}) crossed below EMA21(${slowNow.toFixed(0)})`, qtyInr, leverage_ec);
        btcDailyTradeCounts["btc_ema_crossover_SHORT"] = shorts + 1;
    }
}
// ── BTC Strategy 2: Orion (ORB) ──────────────────────────────
async function strategyBtcOrion() {
    const now = new Date();
    const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (utcMins < 30) {
        // Within the 00:00–00:30 UTC window — build ORB from those candles
        const candles30s = getCandles("BTC", "30s");
        const orbCandles = candles30s.filter(c => c.time >= utcMidnight && c.time < utcMidnight + 30 * 60000);
        if (orbCandles.length > 0) {
            btcOrbHigh = Math.max(...orbCandles.map(c => c.high));
            btcOrbLow = Math.min(...orbCandles.map(c => c.low));
        }
        btcOrbSet = false;
        return;
    }
    // Past the ORB window — seed from all today's 15m candles if not yet set
    if (!btcOrbSet) {
        const candles15m = getCandles("BTC", "15m");
        const todayCandles = candles15m.filter(c => c.time >= utcMidnight);
        if (todayCandles.length === 0) {
            console.log(`[BTC:orion] Past ORB window, no today 15m candles yet — waiting`);
            return;
        }
        btcOrbHigh = Math.max(...todayCandles.map(c => c.high));
        btcOrbLow = Math.min(...todayCandles.map(c => c.low));
        btcOrbSet = true;
        console.log(`[BTC:orion] ORB seeded from ${todayCandles.length} today 15m candles — H=$${btcOrbHigh.toFixed(0)} L=$${btcOrbLow.toFixed(0)}`);
    }
    const longs = btcDailyTradeCounts["btc_orion_LONG"] ?? 0;
    const shorts = btcDailyTradeCounts["btc_orion_SHORT"] ?? 0;
    const total = longs + shorts;
    const { data: openPos } = await supabase
        .from("btc_strategy_positions")
        .select("id")
        .eq("strategy_id", "btc_orion")
        .eq("status", "OPEN");
    const posStr = btcPrice > btcOrbHigh ? "above-H" : btcPrice < btcOrbLow ? "below-L" : "inside";
    console.log(`[BTC:orion] price=$${btcPrice.toFixed(0)} H=$${btcOrbHigh.toFixed(0)} L=$${btcOrbLow.toFixed(0)} pos=${posStr} | open=${openPos?.length ?? 0} daily=${total}/2`);
    if (total >= 2) {
        console.log(`[BTC:orion] Daily limit reached (${total}/2)`);
        return;
    }
    if (openPos && openPos.length > 0)
        return;
    const leverage_orion = BTC_LEVERAGE["btc_orion"];
    if (btcPrice > btcOrbHigh && longs < 1) {
        const cv = await getBtcCurrentValue("btc_orion");
        const qtyInr = Math.round(cv * 0.50 * leverage_orion);
        await openBtcPosition("btc_orion", "LONG", btcPrice, btcOrbLow, `Price ($${btcPrice.toFixed(0)}) broke above ORB High ($${btcOrbHigh.toFixed(0)})`, qtyInr, leverage_orion);
        btcDailyTradeCounts["btc_orion_LONG"] = longs + 1;
    }
    else if (btcPrice < btcOrbLow && shorts < 1) {
        const cv = await getBtcCurrentValue("btc_orion");
        const qtyInr = Math.round(cv * 0.50 * leverage_orion);
        await openBtcPosition("btc_orion", "SHORT", btcPrice, btcOrbHigh, `Price ($${btcPrice.toFixed(0)}) broke below ORB Low ($${btcOrbLow.toFixed(0)})`, qtyInr, leverage_orion);
        btcDailyTradeCounts["btc_orion_SHORT"] = shorts + 1;
    }
}
// ── BTC Strategy 3: EMA Confluence ───────────────────────────
async function strategyBtcEmaConfluence() {
    const candles5m = getCandles("BTC", "5m");
    if (candles5m.length < 52) {
        console.log(`[BTC:ema_confluence] Waiting for 5m candles (${candles5m.length}/52)`);
        return;
    }
    const ema20 = calcEMA(candles5m, 20);
    const ema50 = calcEMA(candles5m, 50);
    const rsi = calcRSI(candles5m, 14);
    const atr = calcATR(candles5m, 14);
    const vwap = calcBtcVWAP(candles5m);
    if (!atr)
        return;
    const slice9 = candles5m.slice(-15).map(c => c.close);
    const ema9arr = emaValues(slice9, 9);
    const slope = ema9arr.length >= 2 ? ema9arr[ema9arr.length - 1] - ema9arr[ema9arr.length - 2] : 0;
    const atrPct = (atr / btcPrice) * 100;
    // Log each filter result
    const f1 = ema20 > ema50 ? "EMA20>50✓" : ema20 < ema50 ? "EMA20<50✓(bear)" : "EMA20=50✗";
    const f2 = rsi > 40 && rsi < 60 ? `RSI=${rsi.toFixed(0)}✓` : `RSI=${rsi.toFixed(0)}✗(need 40-60)`;
    const f3 = btcPrice > vwap ? `P>VWAP✓` : `P<VWAP✓(bear)`;
    const f4 = atrPct > 0.5 ? `ATR=${atrPct.toFixed(2)}%✓` : `ATR=${atrPct.toFixed(2)}%✗(need >0.5%)`;
    const f5 = slope > 0 ? `slope=+${slope.toFixed(0)}✓` : slope < 0 ? `slope=${slope.toFixed(0)}✓(bear)` : `slope=0✗`;
    const bullish = ema20 > ema50 && rsi > 40 && rsi < 60 && btcPrice > vwap && atrPct > 0.5 && slope > 0;
    const bearish = ema20 < ema50 && rsi > 40 && rsi < 60 && btcPrice < vwap && atrPct > 0.5 && slope < 0;
    const { data: openPos } = await supabase
        .from("btc_strategy_positions")
        .select("id")
        .eq("strategy_id", "btc_ema_confluence")
        .eq("status", "OPEN");
    const longs = btcDailyTradeCounts["btc_ema_confluence_LONG"] ?? 0;
    const shorts = btcDailyTradeCounts["btc_ema_confluence_SHORT"] ?? 0;
    const signal = bullish ? "BULLISH" : bearish ? "BEARISH" : "no-signal";
    console.log(`[BTC:ema_confluence] EMA20=${ema20.toFixed(0)} EMA50=${ema50.toFixed(0)} | ${f1} ${f2} ${f3} ${f4} ${f5} | ${signal} | open=${openPos?.length ?? 0} L=${longs}/1 S=${shorts}/1`);
    if (openPos && openPos.length > 0)
        return;
    const leverage_conf = BTC_LEVERAGE["btc_ema_confluence"];
    if (bullish && longs < 1) {
        const cv = await getBtcCurrentValue("btc_ema_confluence");
        const qtyInr = Math.round(cv * 0.50 * leverage_conf);
        await openBtcPosition("btc_ema_confluence", "LONG", btcPrice, btcPrice - 2 * atr, `5-filter bullish: EMA20>EMA50, RSI ${rsi.toFixed(0)}, P>VWAP, ATR ${atrPct.toFixed(1)}%, slope+`, qtyInr, leverage_conf);
        btcDailyTradeCounts["btc_ema_confluence_LONG"] = longs + 1;
    }
    else if (bearish && shorts < 1) {
        const cv = await getBtcCurrentValue("btc_ema_confluence");
        const qtyInr = Math.round(cv * 0.50 * leverage_conf);
        await openBtcPosition("btc_ema_confluence", "SHORT", btcPrice, btcPrice + 2 * atr, `5-filter bearish: EMA20<EMA50, RSI ${rsi.toFixed(0)}, P<VWAP, ATR ${atrPct.toFixed(1)}%, slope-`, qtyInr, leverage_conf);
        btcDailyTradeCounts["btc_ema_confluence_SHORT"] = shorts + 1;
    }
}
// ── BTC Strategy 4: Supertrend ────────────────────────────────
async function strategyBtcSupertrend() {
    const candles5m = getCandles("BTC", "5m");
    if (candles5m.length < 20) {
        console.log(`[BTC:supertrend] Waiting for 5m candles (${candles5m.length}/20)`);
        return;
    }
    const stSeries = calcSupertrendSeries(candles5m, 7, 3);
    if (stSeries.length < 2) {
        console.log(`[BTC:supertrend] Series too short (${stSeries.length})`);
        return;
    }
    const stNow = stSeries[stSeries.length - 1];
    const stPrev = stSeries[stSeries.length - 2];
    const crossUp = stPrev.dir === "down" && stNow.dir === "up";
    const crossDown = stPrev.dir === "up" && stNow.dir === "down";
    const flipTag = crossUp ? "FLIP-UP↑" : crossDown ? "FLIP-DOWN↓" : "no-flip";
    const { data: openPos } = await supabase
        .from("btc_strategy_positions")
        .select("id, side")
        .eq("strategy_id", "btc_supertrend")
        .eq("status", "OPEN");
    const longs = btcDailyTradeCounts["btc_supertrend_LONG"] ?? 0;
    const shorts = btcDailyTradeCounts["btc_supertrend_SHORT"] ?? 0;
    const total = longs + shorts;
    console.log(`[BTC:supertrend] candles=${candles5m.length} ST=${stNow.dir}($${stNow.value.toFixed(0)}) prev=${stPrev.dir} | ${flipTag} | open=${openPos?.length ?? 0} daily L=${longs}/1 S=${shorts}/1 tot=${total}/2`);
    if (openPos && openPos.length > 0) {
        for (const pos of openPos) {
            if (pos.side === "LONG" && crossDown)
                await closeBtcPosition(pos.id, btcPrice, "SUPERTREND_FLIP");
            if (pos.side === "SHORT" && crossUp)
                await closeBtcPosition(pos.id, btcPrice, "SUPERTREND_FLIP");
        }
        return;
    }
    if (total >= 2) {
        console.log(`[BTC:supertrend] Daily limit reached (${total}/2)`);
        return;
    }
    const leverage_st = BTC_LEVERAGE["btc_supertrend"];
    if (crossUp) {
        const cv = await getBtcCurrentValue("btc_supertrend");
        const qtyInr = Math.round(cv * 0.50 * leverage_st);
        await openBtcPosition("btc_supertrend", "LONG", btcPrice, stNow.value, `Supertrend flipped bullish (line $${stNow.value.toFixed(0)})`, qtyInr, leverage_st);
        btcDailyTradeCounts["btc_supertrend_LONG"] = longs + 1;
    }
    else if (crossDown) {
        const cv = await getBtcCurrentValue("btc_supertrend");
        const qtyInr = Math.round(cv * 0.50 * leverage_st);
        await openBtcPosition("btc_supertrend", "SHORT", btcPrice, stNow.value, `Supertrend flipped bearish (line $${stNow.value.toFixed(0)})`, qtyInr, leverage_st);
        btcDailyTradeCounts["btc_supertrend_SHORT"] = shorts + 1;
    }
}
// ── BTC Strategy 5: VWAP Momentum Scalper ────────────────────
async function strategyBtcVwapScalper() {
    if (!btcPrice)
        return;
    const candles = getCandles("BTC", "1m");
    const MIN_CANDLES = 22;
    if (candles.length < MIN_CANDLES) {
        console.log(`[BTC:vwap_scalper] Waiting for 1m candles (${candles.length}/${MIN_CANDLES})`);
        return;
    }
    const vwap = calcBtcVWAP(candles);
    const rsi = calcRSI(candles, 14);
    const atr = calcATR(candles, 14);
    const curr = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const prev2 = candles[candles.length - 3];
    // Volume: tick count vs 20-candle average
    const avgTicks = candles.slice(-20).reduce((s, c) => s + (c.ticks ?? 1), 0) / 20;
    const volOK = (curr.ticks ?? 1) >= avgTicks;
    const bullish = prev.close <= vwap && curr.close > vwap
        && rsi >= 40 && rsi <= 60
        && volOK
        && prev.low > prev2.low;
    const bearish = prev.close >= vwap && curr.close < vwap
        && rsi >= 40 && rsi <= 60
        && volOK
        && prev.high < prev2.high;
    const signalTag = bullish ? "long-signal" : bearish ? "short-signal" : "no-signal";
    console.log(`[BTC:vwap_scalper] VWAP=${vwap.toFixed(0)} price=${btcPrice.toFixed(0)} RSI=${rsi.toFixed(0)} vol=${volOK ? "above" : "below"} | ${signalTag}`);
    if (!bullish && !bearish)
        return;
    const side = bullish ? "LONG" : "SHORT";
    const dayKey = `btc_vwap_scalper_${side}`;
    if ((btcDailyTradeCounts[dayKey] ?? 0) >= 1) {
        console.log(`[BTC:vwap_scalper] Daily ${side} limit reached`);
        return;
    }
    // Check existing open position on same side
    const { data: openPos } = await supabase
        .from("btc_strategy_positions")
        .select("id, side")
        .eq("strategy_id", "btc_vwap_scalper")
        .eq("status", "OPEN");
    if (openPos?.some(p => p.side === side))
        return;
    const leverage_vwap = BTC_LEVERAGE["btc_vwap_scalper"];
    const danger = isDangerWindow();
    const cv = await getBtcCurrentValue("btc_vwap_scalper");
    const baseQty = Math.round(cv * 0.50 * leverage_vwap);
    const qtyInr = danger ? Math.round(baseQty / 2) : baseQty;
    const slDist = danger ? atr : atr * 2;
    const stopLoss = side === "LONG" ? btcPrice - slDist : btcPrice + slDist;
    await openBtcPosition("btc_vwap_scalper", side, btcPrice, stopLoss, `VWAP ${side === "LONG" ? "bounce above" : "reject below"} | VWAP=$${vwap.toFixed(0)} RSI=${rsi.toFixed(0)} vol=above`, qtyInr, leverage_vwap);
    btcDailyTradeCounts[dayKey] = (btcDailyTradeCounts[dayKey] ?? 0) + 1;
}
// ── Run all BTC strategies (every 30s) ───────────────────────
let btcStrategiesRunning = false;
async function runBtcStrategies() {
    if (btcStrategiesRunning || !btcPrice)
        return;
    btcStrategiesRunning = true;
    try {
        checkBtcDailyReset();
        console.log(`[BTC] Cycle — price=$${btcPrice.toFixed(2)} candles30s=${getCandles("BTC", "30s").length} candles1m=${getCandles("BTC", "1m").length} candles5m=${getCandles("BTC", "5m").length}`);
        await strategyBtcEmaCrossover();
        await strategyBtcOrion();
        await strategyBtcEmaConfluence();
        await strategyBtcSupertrend();
        await strategyBtcVwapScalper();
    }
    catch (err) {
        console.error("[BTC Strategies] Error:", err);
    }
    finally {
        btcStrategiesRunning = false;
    }
}
// ══════════════════════════════════════════════════════════════
// Kraken WebSocket — XBT/USD live price feed (unchanged)
// ══════════════════════════════════════════════════════════════
function connectBinanceWS() {
    const socket = new ws_1.default("wss://ws.kraken.com");
    socket.on("open", () => {
        console.log("[BTC] Kraken WebSocket connected — subscribing to XBT/USD + ETH/USD trades");
        socket.send(JSON.stringify({ event: "subscribe", pair: ["XBT/USD", "ETH/USD"], subscription: { name: "trade" } }));
    });
    socket.on("message", (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (!Array.isArray(msg))
                return;
            const pair = msg[3];
            if (pair !== "XBT/USD" && pair !== "ETH/USD")
                return;
            const trades = msg[1];
            if (!Array.isArray(trades) || !trades[0])
                return;
            const price = parseFloat(trades[0][0]);
            if (!price)
                return;
            if (pair === "XBT/USD") {
                btcPrice = price;
                processTick(price, "BTC", Date.now());
                if (Date.now() - lastBtcLogTime > 5000) {
                    console.log(`[BTC] Price: $${btcPrice.toFixed(2)}`);
                    lastBtcLogTime = Date.now();
                }
            }
            else {
                ethPrice = price;
            }
        }
        catch (err) {
            console.error("[BTC] WS parse error:", err);
        }
    });
    socket.on("error", (err) => console.error("[BTC] WS error:", err.message));
    socket.on("close", () => { console.warn("[BTC] WS closed — reconnecting in 5s..."); setTimeout(connectBinanceWS, 5000); });
}
// ══════════════════════════════════════════════════════════════
// Upstox token management (unchanged)
// ══════════════════════════════════════════════════════════════
async function loadTokenFromSupabase() {
    try {
        const [tokenRes, dateRes] = await Promise.all([
            supabase.from("config").select("value").eq("key", "UPSTOX_ACCESS_TOKEN").single(),
            supabase.from("config").select("value").eq("key", "UPSTOX_TOKEN_DATE").single(),
        ]);
        const supabaseToken = tokenRes.data?.value ?? "";
        const supabaseDate = dateRes.data?.value ?? "";
        if (!supabaseToken) {
            console.log("[Token] No token in Supabase config — using Railway env var if set");
            return;
        }
        if (supabaseDate === todayIST()) {
            // Token was approved today via webhook — always wins over any static Railway var
            process.env.UPSTOX_ACCESS_TOKEN = supabaseToken;
            console.log(`[Token] Loaded today's fresh token from Supabase (approved ${supabaseDate})`);
        }
        else if (!process.env.UPSTOX_ACCESS_TOKEN) {
            // No Railway var set — use Supabase as fallback even if from a prior day
            process.env.UPSTOX_ACCESS_TOKEN = supabaseToken;
            console.log(`[Token] Loaded fallback token from Supabase (last approved ${supabaseDate || "unknown"})`);
        }
        else {
            console.log(`[Token] Supabase token is from ${supabaseDate || "unknown"} — keeping Railway env var`);
            console.log(`[Token] ACTION NEEDED: delete UPSTOX_ACCESS_TOKEN from Railway vars so daily webhook token is used`);
        }
    }
    catch (err) {
        console.error("[Token] Load failed:", err);
    }
}
// IST times at which a token request is sent (initial + retries)
const TOKEN_REQUEST_TIMES_IST = ["08:30", "09:30", "10:00", "10:30"];
/** Send a push-notification approval request to Upstox. */
async function sendTokenRequest() {
    const apiKey = process.env.UPSTOX_API_KEY;
    const secret = process.env.UPSTOX_API_SECRET;
    // Log first 10 chars so we can verify correct values in Railway logs
    console.log(`[Token] UPSTOX_API_KEY    = ${apiKey ? apiKey.substring(0, 10) + "..." : "NOT SET"}`);
    console.log(`[Token] UPSTOX_API_SECRET = ${secret ? secret.substring(0, 10) + "..." : "NOT SET"}`);
    if (!apiKey) {
        console.warn("[Token] UPSTOX_API_KEY not set — cannot send token request");
        return;
    }
    if (!secret) {
        console.warn("[Token] UPSTOX_API_SECRET not set — cannot send token request");
        return;
    }
    const url = `https://api.upstox.com/v3/login/auth/token/request/${apiKey}`;
    const body = JSON.stringify({ client_secret: secret });
    console.log(`[Token] POST ${url}`);
    console.log(`[Token] Body: {"client_secret":"${secret.substring(0, 6)}...[masked]"}`);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "accept": "application/json" },
            body,
        });
        const text = await res.text().catch(() => "");
        console.log(`[Token] Response HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    catch (err) {
        console.error("[Token] Request failed:", err);
    }
}
/**
 * Check Supabase config for UPSTOX_TOKEN_DATE — set by the webhook
 * each time a fresh token arrives. Returns true if the value equals today.
 */
async function isTokenApprovedToday() {
    try {
        const { data } = await supabase
            .from("config")
            .select("value")
            .eq("key", "UPSTOX_TOKEN_DATE")
            .single();
        return data?.value === todayIST();
    }
    catch {
        return false;
    }
}
function scheduleTokenRequest() {
    setInterval(async () => {
        const ist = getIST();
        if (ist.getUTCDay() === 0 || ist.getUTCDay() === 6)
            return; // weekends
        const timeStr = `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
        if (!TOKEN_REQUEST_TIMES_IST.includes(timeStr))
            return;
        const approved = await isTokenApprovedToday();
        if (approved) {
            console.log(`[Token] Already approved today — skipping ${timeStr} IST retry`);
            return;
        }
        console.log(`[Token] Not yet approved — sending request at ${timeStr} IST`);
        await sendTokenRequest();
    }, 60000);
}
// ══════════════════════════════════════════════════════════════
// Express server
// ══════════════════════════════════════════════════════════════
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});
const PORT = Number(process.env.PORT ?? process.env.TRADING_SERVER_PORT ?? 8080);
app.get("/ping", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
});
// ── /api/indices — live index prices with change vs prev close ──
app.get("/api/indices", (_req, res) => {
    const ltps = {
        NIFTY: lastNiftyPrice,
        BANKNIFTY: lastBankniftyPrice,
        SENSEX: lastSensexPrice,
        GIFT_NIFTY: lastGiftNiftyPrice,
    };
    const result = {};
    for (const [idx, ltp] of Object.entries(ltps)) {
        const pdc = prevDayClose[idx] ?? 0;
        const change = pdc > 0 ? Number((ltp - pdc).toFixed(2)) : 0;
        const changePct = pdc > 0 ? Number(((change / pdc) * 100).toFixed(2)) : 0;
        result[idx] = { ltp, change, changePct };
    }
    res.json(result);
});
// ── /api/candles — candle data per index + interval ─────────────
// GET /api/candles?index=NIFTY&interval=30s  → last 100 candles
app.get("/api/candles", (req, res) => {
    const index = String(req.query.index ?? "NIFTY").toUpperCase();
    const interval = String(req.query.interval ?? "30s");
    const candles = getCandles(index, interval);
    res.json(candles.slice(-100));
});
// ── /api/indicators — computed indicator series per strategy ──────
// GET /api/indicators?strategy=ema_crossover&index=NIFTY
app.get("/api/indicators", (req, res) => {
    const strategy = String(req.query.strategy ?? "").toLowerCase();
    const index = String(req.query.index ?? "NIFTY").toUpperCase();
    // Determine candle interval based on strategy
    let interval;
    if (["ema_crossover", "ema_confluence", "pcr_reversal"].includes(strategy)) {
        interval = "30s";
    }
    else if (strategy === "supertrend") {
        interval = "5m";
    }
    else if (["orion", "gap_orb"].includes(strategy)) {
        interval = "15m";
    }
    else if (strategy === "vwap_scalper") {
        interval = "1m";
    }
    else {
        interval = "30s";
    }
    const candles = getCandles(index, interval);
    const closes = candles.map(c => c.close);
    const result = {};
    // EMA16 + EMA64 (ema_crossover, ema_confluence)
    if (["ema_crossover", "ema_confluence"].includes(strategy)) {
        const ema16arr = emaValues(closes, 16);
        const ema64arr = emaValues(closes, 64);
        result.ema16 = ema16arr.map((v, i) => ({ time: candles[i].time, value: v })).slice(-100);
        result.ema64 = ema64arr.map((v, i) => ({ time: candles[i].time, value: v })).slice(-100);
        // Crossover detection
        const crossovers = [];
        for (let i = 1; i < ema16arr.length; i++) {
            const prevDiff = ema16arr[i - 1] - ema64arr[i - 1];
            const currDiff = ema16arr[i] - ema64arr[i];
            if (prevDiff <= 0 && currDiff > 0)
                crossovers.push({ time: candles[i].time, type: "bullish" });
            else if (prevDiff >= 0 && currDiff < 0)
                crossovers.push({ time: candles[i].time, type: "bearish" });
        }
        result.crossovers = crossovers.slice(-20);
    }
    // VWAP series (ema_confluence, orion, vwap_scalper)
    if (["ema_confluence", "orion", "vwap_scalper"].includes(strategy)) {
        const istD = getIST();
        const istMidnight = Date.UTC(istD.getUTCFullYear(), istD.getUTCMonth(), istD.getUTCDate()) - (5 * 60 + 30) * 60000;
        const sessionStart = istMidnight + (9 * 60 + 15) * 60000; // 9:15 AM IST
        let cumTP = 0, count = 0;
        const vwapSeries = [];
        for (const c of candles) {
            if (c.time >= sessionStart) {
                cumTP += (c.high + c.low + c.close) / 3;
                count++;
                vwapSeries.push({ time: c.time, value: cumTP / count });
            }
        }
        result.vwap = vwapSeries.slice(-100);
    }
    // Supertrend series (supertrend)
    if (strategy === "supertrend") {
        const stSeries = calcSupertrendSeries(candles, 7, 3);
        const offset = candles.length - stSeries.length;
        const stUpArr = [];
        const stDownArr = [];
        for (let i = 0; i < stSeries.length; i++) {
            const t = candles[offset + i].time;
            const s = stSeries[i];
            stUpArr.push({ time: t, value: s.dir === "up" ? s.value : null });
            stDownArr.push({ time: t, value: s.dir === "down" ? s.value : null });
        }
        result.supertrendUp = stUpArr.slice(-100);
        result.supertrendDown = stDownArr.slice(-100);
    }
    // ORB High/Low (orion, gap_orb, vwap_scalper)
    if (["orion", "gap_orb", "vwap_scalper"].includes(strategy)) {
        result.orbHigh = orbHigh[index] ?? 0;
        result.orbLow = orbLow[index] ?? 0;
    }
    // prevDayClose (gap_orb, orion)
    if (["gap_orb", "orion"].includes(strategy)) {
        result.prevDayClose = prevDayClose[index] ?? 0;
    }
    // PCR series (pcr_reversal)
    if (strategy === "pcr_reversal") {
        const hist = optionChainHistory[index];
        result.pcr = (hist ?? []).map(h => ({ time: h.timestamp, value: h.pcr }));
    }
    res.json(result);
});
// ── /api/btc/prices — live BTC + ETH prices ──────────────────────
app.get("/api/btc/prices", (_req, res) => {
    const candles1m = getCandles("BTC", "1m");
    const utcMidnight = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const todayCandles = candles1m.filter(c => c.time >= utcMidnight);
    const sessionOpen = todayCandles.length > 0 ? todayCandles[0].open : btcPrice;
    const btcChange = btcPrice > 0 && sessionOpen > 0 ? btcPrice - sessionOpen : 0;
    const btcChangePct = sessionOpen > 0 ? (btcChange / sessionOpen) * 100 : 0;
    res.json({ btcPrice, ethPrice, btcChange, btcChangePct });
});
// ── /api/btc/candles — BTC candle data ───────────────────────────
// GET /api/btc/candles?interval=30s|1m|5m|15m
app.get("/api/btc/candles", (req, res) => {
    const interval = String(req.query.interval ?? "30s");
    const candles = getCandles("BTC", interval);
    res.json(candles.slice(-100));
});
// ── /api/btc/indicators — BTC indicator series ───────────────────
// GET /api/btc/indicators?strategy=btc_ema_crossover
app.get("/api/btc/indicators", (req, res) => {
    const strategy = String(req.query.strategy ?? "").toLowerCase();
    let interval;
    if (strategy === "btc_ema_crossover" || strategy === "btc_ema_confluence") {
        interval = "30s";
    }
    else if (strategy === "btc_orion") {
        interval = "15m";
    }
    else if (strategy === "btc_supertrend") {
        interval = "5m";
    }
    else if (strategy === "btc_vwap_scalper") {
        interval = "1m";
    }
    else {
        interval = "30s";
    }
    const candles = getCandles("BTC", interval);
    const closes = candles.map(c => c.close);
    const result = {};
    // EMA9 + EMA21 + crossovers (btc_ema_crossover)
    if (strategy === "btc_ema_crossover") {
        const ema9arr = emaValues(closes, 9);
        const ema21arr = emaValues(closes, 21);
        result.ema9 = ema9arr.map((v, i) => ({ time: candles[i].time, value: v })).slice(-100);
        result.ema21 = ema21arr.map((v, i) => ({ time: candles[i].time, value: v })).slice(-100);
        const crossovers = [];
        for (let i = 1; i < ema9arr.length; i++) {
            const prevDiff = ema9arr[i - 1] - ema21arr[i - 1];
            const currDiff = ema9arr[i] - ema21arr[i];
            if (prevDiff <= 0 && currDiff > 0)
                crossovers.push({ time: candles[i].time, type: "bullish" });
            else if (prevDiff >= 0 && currDiff < 0)
                crossovers.push({ time: candles[i].time, type: "bearish" });
        }
        result.crossovers = crossovers.slice(-20);
    }
    // EMA20 + EMA50 (btc_ema_confluence)
    if (strategy === "btc_ema_confluence") {
        const ema20arr = emaValues(closes, 20);
        const ema50arr = emaValues(closes, 50);
        result.ema20 = ema20arr.map((v, i) => ({ time: candles[i].time, value: v })).slice(-100);
        result.ema50 = ema50arr.map((v, i) => ({ time: candles[i].time, value: v })).slice(-100);
    }
    // VWAP series anchored to UTC midnight (btc_orion, btc_ema_confluence, btc_vwap_scalper)
    if (["btc_orion", "btc_ema_confluence", "btc_vwap_scalper"].includes(strategy)) {
        const utcMidnight = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
        let cumTP = 0, count = 0;
        const vwapSeries = [];
        for (const c of candles) {
            if (c.time >= utcMidnight) {
                cumTP += (c.high + c.low + c.close) / 3;
                count++;
                vwapSeries.push({ time: c.time, value: cumTP / count });
            }
        }
        result.vwap = vwapSeries.slice(-100);
    }
    // Supertrend series (btc_supertrend)
    if (strategy === "btc_supertrend") {
        const stSeries = calcSupertrendSeries(candles, 7, 3);
        const offset = candles.length - stSeries.length;
        const stUpArr = [];
        const stDownArr = [];
        for (let i = 0; i < stSeries.length; i++) {
            const t = candles[offset + i].time;
            const s = stSeries[i];
            stUpArr.push({ time: t, value: s.dir === "up" ? s.value : null });
            stDownArr.push({ time: t, value: s.dir === "down" ? s.value : null });
        }
        result.supertrendUp = stUpArr.slice(-100);
        result.supertrendDown = stDownArr.slice(-100);
    }
    // ORB High/Low (btc_orion)
    if (strategy === "btc_orion") {
        result.orbHigh = btcOrbHigh;
        result.orbLow = btcOrbLow;
    }
    res.json(result);
});
app.get("/health", (_req, res) => {
    res.json({
        status: "running",
        marketOpen: isMarketOpen(),
        prices: {
            nifty: lastNiftyPrice,
            banknifty: lastBankniftyPrice,
            sensex: lastSensexPrice,
            vix: lastVix,
        },
        candles: {
            nifty_30s: getCandles("NIFTY", "30s").length,
            nifty_5m: getCandles("NIFTY", "5m").length,
            nifty_15m: getCandles("NIFTY", "15m").length,
            bnf_5m: getCandles("BANKNIFTY", "5m").length,
        },
        optionChain: {
            nifty: getLatestChain("NIFTY")?.pcr?.toFixed(2) ?? "N/A",
            banknifty: getLatestChain("BANKNIFTY")?.pcr?.toFixed(2) ?? "N/A",
        },
        timestamp: new Date().toISOString(),
    });
});
app.get("/candles", (_req, res) => {
    res.json({
        nifty_30s: getCandles("NIFTY", "30s").slice(-20),
        nifty_5m: getCandles("NIFTY", "5m").slice(-10),
    });
});
app.get("/btc/status", (_req, res) => {
    res.json({
        btcPrice,
        btcCandles_30s: getCandles("BTC", "30s").length,
        btcCandles_5m: getCandles("BTC", "5m").length,
    });
});
app.post("/api/upstox/token-webhook", async (req, res) => {
    const { access_token, message_type } = req.body;
    if (message_type !== "access_token" || !access_token) {
        res.json({ received: true });
        return;
    }
    process.env.UPSTOX_ACCESS_TOKEN = access_token;
    const today = todayIST();
    const [e1, e2] = await Promise.all([
        supabase.from("config").upsert({ key: "UPSTOX_ACCESS_TOKEN", value: access_token }, { onConflict: "key" }),
        supabase.from("config").upsert({ key: "UPSTOX_TOKEN_DATE", value: today }, { onConflict: "key" }),
    ]);
    if (e1.error)
        console.error("[Token] Failed to save token to Supabase:", e1.error.message);
    if (e2.error)
        console.error("[Token] Failed to save token date:", e2.error.message);
    console.log(`[Token] New Upstox token received and activated (${today})`);
    res.json({ received: true });
});
// Endpoint called by GitHub Actions (and manually via curl) to trigger a
// push-notification approval request to the Upstox app.
// Server-side check prevents duplicate requests if already approved today.
app.post("/api/request-upstox-token", async (_req, res) => {
    const approved = await isTokenApprovedToday();
    if (approved) {
        console.log("[Token] /api/request-upstox-token called — already approved today, skipping");
        res.json({ status: "already_approved", message: "Token already approved today" });
        return;
    }
    console.log("[Token] /api/request-upstox-token called — sending request");
    await sendTokenRequest();
    res.json({ status: "requested", message: "Approval notification sent to Upstox app" });
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
const _accessTok = process.env.UPSTOX_ACCESS_TOKEN ?? "";
const _analyticsTok = process.env.UPSTOX_ANALYTICS_TOKEN ?? "";
console.log(`[Token] ACCESS_TOKEN   : ${_accessTok ? _accessTok.substring(0, 10) + "..." : "NOT SET"}`);
console.log(`[Token] ANALYTICS_TOKEN: ${_analyticsTok ? _analyticsTok.substring(0, 10) + "..." : "NOT SET"}`);
if (_analyticsTok) {
    console.log("[Token] Analytics Token active (expires 2027) — will be used for all market data");
}
else {
    console.warn("[Token] UPSTOX_ANALYTICS_TOKEN not set — falling back to OAuth token for market data");
}
refreshUsdToInr().catch(console.error);
scheduleTokenRequest();
// Load token first, THEN seed equity candles — seeding needs a valid Upstox token.
// BTC uses public Kraken API so can start in parallel.
seedBtcCandlesFromKraken().catch(console.error);
loadTokenFromSupabase()
    .then(() => seedEquityCandlesFromUpstox())
    .catch(console.error);
// LTP every second
pollLTP();
setInterval(pollLTP, 1000);
// Option chain every 60 seconds
pollOptionChain();
setInterval(pollOptionChain, 60000);
// Equity strategy loop every 30 seconds
runEquityStrategies();
setInterval(runEquityStrategies, 30000);
// BTC
connectBinanceWS();
runBtcStrategies();
setInterval(runBtcStrategies, 30000);
setInterval(monitorBtcPositions, 5000);
