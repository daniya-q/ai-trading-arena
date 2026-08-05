'use client';
import { STRATEGY_SPEC, SpecRow } from '@/lib/strategySpec';
import { STRATEGY_VALIDATION, ValidationTier } from '@/lib/strategyValidation';

const TIER_COLOR: Record<ValidationTier, string> = {
  validated: '#4ade80', testing: '#fbbf24', unvalidated: '#6b7280',
};
const TIER_LABEL: Record<ValidationTier, string> = {
  validated: 'Validated', testing: 'Under live test', unvalidated: 'Not validated',
};

function Badge({ strategyId, param }: { strategyId: string; param?: string }) {
  if (!param) return null;
  const s = STRATEGY_VALIDATION[strategyId]?.[param];
  if (!s) return null;
  const title = `${TIER_LABEL[s.tier]}${s.note ? ' — ' + s.note : ''}`;
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, cursor: 'help' }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: TIER_COLOR[s.tier], display: 'inline-block' }} />
      <span style={{ fontSize: 'clamp(7px,0.85vh,9px)', color: TIER_COLOR[s.tier], letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 700 }}>
        {s.tier === 'validated' ? 'VLD' : s.tier === 'testing' ? 'TEST' : 'N/V'}
      </span>
    </span>
  );
}

function Row({ row, strategyId }: { row: SpecRow; strategyId: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ fontSize: 'clamp(9px,1.05vh,11px)', color: '#94a3b8', minWidth: 96, flexShrink: 0, fontWeight: 600 }}>{row.label}</div>
      <div style={{ fontSize: 'clamp(10px,1.15vh,12.5px)', color: '#e2e8f0', flex: 1, lineHeight: 1.45 }}>{row.value}</div>
      <Badge strategyId={strategyId} param={row.param} />
    </div>
  );
}

function GroupHeading({ text, accent }: { text: string; accent: string }) {
  return (
    <div style={{ fontSize: 'clamp(9px,1vh,11px)', fontWeight: 800, color: accent, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '10px 0 2px' }}>
      {text}
    </div>
  );
}

export default function StrategySpecCard({ strategyId }: { strategyId: string }) {
  const spec = STRATEGY_SPEC[strategyId];
  if (!spec) return <div style={{ color: '#6b7280', fontSize: 13 }}>No specification recorded for this strategy.</div>;

  const v = STRATEGY_VALIDATION[strategyId] ?? {};
  const counts = Object.values(v).reduce((a, p) => { a[p.tier]++; return a; },
    { validated: 0, testing: 0, unvalidated: 0 } as Record<ValidationTier, number>);

  return (
    <div style={{ height: '100%', overflowY: 'auto', paddingRight: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 'clamp(18px,2.3vh,24px)', fontWeight: 700, color: spec.accent, letterSpacing: '0.01em' }}>
          Specification
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 'clamp(8px,0.95vh,10px)', fontWeight: 700 }}>
          {(['validated', 'testing', 'unvalidated'] as ValidationTier[]).map(t => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: TIER_COLOR[t] }} title={TIER_LABEL[t]}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: TIER_COLOR[t] }} />{counts[t]}
            </span>
          ))}
        </div>
      </div>

      <Row row={{ label: 'Instrument', value: spec.instrument }} strategyId={strategyId} />
      <Row row={{ label: 'Timeframe', value: spec.timeframe }} strategyId={strategyId} />
      <Row row={{ label: 'Window', value: spec.window }} strategyId={strategyId} />

      <GroupHeading text="Entry" accent={spec.accent} />
      {spec.entry.map((r, i) => <Row key={i} row={r} strategyId={strategyId} />)}

      <GroupHeading text="Exit (priority order)" accent={spec.accent} />
      {spec.exit.map((r, i) => <Row key={i} row={r} strategyId={strategyId} />)}

      <GroupHeading text="Position sizing" accent={spec.accent} />
      <div style={{ fontSize: 'clamp(10px,1.15vh,12.5px)', color: '#e2e8f0', lineHeight: 1.5, paddingTop: 2 }}>{spec.sizing}</div>
    </div>
  );
}
