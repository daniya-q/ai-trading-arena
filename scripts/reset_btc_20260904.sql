-- ────────────────────────────────────────────────────────────────────────────
-- BTC strategies reset — Sep 4, 2026
-- New architecture: 5× leverage · 3% price SL · simple trail (+6%/3%)
-- Run this in Supabase SQL editor AFTER the new code is live on Railway.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Step 1: Archive all historical positions
CREATE TABLE IF NOT EXISTS archive_btc_positions_20260904
  AS SELECT * FROM btc_strategy_positions WHERE FALSE;   -- creates schema only if table exists

INSERT INTO archive_btc_positions_20260904
  SELECT * FROM btc_strategy_positions;

-- Step 2: Verify archive row count before deleting
DO $$
DECLARE
  archived_rows  int;
  source_rows    int;
BEGIN
  SELECT COUNT(*) INTO archived_rows  FROM archive_btc_positions_20260904;
  SELECT COUNT(*) INTO source_rows    FROM btc_strategy_positions;
  IF archived_rows <> source_rows THEN
    RAISE EXCEPTION 'Archive count (%) != source count (%) — aborting', archived_rows, source_rows;
  END IF;
  RAISE NOTICE 'Archive verified: % rows', archived_rows;
END $$;

-- Step 3: Wipe all positions
DELETE FROM btc_strategy_positions;

-- Step 4: Reset capital to ₹1,00,000 for all 5 strategies
UPDATE btc_strategy_capital SET
  allocated_inr   = 100000,
  total_pnl_inr   = 0,
  total_trades    = 0,
  winning_trades  = 0,
  sharpe_ratio    = 0,
  updated_at      = NOW()
WHERE strategy_id IN (
  'btc_ema_crossover',
  'btc_orion',
  'btc_ema_confluence',
  'btc_supertrend',
  'btc_vwap_scalper'
);

-- Step 5: Verify reset
DO $$
DECLARE
  remaining_pos int;
  cap_rows      int;
BEGIN
  SELECT COUNT(*) INTO remaining_pos FROM btc_strategy_positions;
  SELECT COUNT(*) INTO cap_rows
    FROM btc_strategy_capital
    WHERE strategy_id IN ('btc_ema_crossover','btc_orion','btc_ema_confluence','btc_supertrend','btc_vwap_scalper')
      AND total_pnl_inr = 0
      AND total_trades = 0;
  IF remaining_pos <> 0 THEN
    RAISE EXCEPTION 'btc_strategy_positions still has % rows after delete', remaining_pos;
  END IF;
  IF cap_rows <> 5 THEN
    RAISE EXCEPTION 'Expected 5 reset capital rows, got %', cap_rows;
  END IF;
  RAISE NOTICE 'Reset complete: 0 positions, 5 capital rows reset to ₹1,00,000';
END $$;

COMMIT;
