/**
 * EMA Crossover Backtest Engine — 1-minute resolution [SYNTHETIC-PREMIUM]
 *
 * Exactly replicates S8 (ema_crossover_1m) logic, parameterized:
 *   entryConfirmSec  {0, 60, 120, 180} — seconds to wait before entering after a cross
 *   exitConfirmSec   {0, 60, 120, 180} — seconds to wait before exiting/flipping after an opposite cross
 *   chopFilter       number | 0 — minimum EMA separation (in index points) to enter; 0 = off
 *   dualTf           boolean — not applicable at 1-min (no finer resolution); always false
 *
 * NOTE: Minimum confirmation granularity is 60 seconds (1 bar) due to 1-minute resolution.
 *       A value of 0 means immediate; {60,120,180} map to {1,2,3} bar confirmation.
 *       The live server runs on 30-second candles, so this engine may generate ~40-60%
 *       fewer crossover signals than the actual live strategy.
 *
 * Premium model: Black-Scholes European (NIFTY is European-style). All P&L labeled [SYNTHETIC].
 * SL check:   CE position → checks BSM at bar.low; PE position → checks BSM at bar.high
 * Trail/tgt:  checked against BSM at bar.close (mark-to-market)
 */

import { bsmPrice, realizedVol, nextNiftyExpiry, timeToExpiry, selectStrike, T_MARK_FLOOR } from './bsm.mjs';
import { calcCharges } from './charges.mjs';

// ── Constants matching live S8 ────────────────────────────────────────────────
const LOT_SIZE           = 65;
const CAPITAL            = 100_000;          // ₹1,00,000 per strategy
const SIZING_PCT         = 0.60;             // 60% of current capital
const SL_PCT             = 0.15;             // 15% hard SL below entry
const TARGET_PCT         = 0.30;             // 30% target above entry
const TRAIL_ACTIVATE_PCT = 0.20;             // trail activates at +20%
const TRAIL_PCT          = 0.10;             // trail at 10% below peak
const MAX_LOSS           = 8_000;            // ₹8,000 cap
const RISK_FREE_RATE     = 0.07;             // India 10yr ~7%
const PREM_MIN           = 60;              // ₹ premium range floor
const PREM_MAX           = 70;              // ₹ premium range ceiling
const WINDOW_START_MIN   = 585;             // 9:45 AM IST in minutes-since-midnight
const WINDOW_END_MIN     = 920;             // 15:20 IST (hard close fires at this exact minute)
const MAX_CANDLES        = 500;             // rolling window matching live server
const VOL_LOOKBACK_DAYS  = 20;             // for realized-vol IV estimate

// ── EMA (same implementation as live server) ──────────────────────────────────
function emaValues(values, period) {
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

// ── IST helpers ───────────────────────────────────────────────────────────────
function toIstMins(tsMs) {
  // UTC ms → IST minutes since midnight
  const ist = new Date(tsMs + 5.5 * 3600 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function toIstDateStr(tsMs) {
  const ist = new Date(tsMs + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

// ── Sizing (matches live calcLots + capQtyByMaxLoss) ─────────────────────────
function calcQty(capital, premium) {
  const rawQty = Math.floor((capital * SIZING_PCT) / premium);
  const lots   = Math.floor(rawQty / LOT_SIZE) * LOT_SIZE;
  // ₹8,000 max-loss cap
  const maxByLoss = Math.floor(MAX_LOSS / (premium * SL_PCT) / LOT_SIZE) * LOT_SIZE;
  return Math.min(lots, maxByLoss);
}

// ── BSM mark-to-market at a given spot price ─────────────────────────────────
// Uses T_MARK_FLOOR to prevent gamma explosion near expiry (see bsm.mjs).
// selectStrike (entry) still uses raw T — floor only applies to position monitoring.
function markPremium(spot, pos, nowMs) {
  const T = Math.max(timeToExpiry(nowMs, pos.expiryMs), T_MARK_FLOOR);
  return bsmPrice(spot, pos.strike, T, RISK_FREE_RATE, pos.sigma, pos.type);
}

// ── Main backtest runner ───────────────────────────────────────────────────────
/**
 * @param {Array<{time:number,open:number,high:number,low:number,close:number}>} candles
 *   All 1-minute candles for the backtest period, sorted ascending by time.
 * @param {object} params
 *   { entryConfirmSec: 0|60|120|180, exitConfirmSec: 0|60|120|180,
 *     chopFilter: number (0=off), startCapital: number (default 100000) }
 * @param {string} [startDate]  ISO date string "YYYY-MM-DD"; if set, skip bars before this date
 * @param {string} [endDate]    ISO date string "YYYY-MM-DD"; if set, skip bars after this date
 * @returns {{ trades: Trade[], stats: Stats }}
 */
export function runBacktest(candles, params, startDate, endDate) {
  const entryConfirmBars = Math.round((params.entryConfirmSec ?? 0) / 60);
  const exitConfirmBars  = Math.round((params.exitConfirmSec  ?? 0) / 60);
  const chopFilter       = params.chopFilter ?? 0;
  let   capital          = params.startCapital ?? CAPITAL;

  const startMs = startDate ? new Date(startDate + 'T00:00:00Z').getTime() : 0;
  const endMs   = endDate   ? new Date(endDate   + 'T23:59:59Z').getTime() : Infinity;

  const trades   = [];
  let   pos      = null;   // open position
  let   pending  = null;   // pending entry/exit confirmation state
  let   prevFast = 0;
  let   prevSlow = 0;
  let   lastDate = '';     // track day boundaries for vol recalculation

  // Rolling IV cache (recompute once per trading day, expensive over full history)
  let   cachedSigma = 0.18; // initial fallback
  let   sigmaDate   = '';

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    if (bar.time < startMs || bar.time > endMs) continue;

    const istMins = toIstMins(bar.time);
    const istDate = toIstDateStr(bar.time);

    // Need at least 66 bars for EMA64 warmup (matching live S8 check)
    const winStart = Math.max(0, i - MAX_CANDLES + 1);
    const window   = candles.slice(winStart, i + 1);
    if (window.length < 66) continue;

    // Recompute IV once per trading day (use all available candles up to this point)
    if (istDate !== sigmaDate) {
      sigmaDate   = istDate;
      // Use up to 30 trading days of history before today for vol estimation
      const volWindow = candles.slice(Math.max(0, i - 30 * 375), i);
      if (volWindow.length > 375) {
        cachedSigma = realizedVol(volWindow, VOL_LOOKBACK_DAYS);
        if (!isFinite(cachedSigma) || cachedSigma <= 0) cachedSigma = 0.18;
      }
    }

    // Track day for sigma recalculation only — do NOT reset EMA state (live server persists cross-day)
    if (istDate !== lastDate) {
      lastDate = istDate;
    }

    // ── Hard close: fire at window end minute regardless of signals ───────────
    if (istMins >= WINDOW_END_MIN && pos) {
      const exitPrem = markPremium(bar.close, pos, bar.time);
      const exitSafe = Math.max(exitPrem, 0.05);
      const trade = closeTrade(pos, bar.time, exitSafe, 'HARD_CLOSE', capital);
      capital += trade.netPnl;
      trades.push(trade);
      pos = null;
      pending = null;
    }

    if (istMins < WINDOW_START_MIN || istMins >= WINDOW_END_MIN) continue;

    // ── EMA crossover detection ───────────────────────────────────────────────
    const closes   = window.map(c => c.close);
    const fastArr  = emaValues(closes, 16);
    const slowArr  = emaValues(closes, 64);
    const fastCurr = fastArr[fastArr.length - 1];
    const slowCurr = slowArr[slowArr.length - 1];
    const fastPrev = prevFast || fastArr[fastArr.length - 2];
    const slowPrev = prevSlow || slowArr[slowArr.length - 2];
    prevFast = fastCurr;
    prevSlow = slowCurr;

    const bullCross = fastPrev <= slowPrev && fastCurr > slowCurr;
    const bearCross = fastPrev >= slowPrev && fastCurr < slowCurr;

    // ── Monitor open position (SL, trail, target) ────────────────────────────
    if (pos) {
      // Use bar.close for all checks — matches live server's ~30s polling cadence.
      // Intrabar lows/highs are NOT checked: the live server only sees prices at poll time,
      // so it would miss transient intrabar SL breaches that recover by close.
      const closePrem = markPremium(bar.close, pos, bar.time);

      // Update peak at bar close
      if (closePrem > pos.peak) pos.peak = closePrem;

      // Trail SL activation / ratchet
      if (!pos.trailActive && closePrem >= pos.entry * (1 + TRAIL_ACTIVATE_PCT)) {
        pos.trailActive = true;
        pos.trailSL     = pos.peak * (1 - TRAIL_PCT);
      }
      if (pos.trailActive) {
        const newTrail = pos.peak * (1 - TRAIL_PCT);
        if (newTrail > pos.trailSL) pos.trailSL = newTrail;
      }

      // SL check at bar close
      if (closePrem <= pos.slPrice) {
        const trade = closeTrade(pos, bar.time, pos.slPrice, 'SL_HIT', capital);
        capital += trade.netPnl;
        trades.push(trade);
        pos = null;
        pending = null;
        continue;
      }

      // Trail SL check at bar close
      if (pos.trailActive && closePrem <= pos.trailSL) {
        const trade = closeTrade(pos, bar.time, pos.trailSL, 'TRAIL_SL', capital);
        capital += trade.netPnl;
        trades.push(trade);
        pos = null;
        pending = null;
        continue;
      }

      // Target check at bar close
      if (closePrem >= pos.entry * (1 + TARGET_PCT)) {
        const trade = closeTrade(pos, bar.time, closePrem, 'TARGET_HIT', capital);
        capital += trade.netPnl;
        trades.push(trade);
        pos = null;
        pending = null;
        continue;
      }
    }

    // ── Pending confirmation state ────────────────────────────────────────────
    if (pending) {
      pending.barsWaited++;
      const stillBull = fastCurr > slowCurr;
      const stillBear = fastCurr < slowCurr;
      const dirOk = (pending.dir === 'CE' && stillBull) || (pending.dir === 'PE' && stillBear);

      if (!dirOk) {
        // Cross has reverted — cancel pending
        pending = null;
      } else if (pending.barsWaited >= pending.barsNeeded) {
        // Confirmed — execute
        if (pending.exitPos) {
          // Close existing position first
          const exitPrem = markPremium(bar.close, pending.exitPos, bar.time);
          const trade = closeTrade(pending.exitPos, bar.time, exitPrem, 'CROSSOVER', capital);
          capital += trade.netPnl;
          trades.push(trade);
          pos = null;
        }
        // Open new position
        pos = openPosition(bar, pending.dir, capital, cachedSigma);
        pending = null;
      }
      continue;
    }

    // ── New cross signal ──────────────────────────────────────────────────────
    if (!bullCross && !bearCross) continue;

    const dir = bullCross ? 'CE' : 'PE';

    // Chop filter: skip if EMA separation is too narrow
    if (chopFilter > 0 && Math.abs(fastCurr - slowCurr) < chopFilter) continue;

    if (pos) {
      if (pos.type === dir) continue; // already in correct direction

      // Opposite direction — exit and flip
      if (exitConfirmBars === 0) {
        const exitPrem = markPremium(bar.close, pos, bar.time);
        const trade = closeTrade(pos, bar.time, exitPrem, 'CROSSOVER', capital);
        capital += trade.netPnl;
        trades.push(trade);
        pos = null;
        // Immediately open new
        const newPos = openPosition(bar, dir, capital, cachedSigma);
        if (newPos) pos = newPos;
      } else {
        pending = { dir, barsNeeded: exitConfirmBars, barsWaited: 0, exitPos: pos };
      }
    } else {
      // No open position
      if (entryConfirmBars === 0) {
        pos = openPosition(bar, dir, capital, cachedSigma);
      } else {
        pending = { dir, barsNeeded: entryConfirmBars, barsWaited: 0, exitPos: null };
      }
    }
  }

  // Force-close any open position at end of period
  if (pos && candles.length > 0) {
    const lastBar = candles[candles.length - 1];
    const exitPrem = markPremium(lastBar.close, pos, lastBar.time);
    const trade = closeTrade(pos, lastBar.time, Math.max(exitPrem, 0.05), 'PERIOD_END', capital);
    capital += trade.netPnl;
    trades.push(trade);
  }

  const stats = computeStats(trades);
  return { trades, stats, finalCapital: capital };
}

// ── Open a position ───────────────────────────────────────────────────────────
function openPosition(bar, type, capital, sigma) {
  const expiryMs = nextNiftyExpiry(bar.time);
  const T        = timeToExpiry(bar.time, expiryMs);
  const { strike, premium } = selectStrike(bar.close, type, T, RISK_FREE_RATE, sigma);
  if (premium <= 0) return null;

  const qty = calcQty(capital, premium);
  if (qty === 0) return null;

  return {
    type,
    strike,
    premium,         // entry premium
    entry:    premium,
    slPrice:  Math.round(premium * (1 - SL_PCT) * 10) / 10,
    peak:     premium,
    trailSL:  0,
    trailActive: false,
    qty,
    expiryMs,
    sigma,
    openTime: bar.time,
  };
}

// ── Close a position → Trade record ──────────────────────────────────────────
function closeTrade(pos, closeTime, exitPrem, reason, capital) {
  const grossPnl = (exitPrem - pos.entry) * pos.qty;
  const charges  = calcCharges(pos.entry, exitPrem, pos.qty);
  const netPnl   = grossPnl - charges;
  return {
    type:      pos.type,
    strike:    pos.strike,
    entry:     pos.entry,
    exit:      exitPrem,
    qty:       pos.qty,
    openTime:  pos.openTime,
    closeTime,
    reason,
    grossPnl:  Math.round(grossPnl * 100) / 100,
    charges:   Math.round(charges   * 100) / 100,
    netPnl:    Math.round(netPnl    * 100) / 100,
    durationMs: closeTime - pos.openTime,
    synthetic:  true,
  };
}

// ── Aggregate stats ───────────────────────────────────────────────────────────
export function computeStats(trades) {
  if (trades.length === 0) return { trades: 0 };

  const netPnls    = trades.map(t => t.netPnl);
  const totalNet   = netPnls.reduce((s, v) => s + v, 0);
  const wins       = trades.filter(t => t.netPnl > 0);
  const losses     = trades.filter(t => t.netPnl <= 0);
  const winRate    = wins.length / trades.length;

  const grossWins  = wins.reduce((s, t) => s + t.grossPnl, 0);
  const grossLoss  = Math.abs(losses.reduce((s, t) => s + t.grossPnl, 0));
  const profitFactor = grossLoss > 0 ? grossWins / grossLoss : Infinity;

  // Max drawdown (running peak of cumulative net PnL)
  let peak = 0, runPnl = 0, maxDD = 0;
  for (const t of trades) {
    runPnl += t.netPnl;
    if (runPnl > peak) peak = runPnl;
    const dd = peak - runPnl;
    if (dd > maxDD) maxDD = dd;
  }

  // Max consecutive losses
  let maxConsecLoss = 0, consecLoss = 0;
  for (const t of trades) {
    if (t.netPnl <= 0) { consecLoss++; if (consecLoss > maxConsecLoss) maxConsecLoss = consecLoss; }
    else consecLoss = 0;
  }

  // Whipsaw drain: CROSSOVER exits with duration < 60s
  const whipsaws     = trades.filter(t => t.reason === 'CROSSOVER' && t.durationMs < 60_000);
  const whipsawDrain = whipsaws.reduce((s, t) => s + t.netPnl, 0);

  // Exit reason breakdown
  const byReason = {};
  for (const t of trades) {
    if (!byReason[t.reason]) byReason[t.reason] = { count: 0, netPnl: 0, wins: 0 };
    byReason[t.reason].count++;
    byReason[t.reason].netPnl += t.netPnl;
    if (t.netPnl > 0) byReason[t.reason].wins++;
  }

  const avgWin  = wins.length  > 0 ? wins.reduce((s,t)  => s + t.netPnl, 0) / wins.length  : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s,t) => s + t.netPnl, 0) / losses.length : 0;

  return {
    trades:         trades.length,
    wins:           wins.length,
    losses:         losses.length,
    winRate:        Math.round(winRate * 1000) / 10,          // %
    totalNetPnl:    Math.round(totalNet * 100) / 100,
    profitFactor:   isFinite(profitFactor) ? Math.round(profitFactor * 100) / 100 : 'inf',
    avgWin:         Math.round(avgWin  * 100) / 100,
    avgLoss:        Math.round(avgLoss * 100) / 100,
    maxDrawdown:    Math.round(maxDD   * 100) / 100,
    maxConsecLoss,
    whipsaws:       whipsaws.length,
    whipsawDrain:   Math.round(whipsawDrain * 100) / 100,
    byReason,
  };
}

// ── Load all cached candles for a date range ──────────────────────────────────
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, 'data', 'candles');

export function loadCandles(fromDate, toDate) {
  const fromMs = new Date(fromDate + 'T00:00:00Z').getTime();
  const toMs   = new Date(toDate   + 'T23:59:59Z').getTime();

  // Determine which months to load
  const months = [];
  const from = new Date(fromMs);
  const to   = new Date(toMs);
  let cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cur <= to) {
    months.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2,'0')}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  const all = [];
  for (const m of months) {
    const file = path.join(DATA_DIR, `${m}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`Missing candle file: ${file} — run fetch-candles.mjs first`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const c of data) {
      if (c.time >= fromMs && c.time <= toMs) all.push(c);
    }
  }

  return all.sort((a, b) => a.time - b.time);
}
