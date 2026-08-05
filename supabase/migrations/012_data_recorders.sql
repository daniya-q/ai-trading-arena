-- ============================================================
-- Data recorders: 30-second candles + option-chain snapshots
-- Upstox's historical API floor is 1-minute and expired option
-- contracts are purged, so neither of these can ever be bought
-- or backfilled. They exist only if we record them ourselves.
-- ============================================================

create table if not exists recorded_candles (
  id           bigserial primary key,
  symbol       text        not null,
  timeframe    text        not null default '30s',
  bucket_time  timestamptz not null,
  open         numeric     not null,
  high         numeric     not null,
  low          numeric     not null,
  close        numeric     not null,
  ticks        integer,
  created_at   timestamptz not null default now(),
  constraint recorded_candles_unique unique (symbol, timeframe, bucket_time)
);
create index if not exists recorded_candles_symbol_time_idx
  on recorded_candles (symbol, timeframe, bucket_time);

create table if not exists recorded_option_chains (
  id            bigserial primary key,
  index_name    text        not null,
  expiry        date        not null,
  snapshot_at   timestamptz not null,
  spot_price    numeric     not null,
  atm_strike    numeric     not null,
  pcr           numeric,
  strikes_from  numeric,
  strikes_to    numeric,
  chain_rows    jsonb       not null,
  created_at    timestamptz not null default now(),
  constraint recorded_option_chains_unique unique (index_name, expiry, snapshot_at)
);
create index if not exists recorded_chains_index_time_idx
  on recorded_option_chains (index_name, snapshot_at);

alter table recorded_candles       enable row level security;
alter table recorded_option_chains enable row level security;
-- No policies: service-role writes only, no anon/authenticated access.
