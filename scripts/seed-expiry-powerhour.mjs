// Seed S14 + S15 expiry power hour strategies via JS fetch
const SUPABASE_URL = 'https://vgpfjlkizdwxdcbflhyp.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZncGZqbGtpemR3eGRjYmZsaHlwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM0NTYzMywiZXhwIjoyMDk0OTIxNjMzfQ.RzpgQP99QhTgKaKBMJetNzGoiTMWu0Xsz5Elg7GAo_s';

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=ignore-duplicates,return=representation',
};

async function upsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const txt = await res.text();
  console.log(`POST ${table}: ${res.status} → ${txt.slice(0, 300)}`);
  return res.status;
}

// Insert strategies
const strategies = [
  {
    id: 'expiry_powerhour_dir',
    name: 'Expiry Power Hour',
    description: 'Directional expiry-day trade at 2:45 PM — drift(2:45−2:30) decides CE/PE, ₹15–30 OTM strike, 40% SL, trail at +50%',
    status: 'active',
    slot_number: 14,
  },
  {
    id: 'expiry_powerhour_straddle',
    name: 'Expiry Straddle',
    description: 'Buy both CE+PE in ₹15–30 band at 2:45 PM on expiry day, each leg independent, 40% SL, trail at +50%',
    status: 'active',
    slot_number: 15,
  },
];

for (const s of strategies) {
  await upsert('strategies', s);
}

// Insert capital
const capital = [
  { strategy_id: 'expiry_powerhour_dir',      allocated_capital: 100000, current_value: 100000, total_pnl: 0, win_rate: 0, sharpe_ratio: 0, today_trades: 0, lifetime_trades: 0 },
  { strategy_id: 'expiry_powerhour_straddle', allocated_capital: 100000, current_value: 100000, total_pnl: 0, win_rate: 0, sharpe_ratio: 0, today_trades: 0, lifetime_trades: 0 },
];

for (const c of capital) {
  await upsert('strategy_capital', c);
}

// Verify
const verRes = await fetch(`${SUPABASE_URL}/rest/v1/strategies?id=in.(expiry_powerhour_dir,expiry_powerhour_straddle)&select=id,slot_number,status`, { headers });
const rows = await verRes.json();
console.log('\nVerification strategies:', JSON.stringify(rows));

const capRes = await fetch(`${SUPABASE_URL}/rest/v1/strategy_capital?strategy_id=in.(expiry_powerhour_dir,expiry_powerhour_straddle)&select=strategy_id,current_value,allocated_capital`, { headers });
const capRows = await capRes.json();
console.log('Verification capital:', JSON.stringify(capRows));
