import { supabase } from "@/lib/supabase/client";
import type { BotStats } from "@/store/leaderboardStore";

/**
 * Syncs leaderboard stats to the Supabase capital table.
 * Updates pnl, win_rate, and sharpe_like for each bot.
 * Called after leaderboard recalculation.
 */
export async function syncLeaderboard(
  stats: BotStats[]
): Promise<void> {
  await Promise.all(
    stats.map(async (s) => {
      const { error } = await supabase
        .from("capital")
        .update({
          pnl: s.totalPnL,
          win_rate: s.winRate,
          sharpe_like: s.sharpeLike,
          updated_at: new Date().toISOString(),
        })
        .eq("bot_id", s.bot);

      if (error) {
        console.error(
          `[Leaderboard] Supabase sync failed for ${s.bot}:`,
          error.message
        );
      }
    })
  );
}
