"use client";

import { bots } from "@/data/bots";

import { trades } from "@/data/trades";

import { calculateAdvancedStats } from "@/lib/analytics/calculateAdvancedStats";

export default function Leaderboard() {
  const leaderboard =
    bots.map((bot) => {
      const botTrades =
        trades.filter(
          (trade) =>
            trade.bot ===
            bot.name
        );

      const stats =
        calculateAdvancedStats(
          botTrades
        );

      return {
        bot: bot.name,

        ...stats,
      };
    });

  /*
    Sort by:
    Sharpe-like first,
    then pnl
  */

  leaderboard.sort(
    (a, b) => {
      if (
        b.sharpeLike !==
        a.sharpeLike
      ) {
        return (
          b.sharpeLike -
          a.sharpeLike
        );
      }

      return (
        b.totalPnL -
        a.totalPnL
      );
    }
  );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <h2 className="text-3xl font-bold mb-8 text-white">
        AI Performance Analytics
      </h2>

      <div className="space-y-5">

        {leaderboard.map(
          (
            bot,
            index
          ) => (
            <div
              key={bot.bot}
              className="bg-black border border-zinc-800 rounded-2xl p-6"
            >

              <div className="flex items-center justify-between mb-6">

                <div>

                  <div className="flex items-center gap-3 mb-2">

                    <span className="text-zinc-500 text-xl font-bold">
                      #
                      {index +
                        1}
                    </span>

                    <h3 className="text-3xl font-bold text-white">
                      {
                        bot.bot
                      }
                    </h3>

                  </div>

                  <p className="text-zinc-500">
                    Institutional AI Strategy Evaluation
                  </p>

                </div>

                <div className="text-right">

                  <p className="text-zinc-500 mb-2">
                    Total P&L
                  </p>

                  <h3
                    className={`text-4xl font-bold ${
                      bot.totalPnL >=
                      0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    ₹
                    {bot.totalPnL.toLocaleString(
                      "en-IN"
                    )}
                  </h3>

                </div>

              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-500 text-sm mb-2">
                    Trades
                  </p>

                  <h4 className="text-2xl font-bold text-white">
                    {
                      bot.totalTrades
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-500 text-sm mb-2">
                    Win Rate
                  </p>

                  <h4 className="text-2xl font-bold text-green-400">
                    {
                      bot.winRate
                    }
                    %
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-500 text-sm mb-2">
                    Avg P&L
                  </p>

                  <h4 className="text-2xl font-bold text-white">
                    ₹
                    {
                      bot.avgPnL
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-500 text-sm mb-2">
                    Profit Factor
                  </p>

                  <h4 className="text-2xl font-bold text-blue-400">
                    {
                      bot.profitFactor
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-500 text-sm mb-2">
                    Max DD
                  </p>

                  <h4 className="text-2xl font-bold text-red-400">
                    ₹
                    {
                      bot.maxDrawdown
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-500 text-sm mb-2">
                    Expectancy
                  </p>

                  <h4 className="text-2xl font-bold text-yellow-400">
                    {
                      bot.expectancy
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-500 text-sm mb-2">
                    Sharpe-Like
                  </p>

                  <h4 className="text-2xl font-bold text-purple-400">
                    {
                      bot.sharpeLike
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-500 text-sm mb-2">
                    Rating
                  </p>

                  <h4 className="text-2xl font-bold text-orange-400">

                    {bot.sharpeLike >
                    1.5
                      ? "ELITE"
                      : bot.sharpeLike >
                        1
                      ? "STRONG"
                      : bot.sharpeLike >
                        0.5
                      ? "GOOD"
                      : "WEAK"}

                  </h4>

                </div>

              </div>

            </div>
          )
        )}

      </div>

    </div>
  );
}