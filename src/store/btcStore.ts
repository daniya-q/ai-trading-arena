import { create } from "zustand";

type BtcStore = {
  btcPrice: number;
  btcChange24h: number;
  btcHigh24h: number;
  btcLow24h: number;
  lastUpdated: number;

  updateBtcPrice: (price: number) => void;

  update24h: (
    change: number,
    high: number,
    low: number
  ) => void;
};

export const useBtcStore =
  create<BtcStore>((set) => ({
    btcPrice: 0,
    btcChange24h: 0,
    btcHigh24h: 0,
    btcLow24h: 0,
    lastUpdated: 0,

    updateBtcPrice: (price) =>
      set({
        btcPrice: price,
        lastUpdated: Date.now(),
      }),

    update24h: (change, high, low) =>
      set({
        btcChange24h: change,
        btcHigh24h: high,
        btcLow24h: low,
      }),
  }));
