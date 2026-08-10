-- ── Migration 017: VWAP Scalper Deadband Variants (S23, S24) ─────────────────
-- S23: vwap_scalper_dband_lo — deadband 0.03% (exit only if price ≥0.03% past VWAP)
-- S24: vwap_scalper_dband_hi — deadband 0.08% (exit only if price ≥0.08% past VWAP)
--
-- Rationale: S7's VWAP_CROSS exit fires on any single 1-min close on the wrong
-- side of VWAP. 272 of 295 clean trades exited this way, netting −₹1,29,225.
-- 247 of those landed within ±5% of entry price after ~4.5 min (~₹32k fee drag
-- on trades that captured no move). A candle-level check on 31 reconstructible
-- NIFTY exits showed near-VWAP exits had price return to the favourable side
-- 62.5–100% of the time. Two deadband sizes go live for A/B vs S7.

INSERT INTO strategies (id, name, description, status, slot_number) VALUES
  ('vwap_scalper_dband_lo',
   'VWAP Scalper Deadband 0.03%',
   'Clone of S7 (VWAP Scalper) — identical entry (VWAP pullback + RSI 40–60 + OI rising + higher-low/lower-high), but VWAP_CROSS exit only fires if price is ≥0.03% past VWAP. Live A/B vs S7 to test whether filtering noise-level crosses reduces fee drag.',
   'active', 23),
  ('vwap_scalper_dband_hi',
   'VWAP Scalper Deadband 0.08%',
   'Clone of S7 (VWAP Scalper) — identical entry, but VWAP_CROSS exit only fires if price is ≥0.08% past VWAP. Live A/B vs S7 and S23 to test a wider deadband.',
   'active', 24)
ON CONFLICT (id) DO NOTHING;

INSERT INTO strategy_capital
  (strategy_id, allocated_capital, current_value, total_pnl, win_rate, sharpe_ratio, today_trades, lifetime_trades)
VALUES
  ('vwap_scalper_dband_lo', 100000, 100000, 0, 0, 0, 0, 0),
  ('vwap_scalper_dband_hi', 100000, 100000, 0, 0, 0, 0, 0)
ON CONFLICT (strategy_id) DO NOTHING;
