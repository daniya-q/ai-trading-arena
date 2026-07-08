/**
 * SL_HIT Diagnostic — classify backtest SL hits as genuine vs BSM artifact.
 *
 * Reruns the engine in diagnostic mode: captures, for every SL_HIT trade,
 * the entry bar, the SL-trigger bar, spot prices, BSM premiums, sigma used,
 * and time-to-expiry at both points.
 *
 * Classification logic:
 *   GENUINE   — spot moved ≥0.40% from entry close to SL bar close. At delta ~0.5,
 *               0.40% of 24000 = 96 pts → 48-pt premium drop = 74% of a 65-pt entry.
 *               A real option quote would almost certainly be below SL too.
 *   BORDERLINE— spot moved 0.15–0.40%. Corresponds to 36–96 pt NIFTY move → 18–48 pt
 *               premium drop. Live option might or might not have been below SL depending
 *               on exact bid/ask timing.
 *   ARTIFACT  — spot moved <0.15% (< 36 pts). Premium drop driven by theta, IV-day-boundary
 *               change, or BSM model noise — not by a real directional market move.
 */

import { bsmPrice, realizedVol, nextNiftyExpiry, timeToExpiry, selectStrike, T_MARK_FLOOR } from './bsm.mjs';
import { calcCharges } from './charges.mjs';
import { loadCandles } from './engine.mjs';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Reproduce constants from engine.mjs ──────────────────────────────────────
const LOT_SIZE           = 65;
const CAPITAL            = 100_000;
const SIZING_PCT         = 0.60;
const SL_PCT             = 0.15;
const TARGET_PCT         = 0.30;
const TRAIL_ACTIVATE_PCT = 0.20;
const TRAIL_PCT          = 0.10;
const RISK_FREE_RATE     = 0.07;
const PREM_MIN = 60, PREM_MAX = 70;
const WINDOW_START_MIN   = 585;   // 9:45 IST
const WINDOW_END_MIN     = 920;   // 15:20 IST
const MAX_CANDLES        = 500;
const VOL_LOOKBACK_DAYS  = 20;

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
function toIstMins(ts) { const d = new Date(ts + 5.5*3600*1000); return d.getUTCHours()*60+d.getUTCMinutes(); }
function toIstDateStr(ts) { return new Date(ts + 5.5*3600*1000).toISOString().slice(0,10); }
function toIstTimeStr(ts) { return new Date(ts + 5.5*3600*1000).toISOString().slice(11,16)+' IST'; }
function calcQty(capital, premium) {
  const lots = Math.floor(Math.floor((capital * SIZING_PCT) / premium) / LOT_SIZE) * LOT_SIZE;
  const cap  = Math.floor(8000 / (premium * SL_PCT) / LOT_SIZE) * LOT_SIZE;
  return Math.min(lots, cap);
}
function markPremium(spot, pos, nowMs) {
  const T = Math.max(timeToExpiry(nowMs, pos.expiryMs), T_MARK_FLOOR);
  return bsmPrice(spot, pos.strike, T, RISK_FREE_RATE, pos.sigma, pos.type);
}

// ── Diagnostic engine run ─────────────────────────────────────────────────────
// Identical to engine.mjs but injects `diagInfo` into every SL_HIT trade.
function runDiagnostic(candles, startDate, endDate) {
  const startMs = new Date(startDate + 'T00:00:00Z').getTime();
  const endMs   = new Date(endDate   + 'T23:59:59Z').getTime();

  const slHits = [];
  let   pos     = null;
  let   pending = null;
  let   prevFast = 0, prevSlow = 0;
  let   lastDate = '', sigmaDate = '', cachedSigma = 0.18;
  let   capital  = CAPITAL;

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    if (bar.time < startMs || bar.time > endMs) continue;

    const istMins = toIstMins(bar.time);
    const istDate = toIstDateStr(bar.time);
    const winStart = Math.max(0, i - MAX_CANDLES + 1);
    const window   = candles.slice(winStart, i + 1);
    if (window.length < 66) continue;

    if (istDate !== sigmaDate) {
      sigmaDate = istDate;
      const volWin = candles.slice(Math.max(0, i - 30 * 375), i);
      if (volWin.length > 375) {
        const v = realizedVol(volWin, VOL_LOOKBACK_DAYS);
        if (isFinite(v) && v > 0) cachedSigma = v;
      }
    }
    if (istDate !== lastDate) lastDate = istDate;

    if (istMins >= WINDOW_END_MIN && pos) {
      pos = null; pending = null; continue;
    }
    if (istMins < WINDOW_START_MIN || istMins >= WINDOW_END_MIN) continue;

    const closes   = window.map(c => c.close);
    const fastArr  = emaValues(closes, 16);
    const slowArr  = emaValues(closes, 64);
    const fastCurr = fastArr[fastArr.length - 1];
    const slowCurr = slowArr[slowArr.length - 1];
    const fastPrev = prevFast || fastArr[fastArr.length - 2];
    const slowPrev = prevSlow || slowArr[slowArr.length - 2];
    prevFast = fastCurr; prevSlow = slowCurr;

    const bullCross = fastPrev <= slowPrev && fastCurr > slowCurr;
    const bearCross = fastPrev >= slowPrev && fastCurr < slowCurr;

    // ── Monitor open position ─────────────────────────────────────────────────
    if (pos) {
      const closePrem = markPremium(bar.close, pos, bar.time);
      if (closePrem > pos.peak) pos.peak = closePrem;
      if (!pos.trailActive && closePrem >= pos.entry * (1 + TRAIL_ACTIVATE_PCT)) {
        pos.trailActive = true; pos.trailSL = pos.peak * (1 - TRAIL_PCT);
      }
      if (pos.trailActive) { const nt = pos.peak*(1-TRAIL_PCT); if (nt > pos.trailSL) pos.trailSL = nt; }

      if (closePrem <= pos.slPrice) {
        // ── Capture diagnostic data ──────────────────────────────────────────
        const entrySpot = pos.entrySpot;
        const slSpot    = bar.close;
        const spotMovePct = ((slSpot - entrySpot) / entrySpot) * 100;
        // For CE: spot falls → premium falls. Meaningful direction:
        const directedMove = pos.type === 'CE' ? -spotMovePct : spotMovePct;

        // Recompute expected spot move to hit SL purely via BSM (no sigma change)
        // Solve BSM(entrySpot + delta_S, K, T_entry, r, sigma_entry) = slPrice
        // Approximate: delta_S_needed = (slPrice - entryPrem) / delta_approx
        const T_entry = timeToExpiry(pos.openTime, pos.expiryMs);
        const entryPrem = pos.entry;
        // numerical: walk spot in 5-pt steps to find crossing point
        let expectedSpotMove = null;
        const dir = pos.type === 'CE' ? -1 : 1;  // CE needs spot to drop
        for (let pts = 5; pts <= 500; pts += 5) {
          const testSpot = entrySpot + dir * pts;
          const testPrem = bsmPrice(testSpot, pos.strike, T_entry, RISK_FREE_RATE, pos.sigma, pos.type);
          if (testPrem <= pos.slPrice) {
            expectedSpotMove = pts;
            break;
          }
        }

        // IV contribution: what would premium be at SL bar if sigma unchanged vs entry?
        const T_sl = timeToExpiry(bar.time, pos.expiryMs);
        const premSameIV   = bsmPrice(slSpot, pos.strike, T_sl, RISK_FREE_RATE, pos.sigma, pos.type);
        const premEntryIV  = bsmPrice(entrySpot, pos.strike, T_entry, RISK_FREE_RATE, pos.sigma, pos.type);

        // Theta contribution: premium drop from time passage alone (spot held constant)
        const premThetaOnly = bsmPrice(entrySpot, pos.strike, T_sl, RISK_FREE_RATE, pos.sigma, pos.type);
        const thetaDrop = entryPrem - premThetaOnly;

        // Sigma change contribution (day boundary IV shift)
        const sigmaAtEntry = pos.sigma;
        const sigmaAtSL    = cachedSigma;  // might differ if day crossed
        const premNewSigma  = bsmPrice(entrySpot, pos.strike, T_entry, RISK_FREE_RATE, sigmaAtSL, pos.type);
        const sigmaDrop     = entryPrem - premNewSigma;

        // Actual premium drop
        const actualDrop = closePrem - entryPrem;   // negative for loss
        const actualDropPct = (actualDrop / entryPrem) * 100;

        const holdDurationMin = (bar.time - pos.openTime) / 60000;

        // Classification
        const absMove = Math.abs(directedMove);
        let cls;
        if (absMove >= 0.40) cls = 'GENUINE';
        else if (absMove >= 0.15) cls = 'BORDERLINE';
        else cls = 'ARTIFACT';

        slHits.push({
          n:            slHits.length + 1,
          type:         pos.type,
          strike:       pos.strike,
          openTime:     toIstTimeStr(pos.openTime),
          closeTime:    toIstTimeStr(bar.time),
          openDate:     toIstDateStr(pos.openTime),
          holdMin:      Math.round(holdDurationMin),
          entrySpot:    Math.round(entrySpot),
          slSpot:       Math.round(slSpot),
          spotMovePct:  spotMovePct.toFixed(3),
          directedMovePct: directedMove.toFixed(3),
          entryPrem:    entryPrem.toFixed(2),
          slPrice:      pos.slPrice.toFixed(2),
          closePrem:    closePrem.toFixed(2),
          actualDropPct: actualDropPct.toFixed(1),
          sigma:        sigmaAtEntry.toFixed(4),
          sigmaAtSL:    sigmaAtSL.toFixed(4),
          thetaDrop:    thetaDrop.toFixed(2),
          sigmaDrop:    sigmaDrop.toFixed(2),
          expectedSpotMovePts: expectedSpotMove,
          T_entry_days: (T_entry * 365).toFixed(1),
          T_sl_days:    (T_sl    * 365).toFixed(1),
          cls,
        });

        pos = null; pending = null; continue;
      }
      if (pos.trailActive && closePrem <= pos.trailSL) { pos = null; pending = null; continue; }
      if (closePrem >= pos.entry * (1 + TARGET_PCT))   { pos = null; pending = null; continue; }
    }

    // ── Pending confirmation ──────────────────────────────────────────────────
    if (pending) {
      pending.barsWaited++;
      const stillBull = fastCurr > slowCurr, stillBear = fastCurr < slowCurr;
      const dirOk = (pending.dir === 'CE' && stillBull) || (pending.dir === 'PE' && stillBear);
      if (!dirOk) { pending = null; continue; }
      if (pending.barsWaited >= pending.barsNeeded) {
        if (pending.exitPos) { pos = null; }
        // Open new
        const ep = nextNiftyExpiry(bar.time);
        const T  = timeToExpiry(bar.time, ep);
        const { strike, premium } = selectStrike(bar.close, pending.dir, T, RISK_FREE_RATE, cachedSigma);
        if (premium > 0 && calcQty(capital, premium) > 0) {
          pos = { type: pending.dir, strike, entry: premium, slPrice: Math.round(premium * 0.85 * 10)/10,
                  peak: premium, trailSL: 0, trailActive: false, qty: calcQty(capital, premium),
                  expiryMs: ep, sigma: cachedSigma, openTime: bar.time, entrySpot: bar.close };
        }
        pending = null;
      }
      continue;
    }

    // ── New cross ─────────────────────────────────────────────────────────────
    if (!bullCross && !bearCross) continue;
    const dir = bullCross ? 'CE' : 'PE';
    if (pos) {
      if (pos.type === dir) continue;
      pos = null;
      const ep = nextNiftyExpiry(bar.time);
      const T  = timeToExpiry(bar.time, ep);
      const { strike, premium } = selectStrike(bar.close, dir, T, RISK_FREE_RATE, cachedSigma);
      if (premium > 0) {
        const q = calcQty(capital, premium);
        if (q > 0) pos = { type: dir, strike, entry: premium, slPrice: Math.round(premium * 0.85 * 10)/10,
                           peak: premium, trailSL: 0, trailActive: false, qty: q,
                           expiryMs: ep, sigma: cachedSigma, openTime: bar.time, entrySpot: bar.close };
      }
    } else {
      const ep = nextNiftyExpiry(bar.time);
      const T  = timeToExpiry(bar.time, ep);
      const { strike, premium } = selectStrike(bar.close, dir, T, RISK_FREE_RATE, cachedSigma);
      if (premium > 0) {
        const q = calcQty(capital, premium);
        if (q > 0) pos = { type: dir, strike, entry: premium, slPrice: Math.round(premium * 0.85 * 10)/10,
                           peak: premium, trailSL: 0, trailActive: false, qty: q,
                           expiryMs: ep, sigma: cachedSigma, openTime: bar.time, entrySpot: bar.close };
      }
    }
  }
  return slHits;
}

// ── Main ───────────────────────────────────────────────────────────────────────
const FROM_DATE = '2026-06-24', TO_DATE = '2026-07-06';
const WARMUP    = '2026-05-16';

console.log('\n━━━ SL_HIT Diagnostic ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Loading candles...');
const warmup  = loadCandles(WARMUP, '2026-06-23');
const period  = loadCandles(FROM_DATE, TO_DATE);
const full    = [...warmup, ...period].sort((a,b) => a.time - b.time);
console.log(`${full.length} total bars (incl warmup). Running diagnostic engine...\n`);

const hits = runDiagnostic(full, FROM_DATE, TO_DATE);
console.log(`Found ${hits.length} SL_HIT trades.\n`);

// ── Classification summary ─────────────────────────────────────────────────────
const byClass = { GENUINE: [], BORDERLINE: [], ARTIFACT: [] };
for (const h of hits) byClass[h.cls].push(h);

const N = (n, w=6) => String(n).padEnd(w);
const F = (n, dec=2) => Number(n).toFixed(dec);

console.log('━━━ CLASSIFICATION SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log(`  GENUINE   (spot ≥0.40%): ${byClass.GENUINE.length}`);
console.log(`  BORDERLINE(0.15–0.40%): ${byClass.BORDERLINE.length}`);
console.log(`  ARTIFACT  (spot <0.15%): ${byClass.ARTIFACT.length}`);
console.log(`  Total:                  ${hits.length}\n`);

// ── Full table ─────────────────────────────────────────────────────────────────
console.log('━━━ FULL SL_HIT TABLE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
const H = (s,w) => s.padEnd(w);
console.log(
  H('#',3)+H('Date',12)+H('Time open→sl',22)+H('Dur',5)+
  H('Type',5)+H('Strike',8)+H('Spot Δ%',9)+H('Prem Δ%',9)+
  H('σ entry',9)+H('σ sl',7)+H('θ drop',8)+H('T(days)',9)+H('Class',12)
);
console.log('─'.repeat(118));
for (const h of hits) {
  const directedPct = parseFloat(h.directedMovePct);
  const premDropPct = parseFloat(h.actualDropPct);
  console.log(
    H(String(h.n),3)+
    H(h.openDate,12)+
    H(`${h.openTime.slice(0,5)}→${h.closeTime.slice(0,5)}`,22)+
    H(String(h.holdMin)+'m',5)+
    H(h.type,5)+
    H(String(h.strike),8)+
    H((directedPct>=0?'+':'')+directedPct.toFixed(3)+'%',9)+
    H((premDropPct>=0?'+':'')+premDropPct.toFixed(1)+'%',9)+
    H(h.sigma,9)+H(h.sigmaAtSL,7)+
    H(h.thetaDrop,8)+
    H(`${h.T_entry_days}d`,9)+
    H(h.cls,12)
  );
}

// ── Detailed examples (2-3 per class) ─────────────────────────────────────────
console.log('\n━━━ DETAILED EXAMPLES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
const examples = [
  ...byClass.GENUINE.slice(0,2),
  ...byClass.BORDERLINE.slice(0,2),
  ...byClass.ARTIFACT.slice(0,2),
].filter(Boolean);

for (const h of examples) {
  console.log(`  ── Trade #${h.n} [${h.cls}] ──`);
  console.log(`     Date/time:     ${h.openDate}  ${h.openTime.slice(0,5)} → ${h.closeTime.slice(0,5)} IST  (held ${h.holdMin}m)`);
  console.log(`     Option:        NIFTY ${h.type} strike ${h.strike}`);
  console.log(`     Entry premium: ₹${h.entryPrem}  SL price: ₹${h.slPrice}  Close prem: ₹${h.closePrem}`);
  console.log(`     Premium drop:  ${h.actualDropPct}% (need 15.0%)`);
  console.log(`     Spot at entry: ${h.entrySpot}  Spot at SL bar: ${h.slSpot}`);
  console.log(`     Spot move:     ${h.directedMovePct}% (${h.expectedSpotMovePts ?? '>500'} pts expected for SL via delta)`);
  console.log(`     IV (σ):        ${h.sigma} at entry → ${h.sigmaAtSL} at SL bar`);
  console.log(`     Theta erosion: -₹${h.thetaDrop} over ${parseFloat(h.T_entry_days)-parseFloat(h.T_sl_days) > 0 ? (parseFloat(h.T_entry_days)-parseFloat(h.T_sl_days)).toFixed(2) : '0.00'}d  (T: ${h.T_entry_days}d → ${h.T_sl_days}d)`);
  const sigmaShift = Math.abs(parseFloat(h.sigma) - parseFloat(h.sigmaAtSL));
  if (sigmaShift > 0.005) console.log(`     IV shift:      Δσ=${sigmaShift.toFixed(4)} — day boundary repricing`);
  console.log('');
}

// ── Verdict ───────────────────────────────────────────────────────────────────
console.log('━━━ VERDICT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
const artPct = (byClass.ARTIFACT.length / hits.length * 100).toFixed(0);
const genPct = (byClass.GENUINE.length  / hits.length * 100).toFixed(0);
console.log(`  GENUINE:    ${byClass.GENUINE.length}/${hits.length} (${genPct}%)`);
console.log(`  BORDERLINE: ${byClass.BORDERLINE.length}/${hits.length}`);
console.log(`  ARTIFACT:   ${byClass.ARTIFACT.length}/${hits.length} (${artPct}%)\n`);
if (byClass.ARTIFACT.length / hits.length > 0.4) {
  console.log('  Majority or large minority are artifacts → Phase 2 path: FLAG SL-avoidance');
  console.log('  improvements as lower-confidence; weight max drawdown + whipsaw-exit count');
  console.log('  more heavily than raw SL_HIT reduction when ranking parameter combos.');
} else {
  console.log('  Mostly genuine spot moves → Phase 2 proceeds as originally planned.');
  console.log('  SL_HIT reduction from confirmation/chop filter reflects real market noise reduction.');
}
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
