-- ══════════════════════════════════════════════════════════════
-- 003_strategy_tables.sql
-- New rule-based strategy tables for AI Trading Arena rebuild
-- ══════════════════════════════════════════════════════════════

-- Strategies registry
CREATE TABLE IF NOT EXISTS strategies (
  id          text PRIMARY KEY,
  name        text,
  description text,
  status      text,           -- 'active' | 'paused' | 'placeholder'
  slot_number int,
  created_at  timestamptz DEFAULT now()
);

-- Per-strategy capital / performance stats
CREATE TABLE IF NOT EXISTS strategy_capital (
  id                uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_id       text    REFERENCES strategies(id),
  allocated_capital numeric DEFAULT 100000,
  current_value     numeric DEFAULT 100000,
  peak_capital      numeric DEFAULT 100000,
  total_pnl         numeric DEFAULT 0,
  win_rate          numeric DEFAULT 0,
  sharpe_ratio      numeric DEFAULT 0,
  today_trades      int     DEFAULT 0,
  lifetime_trades   int     DEFAULT 0,
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (strategy_id)
);

-- Per-strategy option positions (paper trading)
CREATE TABLE IF NOT EXISTS strategy_positions (
  id          uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_id text    REFERENCES strategies(id),
  symbol      text,                    -- e.g. 'NIFTY 2026-06-12 23400 CE'
  type        text,                    -- 'CE' | 'PE'
  side        text    DEFAULT 'LONG',
  entry_price numeric,
  current_price numeric,
  exit_price  numeric,
  quantity    int,
  stop_loss   numeric,
  trail_sl    numeric,
  pnl         numeric DEFAULT 0,
  status      text    DEFAULT 'OPEN',  -- 'OPEN' | 'CLOSED'
  opened_at   timestamptz DEFAULT now(),
  closed_at   timestamptz,
  exit_reason text                     -- 'SL_HIT' | 'CROSSOVER' | 'TRAIL_SL' | 'HARD_CLOSE' | 'TARGET' | 'PCR_NEUTRAL' | 'OI_REVERSE' | 'GAP_FILL'
);

-- ──────────────────────────────────────────────────────────────
-- Seed strategies
-- ──────────────────────────────────────────────────────────────
INSERT INTO strategies (id, name, description, status, slot_number) VALUES
  ('ema_crossover',  'EMA Crossover',  '16/64 EMA on 30s candles · Nifty options',          'active',      1),
  ('orion',          'Orion',          'ORB + VWAP + OI Confluence · Multi-index',           'active',      2),
  ('ema_confluence', 'EMA Confluence', 'EMA + RSI + VWAP + Volume + Fib · Nifty',            'active',      3),
  ('supertrend',     'Supertrend',     'Supertrend (7,3) · 5-min · Nifty + BankNifty',       'active',      4),
  ('pcr_reversal',   'PCR Reversal',   'PCR + OI Unwinding · Nifty',                         'active',      5),
  ('gap_orb',        'Gap + ORB',      'Gap fade + Opening Range Breakout · Nifty',          'active',      6),
  ('placeholder_7',  'Coming Soon',    'Strategy slot reserved',                             'placeholder', 7),
  ('placeholder_8',  'Coming Soon',    'Strategy slot reserved',                             'placeholder', 8),
  ('placeholder_9',  'Coming Soon',    'Strategy slot reserved',                             'placeholder', 9),
  ('placeholder_10', 'Coming Soon',    'Strategy slot reserved',                             'placeholder', 10)
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- Seed capital rows for active strategies
-- ──────────────────────────────────────────────────────────────
INSERT INTO strategy_capital (strategy_id, allocated_capital, current_value, peak_capital, total_pnl, win_rate, sharpe_ratio, today_trades, lifetime_trades)
SELECT s.id, 100000, 100000, 100000, 0, 0, 0, 0, 0
FROM strategies s
WHERE s.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM strategy_capital sc WHERE sc.strategy_id = s.id
  );

-- ──────────────────────────────────────────────────────────────
-- Enable RLS (read-only for anon, full access for service role)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE strategies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_capital   ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_positions ENABLE ROW LEVEL SECURITY;

-- Allow public read
CREATE POLICY "read_strategies"         ON strategies         FOR SELECT USING (true);
CREATE POLICY "read_strategy_capital"   ON strategy_capital   FOR SELECT USING (true);
CREATE POLICY "read_strategy_positions" ON strategy_positions FOR SELECT USING (true);
