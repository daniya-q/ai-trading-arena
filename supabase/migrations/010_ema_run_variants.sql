-- ── Migration 010: EMA 1m Run variants (S12 + S13) ─────────────────────────
-- S12: ema_crossover_1m_run   — EMA 1m Let-It-Run (no target, no trail)
-- S13: ema_crossover_1m_runtrail — EMA 1m Run+Trail (no target, trail at +20%)

INSERT INTO strategies (id, name, description, status, slot_number) VALUES
  ('ema_crossover_1m_run',
   'EMA 1m Let-It-Run',
   'EMA 16/64 on 1m candles — no profit target, no trail SL, exits only via SL/crossover/hard close',
   'active', 12),
  ('ema_crossover_1m_runtrail',
   'EMA 1m Run+Trail',
   'EMA 16/64 on 1m candles — no profit target, trail SL activates at +20% (10% below peak, ratchet-only)',
   'active', 13)
ON CONFLICT (id) DO NOTHING;

-- Seed capital accounts with ₹1,00,000 each
INSERT INTO strategy_capital
  (strategy_id, allocated_capital, current_value, total_pnl, win_rate, sharpe_ratio, today_trades, lifetime_trades)
VALUES
  ('ema_crossover_1m_run',      100000, 100000, 0, 0, 0, 0, 0),
  ('ema_crossover_1m_runtrail', 100000, 100000, 0, 0, 0, 0, 0)
ON CONFLICT (strategy_id) DO NOTHING;
