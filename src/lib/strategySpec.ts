// Single source of truth for strategy specifications + accent colors.
// Replaces the hardcoded RULES and duplicated ACCENT maps.
// `param` on a row links to the key in strategyValidation.ts for badge lookup.

export interface SpecRow { label: string; value: string; param?: string; }
export interface StrategySpec {
  accent: string;
  instrument: string;
  timeframe: string;
  window: string;
  leverage?: string;          // BTC only
  entry: SpecRow[];
  exit: SpecRow[];
  tiers?: SpecRow[];          // BTC only — partial booking + tiered trailing
  sizing: string;
  charges?: string;           // shown when fees are materially significant
}

const SL = (p: string) => ({ label: 'Stop Loss', value: p, param: 'sl' });
const TGT = (p: string) => ({ label: 'Target', value: p, param: 'target' });
const TRAIL = (p: string) => ({ label: 'Trail SL', value: p, param: 'trail' });
const CLOSE = (t: string) => ({ label: 'Hard Close', value: t });
const SIZING60 = '60% of capital · lot-rounded (65) · ₹8,000 max loss per trade';
const SIZING30 = '30% of capital · lot-rounded · ₹8,000 max loss per trade';

const EMA_ENTRY: SpecRow[] = [
  { label: 'Signal', value: '16 EMA crosses 64 EMA → CE (up) / PE (down)', param: 'entry' },
  { label: 'Strike', value: '₹60–70 premium, closest to spot', param: 'strike' },
  { label: 'Behaviour', value: 'Flips position on every opposite cross' },
];
const EMA_EXIT: SpecRow[] = [
  SL('15% of premium'), TGT('30% of premium'),
  TRAIL('activates +20% · trails 10% below peak (ratchet)'),
  { label: 'Signal exit', value: 'Opposite EMA crossover' }, CLOSE('3:20 PM IST'),
];

export const STRATEGY_SPEC: Record<string, StrategySpec> = {
  ema_crossover_1m: {
    accent: '#EC4899', instrument: 'Nifty 50 options · weekly expiry',
    timeframe: '1-minute candles', window: '9:45 AM – 3:20 PM IST',
    entry: EMA_ENTRY, exit: EMA_EXIT, sizing: SIZING60,
  },
  orion: {
    accent: '#6366F1', instrument: 'Nifty · BankNifty · Sensex options',
    timeframe: '15-minute candles', window: 'entry 9:30 AM – 2:00 PM · close 3:20 PM',
    entry: [
      { label: 'Signal', value: 'Break of 9:15–9:30 opening range', param: 'entry' },
      { label: 'Confirm', value: 'Price beyond VWAP + OI buildup confirms' },
      { label: 'Filter', value: 'Skip entire day if India VIX < 13' },
    ],
    exit: [SL('30% of premium'), TGT('45% of premium'),
      { label: 'Breakeven', value: 'At +20% profit, SL moves to entry' },
      TRAIL('activates +35% · trails 15% below peak'), CLOSE('3:20 PM IST')],
    sizing: SIZING30 + ' · multi-index (can hold all three)',
  },
  supertrend: {
    accent: '#EF4444', instrument: 'Nifty + BankNifty options',
    timeframe: '5-minute candles', window: '9:45 AM – 3:20 PM · entry cutoff 2:30 PM',
    entry: [
      { label: 'Signal', value: 'Supertrend(7,3) flips green → CE · red → PE', param: 'entry' },
      { label: 'Limit', value: 'Max 2 trades per instrument per day' },
    ],
    exit: [SL('20% of premium'), TGT('40% of premium'),
      TRAIL('activates +35% · trails 12% below peak'),
      { label: 'Signal exit', value: 'Opposite Supertrend flip' }, CLOSE('3:20 PM IST')],
    sizing: SIZING30 + ' · multi-index',
  },
  supertrend_late: {
    accent: '#FCA5A5', instrument: 'Nifty + BankNifty options',
    timeframe: '5-minute candles', window: '11:00 AM – 3:20 PM IST · entry cutoff 2:30 PM',
    entry: [
      { label: 'Signal', value: 'Supertrend(7,3) flips green → CE · red → PE', param: 'entry' },
      { label: 'Limit', value: 'Max 2 trades per instrument per day' },
      { label: 'Variant', value: 'No entries before 11:00 AM — opening period has no established trend', param: 'late_entry' },
    ],
    exit: [SL('20% of premium'), TGT('40% of premium'),
      TRAIL('activates +35% · trails 12% below peak'),
      { label: 'Signal exit', value: 'Opposite Supertrend flip' }, CLOSE('3:20 PM IST')],
    sizing: SIZING30 + ' · multi-index',
  },
  pcr_reversal: {
    accent: '#8B5CF6', instrument: 'Nifty 50 options',
    timeframe: 'Option chain polled every 5 minutes', window: '10:00 AM – 2:30 PM IST',
    entry: [
      { label: 'CE entry', value: 'PCR > 1.3 AND ATM PE OI fell 10%+ in 30 min', param: 'thresholds' },
      { label: 'PE entry', value: 'PCR < 0.7 AND ATM CE OI fell 10%+ in 30 min', param: 'thresholds' },
      { label: 'Limit', value: 'Max 3 trades per day' },
    ],
    exit: [SL('15% of premium'), TGT('37.5% of premium'),
      TRAIL('activates +35% · trails 12% below peak'),
      { label: 'Signal exit', value: 'PCR reverts to neutral (0.9–1.1) or opposite OI builds' },
      CLOSE('3:20 PM IST')],
    sizing: SIZING60,
  },
  gap_orb: {
    accent: '#06B6D4', instrument: 'Nifty 50 options',
    timeframe: '15-minute candles', window: 'entry 9:15 – 11:30 AM only · close 3:20 PM',
    entry: [
      { label: 'Gap > 0.3%', value: 'FADE the gap — buy opposite direction', param: 'entry' },
      { label: 'Gap < 0.3%', value: 'Trade the opening-range breakout direction' },
      { label: 'Limit', value: 'Max 2 trades per day' },
    ],
    exit: [SL('20% of premium'),
      TGT('gap fill (price returns to prev close) · 40% fallback for breakouts'),
      TRAIL('activates +35% · trails 12% below peak'), CLOSE('3:20 PM IST')],
    sizing: SIZING60,
  },
  vwap_scalper: {
    accent: '#F97316', instrument: 'Nifty · BankNifty · Sensex options',
    timeframe: '1-minute candles', window: '9:45 AM – 3:20 PM IST · expiry-aware',
    entry: [
      { label: 'Signal', value: 'Pullback to VWAP, then close back across it', param: 'entry' },
      { label: 'Confirm', value: 'RSI 40–60 + OI rising + prior higher-low (CE) / lower-high (PE)' },
      { label: 'Strike', value: '₹50–80 premium' },
    ],
    exit: [SL('20% · tightens to 10% in expiry danger windows'),
      TGT('30% · tightens to 15% in danger windows'),
      { label: 'Breakeven', value: 'At +25% profit, SL moves to entry' },
      TRAIL('activates +35% · trails 12% (5% in danger windows)'),
      { label: 'Signal exit', value: 'Opposite VWAP cross' }, CLOSE('3:20 PM IST')],
    sizing: SIZING30 + ' · halves during expiry danger windows',
  },
  vwap_scalper_dband_lo: {
    accent: '#FDBA74', instrument: 'Nifty · BankNifty · Sensex options',
    timeframe: '1-minute candles', window: '9:45 AM – 3:20 PM IST · expiry-aware',
    entry: [
      { label: 'Signal', value: 'Pullback to VWAP, then close back across it', param: 'entry' },
      { label: 'Confirm', value: 'RSI 40–60 + OI rising + prior higher-low (CE) / lower-high (PE)' },
      { label: 'Strike', value: '₹50–80 premium' },
    ],
    exit: [SL('20% · tightens to 10% in expiry danger windows'),
      TGT('30% · tightens to 15% in danger windows'),
      { label: 'Breakeven', value: 'At +25% profit, SL moves to entry' },
      TRAIL('activates +35% · trails 12% (5% in danger windows)'),
      { label: 'Signal exit', value: 'Opposite VWAP cross — only if price is ≥0.03% past VWAP (deadband)', param: 'deadband' },
      CLOSE('3:20 PM IST')],
    sizing: SIZING30 + ' · halves during expiry danger windows',
  },
  vwap_scalper_dband_hi: {
    accent: '#FB923C', instrument: 'Nifty · BankNifty · Sensex options',
    timeframe: '1-minute candles', window: '9:45 AM – 3:20 PM IST · expiry-aware',
    entry: [
      { label: 'Signal', value: 'Pullback to VWAP, then close back across it', param: 'entry' },
      { label: 'Confirm', value: 'RSI 40–60 + OI rising + prior higher-low (CE) / lower-high (PE)' },
      { label: 'Strike', value: '₹50–80 premium' },
    ],
    exit: [SL('20% · tightens to 10% in expiry danger windows'),
      TGT('30% · tightens to 15% in danger windows'),
      { label: 'Breakeven', value: 'At +25% profit, SL moves to entry' },
      TRAIL('activates +35% · trails 12% (5% in danger windows)'),
      { label: 'Signal exit', value: 'Opposite VWAP cross — only if price is ≥0.08% past VWAP (deadband)', param: 'deadband' },
      CLOSE('3:20 PM IST')],
    sizing: SIZING30 + ' · halves during expiry danger windows',
  },
  ema_crossover_1m_run: {
    accent: '#84CC16', instrument: 'Nifty 50 options · weekly expiry',
    timeframe: '1-minute candles', window: '9:45 AM – 3:20 PM IST',
    entry: EMA_ENTRY,
    exit: [SL('15% of premium'),
      { label: 'Target', value: 'NONE — no profit target', param: 'no_target' },
      { label: 'Trail SL', value: 'NONE — no trailing stop', param: 'no_target' },
      { label: 'Signal exit', value: 'Opposite EMA crossover' }, CLOSE('3:20 PM IST')],
    sizing: SIZING60,
  },
  ema_crossover_1m_runtrail: {
    accent: '#14B8A6', instrument: 'Nifty 50 options · weekly expiry',
    timeframe: '1-minute candles', window: '9:45 AM – 3:20 PM IST',
    entry: EMA_ENTRY,
    exit: [SL('15% of premium'),
      { label: 'Target', value: 'NONE — no profit target', param: 'no_target' },
      TRAIL('activates +20% · trails 10% below peak (ratchet)'),
      { label: 'Signal exit', value: 'Opposite EMA crossover' }, CLOSE('3:20 PM IST')],
    sizing: SIZING60,
  },
  expiry_powerhour_dir: {
    accent: '#F43F5E', instrument: 'Nifty weekly options · EXPIRY DAYS ONLY',
    timeframe: '30-second candles', window: 'single entry at 2:45 PM IST',
    entry: [
      { label: 'Signal', value: 'Drift (2:45 vs 2:30) decides direction — up → CE, down → PE', param: 'entry' },
      { label: 'Strike', value: '₹15–30 premium, closest to spot' },
      { label: 'Limit', value: 'One entry per expiry day, no re-entry' },
    ],
    exit: [SL('40% of premium'), { label: 'Target', value: 'NONE — no profit target' },
      TRAIL('activates +50% · trails 20% below peak'), CLOSE('3:18 PM IST')],
    sizing: '60% of capital · lot-rounded · ₹8,000 max loss at 40% SL',
  },
  expiry_powerhour_straddle: {
    accent: '#0EA5E9', instrument: 'Nifty weekly options · EXPIRY DAYS ONLY',
    timeframe: '30-second candles', window: 'single entry at 2:45 PM IST',
    entry: [
      { label: 'Signal', value: 'Buys BOTH CE and PE — direction-neutral', param: 'entry' },
      { label: 'Strike', value: '₹15–30 premium each leg, closest to spot' },
      { label: 'Guard', value: 'Skips the day entirely if only one side is available' },
    ],
    exit: [SL('40% of premium, per leg independently'),
      { label: 'Target', value: 'NONE — no profit target' },
      TRAIL('activates +50% · trails 20% below peak, per leg'), CLOSE('3:18 PM IST')],
    sizing: 'Half size per leg (30% capital each) · ₹4,000 max loss per leg',
  },

  // ─────────── BTC STRATEGIES ───────────
  // Shared: BTC/USD via Kraken, LONG+SHORT, 24/7, no hard close.
  // All strategies: 5× leverage. Sizing: qty_inr = capital × 50% × 5×.
  // Charges: Kraken taker 0.26%/side = 0.52% round-trip on notional (≈2.6% of capital at 5×).
  // Exit: hard SL at 3% price move; trail activates at +6%, trails 3% from peak.
  btc_ema_crossover: {
    accent: '#F59E0B', instrument: 'BTC/USD · Kraken · LONG + SHORT',
    timeframe: '15-minute candles', window: '24/7 — no market hours, no hard close',
    leverage: '5×',
    entry: [
      { label: 'Signal', value: 'EMA 9 crosses EMA 21 → LONG (up) / SHORT (down)', param: 'entry' },
      { label: 'Behaviour', value: 'Max 1 position/direction per day; flips on opposite cross' },
    ],
    exit: [
      { label: 'Hard SL', value: '3% price move from entry', param: 'sl' },
      { label: 'Trail SL', value: 'Activates at +6% · trails 3% below peak price', param: 'trail' },
      { label: 'Signal exit', value: 'Opposite EMA cross' },
    ],
    sizing: 'qty_inr = capital × 50% × 5× · ₹8,000 max-loss cap',
    charges: '0.52% round-trip on notional (≈2.6% of capital at 5×)',
  },
  btc_orion: {
    accent: '#6366F1', instrument: 'BTC/USD · Kraken · LONG + SHORT',
    timeframe: '15-minute candles', window: '24/7 — ORB built 00:00–00:30 UTC each day',
    leverage: '5×',
    entry: [
      { label: 'Signal', value: 'Break of UTC daily opening range (00:00–00:30)', param: 'entry' },
      { label: 'ORB', value: 'First 30 min of UTC day; reset by daily counter', param: 'orb_reset' },
      { label: 'Limit', value: 'Max 2 trades per day' },
    ],
    exit: [
      { label: 'Hard SL', value: '3% price move from entry', param: 'sl' },
      { label: 'Trail SL', value: 'Activates at +6% · trails 3% below peak price', param: 'trail' },
    ],
    sizing: 'qty_inr = capital × 50% × 5× · ₹8,000 max-loss cap',
    charges: '0.52% round-trip on notional (≈2.6% of capital at 5×)',
  },
  btc_ema_confluence: {
    accent: '#10B981', instrument: 'BTC/USD · Kraken · LONG + SHORT',
    timeframe: '5-minute candles', window: '24/7 — no market hours',
    leverage: '5×',
    entry: [
      { label: 'Filter 1', value: 'EMA 20/50 trend direction', param: 'entry' },
      { label: 'Filter 2 — RSI', value: 'RSI between 40 and 60 (neutral band)' },
      { label: 'Filter 3 — VWAP', value: 'Price on the correct side of VWAP' },
      { label: 'Filter 4 — ATR', value: 'ATR ≥ 0.1%', param: 'atr' },
      { label: 'Filter 5 — Slope', value: 'EMA 9 slope confirms direction' },
      { label: 'Note', value: 'All five must align simultaneously' },
    ],
    exit: [
      { label: 'Hard SL', value: '3% price move from entry', param: 'sl' },
      { label: 'Trail SL', value: 'Activates at +6% · trails 3% below peak price', param: 'trail' },
    ],
    sizing: 'qty_inr = capital × 50% × 5× · ₹8,000 max-loss cap',
    charges: '0.52% round-trip on notional (≈2.6% of capital at 5×)',
  },
  btc_supertrend: {
    accent: '#EF4444', instrument: 'BTC/USD · Kraken · LONG + SHORT',
    timeframe: '15-minute candles', window: '24/7 — no market hours',
    leverage: '5×',
    entry: [
      { label: 'Signal', value: 'Supertrend(7,3) flips bullish → LONG / bearish → SHORT', param: 'entry' },
      { label: 'Limit', value: 'Max 2 trades per day' },
    ],
    exit: [
      { label: 'Hard SL', value: '3% price move from entry', param: 'sl' },
      { label: 'Trail SL', value: 'Activates at +6% · trails 3% below peak price', param: 'trail' },
      { label: 'Signal exit', value: 'Opposite Supertrend flip' },
    ],
    sizing: 'qty_inr = capital × 50% × 5× · ₹8,000 max-loss cap',
    charges: '0.52% round-trip on notional (≈2.6% of capital at 5×)',
  },
  btc_vwap_scalper: {
    accent: '#F97316', instrument: 'BTC/USD · Kraken · LONG + SHORT',
    timeframe: '5-minute candles (VWAP resets at UTC midnight)', window: '24/7 — no market hours',
    leverage: '5×',
    entry: [
      { label: 'Signal', value: 'Price reclaims VWAP (LONG) or rejects it (SHORT)', param: 'entry' },
      { label: 'Confirm', value: 'RSI 40–60 + tick volume > 20-candle average' },
      { label: 'Structure', value: 'Previous candle made a higher low (LONG) / lower high (SHORT)' },
    ],
    exit: [
      { label: 'Hard SL', value: '3% price move from entry', param: 'sl' },
      { label: 'Trail SL', value: 'Activates at +6% · trails 3% below peak price', param: 'trail' },
      { label: 'Signal exit', value: 'Opposite VWAP cross on 5m' },
    ],
    sizing: 'qty_inr = capital × 50% × 5× · ₹8,000 max-loss cap',
    charges: '0.52% round-trip on notional (≈2.6% of capital at 5×)',
  },
};

// Accent lookup — replaces the duplicated ACCENT maps
export const accentFor = (id: string) => STRATEGY_SPEC[id]?.accent ?? '#6b7280';

// ── Short labels for compact displays (correlation matrix etc.) ──
export const SHORT_LABEL: Record<string, string> = {
  ema_crossover_1m: 'EMA 1m', ema_crossover_1m_run: 'Run', ema_crossover_1m_runtrail: 'Run+Trail',
  expiry_powerhour_dir: 'Exp Dir', expiry_powerhour_straddle: 'Exp Strad',
  orion: 'Orion', supertrend: 'Supertrend', supertrend_late: 'Supertrend Late',
  pcr_reversal: 'PCR Rev', gap_orb: 'Gap+ORB', vwap_scalper: 'VWAP Scalp',
  vwap_scalper_dband_lo: 'VWAP DB .03', vwap_scalper_dband_hi: 'VWAP DB .08',
  btc_ema_crossover: 'BTC EMA ×', btc_orion: 'BTC Orion', btc_ema_confluence: 'BTC Confluence',
  btc_supertrend: 'BTC Supertrend', btc_vwap_scalper: 'BTC VWAP',
};
export const shortLabel = (id: string) => SHORT_LABEL[id] ?? id;

// ── Experiment families for dashboard grouping ──
export interface StrategyFamily { title: string; subtitle: string; ids: string[]; }
export const STRATEGY_FAMILIES: StrategyFamily[] = [
  { title: 'EMA 1-minute Family', subtitle: 'S8 control vs no-target exit variants',
    ids: ['ema_crossover_1m', 'ema_crossover_1m_run', 'ema_crossover_1m_runtrail'] },
  { title: 'Expiry Day', subtitle: 'Power-hour trades — expiry Tuesdays only, one entry at 2:45 PM',
    ids: ['expiry_powerhour_dir', 'expiry_powerhour_straddle'] },
  { title: 'Standalone Strategies', subtitle: 'Independent signals — no variant race',
    ids: ['orion', 'supertrend', 'supertrend_late', 'pcr_reversal', 'gap_orb', 'vwap_scalper', 'vwap_scalper_dband_lo', 'vwap_scalper_dband_hi'] },
];

export const BTC_FAMILIES: StrategyFamily[] = [
  { title: 'BTC Strategies', subtitle: 'BTC/USD via Kraken · 24/7 · 5× leverage · 3% SL · +6% trail activates',
    ids: ['btc_ema_crossover', 'btc_orion', 'btc_ema_confluence', 'btc_supertrend', 'btc_vwap_scalper'] },
];
