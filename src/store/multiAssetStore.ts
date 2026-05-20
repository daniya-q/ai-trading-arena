import { create } from "zustand";

export type AssetData = {
  symbol: string;

  price: number;

  change: number;

  volume: number;

  trend: string;

  volatility: string;
};

type MultiAssetStore = {
  assets: AssetData[];

  updateAsset: (
    symbol: string,

    updates: Partial<AssetData>
  ) => void;
};

const initialAssets: AssetData[] =
  [
    {
      symbol: "NIFTY",

      price: 24500,

      change: 0,

      volume: 0,

      trend: "NEUTRAL",

      volatility: "LOW",
    },

    {
      symbol:
        "BANKNIFTY",

      price: 54000,

      change: 0,

      volume: 0,

      trend: "NEUTRAL",

      volatility: "LOW",
    },

    {
      symbol: "SENSEX",

      price: 80500,

      change: 0,

      volume: 0,

      trend: "NEUTRAL",

      volatility: "LOW",
    },

    {
      symbol: "FINNIFTY",

      price: 23500,

      change: 0,

      volume: 0,

      trend: "NEUTRAL",

      volatility: "LOW",
    },
  ];

export const useMultiAssetStore =
  create<MultiAssetStore>(
    (set) => ({
      assets:
        initialAssets,

      updateAsset: (
        symbol,
        updates
      ) =>
        set((state) => ({
          assets:
            state.assets.map(
              (asset) =>
                asset.symbol ===
                symbol
                  ? {
                      ...asset,

                      ...updates,
                    }
                  : asset
            ),
        })),
    })
  );