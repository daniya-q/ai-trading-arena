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
  ema_crossover: {
    entry:  { tier: 'unvalidated', note: 'Signal tested as non-predictive; never optimized' },
    strike: { tier: 'unvalidated' },
    sl:     { tier: 'unvalidated' },
    target: { tier: 'unvalidated' },
    trail:  { tier: 'unvalidated' },
  },
  orion: {
    entry:  { tier: 'unvalidated' },
    sl:     { tier: 'unvalidated' },
    target: { tier: 'unvalidated' },
    trail:  { tier: 'unvalidated' },
  },
  ema_confluence: {
    rsi:    { tier: 'validated', note: 'Signal-log analysis + sweep; 65/35 confirmed' },
    vwap:   { tier: 'unvalidated' },
    fib:    { tier: 'unvalidated' },
    sl:     { tier: 'unvalidated', note: '≈ backtest optimum by coincidence, not confirmed' },
    target: { tier: 'validated', note: 'Tested — HARMFUL; fixed target caps winners, should be removed' },
    trail:  { tier: 'validated', note: 'Tested — HARMFUL; trail clips tail-runners, should be removed' },
  },
  supertrend: {
    entry:  { tier: 'unvalidated' },
    sl:     { tier: 'unvalidated' },
    target: { tier: 'unvalidated' },
    trail:  { tier: 'unvalidated' },
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
  ema_crossover_1m: {
    entry:  { tier: 'unvalidated' },
    sl:     { tier: 'unvalidated' },
    target: { tier: 'unvalidated' },
    trail:  { tier: 'unvalidated' },
  },
  ema_crossover_asym: {
    confirmation: { tier: 'testing', note: 'Live A/B vs S1; backtest said inert' },
    exits:        { tier: 'unvalidated', note: 'Inherited from S1' },
  },
  ema_crossover_confirm: {
    confirmation: { tier: 'testing', note: 'Live A/B vs S1; backtest said inert' },
    exits:        { tier: 'unvalidated', note: 'Inherited from S1' },
  },
  ema_crossover_dualtf: {
    dual_tf: { tier: 'testing', note: 'Live A/B vs S1' },
    exits:   { tier: 'unvalidated', note: 'Inherited from S1' },
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
  ema_crossover_chop_lo: {
    chop_filter: { tier: 'testing', note: 'Live A/B; threshold 0.05%' },
    exits:       { tier: 'unvalidated', note: 'Inherited from S1' },
  },
  ema_crossover_chop_md: {
    chop_filter: { tier: 'testing', note: 'Live A/B; threshold 0.10% (backtest pick)' },
    exits:       { tier: 'unvalidated', note: 'Inherited from S1' },
  },
  ema_crossover_chop_hi: {
    chop_filter: { tier: 'testing', note: 'Live A/B; threshold 0.15%' },
    exits:       { tier: 'unvalidated', note: 'Inherited from S1' },
  },
  ema_crossover_run: {
    entry:     { tier: 'unvalidated', note: 'Inherited from S1' },
    sl:        { tier: 'unvalidated' },
    no_target: { tier: 'testing', note: 'Live A/B vs S1 — transfers the Confluence expectancy finding to the unfiltered 30s signal' },
    no_trail:  { tier: 'testing', note: 'Live A/B vs S21 — settles the trail question on 30s data' },
  },
  ema_crossover_runtrail: {
    entry:     { tier: 'unvalidated', note: 'Inherited from S1' },
    sl:        { tier: 'unvalidated' },
    no_target: { tier: 'testing', note: 'Live A/B vs S1' },
    trail:     { tier: 'testing', note: 'Live A/B vs S20 — does the trail help or clip winners on 30s?' },
  },
  ema_confluence_run: {
    rsi:      { tier: 'validated', note: 'Signal-log analysis + sweep; 65/35 confirmed (shared with S3)' },
    vwap:     { tier: 'unvalidated' },
    fib:      { tier: 'unvalidated' },
    sl:       { tier: 'unvalidated', note: 'Inherited from S3' },
    no_target: { tier: 'validated', note: 'Expectancy sweep on 4.5yr real index data: no-target = 2.18 pts/trade vs 1.04 best fixed target' },
    no_trail:  { tier: 'validated', note: 'All 16 trail configs underperformed no-trail in 4.5yr sweep' },
  },

  // ─────────── BTC STRATEGIES ───────────
  // Aug 2026 finding: Kraken fees (0.52% round-trip on leveraged notional) exceed
  // typical captured move (~0.1%) — structurally loss-making regardless of signal.
  btc_ema_crossover: {
    fees:     { tier: 'validated', note: 'Analysed Aug 2026 — 0.52% round-trip on notional vs ~0.1% typical captured move; structurally loss-making. Redesign pending' },
    leverage: { tier: 'unvalidated', note: '10× chosen by design; does not change break-even threshold, only decay speed (~2.6% of capital per trade)' },
    entry:    { tier: 'unvalidated' },
    sl:       { tier: 'unvalidated', note: 'Sources disagree — doc says flat 20%, page text says 2× ATR, observed stops ~0.1%. Needs code trace' },
    booking:  { tier: 'unvalidated', note: 'Tiered system designed, never tested' },
    tiers:    { tier: 'unvalidated', note: 'Tier thresholds never tested' },
  },
  btc_orion: {
    fees:      { tier: 'validated', note: 'Analysed Aug 2026 — fees exceed captured move; structurally loss-making. Redesign pending' },
    leverage:  { tier: 'unvalidated', note: '50× → ~13% of capital paid in fees per trade' },
    entry:     { tier: 'unvalidated' },
    orb_reset: { tier: 'unvalidated', note: 'Changed daily→4-hourly after observing idleness; observation-driven, not measured' },
    sl:        { tier: 'unvalidated', note: 'Same SL definition discrepancy as the other BTC strategies' },
    booking:   { tier: 'unvalidated' },
    tiers:     { tier: 'unvalidated' },
  },
  btc_ema_confluence: {
    fees:     { tier: 'validated', note: 'Analysed Aug 2026 — fees exceed captured move; structurally loss-making. Redesign pending' },
    leverage: { tier: 'unvalidated', note: '100× → ~26% of capital paid in fees per trade' },
    entry:    { tier: 'unvalidated' },
    atr:      { tier: 'unvalidated', note: 'Loosened 0.5%→0.1% because original never triggered; plausible but no logged-signal analysis' },
    sl:       { tier: 'unvalidated', note: 'Same SL definition discrepancy' },
    booking:  { tier: 'unvalidated' },
    tiers:    { tier: 'unvalidated' },
  },
  btc_supertrend: {
    fees:     { tier: 'validated', note: 'Analysed Aug 2026 — fees exceed captured move; structurally loss-making. Redesign pending' },
    leverage: { tier: 'unvalidated', note: '50× → ~13% of capital paid in fees per trade' },
    entry:    { tier: 'unvalidated' },
    sl:       { tier: 'unvalidated', note: 'Same SL definition discrepancy' },
    booking:  { tier: 'unvalidated' },
    tiers:    { tier: 'unvalidated' },
  },
  btc_vwap_scalper: {
    fees:     { tier: 'validated', note: 'Analysed Aug 2026 — at 200× leverage, ~52% of capital paid in fees per round trip. Fastest decay of the five (75 trades to zero). Redesign pending' },
    leverage: { tier: 'unvalidated', note: '200× → ~52% of capital paid in fees per trade' },
    entry:    { tier: 'unvalidated' },
    sl:       { tier: 'unvalidated', note: 'Same SL definition discrepancy' },
    booking:  { tier: 'unvalidated' },
    tiers:    { tier: 'unvalidated' },
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
