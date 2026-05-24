"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";

import { bots } from "@/data/bots";

type BotStats = {
  botId: string;
  botName: string;
  allocatedCapital: number;
  pnl: number;
  winRate: number;
  sharpeLike: number;
  totalTrades: number;
};

const BOT_COLORS: Record<string, string> = {
  gpt: "text-blue-400",
  claude: "text-purple-400",
  gemini: "text-emerald-400",
  groq: "text-yellow-400",
};

const RANK_CONFIGS = [
  {
    border: "border-yellow-500/40",
    bg: "bg-yellow-500/5",
    rankColor: "text-yellow-400",
    label: "#1",
  },
  {
    border: "border-gray-400/30",
    bg: "bg-gray-400/5",
    rankColor: "text-gray-300",
    label: "#2",
  },
  {
    border: "border-orange-600/30",
    bg: "bg-orange-700/5",
    rankColor: "text-orange-400",
    label: "#3",
  },
  {
    border: "border-zinc-700",
    bg: "",
    rankColor: "text-zinc-500",
    label: "#4",
  },
];

const botNameMap = Object.fromEntries(
  bots.map((b) => [b.id, b.name])
);

async function fetchLeaderboardData(): Promise<BotStats[]> {

  const [capitalRes, positionsRes] = await Promise.all([
    supabase
      .from("capital")
      .select(
        "bot_id, allocated_capital, pnl, win_rate, sharpe_like"
      ),
    supabase
      .from("positions")
      .select("bot_id"),
  ]);

  const tradeCounts: Record<string, number> = {};

  (positionsRes.data || []).forEach((row) => {
    tradeCounts[row.bot_id] =
      (tradeCounts[row.bot_id] || 0) + 1;
  });

  const capitalData = capitalRes.data || [];

  const source =
    capitalData.length > 0
      ? capitalData.map((row) => ({
          botId: row.bot_id,
          botName:
            botNameMap[row.bot_id] || row.bot_id,
          allocatedCapital: Number(
            row.allocated_capital
          ),
          pnl: Number(row.pnl),
          winRate: Number(row.win_rate),
          sharpeLike: Number(row.sharpe_like),
          totalTrades: tradeCounts[row.bot_id] || 0,
        }))
      : bots.map((b) => ({
          botId: b.id,
          botName: b.name,
          allocatedCapital: 100000,
          pnl: 0,
          winRate: 0,
          sharpeLike: 0,
          totalTrades: tradeCounts[b.id] || 0,
        }));

  return source.sort((a, b) => b.pnl - a.pnl);
}

export default function LeaderboardPage() {

  const [stats, setStats] =
    useState<BotStats[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [lastUpdated, setLastUpdated] =
    useState<Date | null>(null);

  async function refresh() {

    const data = await fetchLeaderboardData();

    setStats(data);

    setLastUpdated(new Date());

    setLoading(false);

  }

  useEffect(() => {

    refresh();

    const interval =
      setInterval(refresh, 30000);

    return () => clearInterval(interval);

  }, []);

  return (
    <div className="flex-1 p-8 bg-black min-h-screen text-white fade-in">

      {/* Header */}

      <div className="flex items-end justify-between mb-10">

        <div>

          <h1 className="text-5xl font-bold mb-3">
            Leaderboard
          </h1>

          <p className="text-zinc-500 text-lg">
            Live AI bot rankings by total PnL
          </p>

        </div>

        {lastUpdated && (
          <p className="text-zinc-600 text-sm">
            Refreshes every 30s · Last updated{" "}
            {lastUpdated.toLocaleTimeString()}
          </p>
        )}

      </div>

      {loading ? (

        <div className="flex items-center justify-center py-32">

          <div className="w-8 h-8 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />

        </div>

      ) : (

        <div className="space-y-4">

          {stats.map((bot, index) => {

            const rank =
              RANK_CONFIGS[index] ??
              RANK_CONFIGS[3];

            const pctReturn = (
              (bot.pnl / 100000) *
              100
            ).toFixed(2);

            const colorClass =
              BOT_COLORS[bot.botId] ||
              "text-white";

            return (
              <div
                key={bot.botId}
                className={`bg-zinc-900 border ${rank.border} ${rank.bg} rounded-3xl p-6 flex items-center gap-6`}
              >

                {/* Rank */}

                <div
                  className={`text-4xl font-black w-14 text-center shrink-0 ${rank.rankColor}`}
                >
                  {rank.label}
                </div>

                {/* Bot name */}

                <div className="flex-1 min-w-0">

                  <h2
                    className={`text-2xl font-bold ${colorClass}`}
                  >
                    {bot.botName}
                  </h2>

                  <p className="text-zinc-500 text-sm mt-1">
                    {bot.totalTrades} trades
                    &nbsp;·&nbsp;
                    Sharpe {bot.sharpeLike.toFixed(2)}
                  </p>

                </div>

                {/* Total PnL */}

                <div className="text-right shrink-0 min-w-[150px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    Total PnL
                  </p>

                  <h3
                    className={`text-3xl font-bold ${
                      bot.pnl >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {bot.pnl >= 0 ? "+" : ""}₹
                    {bot.pnl.toLocaleString("en-IN")}
                  </h3>

                </div>

                {/* % Return vs ₹1L */}

                <div className="text-right shrink-0 min-w-[110px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    Return (₹1L)
                  </p>

                  <h3
                    className={`text-2xl font-bold ${
                      Number(pctReturn) >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {Number(pctReturn) >= 0 ? "+" : ""}
                    {pctReturn}%
                  </h3>

                </div>

                {/* Win rate */}

                <div className="text-right shrink-0 min-w-[90px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    Win Rate
                  </p>

                  <h3 className="text-2xl font-bold">
                    {(bot.winRate * 100).toFixed(1)}%
                  </h3>

                </div>

                {/* Trades */}

                <div className="text-right shrink-0 min-w-[70px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    Trades
                  </p>

                  <h3 className="text-2xl font-bold">
                    {bot.totalTrades}
                  </h3>

                </div>

              </div>
            );

          })}

        </div>

      )}

    </div>
  );
}
