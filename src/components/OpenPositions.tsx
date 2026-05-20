"use client";

import { usePositionStore } from "@/store/positionStore";

export default function OpenPositions() {
  const positions =
    usePositionStore(
      (state) =>
        state.positions
    );

  const openPositions =
    positions.filter(
      (position) =>
        position.status ===
        "OPEN"
    );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <h2 className="text-3xl font-bold mb-8 text-white">
        Live Open Positions
      </h2>

      <div className="space-y-4">

        {openPositions.map(
          (position) => (
            <div
              key={
                position.id
              }
              className="bg-black border border-zinc-800 rounded-2xl p-5 flex items-center justify-between"
            >

              <div>

                <div className="flex items-center gap-3 mb-3">

                  <h3 className="text-2xl font-bold text-white">
                    {
                      position.bot
                    }
                  </h3>

                  <span
                    className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                      position.side ===
                      "BUY"
                        ? "bg-green-500/10 text-green-400 border border-green-500/20"
                        : "bg-red-500/10 text-red-400 border border-red-500/20"
                    }`}
                  >
                    {
                      position.side
                    }
                  </span>

                </div>

                <p className="text-3xl font-bold text-white">
                  {
                    position.symbol
                  }
                </p>

                <div className="flex gap-5 mt-3 text-sm text-zinc-400">

                  <span>
                    Qty:{" "}
                    {
                      position.quantity
                    }
                  </span>

                  <span>
                    Entry: ₹
                    {
                      position.entryPrice
                    }
                  </span>

                  <span>
                    SL: ₹
                    {
                      position.stopLoss
                    }
                  </span>

                  <span>
                    TP: ₹
                    {
                      position.takeProfit
                    }
                  </span>

                </div>

              </div>

              <div className="text-right">

                <p className="text-zinc-500 mb-2">
                  Live P&L
                </p>

                <h3
                  className={`text-4xl font-bold ${
                    position.pnl >=
                    0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  ₹
                  {position.pnl.toFixed(
                    2
                  )}
                </h3>

                <p className="text-zinc-500 mt-2 text-sm">
                  OPEN
                </p>

              </div>

            </div>
          )
        )}

        {openPositions.length ===
          0 && (
          <div className="text-zinc-500 text-center py-10">
            No open positions
          </div>
        )}

      </div>

    </div>
  );
}