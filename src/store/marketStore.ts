import { create } from "zustand";

import { marketData } from "@/data/market";

type MarketStore = {
  market: typeof marketData;

  updateIndexPrice: (
    symbol: string,
    newPrice: number
  ) => void;
};

export const useMarketStore = create<MarketStore>(
  (set) => ({
    market: marketData,

    updateIndexPrice: (
      symbol,
      newPrice
    ) =>
      set((state) => ({
        market: {
          ...state.market,

          indices: state.market.indices.map(
            (index) =>
              index.symbol === symbol
                ? {
                    ...index,

                    price: newPrice,
                  }
                : index
          ),
        },
      })),
  })
);