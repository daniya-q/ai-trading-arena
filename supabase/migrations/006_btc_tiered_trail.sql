-- Migration 006: Tiered trailing stop + partial profit booking for BTC strategies

ALTER TABLE btc_strategy_positions ADD COLUMN IF NOT EXISTS partial_booked    boolean DEFAULT false;
ALTER TABLE btc_strategy_positions ADD COLUMN IF NOT EXISTS partial_qty_inr   numeric DEFAULT 0;
ALTER TABLE btc_strategy_positions ADD COLUMN IF NOT EXISTS remaining_qty_inr numeric;
ALTER TABLE btc_strategy_positions ADD COLUMN IF NOT EXISTS current_tier      int     DEFAULT 0;
ALTER TABLE btc_strategy_positions ADD COLUMN IF NOT EXISTS realized_pnl      numeric DEFAULT 0;
ALTER TABLE btc_strategy_positions ADD COLUMN IF NOT EXISTS original_sl_usd   numeric;

-- Back-fill remaining_qty_inr for existing open positions
UPDATE btc_strategy_positions
SET remaining_qty_inr = qty_inr
WHERE remaining_qty_inr IS NULL;
