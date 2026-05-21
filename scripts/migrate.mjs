/**
 * Supabase migration runner
 * Usage: node --env-file=.env.local scripts/migrate.mjs
 *
 * Tries Supabase Management API first; falls back to seeding
 * via the REST API and reports table verification.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createClient } from "@supabase/supabase-js";

const __dir = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF = SUPABASE_URL.replace("https://", "").replace(
  ".supabase.co",
  ""
);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── Read migration SQL ────────────────────────────────────────
const migrationPath = join(
  __dir,
  "../supabase/migrations/001_initial_schema.sql"
);
const fullSQL = readFileSync(migrationPath, "utf8");

// Split into individual statements (skip comments and blanks)
const statements = fullSQL
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

// ── Step 1: Try Supabase Management API ──────────────────────
async function tryManagementAPI() {
  console.log(
    "\n[1/3] Trying Supabase Management API...\n" +
      `      POST https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
  );

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: fullSQL }),
    }
  );

  if (res.ok) {
    const json = await res.json();
    console.log("✅ Management API succeeded:", JSON.stringify(json));
    return true;
  }

  const errText = await res.text();
  console.warn(
    `⚠️  Management API returned ${res.status} — ` +
      (res.status === 401
        ? "service role key is not a valid PAT for this endpoint (expected)."
        : errText)
  );
  return false;
}

// ── Step 2: Seed via REST API (works with service role key) ──
async function seedViaREST() {
  console.log(
    "\n[2/3] Seeding data via Supabase REST API (service role key)...\n"
  );

  const bots = [
    { id: "gpt",    name: "GPT Bot",    provider: "openai" },
    { id: "claude", name: "Claude Bot", provider: "claude" },
    { id: "gemini", name: "Gemini Bot", provider: "gemini" },
    { id: "groq",   name: "Groq Bot",   provider: "groq"   },
  ];

  // Bots
  const { error: botsErr } = await supabase
    .from("bots")
    .upsert(bots, { onConflict: "id" });
  if (botsErr) throw new Error(`bots seed failed: ${botsErr.message}`);
  console.log("  ✅ bots — seeded 4 rows");

  // Capital
  const capital = bots.map((b) => ({
    bot_id: b.id,
    allocated_capital: 100000,
    peak_capital: 100000,
    pnl: 0,
    win_rate: 0,
    sharpe_like: 0,
  }));
  const { error: capErr } = await supabase
    .from("capital")
    .upsert(capital, { onConflict: "bot_id" });
  if (capErr) throw new Error(`capital seed failed: ${capErr.message}`);
  console.log("  ✅ capital — seeded 4 rows (₹1,00,000 each)");

  // NSE Holidays 2025
  const holidays2025 = [
    { date: "2025-02-26", description: "Mahashivratri" },
    { date: "2025-03-14", description: "Holi" },
    { date: "2025-03-31", description: "Id-Ul-Fitr (Eid al-Fitr)" },
    { date: "2025-04-10", description: "Shri Ram Navami" },
    { date: "2025-04-14", description: "Dr. B.R. Ambedkar Jayanti" },
    { date: "2025-04-18", description: "Good Friday" },
    { date: "2025-05-01", description: "Maharashtra Day" },
    { date: "2025-07-07", description: "Moharram" },
    { date: "2025-08-15", description: "Independence Day" },
    { date: "2025-08-27", description: "Ganesh Chaturthi" },
    { date: "2025-10-02", description: "Gandhi Jayanti / Dussehra" },
    { date: "2025-10-20", description: "Diwali Laxmi Puja" },
    { date: "2025-10-21", description: "Diwali Balipratipada" },
    { date: "2025-11-05", description: "Prakash Gurpurb Sri Guru Nanak Dev Ji" },
    { date: "2025-12-25", description: "Christmas" },
  ];

  // NSE Holidays 2026 (estimated — verify with NSE official calendar)
  const holidays2026 = [
    { date: "2026-01-26", description: "Republic Day" },
    { date: "2026-03-03", description: "Holi" },
    { date: "2026-03-20", description: "Id-Ul-Fitr (Eid al-Fitr)" },
    { date: "2026-04-03", description: "Good Friday" },
    { date: "2026-04-14", description: "Dr. B.R. Ambedkar Jayanti" },
    { date: "2026-05-01", description: "Maharashtra Day" },
    { date: "2026-10-02", description: "Gandhi Jayanti" },
    { date: "2026-11-17", description: "Diwali Laxmi Puja" },
    { date: "2026-11-18", description: "Diwali Balipratipada" },
    { date: "2026-11-24", description: "Dussehra" },
    { date: "2026-12-25", description: "Christmas" },
  ];

  const { error: holErr } = await supabase
    .from("nse_holidays")
    .upsert([...holidays2025, ...holidays2026], { onConflict: "date" });
  if (holErr) throw new Error(`nse_holidays seed failed: ${holErr.message}`);
  console.log(
    `  ✅ nse_holidays — seeded ${holidays2025.length + holidays2026.length} rows (2025 + 2026)`
  );
}

// ── Step 3: Verify all tables ─────────────────────────────────
async function verifyTables() {
  console.log("\n[3/3] Verifying tables...\n");

  const tables = ["bots", "capital", "positions", "ai_memory", "strategy_log", "nse_holidays"];
  let allOk = true;

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .limit(1);

    if (
      error &&
      (error.message.includes("does not exist") ||
        error.message.includes("schema cache") ||
        error.code === "42P01")
    ) {
      console.log(`  ❌ ${table} — table does not exist`);
      allOk = false;
    } else if (error) {
      console.log(`  ❌ ${table} — ${error.message}`);
      allOk = false;
    } else {
      console.log(`  ✅ ${table} — exists`);
    }
  }

  return allOk;
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  console.log("═══════════════════════════════════════════════");
  console.log("  AI Trading Arena — Supabase Migration Runner ");
  console.log(`  Project: ${PROJECT_REF}`);
  console.log("═══════════════════════════════════════════════");

  const mgmtOk = await tryManagementAPI();

  if (!mgmtOk) {
    console.log(
      "\n  📋 Management API unavailable (requires Personal Access Token)."
    );
    console.log(
      "  Run the SQL below in your Supabase SQL Editor, then re-run this script:\n"
    );
    console.log(
      "  https://supabase.com/dashboard/project/" +
        PROJECT_REF +
        "/sql/new\n"
    );
    console.log("  File: supabase/migrations/001_initial_schema.sql\n");
    console.log("─".repeat(64));
  }

  // Always attempt seeding (works if tables already exist)
  try {
    await seedViaREST();
  } catch (err) {
    console.error("\n  ❌ Seeding failed:", err.message);
    if (err.message.includes("does not exist")) {
      console.error(
        "\n  Tables don't exist yet. Please run the SQL migration first:\n" +
          "  https://supabase.com/dashboard/project/" +
          PROJECT_REF +
          "/sql/new"
      );
      process.exit(1);
    }
  }

  const ok = await verifyTables();

  console.log("\n═══════════════════════════════════════════════");
  if (ok) {
    console.log("  ✅ All migrations confirmed successfully!");
  } else {
    console.log("  ⚠️  Some tables are missing. Run the SQL migration first.");
  }
  console.log("═══════════════════════════════════════════════\n");

  process.exit(ok ? 0 : 1);
})();
