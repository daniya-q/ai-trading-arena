import { create } from "zustand";

export type PerformanceRecord = {
  bot: string;

  symbol: string;

  pnl: number;

  win: boolean;

  marketRegime: string;

  volatility: string;

  timestamp: string;
};

type PerformanceStore = {
  records: PerformanceRecord[];

  addRecord: (
    record: PerformanceRecord
  ) => void;
};

export const usePerformanceStore =
  create<PerformanceStore>(
    (set) => ({
      records: [],

      addRecord: (
        record
      ) =>
        set((state) => ({
          records: [
            record,

            ...state.records,
          ].slice(0, 500),
        })),
    })
  );