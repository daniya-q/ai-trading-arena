-- ══════════════════════════════════════════════════════════════
-- 005_btc_rebuild.sql
-- Wipe old BTC AI bot data, create BTC rule-based strategy tables
-- ══════════════════════════════════════════════════════════════

-- 1. Wipe old bot data
DELETE FROM btc_positions;
DELETE FROM btc_capital;

-- 2. BTC strategies lookup table
CREATE TABLE IF NOT EXISTS btc_strategies (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  description  text,
  is_active    boolean DEFAULT true,
  sort_order   int DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

-- 3. Per-strategy capital / stats
CREATE TABLE IF NOT EXISTS btc_strategy_capital (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_id     text REFERENCES btc_strategies(id) ON DELETE CASCADE,
  allocated_inr   numeric(18,2) DEFAULT 10000,
  total_pnl_inr   numeric(18,2) DEFAULT 0,
  total_trades    int DEFAULT 0,
  winning_trades  int DEFAULT 0,
  sharpe_ratio    numeric(8,4) DEFAULT 0,
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (strategy_id)
);

-- 4. Individual trade positions
CREATE TABLE IF NOT EXISTS btc_strategy_positions (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_id         text REFERENCES btc_strategies(id) ON DELETE CASCADE,
  side                text NOT NULL CHECK (side IN ('LONG','SHORT')),
  entry_price_usd     numeric(18,2) NOT NULL,
  current_price_usd   numeric(18,2),
  exit_price_usd      numeric(18,2),
  qty_inr             numeric(18,2) DEFAULT 5000,
  pnl_inr             numeric(18,2) DEFAULT 0,
  stop_loss           numeric(18,2),
  trail_sl            numeric(18,2),
  status              text DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  entry_reason        text,
  exit_reason         text,
  exit_reason_detail  text,
  opened_at           timestamptz DEFAULT now(),
  closed_at           timestamptz
);

-- 5. Row-level security
ALTER TABLE btc_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE btc_strategy_capital ENABLE ROW LEVEL SECURITY;
ALTER TABLE btc_strategy_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read btc_strategies"
  ON btc_strategies FOR SELECT USING (true);

CREATE POLICY "public read btc_strategy_capital"
  ON btc_strategy_capital FOR SELECT USING (true);

CREATE POLICY "public read btc_strategy_positions"
  ON btc_strategy_positions FOR SELECT USING (true);

-- 6. Seed 4 BTC strategies
INSERT INTO btc_strategies (id, name, description, is_active, sort_order) VALUES
  ('btc_ema_crossover',  'BTC EMA Crossover',   'EMA 9/21 crossover on 30s candles. Long on golden cross, short on death cross.',              true, 1),
  ('btc_orion',          'BTC Orion',            'Opening range breakout — ORB built 00:00–00:30 UTC, then trades breakouts.',                   true, 2),
  ('btc_ema_confluence', 'BTC EMA Confluence',   '5-filter system: EMA20/50 trend, RSI 40–60, VWAP, ATR volatility, EMA9 slope.',              true, 3),
  ('btc_supertrend',     'BTC Supertrend',       'Supertrend(7,3) on 5m candles. Long on bullish flip, short on bearish flip.',                 true, 4)
ON CONFLICT (id) DO NOTHING;

-- 7. Seed capital rows (₹10,000 per strategy)
INSERT INTO btc_strategy_capital (strategy_id, allocated_inr) VALUES
  ('btc_ema_crossover',  10000),
  ('btc_orion',          10000),
  ('btc_ema_confluence', 10000),
  ('btc_supertrend',     10000)
ON CONFLICT (strategy_id) DO NOTHING;
