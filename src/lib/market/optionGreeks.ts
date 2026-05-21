import { getDTE } from "@/lib/market/expiryCalendar";
import type { Position } from "@/store/positionStore";

// ── Math helpers ──────────────────────────────────────────────

/** Standard normal PDF */
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal CDF — Abramowitz & Stegun approximation (error < 7.5e-8).
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * absX);
  const poly =
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const y = 1 - poly * Math.exp(-absX * absX);

  return 0.5 * (1 + sign * y);
}

// ── Public functions ──────────────────────────────────────────

/**
 * Approximate daily theta (₹ decay per day per unit) using Black-Scholes.
 *
 * @param premium    Current option premium (not used in BS but kept for future use)
 * @param dte        Calendar days to expiry
 * @param iv         Implied volatility as a decimal (e.g. 0.18 for 18%)
 * @param spotPrice  Underlying spot price
 * @param strike     Option strike price
 * @param optionType "CE" or "PE"
 * @returns Daily theta in ₹ (typically negative — represents decay)
 */
export function calculateTheta(
  _premium: number,
  dte: number,
  iv: number,
  spotPrice: number,
  strike: number,
  optionType: "CE" | "PE"
): number {
  if (dte <= 0 || iv <= 0 || spotPrice <= 0 || strike <= 0) return 0;

  const S = spotPrice;
  const K = strike;
  const T = dte / 365; // time in years
  const r = 0.065;     // India 10-year risk-free rate
  const sigma = iv;

  const sqrtT = Math.sqrt(T);
  const d1 =
    (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  // Black-Scholes annual theta
  const thetaAnnual =
    optionType === "CE"
      ? -(S * normalPDF(d1) * sigma) / (2 * sqrtT) -
        r * K * Math.exp(-r * T) * normalCDF(d2)
      : -(S * normalPDF(d1) * sigma) / (2 * sqrtT) +
        r * K * Math.exp(-r * T) * normalCDF(-d2);

  // Convert to per-day theta
  return Number((thetaAnnual / 365).toFixed(2));
}

/**
 * Returns the moneyness of an option strike relative to the current spot.
 * ATM band: within ±0.5% of spot.
 */
export function getITMStatus(
  strike: number,
  spotPrice: number,
  optionType: "CE" | "PE"
): "ITM" | "ATM" | "OTM" {
  const diffPct = (strike - spotPrice) / spotPrice;

  if (Math.abs(diffPct) <= 0.005) return "ATM";

  if (optionType === "CE") {
    return strike < spotPrice ? "ITM" : "OTM";
  } else {
    return strike > spotPrice ? "ITM" : "OTM";
  }
}

export type EnrichedPosition = Position & {
  dte: number;
  theta: number;
  itmStatus: "ITM" | "ATM" | "OTM";
  thetaPaid: number;
  expiryDate: string;
  isExpiringSoon: boolean;
};

/**
 * Decorates an open options position with Greeks and expiry metadata.
 *
 * @param position   The options position from positionStore.
 *                   Must have optionType, strike, expiryDate set.
 *                   iv (%) is optional — defaults to 15%.
 * @param spotPrice  Current underlying spot price (the index LTP).
 * @returns          The position extended with dte, theta, itmStatus,
 *                   thetaPaid, expiryDate, and isExpiringSoon.
 */
export function enrichPosition(
  position: Position,
  spotPrice: number
): EnrichedPosition {
  const expiryDate = position.expiryDate ?? "";
  const dte = expiryDate ? getDTE(expiryDate) : 0;
  const optionType = position.optionType ?? "CE";
  const strike = position.strike ?? position.entryPrice;

  // IV stored as percentage (e.g. 18) → convert to decimal for BS
  const iv = ((position.iv ?? 15) / 100);

  const theta = calculateTheta(
    position.currentPrice,
    dte,
    iv,
    spotPrice,
    strike,
    optionType
  );

  const itmStatus = getITMStatus(strike, spotPrice, optionType);

  // Days held since entry (calendar days)
  const daysHeld = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(position.openedAt).getTime()) /
        (1000 * 60 * 60 * 24)
    )
  );

  // Total theta cost approximation: |daily theta| × qty × days held
  const thetaPaid = Number(
    (Math.abs(theta) * position.quantity * daysHeld).toFixed(2)
  );

  return {
    ...position,
    dte,
    theta,
    itmStatus,
    thetaPaid,
    expiryDate,
    isExpiringSoon: dte <= 1,
  };
}
