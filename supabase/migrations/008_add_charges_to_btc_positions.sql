-- ══════════════════════════════════════════════════════════════
-- 008_add_charges_to_btc_positions.sql
-- Add charges_inr column to btc_strategy_positions for Kraken taker fee deductions.
-- pnl_inr = gross PnL in INR (existing logic, untouched)
-- charges_inr = Kraken 0.26% taker fee × 2 sides × remaining position size
-- net PnL (used for capital, Sharpe, win rate) = pnl_inr - charges_inr
-- ══════════════════════════════════════════════════════════════

ALTER TABLE btc_strategy_positions
  ADD COLUMN IF NOT EXISTS charges_inr numeric DEFAULT 0;
