"use client";

import { usePositionStore } from "@/store/positionStore";

export default function PortfolioRisk() {
  const exposure =
    usePositionStore(
      (state) =>
        state.exposure
    );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <h2 className="text-3xl font-bold mb-8 text-white">
        Portfolio Risk Engine
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-3">
            Open Positions
          </p>

          <h3 className="text-4xl font-bold text-white">
            {
              exposure.totalOpenPositions
            }
          </h3>

        </div>

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-3">
            BUY Exposure
          </p>

          <h3 className="text-4xl font-bold text-green-400">
            ₹
            {exposure.totalBuyExposure.toLocaleString(
              "en-IN"
            )}
          </h3>

        </div>

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-3">
            SELL Exposure
          </p>

          <h3 className="text-4xl font-bold text-red-400">
            ₹
            {exposure.totalSellExposure.toLocaleString(
              "en-IN"
            )}
          </h3>

        </div>

        <div className="bg-black border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-3">
            Net Exposure
          </p>

          <h3
            className={`text-4xl font-bold ${
              exposure.netExposure >=
              0
                ? "text-green-400"
                : "text-red-400"
            }`}
          >
            ₹
            {exposure.netExposure.toLocaleString(
              "en-IN"
            )}
          </h3>

        </div>

      </div>

    </div>
  );
}