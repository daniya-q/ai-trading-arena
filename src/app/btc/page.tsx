"use client";

import { useEffect, useState } from "react";

import { useBtcStore } from "@/store/btcStore";

import { startBtcWebSocket } from "@/lib/btc/btcWebSocket";

import { supabase } from "@/lib/supabase/client";

import { bots } from "@/data/bots";

// ── Types ─────────────────────────────────────────────────────

type BotStats = {
  botId: string;
  botName: string;
  allocatedCapital: number;
  pnl: number;
  winRate: number;
  sharpeLike: number;
  totalTrades: number;
};

type BtcPosition = {
  id: string;
  botId: string;
  botName: string;
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt?: string;
};

// ── Constants ─────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────

function formatUSD(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ── Data fetchers ─────────────────────────────────────────────

async function fetchBotStats(): Promise<BotStats[]> {

  const [capitalRes, positionsRes] =
    await Promise.all([
      supabase
        .from("btc_capital")
        .select(
          "bot_id, allocated_capital, pnl, win_rate, sharpe_like"
        ),
      supabase
        .from("btc_positions")
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

async function fetchPositions(): Promise<BtcPosition[]> {

  const { data, error } = await supabase
    .from("btc_positions")
    .select("*")
    .order("opened_at", { ascending: false });

  if (error) {
    console.error(
      "[BTC] Positions fetch failed:",
      error.message
    );
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    botId: row.bot_id,
    botName: botNameMap[row.bot_id] || row.bot_id,
    symbol: row.symbol,
    side: row.side,
    quantity: Number(row.quantity),
    entryPrice: Number(row.entry_price),
    currentPrice: Number(row.current_price),
    pnl: Number(row.pnl),
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
  }));
}

// ── Component ─────────────────────────────────────────────────

export default function BtcArenaPage() {

  const { btcPrice, btcChange24h, btcHigh24h, btcLow24h, update24h } =
    useBtcStore();

  const [botStats, setBotStats] =
    useState<BotStats[]>([]);

  const [positions, setPositions] =
    useState<BtcPosition[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [lastUpdated, setLastUpdated] =
    useState<Date | null>(null);

  async function refresh() {

    const [stats, pos] = await Promise.all([
      fetchBotStats(),
      fetchPositions(),
    ]);

    setBotStats(stats);
    setPositions(pos);
    setLastUpdated(new Date());
    setLoading(false);

  }

  useEffect(() => {

    // Start Binance WebSocket for live BTC price
    startBtcWebSocket();

    // Fetch 24h ticker from Binance REST (public, no auth)
    fetch(
      "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"
    )
      .then((r) => r.json())
      .then((d) => {
        update24h(
          parseFloat(d.priceChangePercent ?? "0"),
          parseFloat(d.highPrice ?? "0"),
          parseFloat(d.lowPrice ?? "0")
        );
      })
      .catch(() => {
        // Non-critical — price stream still works
      });

    // Fetch Supabase data
    refresh();

    const interval = setInterval(refresh, 15000);

    return () => clearInterval(interval);

  }, []);

  const openPositions = positions.filter(
    (p) => p.status === "OPEN"
  );

  const closedTrades = positions.filter(
    (p) => p.status === "CLOSED"
  );

  return (
    <div className="flex-1 p-8 bg-black min-h-screen text-white fade-in">

      {/* Header */}

      <div className="flex items-end justify-between mb-8">

        <div>

          <h1 className="text-5xl font-bold mb-3">
            BTC Arena
          </h1>

          <p className="text-zinc-500 text-lg">
            Autonomous AI bots trading Bitcoin 24/7
          </p>

        </div>

        {lastUpdated && (
          <p className="text-zinc-600 text-sm">
            Refreshes every 15s · Last updated{" "}
            {lastUpdated.toLocaleTimeString()}
          </p>
        )}

      </div>

      {/* BTC Price Hero + 24h Stats */}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4">

        {/* Live price — spans 2 cols */}

        <div className="lg:col-span-2 bg-zinc-900 border border-orange-500/30 rounded-2xl p-6 flex flex-col justify-between">

          <p className="text-zinc-500 text-sm mb-2">
            BTC / USDT · Live
          </p>

          <div>

            <h2
              className={`text-5xl font-black tracking-tight ${
                btcPrice > 0
                  ? "text-orange-400"
                  : "text-zinc-600"
              }`}
            >
              {btcPrice > 0
                ? `$${formatUSD(btcPrice)}`
                : "Connecting..."}
            </h2>

            {btcChange24h !== 0 && (
              <p
                className={`text-lg font-semibold mt-2 ${
                  btcChange24h >= 0
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              >
                {btcChange24h >= 0 ? "+" : ""}
                {btcChange24h.toFixed(2)}% (24h)
              </p>
            )}

          </div>

        </div>

        {/* 24h High */}

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">

          <p className="text-zinc-500 text-sm mb-2">
            24h High
          </p>

          <h3 className="text-2xl font-bold text-green-400">
            {btcHigh24h > 0
              ? `$${formatUSD(btcHigh24h)}`
              : "--"}
          </h3>

        </div>

        {/* 24h Low */}

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">

          <p className="text-zinc-500 text-sm mb-2">
            24h Low
          </p>

          <h3 className="text-2xl font-bold text-red-400">
            {btcLow24h > 0
              ? `$${formatUSD(btcLow24h)}`
              : "--"}
          </h3>

        </div>

      </div>

      {/* Market Status — always open */}

      <div className="flex items-center gap-3 mb-10 px-1">

        <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold border bg-green-500/10 border-green-500/30 text-green-400">

          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />

          MARKET OPEN 24/7

        </span>

        <span className="text-zinc-600 text-sm">
          Bitcoin trades around the clock, every day
        </span>

      </div>

      {/* Bot Rankings */}

      <div className="mb-10">

        <h2 className="text-2xl font-bold mb-5">
          AI Bot Rankings
        </h2>

        {loading ? (

          <div className="flex items-center justify-center py-16">

            <div className="w-8 h-8 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin" />

          </div>

        ) : (

          <div className="space-y-4">

            {botStats.map((bot, index) => {

              const rank =
                RANK_CONFIGS[index] ??
                RANK_CONFIGS[3];

              const pctReturn = (
                (bot.pnl / 100000) *
                100
              ).toFixed(2);

              const colorClass =
                BOT_COLORS[bot.botId] || "text-white";

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

                    <h3
                      className={`text-2xl font-bold ${colorClass}`}
                    >
                      {bot.botName}
                    </h3>

                    <p className="text-zinc-500 text-sm mt-1">
                      {bot.totalTrades} BTC trades
                      &nbsp;·&nbsp;
                      Sharpe {bot.sharpeLike.toFixed(2)}
                    </p>

                  </div>

                  {/* Total PnL */}

                  <div className="text-right shrink-0 min-w-[150px]">

                    <p className="text-zinc-500 text-xs mb-1">
                      Total PnL
                    </p>

                    <h4
                      className={`text-3xl font-bold ${
                        bot.pnl >= 0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {bot.pnl >= 0 ? "+" : ""}$
                      {formatUSD(bot.pnl)}
                    </h4>

                  </div>

                  {/* % Return */}

                  <div className="text-right shrink-0 min-w-[110px]">

                    <p className="text-zinc-500 text-xs mb-1">
                      Return ($1K)
                    </p>

                    <h4
                      className={`text-2xl font-bold ${
                        Number(pctReturn) >= 0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {Number(pctReturn) >= 0 ? "+" : ""}
                      {pctReturn}%
                    </h4>

                  </div>

                  {/* Win Rate */}

                  <div className="text-right shrink-0 min-w-[90px]">

                    <p className="text-zinc-500 text-xs mb-1">
                      Win Rate
                    </p>

                    <h4 className="text-2xl font-bold">
                      {(bot.winRate * 100).toFixed(1)}%
                    </h4>

                  </div>

                  {/* Trades */}

                  <div className="text-right shrink-0 min-w-[70px]">

                    <p className="text-zinc-500 text-xs mb-1">
                      Trades
                    </p>

                    <h4 className="text-2xl font-bold">
                      {bot.totalTrades}
                    </h4>

                  </div>

                </div>
              );

            })}

          </div>

        )}

      </div>

      {/* Open BTC Positions */}

      <div className="mb-10">

        <h2 className="text-2xl font-bold mb-5">
          Open BTC Positions
          {openPositions.length > 0 && (
            <span className="ml-3 text-base font-normal text-zinc-500">
              {openPositions.length} active
            </span>
          )}
        </h2>

        {loading ? (

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex justify-center">

            <div className="w-7 h-7 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin" />

          </div>

        ) : openPositions.length === 0 ? (

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 text-center text-zinc-600">
            No open BTC positions
          </div>

        ) : (

          <div className="space-y-3">

            {openPositions.map((pos) => (

              <div
                key={pos.id}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex items-center gap-4 flex-wrap md:flex-nowrap"
              >

                <div className="w-28 shrink-0">

                  <span
                    className={`font-bold text-sm ${
                      BOT_COLORS[pos.botId] || "text-white"
                    }`}
                  >
                    {pos.botName}
                  </span>

                </div>

                <div className="flex-1 min-w-[80px]">

                  <span className="font-bold text-lg">
                    {pos.symbol}
                  </span>

                </div>

                <div className="shrink-0">

                  <span
                    className={`px-3 py-1 rounded-lg text-xs font-semibold border ${
                      pos.side === "BUY"
                        ? "bg-green-500/10 border-green-500/20 text-green-400"
                        : "bg-red-500/10 border-red-500/20 text-red-400"
                    }`}
                  >
                    {pos.side}
                  </span>

                </div>

                <div className="text-right shrink-0 min-w-[100px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    Entry
                  </p>

                  <p className="font-semibold text-sm">
                    ${formatUSD(pos.entryPrice)}
                  </p>

                </div>

                <div className="text-right shrink-0 min-w-[100px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    Current
                  </p>

                  <p className="font-semibold text-sm">
                    ${formatUSD(pos.currentPrice)}
                  </p>

                </div>

                <div className="text-right shrink-0 min-w-[100px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    Qty (BTC)
                  </p>

                  <p className="font-semibold text-sm">
                    {pos.quantity.toFixed(4)}
                  </p>

                </div>

                <div className="text-right shrink-0 min-w-[110px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    PnL
                  </p>

                  <p
                    className={`font-bold text-lg ${
                      pos.pnl >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {pos.pnl >= 0 ? "+" : ""}$
                    {formatUSD(pos.pnl)}
                  </p>

                </div>

                <div className="shrink-0">

                  <span className="px-3 py-1 rounded-lg text-xs font-semibold border bg-blue-500/10 border-blue-500/20 text-blue-400">
                    OPEN
                  </span>

                </div>

                <div className="text-right shrink-0 min-w-[120px]">

                  <p className="text-zinc-500 text-xs">
                    {formatTime(pos.openedAt)}
                  </p>

                </div>

              </div>

            ))}

          </div>

        )}

      </div>

      {/* Closed BTC Trades */}

      <div>

        <h2 className="text-2xl font-bold mb-5">
          Closed BTC Trades
          {closedTrades.length > 0 && (
            <span className="ml-3 text-base font-normal text-zinc-500">
              {closedTrades.length} total
            </span>
          )}
        </h2>

        {loading ? (

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex justify-center">

            <div className="w-7 h-7 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin" />

          </div>

        ) : closedTrades.length === 0 ? (

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 text-center text-zinc-600">
            No closed BTC trades yet
          </div>

        ) : (

          <div className="space-y-3">

            {closedTrades.map((trade) => (

              <div
                key={trade.id}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex items-center gap-4 flex-wrap md:flex-nowrap"
              >

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

                <div className="flex-1 min-w-[80px]">

                  <span className="font-bold text-lg">
                    {trade.symbol}
                  </span>

                </div>

                <div className="shrink-0">

                  <span
                    className={`px-3 py-1 rounded-lg text-xs font-semibold border ${
                      trade.side === "BUY"
                        ? "bg-green-500/10 border-green-500/20 text-green-400"
                        : "bg-red-500/10 border-red-500/20 text-red-400"
                    }`}
                  >
                    {trade.side}
                  </span>

                </div>

                <div className="text-right shrink-0 min-w-[100px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    Entry
                  </p>

                  <p className="font-semibold text-sm">
                    ${formatUSD(trade.entryPrice)}
                  </p>

                </div>

                <div className="text-right shrink-0 min-w-[100px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    Exit
                  </p>

                  <p className="font-semibold text-sm">
                    ${formatUSD(trade.currentPrice)}
                  </p>

                </div>

                <div className="text-right shrink-0 min-w-[100px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    Qty (BTC)
                  </p>

                  <p className="font-semibold text-sm">
                    {trade.quantity.toFixed(4)}
                  </p>

                </div>

                <div className="text-right shrink-0 min-w-[110px]">

                  <p className="text-zinc-500 text-xs mb-1">
                    PnL
                  </p>

                  <p
                    className={`font-bold text-lg ${
                      trade.pnl >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {trade.pnl >= 0 ? "+" : ""}$
                    {formatUSD(trade.pnl)}
                  </p>

                </div>

                <div className="shrink-0">

                  <span className="px-3 py-1 rounded-lg text-xs font-semibold border bg-zinc-800 border-zinc-700 text-zinc-400">
                    CLOSED
                  </span>

                </div>

                <div className="text-right shrink-0 min-w-[120px]">

                  <p className="text-zinc-500 text-xs">
                    {trade.closedAt
                      ? formatTime(trade.closedAt)
                      : formatTime(trade.openedAt)}
                  </p>

                </div>

              </div>

            ))}

          </div>

        )}

      </div>

    </div>
  );
}
