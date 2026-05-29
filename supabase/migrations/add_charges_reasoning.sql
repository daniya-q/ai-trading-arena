-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/vgpfjlkizdwxdcbflhyp/sql
ALTER TABLE btc_positions ADD COLUMN IF NOT EXISTS charges NUMERIC DEFAULT 0;
ALTER TABLE btc_positions ADD COLUMN IF NOT EXISTS reasoning TEXT;
