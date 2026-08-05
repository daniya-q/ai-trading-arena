-- ── Migration 014: EMA Chop-filter variants (S16 / S17 / S18) ───────────────
-- These strategies were added to the codebase (commit fb892d5) and exist in
-- the live DB but had no migration file. This is repo-hygiene only.
-- S16: ema_crossover_chop_lo — chop filter at |EMA16−EMA64| / spot < 0.05%
-- S17: ema_crossover_chop_md — chop filter at |EMA16−EMA64| / spot < 0.10%
-- S18: ema_crossover_chop_hi — chop filter at |EMA16−EMA64| / spot < 0.15%

INSERT INTO strategies (id, name, description, status, slot_number) VALUES
  ('ema_crossover_chop_lo',
   'EMA Chop-Lo (0.05%)',
   'EMA 16/64 on 30s NIFTY candles — blocks entry when |EMA16−EMA64| / spot < 0.05% (loose chop filter)',
   'active', 16),
  ('ema_crossover_chop_md',
   'EMA Chop-Md (0.10%)',
   'EMA 16/64 on 30s NIFTY candles — blocks entry when |EMA16−EMA64| / spot < 0.10% (medium chop filter, backtest-optimal)',
   'active', 17),
  ('ema_crossover_chop_hi',
   'EMA Chop-Hi (0.15%)',
   'EMA 16/64 on 30s NIFTY candles — blocks entry when |EMA16−EMA64| / spot < 0.15% (strict chop filter)',
   'active', 18)
ON CONFLICT (id) DO NOTHING;

INSERT INTO strategy_capital
  (strategy_id, allocated_capital, current_value, total_pnl, win_rate, sharpe_ratio, today_trades, lifetime_trades)
VALUES
  ('ema_crossover_chop_lo', 100000, 100000, 0, 0, 0, 0, 0),
  ('ema_crossover_chop_md', 100000, 100000, 0, 0, 0, 0, 0),
  ('ema_crossover_chop_hi', 100000, 100000, 0, 0, 0, 0, 0)
ON CONFLICT (strategy_id) DO NOTHING;
