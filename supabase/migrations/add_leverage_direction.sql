-- Run in Supabase SQL Editor for project vgpfjlkizdwxdcbflhyp
ALTER TABLE btc_positions ADD COLUMN IF NOT EXISTS leverage NUMERIC DEFAULT 1;
ALTER TABLE btc_positions ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'LONG';
ALTER TABLE btc_positions ADD COLUMN IF NOT EXISTS stop_loss NUMERIC;
ALTER TABLE btc_positions ADD COLUMN IF NOT EXISTS take_profit NUMERIC;
