"use client";

import { bots } from "@/data/bots";

import { trades } from "@/data/trades";

import TradingChart from "@/components/charts/TradingChart";

import Leaderboard from "@/components/Leaderboard";

import OpenPositions from "@/components/OpenPositions";

import PortfolioRisk from "@/components/PortfolioRisk";

import CapitalAllocation from "@/components/CapitalAllocation";

import MultiAssetDashboard from "@/components/MultiAssetDashboard";

import { useMarketStore } from "@/store/marketStore";

import { useLiveMarketStore } from "@/store/liveMarketStore";

import { useCapitalStore } from "@/store/capitalStore";

import { useLeaderboardStore } from "@/store/leaderboardStore";

import { startLiveAITrading } from "@/lib/agents/liveTradingAgent";

import {
  startMarketWebSocket,
  startRestPolling,
} from "@/lib/upstox/startMarketWebSocket";

import { usePositionStore } from "@/store/positionStore";

import { useAIMemoryStore } from "@/store/aiMemoryStore";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

import {
  useEffect,
  useState,
} from "react";

export default function Home() {

  const {
    market,
    updateIndexPrice,
  } = useMarketStore();

  const {
    nifty,
    banknifty,
    sensex,
  } = useLiveMarketStore();

  const { capitals } =
    useCapitalStore();

  const { leaderboard } =
    useLeaderboardStore();

  const totalCapital =
    capitals.reduce(
      (sum, bot) =>
        sum + bot.allocatedCapital,
      0
    );

  const bestBot =
    [...leaderboard]
      .sort(
        (a, b) =>
          b.totalPnL - a.totalPnL
      )[0]?.bot || "--";

  const [equityData, setEquityData] =
    useState<
      { day: string; value: number }[]
    >([]);

  const [mounted, setMounted] =
    useState(false);

  useEffect(() => {

    setMounted(true);

    /*
      Load persistent state from Supabase before starting engines.
      Runs in parallel: capitals, open positions, AI memory for all bots.
    */

    Promise.all([
      useCapitalStore
        .getState()
        .initializeBots(
          bots.map((b) => b.id)
        ),
      usePositionStore
        .getState()
        .loadFromSupabase(),
      useAIMemoryStore
        .getState()
        .loadFromSupabase(),
    ]).then(() => {
      /*
        Start AI trading after stores are hydrated
      */

      startLiveAITrading();
    });

    /*
      WebSocket and REST polling start immediately —
      they don't depend on store hydration
    */

    startMarketWebSocket();

    startRestPolling();

    /*
      Simulated capital updates
    */

    const interval =
      setInterval(() => {

        const currentCapitals =
          useCapitalStore.getState().capitals;

        const currentTotal =
          currentCapitals.reduce(
            (sum, bot) =>
              sum + bot.allocatedCapital,
            0
          );

        if (currentTotal > 0) {
          setEquityData((prev) => [
            ...prev.slice(-29),
            {
              day: new Date().toLocaleTimeString(),
              value: currentTotal,
            },
          ]);
        }

        market.indices.forEach(
          (index) => {

            const randomMove =
              Math.random() *
                20 -
              10;

            updateIndexPrice(
              index.symbol,

              Number(
                (
                  index.price +
                  randomMove
                ).toFixed(2)
              )
            );
          }
        );

      }, 2000);

    return () =>
      clearInterval(interval);

  }, [
    market.indices,
    updateIndexPrice,
  ]);

  if (!mounted) {
    return null;
  }

  return (
    <div className="flex-1 p-8 bg-black min-h-screen text-white fade-in">

      {/* Market Banner */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-500 mb-2">
            NIFTY 50
          </p>

          <h2 className="text-3xl font-bold text-green-400">
            {nifty || "--"}
          </h2>

        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-500 mb-2">
            BANKNIFTY
          </p>

          <h2 className="text-3xl font-bold text-blue-400">
            {banknifty || "--"}
          </h2>

        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-500 mb-2">
            SENSEX
          </p>

          <h2 className="text-3xl font-bold text-yellow-400">
            {sensex || "--"}
          </h2>

        </div>

      </div>

      {/* Header */}

      <div className="mb-10">

        <h1 className="text-5xl font-bold mb-3 animate-pulse">
          AI Trading Arena
        </h1>

        <p className="text-zinc-500 text-lg">
          Autonomous competing AI hedge funds trading live Indian markets.
        </p>

      </div>

      {/* KPI Cards */}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-10">

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">

          <p className="text-zinc-500 mb-2">
            Combined Capital
          </p>

          <h2 className="text-4xl font-bold">
            ₹
            {totalCapital.toLocaleString(
              "en-US"
            )}
          </h2>

        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">

          <p className="text-zinc-500 mb-2">
            Active Bots
          </p>

          <h2 className="text-4xl font-bold">
            {bots.length}
          </h2>

        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">

          <p className="text-zinc-500 mb-2">
            Total Trades
          </p>

          <h2 className="text-4xl font-bold">
            {trades.length}
          </h2>

        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">

          <p className="text-zinc-500 mb-2">
            Best AI
          </p>

          <h2 className="text-4xl font-bold text-green-400">
            {bestBot}
          </h2>

        </div>

      </div>

      {/* Risk Engine */}

      <PortfolioRisk />

      {/* Multi Asset Engine */}

      <MultiAssetDashboard />

      {/* Capital Allocation */}

      <CapitalAllocation />

      {/* Trading Chart */}

      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

        <h2 className="text-3xl font-bold mb-8">
          Market Performance
        </h2>

        <TradingChart />

      </div>

      {/* Open Positions */}

      <OpenPositions />

      {/* Leaderboard */}

      <Leaderboard />

      {/* Equity Curve */}

      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

        <h2 className="text-3xl font-bold mb-8">
          Portfolio Equity Curve
        </h2>

        <div className="h-[300px]">

          <ResponsiveContainer
            width="100%"
            height="100%"
          >

            <LineChart
              data={equityData}
            >

              <XAxis
                dataKey="day"
                stroke="#71717a"
              />

              <YAxis
                stroke="#71717a"
              />

              <Tooltip />

              <Line
                type="monotone"
                dataKey="value"
                stroke="#22c55e"
                strokeWidth={3}
                dot={false}
              />

            </LineChart>

          </ResponsiveContainer>

        </div>

      </div>

      {/* Closed Trades */}

      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">

        <h2 className="text-3xl font-bold mb-8">
          Closed Trades
        </h2>

        <div className="space-y-4">

          {trades
            .slice(0, 10)
            .map((trade) => (

              <div
                key={trade.id}
                className="bg-black border border-zinc-800 rounded-2xl p-5 flex items-center justify-between"
              >

                <div>

                  <div className="flex gap-3 items-center mb-3">

                    <h3 className="text-xl font-semibold">
                      {trade.bot}
                    </h3>

                    <span
                      className={`px-2 py-1 rounded-lg text-sm ${
                        trade.side ===
                        "BUY"
                          ? "bg-green-500/10 border border-green-500/20 text-green-400"
                          : "bg-red-500/10 border border-red-500/20 text-red-400"
                      }`}
                    >

                      {trade.side}

                    </span>

                  </div>

                  <p className="text-2xl font-bold">
                    {trade.symbol}
                  </p>

                </div>

                <div className="text-right">

                  <p className="text-zinc-500 mb-2">
                    P&L
                  </p>

                  <h3
                    className={`text-3xl font-bold ${
                      trade.pnl >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    ₹
                    {trade.pnl}
                  </h3>

                </div>

              </div>

            ))}

        </div>

      </div>

    </div>
  );
}