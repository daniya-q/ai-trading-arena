/**
 * Options charges — mirrors live server calcEquityCharges() exactly.
 * Supports NSE (NIFTY/BANKNIFTY) and BSE (SENSEX/BANKEX) with separate ETC rates.
 * Pass `symbol` (e.g. "NIFTY 08SEP 24000 CE") to get exchange-correct charges;
 * omitting symbol defaults to NSE rates (correct for all NIFTY backtest scenarios).
 *
 * Components:
 *   Brokerage:       ₹20/order × 2 = ₹40 flat
 *   STT:             0.1% on exit (sell) premium value  — options rule
 *   Exchange (NSE):  0.03503% on total premium turnover (₹3,503/crore — SEBI flat-fee Oct 2024)
 *   Exchange (BSE):  0.0325%  on total premium turnover (₹3,250/crore — SEBI flat-fee Oct 2024)
 *   IPFT (NSE only): 0.0005%  on total premium turnover (₹50/crore; BSE equiv not published)
 *   GST:             18% on (brokerage + exchange charges + IPFT)
 *   SEBI:            ₹10 per crore turnover
 *   Stamp duty:      0.003% on entry (buy) premium value
 */
export function calcCharges(entryPrice, exitPrice, qty, symbol = '') {
  const entryValue     = entryPrice * qty;
  const exitValue      = exitPrice  * qty;
  const turnover       = entryValue + exitValue;
  const isBSE          = /^(SENSEX|BANKEX)\b/i.test(symbol);
  const brokerage      = 40;
  const stt            = exitValue  * 0.001;
  const exchange       = isBSE ? turnover * 0.000325 : turnover * 0.0003503;
  const ipft           = isBSE ? 0 : turnover * 0.000005;
  const gst            = (brokerage + exchange + ipft) * 0.18;
  const sebi           = (turnover / 10_000_000) * 10;
  const stampDuty      = entryValue * 0.00003;
  return Math.round((brokerage + stt + exchange + ipft + gst + sebi + stampDuty) * 100) / 100;
}
