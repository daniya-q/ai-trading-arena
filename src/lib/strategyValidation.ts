// Single source of truth for strategy parameter validation status.
// Tiers: 'validated' (green) | 'testing' (yellow, live A/B) | 'unvalidated' (grey)
// Update a parameter's tier here as validation work is completed.

export type ValidationTier = 'validated' | 'testing' | 'unvalidated';

export interface ParamStatus {
  tier: ValidationTier;
  note?: string;
}

export interface StrategyValidation {
  [param: string]: ParamStatus;
}

export const STRATEGY_VALIDATION: Record<string, StrategyValidation> = {
  orion: {
    entry:  { tier: 'unvalidated' },
    sl:     { tier: 'unvalidated' },
    target: { tier: 'unvalidated' },
    trail:  { tier: 'unvalidated' },
  },
  supertrend: {
    entry:  { tier: 'unvalidated' },
    sl:     { tier: 'unvalidated' },
    target: { tier: 'unvalidated' },
    trail:  { tier: 'unvalidated' },
  },
  supertrend_late: {
    entry:      { tier: 'unvalidated', note: 'Inherited from S4' },
    late_entry: { tier: 'testing', note: 'Live A/B vs S4 — archived data showed 9:45–11:00 entries returned −₹42,357 at 25% win rate vs +₹1.54L at 57.7% for 11:00–13:00 (69 trades, Jun–Jul 2026)' },
    sl:         { tier: 'unvalidated' },
    target:     { tier: 'unvalidated' },
    trail:      { tier: 'unvalidated' },
  },
  pcr_reversal: {
    thresholds: { tier: 'validated', note: 'Reverted to strict 1.3/0.7 on evidence' },
    sl:         { tier: 'validated', note: 'Tightened 25%→15% from real overshoot data' },
    target:     { tier: 'unvalidated' },
    trail:      { tier: 'unvalidated' },
  },
  gap_orb: {
    entry:  { tier: 'unvalidated' },
    sl:     { tier: 'unvalidated' },
    target: { tier: 'unvalidated' },
    trail:  { tier: 'unvalidated' },
  },
  vwap_scalper: {
    entry:  { tier: 'unvalidated' },
    sl:     { tier: 'unvalidated' },
    target: { tier: 'unvalidated' },
    trail:  { tier: 'unvalidated' },
  },
  vwap_scalper_dband_lo: {
    entry:    { tier: 'unvalidated', note: 'Inherited from S7' },
    deadband: { tier: 'testing', note: 'Live A/B vs S7 — 272 archived VWAP_CROSS exits netted −₹1.29L with 91% landing within ±5% of entry (~₹32k fee drag). Threshold not derivable from archive (only 31 reconstructible trades); two candidates under test' },
    sl:       { tier: 'unvalidated', note: 'Fired once in 295 trades — effectively decorative' },
    target:   { tier: 'unvalidated' },
    trail:    { tier: 'unvalidated' },
  },
  vwap_scalper_dband_hi: {
    entry:    { tier: 'unvalidated', note: 'Inherited from S7' },
    deadband: { tier: 'testing', note: 'Live A/B vs S7 — 272 archived VWAP_CROSS exits netted −₹1.29L with 91% landing within ±5% of entry (~₹32k fee drag). Threshold not derivable from archive (only 31 reconstructible trades); two candidates under test' },
    sl:       { tier: 'unvalidated', note: 'Fired once in 295 trades — effectively decorative' },
    target:   { tier: 'unvalidated' },
    trail:    { tier: 'unvalidated' },
  },
  ema_crossover_1m: {
    entry:  { tier: 'unvalidated' },
    sl:     { tier: 'unvalidated' },
    target: { tier: 'unvalidated' },
    trail:  { tier: 'unvalidated' },
  },
  ema_crossover_1m_run: {
    no_target: { tier: 'testing', note: 'Live A/B vs S8' },
    sl:        { tier: 'unvalidated' },
  },
  ema_crossover_1m_runtrail: {
    no_target: { tier: 'testing', note: 'Backtest-supported, live-leading pre-reset' },
    trail:     { tier: 'testing', note: 'Live A/B vs S8' },
    sl:        { tier: 'unvalidated' },
  },
  expiry_powerhour_dir: {
    entry: { tier: 'testing', note: 'Real-index wave analysis supported; live confirming' },
    sl:    { tier: 'unvalidated' },
    trail: { tier: 'unvalidated' },
  },
  expiry_powerhour_straddle: {
    entry: { tier: 'testing', note: 'Real-index wave analysis; live confirming' },
    sl:    { tier: 'unvalidated' },
    trail: { tier: 'unvalidated' },
  },

  // ─────────── BTC STRATEGIES ───────────
  // Sep 2026 rebuild: all 5 strategies reset to 5× leverage, 3% price SL, simple trail.
  // Fee finding (Aug 2026): 0.52% round-trip on notional ≈ 2.6% of capital at 5×.
  // At 5× the fee drag is survivable; break-even is ~1 winning trade per 2 losers.
  btc_ema_crossover: {
    fees:      { tier: 'validated', note: 'Confirmed 0.52% round-trip on notional; at 5× ≈ 2.6% of capital per trade — survivable threshold' },
    leverage:  { tier: 'testing',   note: '5× chosen Sep 2026 (was 10×); survivable fee drag. Live confirming' },
    entry:     { tier: 'unvalidated', note: '15m EMA 9/21 crossover — timeframe changed from 30s Sep 2026' },
    sl:        { tier: 'testing',   note: '3% price SL — chosen Sep 2026 (was 1.5×ATR). Live confirming' },
    trail:     { tier: 'testing',   note: 'Activates +6%, trails 3% from peak — Sep 2026 (replaced tiered system). Live confirming' },
  },
  btc_orion: {
    fees:      { tier: 'validated', note: 'Confirmed 0.52% round-trip; at 5× ≈ 2.6% of capital per trade' },
    leverage:  { tier: 'testing',   note: '5× chosen Sep 2026 (was 50×). Live confirming' },
    entry:     { tier: 'unvalidated', note: 'UTC daily ORB 00:00–00:30 — changed from 4-hourly Sep 2026' },
    orb_reset: { tier: 'testing',   note: 'Daily reset (was 4-hourly). More data needed to compare' },
    sl:        { tier: 'testing',   note: '3% price SL — chosen Sep 2026 (was ORB opposite boundary). Live confirming' },
    trail:     { tier: 'testing',   note: 'Activates +6%, trails 3% from peak — Sep 2026. Live confirming' },
  },
  btc_ema_confluence: {
    fees:      { tier: 'validated', note: 'Confirmed 0.52% round-trip; at 5× ≈ 2.6% of capital per trade' },
    leverage:  { tier: 'testing',   note: '5× chosen Sep 2026 (was 100×). Live confirming' },
    entry:     { tier: 'unvalidated', note: '5-filter confluence on 5m — unchanged' },
    atr:       { tier: 'unvalidated', note: 'Threshold 0.1% unchanged; original 0.5% never triggered' },
    sl:        { tier: 'testing',   note: '3% price SL — chosen Sep 2026 (was 2×ATR). Live confirming' },
    trail:     { tier: 'testing',   note: 'Activates +6%, trails 3% from peak — Sep 2026. Live confirming' },
  },
  btc_supertrend: {
    fees:      { tier: 'validated', note: 'Confirmed 0.52% round-trip; at 5× ≈ 2.6% of capital per trade' },
    leverage:  { tier: 'testing',   note: '5× chosen Sep 2026 (was 50×). Live confirming' },
    entry:     { tier: 'unvalidated', note: 'Supertrend(7,3) on 15m — timeframe changed from 5m Sep 2026' },
    sl:        { tier: 'testing',   note: '3% price SL — chosen Sep 2026 (was Supertrend line). Live confirming' },
    trail:     { tier: 'testing',   note: 'Activates +6%, trails 3% from peak — Sep 2026. Live confirming' },
  },
  btc_vwap_scalper: {
    fees:      { tier: 'validated', note: 'Confirmed 0.52% round-trip; at 5× ≈ 2.6% of capital per trade (was 52% at 200×)' },
    leverage:  { tier: 'testing',   note: '5× chosen Sep 2026 (was 200×). Live confirming' },
    entry:     { tier: 'unvalidated', note: 'VWAP bounce/reject on 5m — timeframe changed from 1m Sep 2026' },
    sl:        { tier: 'testing',   note: '3% price SL — chosen Sep 2026 (was ATR-based). Live confirming' },
    trail:     { tier: 'testing',   note: 'Activates +6%, trails 3% from peak — Sep 2026. Live confirming' },
  },
};

// Helper: overall validation summary for a strategy (for badges/rollups)
export function validationSummary(strategyId: string): { validated: number; testing: number; unvalidated: number; total: number } {
  const s = STRATEGY_VALIDATION[strategyId];
  if (!s) return { validated: 0, testing: 0, unvalidated: 0, total: 0 };
  const vals = Object.values(s);
  return {
    validated:   vals.filter(v => v.tier === 'validated').length,
    testing:     vals.filter(v => v.tier === 'testing').length,
    unvalidated: vals.filter(v => v.tier === 'unvalidated').length,
    total:       vals.length,
  };
}
