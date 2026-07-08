// Seed 3 new EMA variant strategies via JS fetch (avoids curl encoding issues)
const SUPABASE_URL = 'https://vgpfjlkizdwxdcbflhyp.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZncGZqbGtpemR3eGRjYmZsaHlwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM0NTYzMywiZXhwIjoyMDk0OTIxNjMzfQ.RzpgQP99QhTgKaKBMJetNzGoiTMWu0Xsz5Elg7GAo_s';

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function post(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const txt = await res.text();
  console.log(`POST ${table}: ${res.status} → ${txt.slice(0, 200)}`);
  return res.status;
}

async function del(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE', headers,
  });
  console.log(`DELETE ${table}?${filter}: ${res.status}`);
}

// Remove placeholders
await del('strategies', 'id=in.(placeholder_8,placeholder_9,placeholder_10)');

// Insert strategies
const strategies = [
  { id: 'ema_crossover_asym',    name: 'EMA Crossover Asym',    description: 'EMA 16/64 on 30s — instant entry, 2-bar exit confirmation',          status: 'active', slot_number: 9  },
  { id: 'ema_crossover_confirm', name: 'EMA Crossover Confirm', description: 'EMA 16/64 on 30s — 2-bar confirmation on both entry and exit',         status: 'active', slot_number: 10 },
  { id: 'ema_crossover_dualtf',  name: 'EMA Crossover Dual-TF', description: 'EMA 16/64 on 30s + 1m — both timeframes must agree for entry/exit',    status: 'active', slot_number: 11 },
];

for (const s of strategies) {
  await post('strategies', s);
}

// Insert capital
const capital = [
  { strategy_id: 'ema_crossover_asym',    allocated_capital: 100000, current_value: 100000, total_pnl: 0, win_rate: 0, sharpe_ratio: 0, today_trades: 0, lifetime_trades: 0 },
  { strategy_id: 'ema_crossover_confirm', allocated_capital: 100000, current_value: 100000, total_pnl: 0, win_rate: 0, sharpe_ratio: 0, today_trades: 0, lifetime_trades: 0 },
  { strategy_id: 'ema_crossover_dualtf',  allocated_capital: 100000, current_value: 100000, total_pnl: 0, win_rate: 0, sharpe_ratio: 0, today_trades: 0, lifetime_trades: 0 },
];

for (const c of capital) {
  await post('strategy_capital', c);
}

// Verify
const verRes = await fetch(`${SUPABASE_URL}/rest/v1/strategies?id=in.(ema_crossover_asym,ema_crossover_confirm,ema_crossover_dualtf)&select=id,slot_number,status`, { headers });
const rows = await verRes.json();
console.log('\nVerification:', JSON.stringify(rows));

const capRes = await fetch(`${SUPABASE_URL}/rest/v1/strategy_capital?strategy_id=in.(ema_crossover_asym,ema_crossover_confirm,ema_crossover_dualtf)&select=strategy_id,current_value`, { headers });
const capRows = await capRes.json();
console.log('Capital:', JSON.stringify(capRows));
