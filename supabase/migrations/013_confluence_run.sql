-- ── Migration 013: EMA Confluence Run (S19) ─────────────────────────────────
-- S19: ema_confluence_run — clone of S3 with no profit target and no trail.
-- Data-derived: expectancy sweeps on 4.5yr real NIFTY index data showed
-- no-target = 2.18 pts/trade vs 1.04 for best fixed; all 16 trail configs
-- underperformed no-trail.

INSERT INTO strategies (id, name, description, status, slot_number) VALUES
  ('ema_confluence_run',
   'EMA Confluence Run',
   'EMA 16/64 on 30s NIFTY candles with RSI + VWAP + Fibonacci filters — no profit target, no trail. Expectancy sweep on 4.5yr real index data: no-target = 2.18 pts/trade vs 1.04 best fixed; all 16 trail configs lost to no-trail.',
   'active', 19)
ON CONFLICT (id) DO NOTHING;

INSERT INTO strategy_capital
  (strategy_id, allocated_capital, current_value, total_pnl, win_rate, sharpe_ratio, today_trades, lifetime_trades)
VALUES
  ('ema_confluence_run', 100000, 100000, 0, 0, 0, 0, 0)
ON CONFLICT (strategy_id) DO NOTHING;
