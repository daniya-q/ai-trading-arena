-- ============================================================
-- AI Trading Arena — Initial Schema
-- Run in Supabase SQL Editor or via migration script
-- ============================================================

-- Table: bots
CREATE TABLE IF NOT EXISTS bots (
  id          text        PRIMARY KEY,
  name        text        NOT NULL,
  provider    text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Table: capital
CREATE TABLE IF NOT EXISTS capital (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id            text        NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  allocated_capital numeric     NOT NULL DEFAULT 100000,
  peak_capital      numeric     NOT NULL DEFAULT 100000,
  pnl               numeric     NOT NULL DEFAULT 0,
  win_rate          numeric     NOT NULL DEFAULT 0,
  sharpe_like       numeric     NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Table: positions
CREATE TABLE IF NOT EXISTS positions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id        text        NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  symbol        text        NOT NULL,
  side          text        NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity      numeric     NOT NULL,
  entry_price   numeric     NOT NULL,
  current_price numeric     NOT NULL,
  stop_loss     numeric     NOT NULL,
  take_profit   numeric     NOT NULL,
  pnl           numeric     NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);

-- Table: ai_memory
CREATE TABLE IF NOT EXISTS ai_memory (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id           text        NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  lesson           text        NOT NULL,
  confidence_score numeric     NOT NULL DEFAULT 50,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Table: strategy_log
CREATE TABLE IF NOT EXISTS strategy_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id         text        NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  strategy       text        NOT NULL,
  trade_outcome  text        NOT NULL DEFAULT 'PENDING' CHECK (trade_outcome IN ('WIN', 'LOSS', 'PENDING')),
  pnl            numeric     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Table: nse_holidays
CREATE TABLE IF NOT EXISTS nse_holidays (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date  NOT NULL UNIQUE,
  description text  NOT NULL
);

-- ============================================================
-- Seed: bots
-- ============================================================
INSERT INTO bots (id, name, provider) VALUES
  ('gpt',    'GPT Bot',    'openai'),
  ('claude', 'Claude Bot', 'claude'),
  ('gemini', 'Gemini Bot', 'gemini'),
  ('groq',   'Groq Bot',   'groq')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Seed: capital (₹1,00,000 per bot)
-- ============================================================
INSERT INTO capital (bot_id, allocated_capital, peak_capital)
SELECT id, 100000, 100000 FROM bots
ON CONFLICT DO NOTHING;

-- ============================================================
-- Seed: nse_holidays 2025 (official NSE trading holidays)
-- ============================================================
INSERT INTO nse_holidays (date, description) VALUES
  ('2025-02-26', 'Mahashivratri'),
  ('2025-03-14', 'Holi'),
  ('2025-03-31', 'Id-Ul-Fitr (Eid al-Fitr)'),
  ('2025-04-10', 'Shri Ram Navami'),
  ('2025-04-14', 'Dr. B.R. Ambedkar Jayanti'),
  ('2025-04-18', 'Good Friday'),
  ('2025-05-01', 'Maharashtra Day'),
  ('2025-07-07', 'Moharram'),
  ('2025-08-15', 'Independence Day'),
  ('2025-08-27', 'Ganesh Chaturthi'),
  ('2025-10-02', 'Gandhi Jayanti / Dussehra'),
  ('2025-10-20', 'Diwali Laxmi Puja'),
  ('2025-10-21', 'Diwali Balipratipada'),
  ('2025-11-05', 'Prakash Gurpurb Sri Guru Nanak Dev Ji'),
  ('2025-12-25', 'Christmas')
ON CONFLICT (date) DO NOTHING;

-- ============================================================
-- Seed: nse_holidays 2026 (estimated — verify with NSE)
-- ============================================================
INSERT INTO nse_holidays (date, description) VALUES
  ('2026-01-26', 'Republic Day'),
  ('2026-03-03', 'Holi'),
  ('2026-03-20', 'Id-Ul-Fitr (Eid al-Fitr)'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-14', 'Dr. B.R. Ambedkar Jayanti'),
  ('2026-05-01', 'Maharashtra Day'),
  ('2026-10-02', 'Gandhi Jayanti'),
  ('2026-11-17', 'Diwali Laxmi Puja'),
  ('2026-11-18', 'Diwali Balipratipada'),
  ('2026-11-24', 'Dussehra'),
  ('2026-12-25', 'Christmas')
ON CONFLICT (date) DO NOTHING;
