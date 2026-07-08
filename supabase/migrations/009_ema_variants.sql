-- ── Migration 009: EMA Crossover variants + signal logging columns ─────────

-- Add nullable columns to strategy_signals for variant-specific logging
ALTER TABLE strategy_signals
  ADD COLUMN IF NOT EXISTS blocked_reason     TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_bar   INTEGER,
  ADD COLUMN IF NOT EXISTS ema16_1m           FLOAT,
  ADD COLUMN IF NOT EXISTS ema64_1m           FLOAT;

-- Seed 3 new EMA variant strategies
INSERT INTO strategies (id, name, description, status, slot_number) VALUES
  ('ema_crossover_asym',
   'EMA Crossover Asym',
   'EMA 16/64 on 30s candles — instant entry on cross, 2-bar confirmation required before exit/flip',
   'active', 9),
  ('ema_crossover_confirm',
   'EMA Crossover Confirm',
   'EMA 16/64 on 30s candles — 2-bar confirmation required on BOTH entry and exit/flip',
   'active', 10),
  ('ema_crossover_dualtf',
   'EMA Crossover Dual-TF',
   'EMA 16/64 on 30s candles — entry/exit only when 1-minute EMA direction agrees with 30s cross',
   'active', 11)
ON CONFLICT (id) DO NOTHING;

-- Seed capital accounts with ₹1,00,000 each
INSERT INTO strategy_capital
  (strategy_id, allocated_capital, current_value, total_pnl, win_rate, sharpe_ratio, today_trades, lifetime_trades)
VALUES
  ('ema_crossover_asym',    100000, 100000, 0, 0, 0, 0, 0),
  ('ema_crossover_confirm', 100000, 100000, 0, 0, 0, 0, 0),
  ('ema_crossover_dualtf',  100000, 100000, 0, 0, 0, 0, 0)
ON CONFLICT (strategy_id) DO NOTHING;
