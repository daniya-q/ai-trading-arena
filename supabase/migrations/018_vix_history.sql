-- ── Migration 018: VIX History Table ────────────────────────────────────────
-- Orion skips any day India VIX < 13. lastVix is in-memory only and resets
-- to 0 on every server restart, so there was no historical record to evaluate
-- whether 13 is the right threshold. This table records one VIX sample per
-- minute during market hours (~375 rows/day, well under 1 MB/year).
--
-- Used by: recordVix() — called by setInterval(recordVix, 60_000) in server.

create table if not exists recorded_vix (
  id          bigserial primary key,
  snapshot_at timestamptz not null,
  vix         numeric     not null,
  created_at  timestamptz not null default now(),
  constraint recorded_vix_unique unique (snapshot_at)
);
create index if not exists recorded_vix_time_idx on recorded_vix (snapshot_at);
alter table recorded_vix enable row level security;
