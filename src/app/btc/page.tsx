"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useBtcStore } from "@/store/btcStore";
import { startBtcWebSocket } from "@/lib/btc/btcWebSocket";
import { supabase } from "@/lib/supabase/client";

// ── Constants ─────────────────────────────────────────────────────

const BOT_CONFIG: Record<string, { name: string; color: string }> = {
  gpt:    { name: "GPT",    color: "#00A67E" },
  claude: { name: "Claude", color: "#CC785C" },
  gemini: { name: "Gemini", color: "#4285F4" },
  groq:   { name: "Groq",   color: "#F55036" },
};

const BOT_IDS = ["gpt", "claude", "gemini", "groq"];
const TOTAL_STARTING_CAPITAL = 400_000; // 4 × ₹1,00,000
const USD_TO_INR = 95.82;               // used for live unrealised PnL display

// ── Types ─────────────────────────────────────────────────────────

type CapRow = {
  bot_id: string;
  allocated_capital: number;
  pnl: number;
};

type PosRow = {
  id: string;
  bot_id: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  pnl: number;
  charges: number | null;
  status: "OPEN" | "CLOSED";
  opened_at: string | null;
  closed_at: string | null;
};

// ── Formatters ────────────────────────────────────────────────────

function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtINR(n: number): string {
  return Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}


function pnlColor(n: number): string {
  if (n === 0) return "#888888";
  return n > 0 ? "#00ff88" : "#ff4444";
}

function pnlStr(n: number): string {
  return `${n >= 0 ? "+" : "-"}₹${fmtINR(n)}`;
}

// ── Page ──────────────────────────────────────────────────────────

export default function BtcArenaPage() {
  const { btcPrice, btcChange24h, update24h } = useBtcStore();
  const router = useRouter();

  const [caps, setCaps]             = useState<CapRow[]>([]);
  const [positions, setPositions]   = useState<PosRow[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    const [capRes, posRes] = await Promise.all([
      supabase
        .from("btc_capital")
        .select("bot_id,allocated_capital,pnl"),
      supabase
        .from("btc_positions")
        .select("id,bot_id,quantity,entry_price,current_price,pnl,charges,status,opened_at,closed_at")
        .order("opened_at", { ascending: false }),
    ]);

    if (capRes.error) {
      console.error("[BTC Page] btc_capital error:", capRes.error);
      setFetchError(`btc_capital: ${capRes.error.message}`);
      return;
    }
    if (posRes.error) {
      console.error("[BTC Page] btc_positions error:", posRes.error);
      setFetchError(`btc_positions: ${posRes.error.message}`);
      return;
    }

    setFetchError(null);
    setCaps((capRes.data ?? []) as CapRow[]);
    setPositions((posRes.data ?? []) as PosRow[]);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    startBtcWebSocket();

    fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT")
      .then((r) => r.json())
      .then((d) =>
        update24h(
          parseFloat((d as { priceChangePercent?: string }).priceChangePercent ?? "0"),
          parseFloat((d as { highPrice?: string }).highPrice ?? "0"),
          parseFloat((d as { lowPrice?: string }).lowPrice ?? "0"),
        )
      )
      .catch(() => {});

    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // ── Derived pool totals ────────────────────────────────────────
  const totalCapital  = caps.reduce((s, c) => s + c.allocated_capital, 0);
  const realisedPnl   = caps.reduce((s, c) => s + c.pnl, 0);
  const unrealisedPnl = positions
    .filter((p) => p.status === "OPEN")
    .reduce((s, p) => s + (btcPrice - p.entry_price) * p.quantity * USD_TO_INR, 0);
  const totalPnl      = realisedPnl + unrealisedPnl;
  const totalPnlPct   = (totalPnl / TOTAL_STARTING_CAPITAL) * 100;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex-1 p-6 min-h-screen text-white fade-in">

      {/* ── Page title ─────────────────────────────────────── */}
      <div className="mb-6">
        <p className="font-pixel text-[6px] text-orange-500/50 mb-2 tracking-widest">
          BTC ARENA · SEASON 1
        </p>
        <h1 className="font-pixel text-lg text-white">
          BITCOIN TRADING
        </h1>
      </div>

      {/* ── Error banner ───────────────────────────────────── */}
      {fetchError && (
        <div
          className="mb-6 px-4 py-3 font-pixel text-[6px] leading-relaxed"
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.35)",
            color: "#ef4444",
          }}
        >
          ▸ SUPABASE FETCH ERROR: {fetchError}
          <br />
          <span className="text-zinc-600">
            Check NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY · RLS on btc_capital / btc_positions
          </span>
        </div>
      )}

      {/* ── Pool summary ───────────────────────────────────── */}
      <div
        className="grid grid-cols-3 gap-0 mb-6"
        style={{
          background: "rgba(10,10,22,0.85)",
          border: "1px solid rgba(255,255,255,0.07)",
          backdropFilter: "blur(12px)",
        }}
      >
        {[
          {
            label: "POOL CAPITAL",
            value: `₹${fmtINR(totalCapital)}`,
            color: "#ffffff",
          },
          {
            label: "TOTAL PNL",
            value: pnlStr(totalPnl),
            color: pnlColor(totalPnl),
          },
          {
            label: "RETURN",
            value: `${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(3)}%`,
            color: pnlColor(totalPnlPct),
          },
        ].map((item, i) => (
          <div
            key={item.label}
            className="px-6 py-4"
            style={{
              borderRight: i < 2 ? "1px solid rgba(255,255,255,0.05)" : undefined,
            }}
          >
            <p className="font-pixel font-bold text-[1.176rem] text-zinc-500 mb-2 tracking-widest">
              {item.label}
            </p>
            <p className="font-pixel font-bold text-[1.176rem]" style={{ color: item.color }}>
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── BTC price ──────────────────────────────────────── */}
      <div
        className="flex items-center gap-6 mb-8 px-6 py-4"
        style={{
          background: "rgba(10,10,22,0.85)",
          border: "1px solid rgba(249,115,22,0.2)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div>
          <p className="font-pixel font-bold text-[1.176rem] text-zinc-500 mb-2 tracking-widest">
            BTC / USD · LIVE
          </p>
          <p
            className="font-pixel font-bold text-[1.176rem]"
            style={{ color: btcPrice > 0 ? "#f97316" : "#3f3f46" }}
          >
            {btcPrice > 0 ? `$${fmtUSD(btcPrice)}` : "CONNECTING..."}
          </p>
        </div>

        {btcChange24h !== 0 && (
          <p
            className="font-pixel font-bold text-[1.176rem] mt-1"
            style={{ color: pnlColor(btcChange24h) }}
          >
            {btcChange24h >= 0 ? "+" : ""}
            {btcChange24h.toFixed(2)}% 24H
          </p>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"
            style={{ animation: "pulse 2s infinite" }}
          />
          <span className="font-pixel font-bold text-[1.176rem] text-green-400">
            MARKET OPEN 24/7
          </span>
        </div>
      </div>

      {/* ── Bot squares ────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        {BOT_IDS.map((botId) => {
          const cfg     = BOT_CONFIG[botId]!;
          const cap     = caps.find((c) => c.bot_id === botId);
          const capital = cap?.allocated_capital ?? 100_000;
          const pnl     = cap?.pnl ?? 0;
          const retPct  = (pnl / 100_000) * 100;

          const botPos       = positions.filter((p) => p.bot_id === botId);
          const openPos      = botPos.filter((p) => p.status === "OPEN");
          const totalCharges = botPos.reduce((s, p) => s + (p.charges ?? 0), 0);

          return (
            <div
              key={botId}
              onClick={() => router.push(`/btc/bots?bot=${botId}`)}
              className="cursor-pointer px-5 py-5 flex flex-col gap-4 transition-all hover:scale-[1.02]"
              style={{
                background: "rgba(10,10,22,0.85)",
                border: `1px solid ${cfg.color}40`,
                backdropFilter: "blur(12px)",
                boxShadow: `0 0 20px ${cfg.color}10`,
              }}
            >
              {/* Bot name */}
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: cfg.color, boxShadow: `0 0 8px ${cfg.color}` }}
                />
                <p className="font-pixel font-bold text-[1.176rem]" style={{ color: cfg.color }}>
                  {cfg.name} BOT
                </p>
              </div>

              {/* Stats */}
              <div className="flex flex-col gap-3">
                {[
                  { label: "CAPITAL",  value: `₹${fmtINR(capital)}`,                           color: "#ffffff" },
                  { label: "TOTAL PNL", value: pnlStr(pnl),                                     color: pnlColor(pnl) },
                  { label: "RETURN",   value: `${retPct >= 0 ? "+" : ""}${retPct.toFixed(2)}%`, color: pnlColor(retPct) },
                  { label: "TRADES",   value: `${botPos.length} (${openPos.length} open)`,      color: "#a1a1aa" },
                  { label: "CHARGES",  value: `₹${fmtINR(totalCharges)}`,                       color: "#f59e0b" },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between items-baseline">
                    <p className="font-pixel font-bold text-[1.176rem] text-zinc-600 tracking-widest">
                      {row.label}
                    </p>
                    <p className="font-pixel font-bold text-[1.176rem]" style={{ color: row.color }}>
                      {row.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Click hint */}
              <p className="font-pixel text-[0.55rem] text-zinc-700 tracking-widest mt-1">
                TAP FOR DETAILS →
              </p>
            </div>
          );
        })}
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      {lastUpdated && (
        <p className="font-pixel text-[5px] text-zinc-800 text-center mt-8">
          UPDATED {lastUpdated.toLocaleTimeString()} · AUTO-REFRESH 15s
        </p>
      )}

    </div>
  );
}
