import { create } from "zustand";

type BotCapital = {
  bot: string;

  allocatedCapital: number;

  peakCapital: number;

  pnl: number;

  winRate: number;

  sharpeLike: number;
};

type CapitalStore = {
  capitals: BotCapital[];

  initializeBots: (
    bots: string[]
  ) => void;

  updateBotCapital: (
    bot: string,

    updates: Partial<BotCapital>
  ) => void;

  rebalanceCapital: () => void;
};

export const useCapitalStore =
  create<CapitalStore>(
    (set, get) => ({
      capitals: [],

      initializeBots: (
        bots
      ) => {
        const existing =
          get().capitals;

        if (
          existing.length > 0
        ) {
          return;
        }

        const initialCapital =
          1000000;

        set({
          capitals:
            bots.map(
              (bot) => ({
                bot,

                allocatedCapital:
                  initialCapital,

                peakCapital:
                  initialCapital,

                pnl: 0,

                winRate: 0,

                sharpeLike: 0,
              })
            ),
        });
      },

      updateBotCapital: (
        bot,
        updates
      ) =>
        set((state) => ({
          capitals:
            state.capitals.map(
              (
                capital
              ) =>
                capital.bot ===
                bot
                  ? {
                      ...capital,

                      ...updates,

                      peakCapital:
                        Math.max(
                          capital.peakCapital,

                          updates.allocatedCapital ??
                            capital.allocatedCapital
                        ),
                    }
                  : capital
            ),
        })),

      rebalanceCapital:
        () => {
          const capitals =
            get().capitals;

          /*
            Total capital pool
          */

          const totalCapital =
            capitals.reduce(
              (
                sum,
                bot
              ) =>
                sum +
                bot.allocatedCapital,
              0
            );

          /*
            Score all bots
          */

          const scoredBots =
            capitals.map(
              (bot) => {
                const score =
                  bot.pnl *
                    0.5 +
                  bot.winRate *
                    1000 +
                  bot.sharpeLike *
                    5000;

                return {
                  ...bot,

                  score:
                    Math.max(
                      score,
                      1
                    ),
                };
              }
            );

          const totalScore =
            scoredBots.reduce(
              (
                sum,
                bot
              ) =>
                sum +
                bot.score,
              0
            );

          /*
            Reallocate capital
          */

          const rebalanced =
            scoredBots.map(
              (bot) => {
                const share =
                  bot.score /
                  totalScore;

                const newCapital =
                  totalCapital *
                  share;

                return {
                  ...bot,

                  allocatedCapital:
                    Number(
                      newCapital.toFixed(
                        2
                      )
                    ),
                };
              }
            );

          set({
            capitals:
              rebalanced.map(
                ({
                  score,
                  ...rest
                }) => rest
              ),
          });

          console.log(
            "Capital Rebalanced"
          );
        },
    })
  );