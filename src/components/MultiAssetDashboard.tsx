"use client";

import { useMultiAssetStore } from "@/store/multiAssetStore";

export default function MultiAssetDashboard() {
  const assets =
    useMultiAssetStore(
      (state) =>
        state.assets
    );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <h2 className="text-3xl font-bold mb-8 text-white">
        Multi-Asset Market Engine
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">

        {assets.map(
          (asset) => (
            <div
              key={
                asset.symbol
              }
              className="bg-black border border-zinc-800 rounded-2xl p-5"
            >

              <div className="flex items-center justify-between mb-5">

                <div>

                  <h3 className="text-2xl font-bold text-white mb-2">
                    {
                      asset.symbol
                    }
                  </h3>

                  <p className="text-zinc-300 text-sm">
                    Live Market
                  </p>

                </div>

                <div
                  className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                    asset.trend ===
                    "BULLISH"
                      ? "bg-green-500/10 text-green-400 border border-green-500/20"
                      : "bg-red-500/10 text-red-400 border border-red-500/20"
                  }`}
                >
                  {
                    asset.trend
                  }
                </div>

              </div>

              <div className="space-y-4">

                <div>

                  <p className="text-zinc-300 text-sm mb-1">
                    Price
                  </p>

                  <h4 className="text-3xl font-bold text-white">
                    ₹
                    {asset.price.toLocaleString(
                      "en-IN"
                    )}
                  </h4>

                </div>

                <div>

                  <p className="text-zinc-300 text-sm mb-1">
                    Daily Change
                  </p>

                  <h4
                    className={`text-2xl font-bold ${
                      asset.change >=
                      0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {
                      asset.change
                    }
                    %
                  </h4>

                </div>

                <div>

                  <p className="text-zinc-300 text-sm mb-1">
                    Volatility
                  </p>

                  <h4
                    className={`text-xl font-bold ${
                      asset.volatility ===
                      "HIGH"
                        ? "text-orange-400"
                        : "text-blue-400"
                    }`}
                  >
                    {
                      asset.volatility
                    }
                  </h4>

                </div>

                <div>

                  <p className="text-zinc-300 text-sm mb-1">
                    Volume
                  </p>

                  <h4 className="text-xl font-bold text-purple-400">
                    {asset.volume.toLocaleString(
                      "en-IN"
                    )}
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