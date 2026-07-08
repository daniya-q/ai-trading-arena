/**
 * Fetch & cache 1-minute NIFTY 50 candles from Upstox Historical API.
 * Stores one JSON file per calendar month in scripts/backtest/data/candles/.
 *
 * Usage:
 *   node scripts/backtest/fetch-candles.mjs [--from 2022-01] [--to 2026-07]
 *
 * Requires UPSTOX_ACCESS_TOKEN in Supabase config (refreshed daily by Railway).
 * API limit: up to ~31 days per request — fetches month-by-month.
 * Candle format stored: { time: <UTC ms>, open, high, low, close }
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, 'data', 'candles');
const INSTRUMENT = 'NSE_INDEX%7CNifty%2050';
const INTERVAL   = '1minute';

const SUPABASE_URL = 'https://vgpfjlkizdwxdcbflhyp.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZncGZqbGtpemR3eGRjYmZsaHlwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM0NTYzMywiZXhwIjoyMDk0OTIxNjMzfQ.RzpgQP99QhTgKaKBMJetNzGoiTMWu0Xsz5Elg7GAo_s';

// ── Fetch live Upstox token from Supabase ──────────────────────────────────────
async function getToken() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/config?key=eq.UPSTOX_ACCESS_TOKEN&select=value`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await res.json();
  return rows[0]?.value ?? null;
}

// ── Fetch one month of 1-min candles from Upstox ──────────────────────────────
async function fetchMonth(token, year, month) {
  // toDate = last day of month, fromDate = first day of month
  const fromDate = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay  = new Date(year, month, 0).getDate(); // days in month
  const toDate   = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  const url = `https://api.upstox.com/v2/historical-candle/${INSTRUMENT}/${INTERVAL}/${toDate}/${fromDate}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const data = await res.json();

  if (data.status !== 'success') {
    console.warn(`  Upstox error for ${year}-${month}: ${JSON.stringify(data).slice(0,200)}`);
    return [];
  }

  const raw = data.data?.candles ?? [];
  // Raw format: [dateStr, open, high, low, close, volume, oi]
  // Convert to { time: UTC ms, open, high, low, close }
  const candles = raw.map(c => {
    // c[0] = "2026-07-07T15:29:00+05:30"
    const tsMs = new Date(c[0]).getTime(); // JS Date parses ISO with offset → UTC
    return { time: tsMs, open: c[1], high: c[2], low: c[3], close: c[4] };
  }).sort((a, b) => a.time - b.time); // ascending

  return candles;
}

// ── Main ───────────────────────────────────────────────────────────────────────
fs.mkdirSync(DATA_DIR, { recursive: true });

const args = process.argv.slice(2);
const fromArg = args.find(a => a.startsWith('--from='))?.split('=')[1] ?? '2022-01';
const toArg   = args.find(a => a.startsWith('--to='))?.split('=')[1]   ?? (() => {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2,'0')}`;
})();

const [fromYear, fromMonth] = fromArg.split('-').map(Number);
const [toYear,   toMonth  ] = toArg.split('-').map(Number);

console.log(`Fetching NIFTY 1-min candles from ${fromArg} to ${toArg}...`);
const token = await getToken();
if (!token) { console.error('Could not fetch Upstox token from Supabase'); process.exit(1); }
console.log('Token OK.');

let cur = { year: fromYear, month: fromMonth };
let fetched = 0, skipped = 0;

while (cur.year < toYear || (cur.year === toYear && cur.month <= toMonth)) {
  const key  = `${cur.year}-${String(cur.month).padStart(2,'0')}`;
  const file = path.join(DATA_DIR, `${key}.json`);

  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (existing.length > 0) {
      console.log(`  ${key} — cached (${existing.length} bars), skip`);
      skipped++;
      // Advance month
      if (cur.month === 12) { cur.year++; cur.month = 1; } else { cur.month++; }
      continue;
    }
  }

  process.stdout.write(`  ${key} — fetching... `);
  const candles = await fetchMonth(token, cur.year, cur.month);
  fs.writeFileSync(file, JSON.stringify(candles));
  console.log(`${candles.length} bars saved`);
  fetched++;

  // Small delay to avoid rate limiting
  await new Promise(r => setTimeout(r, 400));

  if (cur.month === 12) { cur.year++; cur.month = 1; } else { cur.month++; }
}

console.log(`\nDone. Fetched ${fetched} months, skipped ${skipped} (already cached).`);

// ── Summary ───────────────────────────────────────────────────────────────────
let totalBars = 0;
const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort();
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
  totalBars += data.length;
}
console.log(`Total cached bars across all months: ${totalBars.toLocaleString()}`);
