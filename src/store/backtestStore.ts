import { create } from "zustand";

export type BacktestTrade = {
  bot: string;

  symbol: string;

  side: string;

  entry: number;

  exit: number;

  pnl: number;

  timestamp: string;
};

export type BacktestResult = {
  bot: string;

  totalPnL: number;

  winRate: number;

  trades: number;

  maxDrawdown: number;

  sharpeLike: number;
};

type BacktestStore = {
  trades: BacktestTrade[];

  results: BacktestResult[];

  running: boolean;

  setRunning: (
    running: boolean
  ) => void;

  addTrade: (
    trade: BacktestTrade
  ) => void;

  setResults: (
    results: BacktestResult[]
  ) => void;

  reset: () => void;
};

export const useBacktestStore =
  create<BacktestStore>(
    (set) => ({
      trades: [],

      results: [],

      running: false,

      setRunning: (
        running
      ) =>
        set({
          running,
        }),

      addTrade: (
        trade
      ) =>
        set((state) => ({
          trades: [
            trade,

            ...state.trades,
          ],
        })),

      setResults: (
        results
      ) =>
        set({
          results,
        }),

      reset: () =>
        set({
          trades: [],

          results: [],

          running: false,
        }),
    })
  );