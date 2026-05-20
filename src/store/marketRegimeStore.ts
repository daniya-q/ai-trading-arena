import { create } from "zustand";

type MarketState = {
  regime: string;

  volatility: string;

  trendAlignment: string;

  momentum: string;

  strength: number;

  summary: string;

  setMarketState: (
    state: Partial<MarketState>
  ) => void;
};

export const useMarketRegimeStore =
  create<MarketState>(
    (set) => ({
      regime: "RANGING",

      volatility:
        "LOW",

      trendAlignment:
        "MISALIGNED",

      momentum:
        "NEUTRAL",

      strength: 50,

      summary:
        "Waiting for market data",

      setMarketState: (
        state
      ) =>
        set(state),
    })
  );