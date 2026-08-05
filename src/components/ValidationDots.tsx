'use client';
import { STRATEGY_VALIDATION, ValidationTier } from '@/lib/strategyValidation';

const C: Record<ValidationTier, string> = { validated: '#4ade80', testing: '#fbbf24', unvalidated: '#6b7280' };
const L: Record<ValidationTier, string> = { validated: 'Validated', testing: 'Under live test', unvalidated: 'Not validated' };

export default function ValidationDots({ strategyId, size = 6 }: { strategyId: string; size?: number }) {
  const v = STRATEGY_VALIDATION[strategyId];
  if (!v) return null;
  const counts = Object.values(v).reduce((a, p) => { a[p.tier]++; return a; },
    { validated: 0, testing: 0, unvalidated: 0 } as Record<ValidationTier, number>);
  const tiers = (['validated', 'testing', 'unvalidated'] as ValidationTier[]).filter(t => counts[t] > 0);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
          title={tiers.map(t => `${counts[t]} ${L[t]}`).join(' · ')}>
      {tiers.map(t => (
        <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: size, height: size, borderRadius: 999, background: C[t], display: 'inline-block' }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: C[t], fontFamily: 'monospace' }}>{counts[t]}</span>
        </span>
      ))}
    </span>
  );
}
