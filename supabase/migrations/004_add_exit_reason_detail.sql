-- ══════════════════════════════════════════════════════════════
-- 004_add_exit_reason_detail.sql
-- Add human-readable exit explanation to strategy_positions
-- ══════════════════════════════════════════════════════════════

ALTER TABLE strategy_positions
  ADD COLUMN IF NOT EXISTS exit_reason_detail text;
