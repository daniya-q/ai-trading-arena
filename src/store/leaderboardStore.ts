import { create } from "zustand";

export type BotStats = {
  bot: string;

  totalTrades: number;

  winRate: number;

  avgPnL: number;

  totalPnL: number;

  profitFactor: number;

  maxDrawdown: number;

  expectancy: number;

  sharpeLike: number;
};

type LeaderboardStore = {
  leaderboard: BotStats[];

  setLeaderboard: (
    leaderboard: BotStats[]
  ) => void;
};

export const useLeaderboardStore =
  create<LeaderboardStore>(
    (set) => ({
      leaderboard: [],

      setLeaderboard: (
        leaderboard
      ) =>
        set({
          leaderboard,
        }),
    })
  );