"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";

import { bots } from "@/data/bots";

type Trade = {
  id: string;
  botId: string;
  botName: string;
  symbol: string;
  side: string;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt?: string;
};

const BOT_COLORS: Record<string, string> = {
  gpt: "text-blue-400",
  claude: "text-purple-400",
  gemini: "text-emerald-400",
  groq: "text-yellow-400",
};

const FILTERS = [
  { label: "All", value: "all" },
  { label: "GPT", value: "gpt" },
  { label: "Claude", value: "claude" },
  { label: "Gemini", value: "gemini" },
  { label: "Groq", value: "groq" },
];

const botNameMap = Object.fromEntries(
  bots.map((b) => [b.id, b.name])
);

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function TradesPage() {

  const [trades, setTrades] =
    useState<Trade[]>([]);

  const [filter, setFilter] =
    useState("all");

  const [loading, setLoading] =
    useState(true);

  const [lastUpdated, setLastUpdated] =
    useState<Date | null>(null);

  async function fetchTrades() {

    const { data, error } =
      await supabase
        .from("positions")
        .select("*")
        .order("opened_at", {
          ascending: false,
        });

    if (error) {
      console.error(
        "[Trades] Supabase fetch failed:",
        error.message
      );
      setLoading(false);
      return;
    }

    const mapped: Trade[] = (
      data || []
    ).map((row) => ({
      id: row.id,
      botId: row.bot_id,
      botName:
        botNameMap[row.bot_id] ||
        row.bot_id,
      symbol: row.symbol,
      side: row.side,
      entryPrice: Number(row.entry_price),
      currentPrice: Number(
        row.current_price
      ),
      pnl: Number(row.pnl),
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at ?? undefined,
    }));

    setTrades(mapped);

    setLastUpdated(new Date());

    setLoading(false);

  }

  useEffect(() => {

    fetchTrades();

    const interval =
      setInterval(fetchTrades, 15000);

    return () => clearInterval(interval);

  }, []);

  const filtered =
    filter === "all"
      ? trades
      : trades.filter(
          (t) => t.botId === filter
        );

  const openCount = trades.filter(
    (t) => t.status === "OPEN"
  ).length;

  const closedCount = trades.filter(
    (t) => t.status === "CLOSED"
  ).length;

  return (
    <div className="flex-1 p-8 bg-black min-h-screen text-white fade-in">

      {/* Header */}

      <div className="flex items-end justify-between mb-8">

        <div>

          <h1 className="text-5xl font-bold mb-3">
            Trades
          </h1>

          <p className="text-zinc-300 text-lg">
            {openCount} open &nbsp;·&nbsp;{" "}
            {closedCount} closed
          </p>

        </div>

        {lastUpdated && (
          <p className="text-zinc-400 text-sm">
            Refreshes every 15s · Last updated{" "}
            {lastUpdated.toLocaleTimeString()}
          </p>
        )}

      </div>

      {/* Filter buttons */}

      <div className="flex gap-3 mb-8 flex-wrap">

        {FILTERS.map((f) => (

          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-5 py-2 rounded-xl text-sm font-semibold border transition-all ${
              filter === f.value
                ? "bg-white text-black border-white"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600"
            }`}
          >
            {f.label}
          </button>

        ))}

      </div>

      {/* Table */}

      {loading ? (

        <div className="flex items-center justify-center py-32">

          <div className="w-8 h-8 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />

        </div>

      ) : filtered.length === 0 ? (

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-400">

          No trades found

        </div>

      ) : (

        <div className="space-y-3">

          {filtered.map((trade) => (

            <div
              key={trade.id}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex items-center gap-4 flex-wrap md:flex-nowrap"
            >

              {/* Bot */}

              <div className="w-28 shrink-0">

                <span
                  className={`font-bold text-sm ${
                    BOT_COLORS[trade.botId] ||
                    "text-white"
                  }`}
                >
                  {trade.botName}
                </span>

              </div>

              {/* Symbol */}

              <div className="flex-1 min-w-[80px]">

                <span className="font-bold text-lg">
                  {trade.symbol}
                </span>

              </div>

              {/* Side badge */}

              <div className="shrink-0">

                <span
                  className={`px-3 py-1 rounded-lg text-sm font-semibold border ${
                    trade.side === "BUY"
                      ? "bg-green-500/10 border-green-500/20 text-green-400"
                      : "bg-red-500/10 border-red-500/20 text-red-400"
                  }`}
                >
                  {trade.side}
                </span>

              </div>

              {/* Entry */}

              <div className="text-right shrink-0 min-w-[100px]">

                <p className="text-zinc-300 text-sm mb-1">
                  Entry
                </p>

                <p className="font-semibold text-sm">
                  ₹
                  {trade.entryPrice.toLocaleString(
                    "en-IN"
                  )}
                </p>

              </div>

              {/* Current / Exit */}

              <div className="text-right shrink-0 min-w-[100px]">

                <p className="text-zinc-300 text-sm mb-1">
                  {trade.status === "CLOSED"
                    ? "Exit"
                    : "Current"}
                </p>

                <p className="font-semibold text-sm">
                  ₹
                  {trade.currentPrice.toLocaleString(
                    "en-IN"
                  )}
                </p>

              </div>

              {/* PnL */}

              <div className="text-right shrink-0 min-w-[110px]">

                <p className="text-zinc-300 text-sm mb-1">
                  PnL
                </p>

                <p
                  className={`font-bold text-lg ${
                    trade.pnl >= 0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {trade.pnl >= 0 ? "+" : ""}₹
                  {trade.pnl.toLocaleString("en-IN")}
                </p>

              </div>

              {/* Status */}

              <div className="shrink-0">

                <span
                  className={`px-3 py-1 rounded-lg text-sm font-semibold border ${
                    trade.status === "OPEN"
                      ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                      : "bg-zinc-800 border-zinc-700 text-zinc-400"
                  }`}
                >
                  {trade.status}
                </span>

              </div>

              {/* Time */}

              <div className="text-right shrink-0 min-w-[120px]">

                <p className="text-zinc-300 text-sm">
                  {trade.status === "CLOSED" &&
                  trade.closedAt
                    ? formatTime(trade.closedAt)
                    : formatTime(trade.openedAt)}
                </p>

              </div>

            </div>

          ))}

        </div>

      )}

    </div>
  );
}
