import { create } from "zustand";

type MarketState = {
  nifty: number;

  banknifty: number;

  sensex: number;

  updateMarket: (
    data: Partial<MarketState>
  ) => void;
};

export const useLiveMarketStore =
  create<MarketState>(
    (set) => ({
      nifty: 0,

      banknifty: 0,

      sensex: 0,

      updateMarket: (
        data
      ) =>
        set(data),
    })
  );