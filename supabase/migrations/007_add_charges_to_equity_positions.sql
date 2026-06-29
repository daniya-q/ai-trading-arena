-- ══════════════════════════════════════════════════════════════
-- 007_add_charges_to_equity_positions.sql
-- Add charges column to strategy_positions for Zerodha-rate deductions.
-- pnl = gross PnL (entry→exit price diff × qty)
-- charges = total brokerage + STT + exchange + GST + SEBI + stamp duty
-- net PnL (used for capital, Sharpe, win rate) = pnl - charges
-- ══════════════════════════════════════════════════════════════

ALTER TABLE strategy_positions
  ADD COLUMN IF NOT EXISTS charges numeric DEFAULT 0;
