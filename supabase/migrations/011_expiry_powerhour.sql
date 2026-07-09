-- ── Migration 011: Expiry Power Hour strategies (S14 + S15) ──────────────────
-- S14: expiry_powerhour_dir      — Directional trade at 2:45 PM on expiry day
-- S15: expiry_powerhour_straddle — Both CE+PE in ₹15–30 band at 2:45 PM on expiry day

INSERT INTO strategies (id, name, description, status, slot_number) VALUES
  ('expiry_powerhour_dir',
   'Expiry Power Hour',
   'Directional expiry-day trade at 2:45 PM — drift(2:45−2:30) decides CE/PE, ₹15–30 OTM strike, 40% SL, trail at +50%',
   'active', 14),
  ('expiry_powerhour_straddle',
   'Expiry Straddle',
   'Buy both CE+PE in ₹15–30 band at 2:45 PM on expiry day, each leg independent, 40% SL, trail at +50%',
   'active', 15)
ON CONFLICT (id) DO NOTHING;

INSERT INTO strategy_capital
  (strategy_id, allocated_capital, current_value, total_pnl, win_rate, sharpe_ratio, today_trades, lifetime_trades)
VALUES
  ('expiry_powerhour_dir',      100000, 100000, 0, 0, 0, 0, 0),
  ('expiry_powerhour_straddle', 100000, 100000, 0, 0, 0, 0, 0)
ON CONFLICT (strategy_id) DO NOTHING;
