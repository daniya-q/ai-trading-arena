"use client";

import { useExecutionStore } from "@/store/executionStore";

export default function ExecutionAnalytics() {
  const executions =
    useExecutionStore(
      (state) =>
        state.executions
    );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <h2 className="text-3xl font-bold mb-8 text-white">
        Execution Analytics Engine
      </h2>

      <div className="space-y-4 max-h-[700px] overflow-y-auto">

        {executions.map(
          (
            execution,
            index
          ) => (
            <div
              key={index}
              className="bg-black border border-zinc-800 rounded-2xl p-5"
            >

              <div className="flex items-center justify-between mb-5">

                <div>

                  <div className="flex items-center gap-3 mb-2">

                    <h3 className="text-2xl font-bold text-white">
                      {
                        execution.bot
                      }
                    </h3>

                    <span
                      className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                        execution.side ===
                        "BUY"
                          ? "bg-green-500/10 text-green-400 border border-green-500/20"
                          : "bg-red-500/10 text-red-400 border border-red-500/20"
                      }`}
                    >
                      {
                        execution.side
                      }
                    </span>

                  </div>

                  <p className="text-zinc-300">
                    {
                      execution.symbol
                    }
                  </p>

                </div>

                <div className="text-right">

                  <p className="text-zinc-300 text-sm">
                    Latency
                  </p>

                  <h4 className="text-2xl font-bold text-yellow-400">
                    {
                      execution.latency
                    }
                    ms
                  </h4>

                </div>

              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-300 text-sm mb-2">
                    Requested
                  </p>

                  <h4 className="text-xl font-bold text-white">
                    ₹
                    {
                      execution.requestedPrice
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-300 text-sm mb-2">
                    Executed
                  </p>

                  <h4 className="text-xl font-bold text-blue-400">
                    ₹
                    {
                      execution.executedPrice
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-300 text-sm mb-2">
                    Slippage
                  </p>

                  <h4 className="text-xl font-bold text-red-400">
                    ₹
                    {
                      execution.slippage
                    }
                  </h4>

                </div>

                <div className="bg-zinc-900 rounded-xl p-4">

                  <p className="text-zinc-300 text-sm mb-2">
                    Fees
                  </p>

                  <h4 className="text-xl font-bold text-orange-400">
                    ₹
                    {
                      execution.fees
                    }
                  </h4>

                </div>

              </div>

            </div>
          )
        )}

        {executions.length ===
          0 && (
          <div className="text-center text-zinc-300 py-10">
            No executions yet
          </div>
        )}

      </div>

    </div>
  );
}