-- ── Migration 015: EMA Crossover 30s No-Target Variants (S20, S21) ──────────
-- S20: ema_crossover_run      — EMA 16/64 30s, SL 15%, no target, no trail
-- S21: ema_crossover_runtrail — EMA 16/64 30s, SL 15%, no target, trail 20%→10%
-- Completes the 30s arm of the no-target matrix (1m arm = S12/S13).
-- A/B question: does removing the target help on 30s the same way it did
-- for Confluence (2.18 pts/trade vs 1.04)?  And does the trail add or clip?

INSERT INTO strategies (id, name, description, status, slot_number) VALUES
  ('ema_crossover_run',
   'EMA Crossover Let-It-Run',
   'EMA 16/64 on 30s NIFTY candles — no profit target, no trail. Live A/B vs S1 to test whether removing exits boosts expectancy on the raw crossover signal.',
   'active', 20),
  ('ema_crossover_runtrail',
   'EMA Crossover Run+Trail',
   'EMA 16/64 on 30s NIFTY candles — no profit target, trail activates at +20% and ratchets 10% below peak. Live A/B vs S20 to settle whether trailing helps or clips winners on 30s.',
   'active', 21)
ON CONFLICT (id) DO NOTHING;

INSERT INTO strategy_capital
  (strategy_id, allocated_capital, current_value, total_pnl, win_rate, sharpe_ratio, today_trades, lifetime_trades)
VALUES
  ('ema_crossover_run',      100000, 100000, 0, 0, 0, 0, 0),
  ('ema_crossover_runtrail', 100000, 100000, 0, 0, 0, 0, 0)
ON CONFLICT (strategy_id) DO NOTHING;
