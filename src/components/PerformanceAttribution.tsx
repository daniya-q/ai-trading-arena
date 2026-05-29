"use client";

import { usePerformanceStore } from "@/store/performanceStore";

export default function PerformanceAttribution() {
  const records =
    usePerformanceStore(
      (state) =>
        state.records
    );

  const totalPnL =
    records.reduce(
      (
        total,
        record
      ) =>
        total +
        record.pnl,
      0
    );

  const wins =
    records.filter(
      (record) =>
        record.win
    ).length;

  const winRate =
    records.length > 0
      ? (
          (wins /
            records.length) *
          100
        ).toFixed(1)
      : "0";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <h2 className="text-3xl font-bold mb-8 text-white">
        Performance Attribution Engine
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-2">
            Total PnL
          </p>

          <h3
            className={`text-4xl font-bold ${
              totalPnL >= 0
                ? "text-green-400"
                : "text-red-400"
            }`}
          >
            ₹
            {totalPnL.toFixed(
              2
            )}
          </h3>

        </div>

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-2">
            Win Rate
          </p>

          <h3 className="text-4xl font-bold text-blue-400">
            {winRate}%
          </h3>

        </div>

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-2">
            Closed Trades
          </p>

          <h3 className="text-4xl font-bold text-purple-400">
            {
              records.length
            }
          </h3>

        </div>

      </div>

      <div className="space-y-4 max-h-[700px] overflow-y-auto">

        {records.map(
          (
            record,
            index
          ) => (
            <div
              key={index}
              className="bg-black border border-zinc-800 rounded-2xl p-5"
            >

              <div className="flex items-center justify-between mb-4">

                <div>

                  <div className="flex items-center gap-3 mb-2">

                    <h3 className="text-2xl font-bold text-white">
                      {
                        record.bot
                      }
                    </h3>

                    <span className="px-3 py-1 rounded-lg text-sm bg-zinc-800 text-zinc-300">
                      {
                        record.symbol
                      }
                    </span>

                  </div>

                  <p className="text-zinc-300">
                    {
                      record.marketRegime
                    }{" "}
                    •{" "}
                    {
                      record.volatility
                    }{" "}
                    volatility
                  </p>

                </div>

                <div className="text-right">

                  <h4
                    className={`text-3xl font-bold ${
                      record.pnl >=
                      0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    ₹
                    {
                      record.pnl
                    }
                  </h4>

                </div>

              </div>

            </div>
          )
        )}

        {records.length ===
          0 && (
          <div className="text-center text-zinc-300 py-10">
            No performance data yet
          </div>
        )}

      </div>

    </div>
  );
}