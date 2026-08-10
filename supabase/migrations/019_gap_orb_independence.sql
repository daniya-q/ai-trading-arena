-- ── Migration 019: Gap+ORB independence from Orion ──────────────────────────
-- Root cause: orbHigh/orbLow/orbSet were set ONLY inside runOrionForIndex().
-- runStrategy2() returns early on its VIX filter (VIX < 13) before reaching
-- the loop that calls runOrionForIndex(). India VIX has been ~12.06 for most
-- of the archive period, so orbSet["NIFTY"] was never set on those days, and
-- runStrategy6 hit Gate 6 ("ORB not set yet") on every tick.
--
-- Fix: server now calls computeORB() inside runStrategy6 directly, populating
-- s6Orb["NIFTY"] independently. Gap+ORB no longer depends on Orion running.
--
-- Also fixed: prevDayClose was seeded once at boot and never refreshed, so
-- gap calculations on multi-day server runs used a stale prior-day close.
-- checkDailyReset() now re-derives prevDayClose from the 1m candle buffer
-- at each date roll.
--
-- Also added: strategy_signals logging for Gap+ORB (was 0 rows in archive).
-- Column mapping:
--   ema16   → gap %          ema64   → prevDayClose
--   price   → NIFTY spot     vwap    → ORB high
--   fib_low → ORB low        rsi_pass → gate passed
--   volume_ok → trade taken  trade_taken / all_filters_passed → as usual
--
-- No schema changes required — strategy_signals and all referenced tables
-- already exist. This migration updates the gap_orb strategy description.

UPDATE strategies
SET description = 'Gap-fade + ORB breakout — NIFTY options, morning-only (before 11:30 AM). Gap ≥ 0.3%: fade towards prev-day close. Gap < 0.3%: ORB breakout. Max 2 trades/day. ORB computed independently (not via Orion). Signal-logged to strategy_signals from server v019.'
WHERE id = 'gap_orb';
