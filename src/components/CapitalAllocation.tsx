"use client";

import { useCapitalStore } from "@/store/capitalStore";

export default function CapitalAllocation() {
  const capitals =
    useCapitalStore(
      (state) =>
        state.capitals
    );

  const sorted =
    [...capitals].sort(
      (a, b) =>
        b.allocatedCapital -
        a.allocatedCapital
    );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <h2 className="text-3xl font-bold mb-8 text-white">
        AI Capital Allocation Engine
      </h2>

      <div className="space-y-5">

        {sorted.map(
          (
            capital,
            index
          ) => {
            const growth =
              ((capital.allocatedCapital -
                1000000) /
                1000000) *
              100;

            return (
              <div
                key={
                  capital.bot
                }
                className="bg-black border border-zinc-800 rounded-2xl p-6"
              >

                <div className="flex items-center justify-between mb-5">

                  <div>

                    <div className="flex items-center gap-3 mb-2">

                      <span className="text-zinc-500 text-xl font-bold">
                        #
                        {index +
                          1}
                      </span>

                      <h3 className="text-3xl font-bold text-white">
                        {
                          capital.bot
                        }
                      </h3>

                    </div>

                    <p className="text-zinc-500">
                      Dynamic Institutional Capital Allocation
                    </p>

                  </div>

                  <div className="text-right">

                    <p className="text-zinc-500 mb-2">
                      Allocated Capital
                    </p>

                    <h3 className="text-4xl font-bold text-green-400">
                      ₹
                      {capital.allocatedCapital.toLocaleString(
                        "en-IN"
                      )}
                    </h3>

                  </div>

                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

                  <div className="bg-zinc-900 rounded-xl p-4">

                    <p className="text-zinc-500 text-sm mb-2">
                      P&L
                    </p>

                    <h4
                      className={`text-2xl font-bold ${
                        capital.pnl >=
                        0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      ₹
                      {capital.pnl.toLocaleString(
                        "en-IN"
                      )}
                    </h4>

                  </div>

                  <div className="bg-zinc-900 rounded-xl p-4">

                    <p className="text-zinc-500 text-sm mb-2">
                      Win Rate
                    </p>

                    <h4 className="text-2xl font-bold text-blue-400">
                      {
                        capital.winRate
                      }
                      %
                    </h4>

                  </div>

                  <div className="bg-zinc-900 rounded-xl p-4">

                    <p className="text-zinc-500 text-sm mb-2">
                      Sharpe-Like
                    </p>

                    <h4 className="text-2xl font-bold text-purple-400">
                      {
                        capital.sharpeLike
                      }
                    </h4>

                  </div>

                  <div className="bg-zinc-900 rounded-xl p-4">

                    <p className="text-zinc-500 text-sm mb-2">
                      Capital Growth
                    </p>

                    <h4
                      className={`text-2xl font-bold ${
                        growth >= 0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {growth.toFixed(
                        2
                      )}
                      %
                    </h4>

                  </div>

                </div>

              </div>
            );
          }
        )}

      </div>

    </div>
  );
}