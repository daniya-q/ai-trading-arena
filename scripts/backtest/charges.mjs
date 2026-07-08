/**
 * NSE options charges — exact formula from live server calcEquityCharges().
 * Verified against Jul 3–6 live trades (T35–T37) to 2 decimal places.
 *
 * Components:
 *   Brokerage:       ₹20/order × 2 = ₹40 flat
 *   STT:             0.1% on exit (sell) premium value  — options rule
 *   Exchange (NSE):  0.053% on total turnover (entry + exit premium)
 *   GST:             18% on (brokerage + exchange charges)
 *   SEBI:            ₹10 per crore turnover
 *   Stamp duty:      0.003% on entry (buy) premium value
 */
export function calcCharges(entryPrice, exitPrice, qty) {
  const entryValue     = entryPrice * qty;
  const exitValue      = exitPrice  * qty;
  const turnover       = entryValue + exitValue;
  const brokerage      = 40;
  const stt            = exitValue  * 0.001;
  const exchange       = turnover   * 0.00053;
  const gst            = (brokerage + exchange) * 0.18;
  const sebi           = (turnover / 10_000_000) * 10;
  const stampDuty      = entryValue * 0.00003;
  return Math.round((brokerage + stt + exchange + gst + sebi + stampDuty) * 100) / 100;
}
