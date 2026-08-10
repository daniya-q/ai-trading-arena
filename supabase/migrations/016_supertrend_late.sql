-- ── Migration 016: Supertrend Late Entry (S22) ───────────────────────────────
-- S22: supertrend_late — clone of S4 (Supertrend 5m) with entry window shifted
-- from 9:45 AM → 11:00 AM. All other params identical: Supertrend(7,3) on 5m,
-- 30% sizing, SL 20%, target 40%, trail +35%→12%, hard close 3:20 PM,
-- both NIFTY and BANKNIFTY, max 2 trades per instrument per day.
--
-- Rationale: 69 archived S4 trades (Jun 10 – Jul 30 2026) showed entries in
-- the 9:45–11:00 window returned −₹42,357 at 25.0% WR, while 11:00–13:00
-- returned +₹1,54,238 at 57.7%. Opening period has no established 5m trend to
-- flip — this variant tests whether skipping those 75 minutes improves results.

INSERT INTO strategies (id, name, description, status, slot_number) VALUES
  ('supertrend_late',
   'Supertrend Late Entry',
   'Supertrend(7,3) on 5m NIFTY + BankNifty candles — entries from 11:00 AM only. Live A/B vs S4 to test whether skipping the 9:45–11:00 opening window (25.0% WR, −₹42,357 on 69 trades) improves win rate and expectancy.',
   'active', 22)
ON CONFLICT (id) DO NOTHING;

INSERT INTO strategy_capital
  (strategy_id, allocated_capital, current_value, total_pnl, win_rate, sharpe_ratio, today_trades, lifetime_trades)
VALUES
  ('supertrend_late', 100000, 100000, 0, 0, 0, 0, 0)
ON CONFLICT (strategy_id) DO NOTHING;
