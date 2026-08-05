-- ============================================================
-- S19 — ema_confluence_run
-- Clone of S3 (ema_confluence) with no target and no trail.
-- Slot 19.
-- ============================================================

insert into strategies (name, display_name, description, status, slot_number)
values (
  'ema_confluence_run',
  'EMA Confluence Run',
  'EMA 16/64 crossover on 30s NIFTY candles with RSI + VWAP + Fibonacci filters. No profit target, no trail — data-derived: expectancy sweeps on 4.5yr real index data showed no-target yields 2.18 pts/trade vs 1.04 for best fixed target; all 16 trail configs lost to no-trail.',
  'active',
  19
)
on conflict (name) do nothing;

insert into strategy_capital (strategy_id, allocated_capital, current_capital, total_pnl, total_trades, winning_trades)
select id, 100000, 100000, 0, 0, 0
from strategies where name = 'ema_confluence_run'
on conflict (strategy_id) do nothing;
