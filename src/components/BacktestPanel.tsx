"use client";

import { useBacktestStore } from "@/store/backtestStore";

import { runBacktest } from "@/lib/backtest/runBacktest";

export default function BacktestPanel() {

  const {
    results,
    running,
    trades,
  } =
    useBacktestStore();

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <div className="flex items-center justify-between mb-8">

        <div>

          <h2 className="text-3xl font-bold text-white mb-2">
            Historical Backtesting Engine
          </h2>

          <p className="text-zinc-300">
            Institutional-grade AI strategy validation
          </p>

        </div>

        <button
          onClick={() =>
            runBacktest()
          }
          disabled={running}
          className="bg-blue-600 hover:bg-blue-500 transition-all px-6 py-3 rounded-2xl font-semibold text-white disabled:opacity-50"
        >

          {running
            ? "Running Backtest..."
            : "Run Backtest"}

        </button>

      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-2">
            Simulated Trades
          </p>

          <h3 className="text-4xl font-bold text-blue-400">
            {
              trades.length
            }
          </h3>

        </div>

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-2">
            AI Agents
          </p>

          <h3 className="text-4xl font-bold text-purple-400">
            {
              results.length
            }
          </h3>

        </div>

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-2">
            Engine Status
          </p>

          <h3
            className={`text-3xl font-bold ${
              running
                ? "text-yellow-400"
                : "text-green-400"
            }`}
          >
            {running
              ? "RUNNING"
              : "READY"}
          </h3>

        </div>

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-2">
            Historical Dataset
          </p>

          <h3 className="text-3xl font-bold text-orange-400">
            300 Candles
          </h3>

        </div>

      </div>

      <div className="space-y-4">

        {results.map(
          (
            result,
            index
          ) => (
            <div
              key={index}
              className="bg-black border border-zinc-800 rounded-2xl p-5"
            >

              <div className="flex items-center justify-between mb-5">

                <div>

                  <h3 className="text-2xl font-bold text-white mb-2">
                    {
                      result.bot
                    }
                  </h3>

                  <p className="text-zinc-300">
                    AI Backtest Analytics
                  </p>

                </div>

                <div>

                  <h3
                    className={`text-4xl font-bold ${
                      result.totalPnL >=
                      0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    ₹
                    {
                      result.totalPnL
                    }
                  </h3>

                </div>

              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-300 text-sm mb-2">
                    Win Rate
                  </p>

                  <h4 className="text-2xl font-bold text-blue-400">
                    {
                      result.winRate
                    }
                    %
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-300 text-sm mb-2">
                    Trades
                  </p>

                  <h4 className="text-2xl font-bold text-purple-400">
                    {
                      result.trades
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-300 text-sm mb-2">
                    Max Drawdown
                  </p>

                  <h4 className="text-2xl font-bold text-red-400">
                    ₹
                    {
                      result.maxDrawdown
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-300 text-sm mb-2">
                    Sharpe-like
                  </p>

                  <h4 className="text-2xl font-bold text-yellow-400">
                    {
                      result.sharpeLike
                    }
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