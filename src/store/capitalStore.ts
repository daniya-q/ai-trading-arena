import { create } from "zustand";
import { supabase } from "@/lib/supabase/client";

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
  ) => Promise<void>;

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

      initializeBots: async (
        bots
      ) => {
        if (get().capitals.length > 0) {
          return;
        }

        // Load from Supabase
        const { data, error } =
          await supabase
            .from("capital")
            .select("*");

        if (!error && data && data.length > 0) {
          set({
            capitals: data.map(
              (row) => ({
                bot: row.bot_id,
                allocatedCapital:
                  Number(row.allocated_capital),
                peakCapital:
                  Number(row.peak_capital),
                pnl: Number(row.pnl),
                winRate: Number(row.win_rate),
                sharpeLike:
                  Number(row.sharpe_like),
              })
            ),
          });
          return;
        }

        // Fallback to defaults if Supabase unavailable
        if (error) {
          console.warn(
            "[Capital] Supabase load failed, using defaults:",
            error.message
          );
        }

        const initialCapital = 100000;

        set({
          capitals: bots.map(
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
      ) => {
        set((state) => ({
          capitals:
            state.capitals.map(
              (capital) =>
                capital.bot === bot
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
        }));

        // Persist to Supabase (fire-and-forget)
        const updated = get().capitals.find(
          (c) => c.bot === bot
        );
        if (updated) {
          supabase
            .from("capital")
            .update({
              allocated_capital:
                updated.allocatedCapital,
              peak_capital: updated.peakCapital,
              pnl: updated.pnl,
              win_rate: updated.winRate,
              sharpe_like: updated.sharpeLike,
              updated_at: new Date().toISOString(),
            })
            .eq("bot_id", bot)
            .then(({ error }) => {
              if (error) {
                console.error(
                  "[Capital] Supabase update failed:",
                  error.message
                );
              }
            });
        }
      },

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
