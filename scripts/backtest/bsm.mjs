/**
 * Black-Scholes-Merton European option pricer + realized-vol IV estimator.
 * All premiums in ₹ (index points). NIFTY options are European.
 */

// ── Normal CDF (Abramowitz & Stegun approximation, error < 1.5e-7) ───────────
function normCdf(x) {
  if (x < -8) return 0;
  if (x >  8) return 1;
  const a1 =  0.319381530, a2 = -0.356563782, a3 =  1.781477937;
  const a4 = -1.821255978, a5 =  1.330274429;
  const k  = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = k * (a1 + k * (a2 + k * (a3 + k * (a4 + k * a5))));
  const base = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x) * poly;
  return x >= 0 ? base : 1 - base;
}

// ── BSM European option price ─────────────────────────────────────────────────
// S: spot, K: strike, T: time-to-expiry (years), r: risk-free rate, sigma: annual vol
// type: "CE" | "PE"
export function bsmPrice(S, K, T, r, sigma, type) {
  if (T <= 0) {
    // At expiry: intrinsic value only
    return type === "CE" ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (type === "CE") {
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  } else {
    return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
  }
}

// ── Realized vol from 1-min candle array ──────────────────────────────────────
// Uses daily log-returns (close-to-close across trading days) — more stable than
// intraday microstructure noise. Returns annualized volatility.
export function realizedVol(candles, lookbackDays = 20) {
  // Group candle closes by trading date
  const byDate = new Map();
  for (const c of candles) {
    const ist = new Date(c.time + 5.5 * 3600 * 1000); // shift to IST
    const dateKey = ist.toISOString().slice(0, 10);
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(c.close);
  }
  // Last close per day
  const dates = [...byDate.keys()].sort();
  const dailyCloses = dates.map(d => {
    const arr = byDate.get(d);
    return arr[arr.length - 1]; // last bar close = day close
  });

  // Take last lookbackDays+1 closes to get lookbackDays returns
  const window = dailyCloses.slice(-lookbackDays - 1);
  if (window.length < 5) return 0.20; // fallback 20% IV

  const returns = [];
  for (let i = 1; i < window.length; i++) {
    returns.push(Math.log(window[i] / window[i - 1]));
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const dailySigma = Math.sqrt(variance);
  return dailySigma * Math.sqrt(252); // annualize
}

// ── Next NIFTY weekly expiry (Tuesday 15:30 IST) ─────────────────────────────
// Input: timestamp (ms UTC). Output: expiry timestamp (ms UTC).
export function nextNiftyExpiry(tsMs) {
  const ist = new Date(tsMs + 5.5 * 3600 * 1000); // IST = UTC+5:30
  const istDay = ist.getUTCDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const istHour = ist.getUTCHours();
  const istMin  = ist.getUTCMinutes();

  // Days until next Tuesday
  let daysUntilTue = (2 - istDay + 7) % 7;

  // If today IS Tuesday and market is still open (before 15:30 IST)
  if (istDay === 2) {
    const pastClose = istHour > 15 || (istHour === 15 && istMin >= 30);
    if (!pastClose) daysUntilTue = 0;     // this Tuesday
    else            daysUntilTue = 7;     // next Tuesday
  } else if (daysUntilTue === 0) {
    daysUntilTue = 7; // should not happen due to modulo, but safety
  }

  // Build expiry: start of that IST day, then add 15:30
  const expiryIst = new Date(ist);
  expiryIst.setUTCDate(expiryIst.getUTCDate() + daysUntilTue);
  expiryIst.setUTCHours(10, 0, 0, 0);   // 15:30 IST = 10:00 UTC
  return expiryIst.getTime();
}

// ── Time-to-expiry in years ───────────────────────────────────────────────────
export function timeToExpiry(nowMs, expiryMs) {
  const secs = Math.max(0, (expiryMs - nowMs) / 1000);
  const years = secs / (365 * 24 * 3600);
  return Math.max(years, 1 / (365 * 24 * 60)); // floor at 1 minute
}

// ── Strike selection: walk from ATM until BSM premium ∈ [minPrem, maxPrem] ───
// Returns { strike, premium } or null if no valid strike found within ±20 steps.
// NIFTY strikes at 50-point intervals.
export function selectStrike(spot, type, T, r, sigma, minPrem = 60, maxPrem = 70) {
  const atmStrike = Math.round(spot / 50) * 50;
  const target = (minPrem + maxPrem) / 2;

  // Search outward from ATM: for CE go OTM (higher strikes), for PE go OTM (lower strikes)
  // But also search ITM side. Walk all strikes within ±20 × 50 = ±1000 points.
  let bestStrike = null;
  let bestDist = Infinity;

  for (let delta = -20; delta <= 20; delta++) {
    const K = atmStrike + delta * 50;
    if (K <= 0) continue;
    const prem = bsmPrice(spot, K, T, r, sigma, type);
    if (prem >= minPrem && prem <= maxPrem) {
      const distToSpot = Math.abs(K - spot);
      // Prefer strike closest to spot (highest delta), matching live getATMOption logic
      if (distToSpot < bestDist) {
        bestDist = distToSpot;
        bestStrike = K;
      }
    }
  }

  if (bestStrike !== null) {
    return { strike: bestStrike, premium: bsmPrice(spot, bestStrike, T, r, sigma, type) };
  }

  // Fallback: pick strike with premium closest to target (₹65)
  let fallbackStrike = atmStrike;
  let fallbackDist = Infinity;
  for (let delta = -20; delta <= 20; delta++) {
    const K = atmStrike + delta * 50;
    if (K <= 0) continue;
    const prem = bsmPrice(spot, K, T, r, sigma, type);
    const d = Math.abs(prem - target);
    if (d < fallbackDist) { fallbackDist = d; fallbackStrike = K; }
  }
  const fallbackPrem = bsmPrice(spot, fallbackStrike, T, r, sigma, type);
  return { strike: fallbackStrike, premium: fallbackPrem };
}
