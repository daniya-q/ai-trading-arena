import { loadCandles } from './engine.mjs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const IST = 5.5 * 3600 * 1000;
const istMin = (t) => { const d = new Date(t + IST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const dayKey = (t) => new Date(t + IST).toISOString().slice(0, 10);

// ── load candles + build day-anchored VWAP series ──
const candles = loadCandles('2026-06-01', '2026-07-31');
const dayStart = new Map();
{ let lk = null; for (let i = 0; i < candles.length; i++) { const k = dayKey(candles[i].time); if (k !== lk) { dayStart.set(k, i); lk = k; } } }

// Precompute VWAP at every bar (day-anchored, unweighted typical price — matches live calcVWAP)
const vwapArr = new Array(candles.length).fill(0);
{
  let s = 0, sum = 0, n = 0, lk = null;
  for (let i = 0; i < candles.length; i++) {
    const k = dayKey(candles[i].time);
    if (k !== lk) { sum = 0; n = 0; lk = k; }
    sum += (candles[i].high + candles[i].low + candles[i].close) / 3;
    n++;
    vwapArr[i] = sum / n;
  }
  void s;
}

// index candles by minute-bucket for fast lookup
const barByMinute = new Map();
for (let i = 0; i < candles.length; i++) {
  barByMinute.set(Math.floor(candles[i].time / 60000) * 60000, i);
}
function findBar(tsMs) {          // nearest bar at or before tsMs
  let b = Math.floor(tsMs / 60000) * 60000;
  for (let k = 0; k < 10; k++) { if (barByMinute.has(b)) return barByMinute.get(b); b -= 60000; }
  return -1;
}

// ── fetch archived VWAP_CROSS trades ──
const { data: trades, error } = await supabase
  .from('archive_strategy_positions_20260731')
  .select('*')
  .eq('strategy_id', 'vwap_scalper')
  .eq('exit_reason', 'VWAP_CROSS');
if (error) { console.error('query failed:', error.message); process.exit(1); }

console.log(`Total VWAP_CROSS exits in archive: ${trades.length}`);
const nifty = trades.filter(t => t.symbol.startsWith('NIFTY'));
console.log(`NIFTY subset: ${nifty.length}  (BANKNIFTY/SENSEX candles not cached)`);

const rows = [];
let skippedNoCandle = 0;
for (const t of nifty) {
  const exitMs  = new Date(t.closed_at).getTime();
  const entryMs = new Date(t.opened_at).getTime();
  const ei = findBar(exitMs), si = findBar(entryMs);
  if (ei < 0 || si < 0) { skippedNoCandle++; continue; }

  const spotExit  = candles[ei].close;
  const vwapExit  = vwapArr[ei];
  const spotEntry = candles[si].close;
  const vwapEntry = vwapArr[si];

  // distance past VWAP at exit, as % of spot — signed so "wrong side" is positive
  const rawDist = t.type === 'CE' ? (vwapExit - spotExit) : (spotExit - vwapExit);
  const distPct = rawDist / spotExit * 100;

  // did it keep going, or come back? look 15 bars forward
  let maxFurther = 0, cameBack = false;
  for (let j = ei + 1; j <= Math.min(candles.length - 1, ei + 15); j++) {
    if (dayKey(candles[j].time) !== dayKey(candles[ei].time)) break;
    const d = (t.type === 'CE' ? (vwapArr[j] - candles[j].close) : (candles[j].close - vwapArr[j])) / candles[j].close * 100;
    if (d > maxFurther) maxFurther = d;
    if (d < 0) cameBack = true;            // returned to the favourable side
  }

  rows.push({
    symbol: t.symbol, type: t.type,
    entryIst: new Date(entryMs + IST).toISOString().slice(11, 16),
    exitIst:  new Date(exitMs + IST).toISOString().slice(11, 16),
    durMin: Math.round((exitMs - entryMs) / 60000),
    spotEntry: +spotEntry.toFixed(1), vwapEntry: +vwapEntry.toFixed(1),
    spotExit: +spotExit.toFixed(1), vwapExit: +vwapExit.toFixed(1),
    distPct: +distPct.toFixed(4),
    maxFurther: +maxFurther.toFixed(4),
    cameBack,
    netPnl: +( (t.pnl ?? 0) - (t.charges ?? 0) ).toFixed(2),
  });
}
console.log(`Usable (exit inside cached window): ${rows.length}   skipped (no candle): ${skippedNoCandle}\n`);

// ── distributions ──
function pctile(a, p) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; }
const dists = rows.map(r => r.distPct);
console.log('━━ DISTANCE PAST VWAP AT EXIT (% of spot) ━━');
console.log(`n=${dists.length}  min=${Math.min(...dists).toFixed(4)}  p25=${pctile(dists,0.25).toFixed(4)}  median=${pctile(dists,0.5).toFixed(4)}  p75=${pctile(dists,0.75).toFixed(4)}  p90=${pctile(dists,0.9).toFixed(4)}  max=${Math.max(...dists).toFixed(4)}`);

console.log('\n━━ EXITS BY DISTANCE BAND — was the exit justified? ━━');
console.log('band(%)        n    cameBack%   medMaxFurther%   netPnL');
const bands = [[0,0.02],[0.02,0.05],[0.05,0.10],[0.10,0.20],[0.20,999]];
for (const [lo, hi] of bands) {
  const g = rows.filter(r => r.distPct >= lo && r.distPct < hi);
  if (!g.length) { console.log(`${lo}–${hi}`.padEnd(14) + '0'); continue; }
  const cb = g.filter(r => r.cameBack).length;
  const mf = pctile(g.map(r => r.maxFurther), 0.5);
  const pnl = g.reduce((s, r) => s + r.netPnl, 0);
  console.log(`${(lo + '–' + hi).padEnd(14)} ${String(g.length).padEnd(4)} ${(100*cb/g.length).toFixed(1).padEnd(11)} ${mf.toFixed(4).padEnd(16)} ₹${pnl.toFixed(0)}`);
}

console.log('\n━━ SIMULATED DEADBAND — how many exits would each threshold have suppressed? ━━');
console.log('threshold(%)   suppressed   suppressedPnL   remainingPnL');
for (const th of [0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.15]) {
  const sup = rows.filter(r => r.distPct < th);
  const rem = rows.filter(r => r.distPct >= th);
  console.log(`${String(th).padEnd(14)} ${String(sup.length).padEnd(12)} ₹${sup.reduce((s,r)=>s+r.netPnl,0).toFixed(0).padEnd(14)} ₹${rem.reduce((s,r)=>s+r.netPnl,0).toFixed(0)}`);
}

console.log('\nNOTE: suppressedPnL is what those trades ACTUALLY made. A deadband would not have');
console.log('avoided those losses outright — the position stays open and exits later by some other');
console.log('rule. This measures how much PnL sits in near-VWAP exits, not the deadband edge.');

console.log('\n━━ 15 nearest-to-VWAP exits ━━');
for (const r of [...rows].sort((a,b)=>a.distPct-b.distPct).slice(0,15))
  console.log(`${r.symbol.padEnd(24)} ${r.type} ${r.entryIst}→${r.exitIst} ${String(r.durMin).padStart(3)}m  dist=${r.distPct.toFixed(4)}%  maxFurther=${r.maxFurther.toFixed(4)}%  cameBack=${r.cameBack}  ₹${r.netPnl}`);
