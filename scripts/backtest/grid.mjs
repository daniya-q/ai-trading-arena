/**
 * Phase 2 — Parameter Grid Search + Walk-Forward Validation
 *
 * Grid dimensions: entryConfirmSec × exitConfirmSec × chopFilter = 4×4×4 = 64 combos
 *
 * Performance design:
 *   - Pre-compute per-bar EMA signals and per-day realized vol in one pass.
 *   - 64 combo simulations then consume the pre-computed data — no repeated EMA slice.
 *   - Expected runtime: ~30-60s total (vs hours with windowed EMA per combo).
 *
 * EMA note: uses incremental EMA (O(1)/bar) rather than the engine's O(500)/bar
 *   rolling-slice approach. After 3-month warmup, values converge to within <0.1%
 *   of the live server's 500-bar window. Negligible effect on signal timing.
 *
 * Walk-forward: run once per combo over full dataset → slice trades by 2-week window.
 *
 * Ranking primary: loss-side composite (|whipsawDrain| + |maxDrawdown|).
 * SL_HIT count differences treated as lower-confidence (BSM residual artifacts in
 * 2-4d DTE regime persist after T_MARK_FLOOR fix).
 *
 * Output sections:
 *   1. Ranked combo table (all 64)
 *   2. Per-calendar-year PnL — top-5 vs bottom-5
 *   3. DTE bucket breakdown — top-10 [0-1d / 2-4d / 5+d]
 *   4. Walk-forward window consistency — top-3
 *   5. Best combo per year
 *   6. Recommendation
 *
 * Saves: scripts/backtest/grid-results.json
 */

import { loadCandles, computeStats } from './engine.mjs';
import { bsmPrice, realizedVol, nextNiftyExpiry, timeToExpiry, selectStrike, T_MARK_FLOOR } from './bsm.mjs';
import { calcCharges } from './charges.mjs';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Constants (must match engine.mjs exactly) ─────────────────────────────────
const LOT_SIZE           = 65;
const CAPITAL            = 100_000;
const SIZING_PCT         = 0.60;
const SL_PCT             = 0.15;
const TARGET_PCT         = 0.30;
const TRAIL_ACTIVATE_PCT = 0.20;
const TRAIL_PCT          = 0.10;
const MAX_LOSS           = 8_000;
const RISK_FREE_RATE     = 0.07;
const PREM_MIN           = 60;
const PREM_MAX           = 70;
const WINDOW_START_MIN   = 585;   // 9:45 IST
const WINDOW_END_MIN     = 920;   // 15:20 IST
const VOL_LOOKBACK_DAYS  = 20;
const EMA_FAST_PERIOD    = 16;
const EMA_SLOW_PERIOD    = 64;

// ── Grid ─────────────────────────────────────────────────────────────────────
const ENTRY_CONFIRM_SECS = [0, 60, 120, 180];
const EXIT_CONFIRM_SECS  = [0, 60, 120, 180];
const CHOP_FILTERS       = [0, 1, 2, 3];

// ── Date range ────────────────────────────────────────────────────────────────
const FULL_START  = '2022-01-01';
const FULL_END    = '2026-07-07';
const WARMUP_FROM = '2021-10-01';

// ── Walk-forward: 2-week windows ──────────────────────────────────────────────
function buildTestWindows(start, end) {
  const wins = [];
  let cur = new Date(start + 'T00:00:00Z');
  const endD = new Date(end + 'T00:00:00Z');
  while (cur < endD) {
    const ws = cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 14);
    const we = new Date(Math.min(cur.getTime() - 1, endD.getTime()));
    wins.push({
      start: ws, end: we.toISOString().slice(0, 10),
      startMs: new Date(ws + 'T00:00:00Z').getTime(),
      endMs:   we.getTime(),
    });
  }
  return wins;
}

// ── IST helpers ───────────────────────────────────────────────────────────────
function toIstMins(ts) {
  const d = new Date(ts + 5.5 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function toIstDate(ts) {
  return new Date(ts + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// ── Sizing ────────────────────────────────────────────────────────────────────
function calcQty(capital, premium) {
  const lots    = Math.floor(Math.floor((capital * SIZING_PCT) / premium) / LOT_SIZE) * LOT_SIZE;
  const maxByLoss = Math.floor(MAX_LOSS / (premium * SL_PCT) / LOT_SIZE) * LOT_SIZE;
  return Math.min(lots, maxByLoss);
}

// ── Mark-to-market (with T floor) ────────────────────────────────────────────
function markPrem(spot, pos, nowMs) {
  const T = Math.max(timeToExpiry(nowMs, pos.expiryMs), T_MARK_FLOOR);
  return bsmPrice(spot, pos.strike, T, RISK_FREE_RATE, pos.sigma, pos.type);
}

// ── DTE bucket ────────────────────────────────────────────────────────────────
function dteBucket(trade) {
  const exp = nextNiftyExpiry(trade.openTime);
  const d   = (exp - trade.openTime) / (1000 * 86400);
  if (d <= 1) return '0-1d';
  if (d <= 4) return '2-4d';
  return '5+d';
}

function bucketStats(trades) {
  const B = { '0-1d': [], '2-4d': [], '5+d': [] };
  for (const t of trades) B[dteBucket(t)].push(t);
  const result = {};
  for (const [lbl, ts] of Object.entries(B)) {
    result[lbl] = {
      trades: ts.length,
      netPnl: Math.round(ts.reduce((s, t) => s + t.netPnl, 0) * 100) / 100,
      wins:   ts.filter(t => t.netPnl > 0).length,
      slHits: ts.filter(t => t.reason === 'SL_HIT').length,
    };
  }
  return result;
}

// ── Pre-compute per-bar signals (EMA + sigma) ─────────────────────────────────
function precompute(candles) {
  console.log('  Pre-computing EMA signals...');
  const MULT_FAST = 2 / (EMA_FAST_PERIOD + 1);
  const MULT_SLOW = 2 / (EMA_SLOW_PERIOD + 1);

  // Daily sigma map: date string → sigma
  // Compute realized vol for each trading day using rolling 20-day window.
  // Group closes by IST date.
  const dateCloses = new Map();
  for (const c of candles) {
    const d = toIstDate(c.time);
    if (!dateCloses.has(d)) dateCloses.set(d, []);
    dateCloses.get(d).push(c.close);
  }
  const tradingDays = [...dateCloses.keys()].sort();
  const dailyClose  = tradingDays.map(d => {
    const arr = dateCloses.get(d);
    return { date: d, close: arr[arr.length - 1] };
  });

  const sigmaMap = new Map();
  for (let i = 0; i < dailyClose.length; i++) {
    if (i < 5) { sigmaMap.set(dailyClose[i].date, 0.18); continue; }
    const win = dailyClose.slice(Math.max(0, i - VOL_LOOKBACK_DAYS - 1), i);
    const rets = [];
    for (let j = 1; j < win.length; j++) rets.push(Math.log(win[j].close / win[j-1].close));
    if (rets.length < 4) { sigmaMap.set(dailyClose[i].date, 0.18); continue; }
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
    const sigma = Math.sqrt(variance) * Math.sqrt(252);
    sigmaMap.set(dailyClose[i].date, isFinite(sigma) && sigma > 0 ? sigma : 0.18);
  }

  // Per-bar signal array
  const bars = new Array(candles.length);
  let fastEma = candles[0].close;
  let slowEma = candles[0].close;
  let prevFast = fastEma, prevSlow = slowEma;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const fast = prevFast + MULT_FAST * (c.close - prevFast);
    const slow = prevSlow + MULT_SLOW * (c.close - prevSlow);

    bars[i] = {
      time:      c.time,
      close:     c.close,
      istMins:   toIstMins(c.time),
      istDate:   toIstDate(c.time),
      fastEma:   fast,
      slowEma:   slow,
      bullCross: prevFast <= prevSlow && fast > slow,
      bearCross: prevFast >= prevSlow && fast < slow,
      sigma:     sigmaMap.get(toIstDate(c.time)) ?? 0.18,
      startIdx:  i,   // original index (for startDate/endDate gating)
    };

    prevFast = fast;
    prevSlow = slow;
  }

  console.log(`  Pre-compute done. ${bars.length.toLocaleString()} bars, ${sigmaMap.size} trading days.`);
  return { bars, sigmaMap };
}

// ── Single-combo simulation (uses pre-computed signals) ───────────────────────
function runCombo(bars, startMs, endMs, entryConfirmBars, exitConfirmBars, chopFilter) {
  const trades = [];
  let capital  = CAPITAL;
  let pos      = null;
  let pending  = null;

  function openPos(bar, type) {
    const expiryMs = nextNiftyExpiry(bar.time);
    const T        = Math.max(timeToExpiry(bar.time, expiryMs), T_MARK_FLOOR);
    // Use actual T for entry (not floored) to get realistic strike, per engine.mjs
    const T_entry  = timeToExpiry(bar.time, expiryMs);
    const { strike, premium } = selectStrike(bar.close, type, T_entry, RISK_FREE_RATE, bar.sigma);
    if (premium <= 0) return null;
    const qty = calcQty(capital, premium);
    if (qty === 0) return null;
    return {
      type, strike, entry: premium, peak: premium,
      slPrice:     Math.round(premium * (1 - SL_PCT) * 10) / 10,
      trailSL:     0, trailActive: false,
      qty, expiryMs, sigma: bar.sigma, openTime: bar.time,
    };
  }

  function closeTrade(pos, closeTime, exitPrem, reason) {
    const grossPnl = (exitPrem - pos.entry) * pos.qty;
    const charges  = calcCharges(pos.entry, exitPrem, pos.qty);
    const netPnl   = grossPnl - charges;
    return {
      type: pos.type, strike: pos.strike, entry: pos.entry, exit: exitPrem,
      qty: pos.qty, openTime: pos.openTime, closeTime, reason,
      grossPnl: Math.round(grossPnl * 100) / 100,
      charges:  Math.round(charges   * 100) / 100,
      netPnl:   Math.round(netPnl    * 100) / 100,
      durationMs: closeTime - pos.openTime,
    };
  }

  for (const bar of bars) {
    if (bar.time < startMs || bar.time > endMs) continue;

    const { istMins, fastEma, slowEma, bullCross, bearCross, sigma } = bar;

    // Hard close
    if (istMins >= WINDOW_END_MIN && pos) {
      const ep = markPrem(bar.close, pos, bar.time);
      const t  = closeTrade(pos, bar.time, Math.max(ep, 0.05), 'HARD_CLOSE');
      capital += t.netPnl; trades.push(t); pos = null; pending = null;
    }
    if (istMins < WINDOW_START_MIN || istMins >= WINDOW_END_MIN) continue;

    // Monitor open position
    if (pos) {
      const cp = markPrem(bar.close, pos, bar.time);
      if (cp > pos.peak) pos.peak = cp;

      if (!pos.trailActive && cp >= pos.entry * (1 + TRAIL_ACTIVATE_PCT)) {
        pos.trailActive = true;
        pos.trailSL     = pos.peak * (1 - TRAIL_PCT);
      }
      if (pos.trailActive) {
        const nt = pos.peak * (1 - TRAIL_PCT);
        if (nt > pos.trailSL) pos.trailSL = nt;
      }

      if (cp <= pos.slPrice) {
        const t = closeTrade(pos, bar.time, pos.slPrice, 'SL_HIT');
        capital += t.netPnl; trades.push(t); pos = null; pending = null; continue;
      }
      if (pos.trailActive && cp <= pos.trailSL) {
        const t = closeTrade(pos, bar.time, pos.trailSL, 'TRAIL_SL');
        capital += t.netPnl; trades.push(t); pos = null; pending = null; continue;
      }
      if (cp >= pos.entry * (1 + TARGET_PCT)) {
        const t = closeTrade(pos, bar.time, cp, 'TARGET_HIT');
        capital += t.netPnl; trades.push(t); pos = null; pending = null; continue;
      }
    }

    // Pending confirmation
    if (pending) {
      pending.barsWaited++;
      const stillBull = fastEma > slowEma;
      const stillBear = fastEma < slowEma;
      const dirOk = (pending.dir === 'CE' && stillBull) || (pending.dir === 'PE' && stillBear);
      if (!dirOk) { pending = null; continue; }
      if (pending.barsWaited >= pending.barsNeeded) {
        if (pending.exitPos) {
          const ep = markPrem(bar.close, pending.exitPos, bar.time);
          const t  = closeTrade(pending.exitPos, bar.time, ep, 'CROSSOVER');
          capital += t.netPnl; trades.push(t); pos = null;
        }
        pos = openPos(bar, pending.dir);
        pending = null;
      }
      continue;
    }

    if (!bullCross && !bearCross) continue;
    const dir = bullCross ? 'CE' : 'PE';
    if (chopFilter > 0 && Math.abs(fastEma - slowEma) < chopFilter) continue;

    if (pos) {
      if (pos.type === dir) continue;
      if (exitConfirmBars === 0) {
        const ep = markPrem(bar.close, pos, bar.time);
        const t  = closeTrade(pos, bar.time, ep, 'CROSSOVER');
        capital += t.netPnl; trades.push(t); pos = null;
        const np = openPos(bar, dir);
        if (np) pos = np;
      } else {
        pending = { dir, barsNeeded: exitConfirmBars, barsWaited: 0, exitPos: pos };
      }
    } else {
      if (entryConfirmBars === 0) {
        pos = openPos(bar, dir);
      } else {
        pending = { dir, barsNeeded: entryConfirmBars, barsWaited: 0, exitPos: null };
      }
    }
  }
  return trades;
}

// ── Loss-side composite score ─────────────────────────────────────────────────
function lossScore(stats) {
  return Math.abs(stats.whipsawDrain ?? 0) + Math.abs(stats.maxDrawdown ?? 0);
}

// ── Formatters ────────────────────────────────────────────────────────────────
const INR  = n => `${n >= 0 ? '+' : '-'}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const PAD  = (s, n) => String(s).padEnd(n);
const PADR = (s, n) => String(s).padStart(n);
function tradeYear(t) { return new Date(t.openTime + 5.5 * 3600 * 1000).getUTCFullYear(); }

// ── Main ───────────────────────────────────────────────────────────────────────
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' Phase 2: Parameter Grid Search + Walk-Forward (4×4×4 = 64 combos)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('Loading candles...');
const warmupCandles = loadCandles(WARMUP_FROM, '2021-12-31');
const mainCandles   = loadCandles(FULL_START, FULL_END);
const allCandles    = [...warmupCandles, ...mainCandles].sort((a, b) => a.time - b.time);
console.log(`Loaded ${allCandles.length.toLocaleString()} bars (incl warmup).`);

const startMs = new Date(FULL_START + 'T00:00:00Z').getTime();
const endMs   = new Date(FULL_END   + 'T23:59:59Z').getTime();
const testWindows = buildTestWindows(FULL_START, FULL_END);
console.log(`Walk-forward: ${testWindows.length} test windows (2-week each).\n`);

// Pre-compute signals
const { bars } = precompute(allCandles);

// Build combos
const combos = [];
for (const ec of ENTRY_CONFIRM_SECS)
  for (const xc of EXIT_CONFIRM_SECS)
    for (const cf of CHOP_FILTERS)
      combos.push({ entryConfirmSec: ec, exitConfirmSec: xc, chopFilter: cf });

console.log(`\nRunning ${combos.length} combo simulations...`);
const t0 = Date.now();

const comboResults = [];
for (let ci = 0; ci < combos.length; ci++) {
  const p    = combos[ci];
  const ecb  = Math.round(p.entryConfirmSec / 60);
  const xcb  = Math.round(p.exitConfirmSec  / 60);
  const trades = runCombo(bars, startMs, endMs, ecb, xcb, p.chopFilter);

  const stats    = computeStats(trades);
  const dteStats = bucketStats(trades);
  const score    = lossScore(stats);
  const lossFreq = trades.length > 0 ? (stats.losses ?? 0) / trades.length : 0;

  // Per-year
  const byYear = {};
  for (const t of trades) {
    const y = tradeYear(t);
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(t);
  }

  // Walk-forward slices
  const byWindow = testWindows.map(win => {
    const wt = trades.filter(t => t.openTime >= win.startMs && t.openTime <= win.endMs);
    return { window: win, stats: computeStats(wt), tradeCount: wt.length };
  });

  comboResults.push({ params: p, trades, stats, dteStats, byYear, byWindow, score, lossFreq });

  if ((ci + 1) % 16 === 0) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${((ci + 1) / combos.length * 100).toFixed(0)}% (${ci + 1}/64) — ${elapsed}s`);
  }
}
console.log(`  Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.\n`);

// Sort
comboResults.sort((a, b) => {
  const ds = a.score - b.score;
  if (Math.abs(ds) > 200) return ds;
  const df = a.lossFreq - b.lossFreq;
  if (Math.abs(df) > 0.005) return df;
  return (b.stats.totalNetPnl ?? 0) - (a.stats.totalNetPnl ?? 0);
});

const allYears = [...new Set(comboResults[0].trades.map(tradeYear))].sort();

// ── SECTION 1: Ranked table ───────────────────────────────────────────────────
console.log('━━━ SECTION 1: RANKED COMBOS (primary: |whipsawDrain|+|maxDD|) ━━━━━━━━━━━━\n');
console.log(
  PAD('Rank',5) + PAD('Entry',7) + PAD('Exit',6) + PAD('Chop',6) +
  PAD('Trades',8) + PAD('Win%',7) + PAD('NetPnL [SYNTH]',16) +
  PAD('PF',7) + PAD('MaxDD',12) + PAD('WhipDrain',12) +
  PAD('Loss%',7) + 'LossScore'
);
console.log('─'.repeat(103));
for (let i = 0; i < comboResults.length; i++) {
  const { params: p, stats: s, score } = comboResults[i];
  const lf = ((s.losses ?? 0) / (s.trades || 1) * 100).toFixed(1);
  console.log(
    PAD(`#${i + 1}`, 5) +
    PAD(`${p.entryConfirmSec}s`, 7) +
    PAD(`${p.exitConfirmSec}s`, 6) +
    PAD(p.chopFilter, 6) +
    PAD(s.trades ?? 0, 8) +
    PAD(`${s.winRate ?? 0}%`, 7) +
    PAD(INR(s.totalNetPnl ?? 0), 16) +
    PAD(s.profitFactor ?? '-', 7) +
    PAD(INR(-(s.maxDrawdown ?? 0)), 12) +
    PAD(INR(s.whipsawDrain ?? 0), 12) +
    PAD(`${lf}%`, 7) +
    INR(-score)
  );
}

// ── SECTION 2: Per-year PnL ───────────────────────────────────────────────────
console.log('\n━━━ SECTION 2: PER-YEAR NET PNL — TOP-5 vs BOTTOM-5 [SYNTH] ━━━━━━━━━━━━━\n');
const showRanks = [
  ...comboResults.slice(0, 5).map((cr, i) => ({ cr, tag: `#${i + 1}` })),
  ...comboResults.slice(-5).map((cr, i) => ({ cr, tag: `#${comboResults.length - 4 + i}` })),
];
process.stdout.write(PAD('Combo', 20));
for (const y of allYears) process.stdout.write(PADR(String(y), 12));
console.log(PADR('Total', 13));
console.log('─'.repeat(20 + allYears.length * 12 + 13));
for (const { cr, tag } of showRanks) {
  const { params: p, byYear } = cr;
  process.stdout.write(PAD(`${tag} ${p.entryConfirmSec}/${p.exitConfirmSec}/${p.chopFilter}`, 20));
  let tot = 0;
  for (const y of allYears) {
    const yt = byYear[y] ?? [];
    const pnl = yt.reduce((s, t) => s + t.netPnl, 0);
    tot += pnl;
    process.stdout.write(PADR(INR(pnl), 12));
  }
  console.log(PADR(INR(tot), 13));
}

// ── SECTION 3: DTE bucket breakdown — top-10 ─────────────────────────────────
console.log('\n━━━ SECTION 3: DTE BUCKET — TOP-10 COMBOS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('  [0-1d]=expiry day | [2-4d]=penultimate+ | [5+d]=normal');
console.log('  Residual BSM artifacts most likely in [2-4d] bucket (tight-SL+delta regime)\n');
const BH = (s, w) => String(s).padEnd(w);
console.log(
  BH('Combo', 24) +
  BH('[0-1d] #/PnL/SL', 24) +
  BH('[2-4d] #/PnL/SL', 24) +
  '[5+d] #/PnL/SL'
);
console.log('─'.repeat(96));
for (let i = 0; i < Math.min(10, comboResults.length); i++) {
  const { params: p, dteStats: d } = comboResults[i];
  const fmt = b => `${b.trades}/${INR(b.netPnl)}/${b.slHits}sl`;
  console.log(
    BH(`#${i + 1} ${p.entryConfirmSec}s/${p.exitConfirmSec}s/c${p.chopFilter}`, 24) +
    BH(fmt(d['0-1d']), 24) +
    BH(fmt(d['2-4d']), 24) +
    fmt(d['5+d'])
  );
}

// ── SECTION 4: Walk-forward window consistency — top-3 ───────────────────────
console.log('\n━━━ SECTION 4: WALK-FORWARD WINDOW P&L — TOP-3 COMBOS ━━━━━━━━━━━━━━━━━━━━\n');
for (let ci = 0; ci < 3; ci++) {
  const { params: p, byWindow } = comboResults[ci];
  const active = byWindow.filter(w => w.tradeCount > 0);
  const pos    = active.filter(w => (w.stats.totalNetPnl ?? 0) > 0).length;
  console.log(`  Combo #${ci + 1}: entry=${p.entryConfirmSec}s exit=${p.exitConfirmSec}s chop=${p.chopFilter}`);
  console.log(`  Active windows: ${active.length}  |  Positive: ${pos} (${active.length > 0 ? (pos/active.length*100).toFixed(0) : 0}%)`);
  console.log('  ' + PAD('Window', 25) + PAD('Trades', 8) + PAD('Wins', 6) + PAD('NetPnL', 14) + 'Win%');
  console.log('  ' + '─'.repeat(59));
  for (const { window: w, stats: ws, tradeCount } of byWindow) {
    if (tradeCount === 0) continue;
    console.log(
      '  ' + PAD(`${w.start}→${w.end}`, 25) +
      PAD(tradeCount, 8) + PAD(ws.wins ?? 0, 6) +
      PAD(INR(ws.totalNetPnl ?? 0), 14) + `${ws.winRate ?? 0}%`
    );
  }
  console.log('');
}

// ── SECTION 5: Best combo per year ───────────────────────────────────────────
console.log('━━━ SECTION 5: BEST COMBO PER CALENDAR YEAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
for (const y of allYears) {
  let bestScore = Infinity, bestNet = -Infinity, bestLabel = '';
  for (const cr of comboResults) {
    const yt = cr.byYear[y] ?? [];
    if (!yt.length) continue;
    const ys  = computeStats(yt);
    const ysc = lossScore(ys);
    const ypnl = ys.totalNetPnl ?? 0;
    if (ysc < bestScore || (ysc === bestScore && ypnl > bestNet)) {
      bestScore = ysc; bestNet = ypnl;
      const { params: pp } = cr;
      bestLabel = `entry=${pp.entryConfirmSec}s exit=${pp.exitConfirmSec}s chop=${pp.chopFilter} → ${INR(ypnl)} (score: ${INR(-ysc)})`;
    }
  }
  console.log(`  ${y}: ${bestLabel}`);
}

// ── SECTION 6: Recommendation ─────────────────────────────────────────────────
console.log('\n━━━ SECTION 6: RECOMMENDATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
const top = comboResults[0];
const { params: tp, stats: ts, dteStats: td, byWindow: tbw } = top;
const aw  = tbw.filter(w => w.tradeCount > 0);
const pw  = aw.filter(w => (w.stats.totalNetPnl ?? 0) > 0).length;

console.log(`  Top-ranked combo:`);
console.log(`    entryConfirmSec = ${tp.entryConfirmSec}s   exitConfirmSec = ${tp.exitConfirmSec}s   chopFilter = ${tp.chopFilter} pts`);
console.log(`    Net PnL [SYNTH]: ${INR(ts.totalNetPnl ?? 0)}  |  Win rate: ${ts.winRate}%  |  Profit factor: ${ts.profitFactor}`);
console.log(`    Max drawdown: ${INR(-(ts.maxDrawdown ?? 0))}  |  Whipsaw drain: ${INR(ts.whipsawDrain ?? 0)}`);
console.log(`    Loss-side score: ${INR(-top.score)}`);
console.log(`    Positive walk-forward windows: ${pw}/${aw.length} (${aw.length > 0 ? (pw/aw.length*100).toFixed(0) : 0}%)`);
console.log(`    DTE: [0-1d] ${td['0-1d'].trades}t/${td['0-1d'].slHits}sl  |  [2-4d] ${td['2-4d'].trades}t/${td['2-4d'].slHits}sl  |  [5+d] ${td['5+d'].trades}t/${td['5+d'].slHits}sl`);
console.log(`\n  Ranking note:`);
console.log(`    SL_HIT count differences between combos are lower-confidence.`);
console.log(`    BSM residual artifacts in [2-4d] DTE (Jun-29-type tight-SL regime).`);
console.log(`    Validate that top combo's loss-score advantage holds in [5+d] bucket too.\n`);

// ── Save ──────────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'grid-results.json');
fs.writeFileSync(outPath, JSON.stringify(
  comboResults.map((cr, rank) => ({
    rank: rank + 1, params: cr.params, stats: cr.stats,
    dteStats: cr.dteStats, lossScore: cr.score, lossFreq: cr.lossFreq,
    byYear: Object.fromEntries(Object.entries(cr.byYear).map(([y, ts]) => [y, {
      trades: ts.length,
      netPnl: Math.round(ts.reduce((s, t) => s + t.netPnl, 0) * 100) / 100,
      wins:   ts.filter(t => t.netPnl > 0).length,
    }])),
  })), null, 2
));
console.log(`  grid-results.json saved.\n`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
