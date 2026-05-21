import { create } from "zustand";
import { supabase } from "@/lib/supabase/client";

export type Position = {
  id: number;

  /** UUID from Supabase — set async after insert */
  supabaseId?: string;

  bot: string;

  symbol: string;

  side: string;

  quantity: number;

  entryPrice: number;

  currentPrice: number;

  stopLoss: number;

  takeProfit: number;

  pnl: number;

  status: "OPEN" | "CLOSED";

  openedAt: string;

  closedAt?: string;

  // ── Options metadata (set when position is an option) ──────
  optionType?: "CE" | "PE";

  strike?: number;

  expiryDate?: string; // YYYY-MM-DD

  /** Implied volatility as a percentage, e.g. 18 for 18% */
  iv?: number;

  // ── Enriched by enrichPosition (updated each price tick) ───
  dte?: number;

  theta?: number;

  itmStatus?: "ITM" | "ATM" | "OTM";

  thetaPaid?: number;

  isExpiringSoon?: boolean;
};

type Exposure = {
  totalOpenPositions: number;

  totalBuyExposure: number;

  totalSellExposure: number;

  netExposure: number;
};

type PositionStore = {
  positions: Position[];

  exposure: Exposure;

  loadFromSupabase: () => Promise<void>;

  addPosition: (
    position: Position
  ) => boolean;

  updatePosition: (
    id: number,

    updates: Partial<Position>
  ) => void;

  closePosition: (
    id: number
  ) => void;

  recomputeExposure: () => void;
};

function calculateExposure(
  positions: Position[]
): Exposure {
  const openPositions =
    positions.filter(
      (position) =>
        position.status ===
        "OPEN"
    );

  let totalBuyExposure = 0;

  let totalSellExposure = 0;

  openPositions.forEach(
    (position) => {
      const exposure =
        position.currentPrice *
        position.quantity;

      if (
        position.side ===
        "BUY"
      ) {
        totalBuyExposure +=
          exposure;
      } else {
        totalSellExposure +=
          exposure;
      }
    }
  );

  return {
    totalOpenPositions:
      openPositions.length,

    totalBuyExposure:
      Number(
        totalBuyExposure.toFixed(
          2
        )
      ),

    totalSellExposure:
      Number(
        totalSellExposure.toFixed(
          2
        )
      ),

    netExposure:
      Number(
        (
          totalBuyExposure -
          totalSellExposure
        ).toFixed(2)
      ),
  };
}

export const usePositionStore =
  create<PositionStore>(
    (set, get) => ({
      positions: [],

      exposure: {
        totalOpenPositions: 0,

        totalBuyExposure: 0,

        totalSellExposure: 0,

        netExposure: 0,
      },

      loadFromSupabase: async () => {
        const { data, error } =
          await supabase
            .from("positions")
            .select("*")
            .eq("status", "OPEN");

        if (error) {
          console.error(
            "[Position] Supabase load failed:",
            error.message
          );
          return;
        }

        if (!data || data.length === 0) return;

        const positions: Position[] = data.map(
          (row, index) => ({
            id: Date.now() + index,
            supabaseId: row.id,
            bot: row.bot_id,
            symbol: row.symbol,
            side: row.side,
            quantity: Number(row.quantity),
            entryPrice: Number(row.entry_price),
            currentPrice: Number(row.current_price),
            stopLoss: Number(row.stop_loss),
            takeProfit: Number(row.take_profit),
            pnl: Number(row.pnl),
            status: row.status as "OPEN" | "CLOSED",
            openedAt: row.opened_at,
            closedAt: row.closed_at ?? undefined,
          })
        );

        set({
          positions,
          exposure: calculateExposure(positions),
        });
      },

      addPosition: (
        position
      ) => {
        const currentExposure =
          get().exposure;

        /*
          Max open positions
        */

        if (
          currentExposure.totalOpenPositions >=
          12
        ) {
          console.log(
            "Exposure Blocked: Max positions reached"
          );

          return false;
        }

        /*
          Directional exposure
        */

        const positionExposure =
          position.entryPrice *
          position.quantity;

        if (
          position.side ===
            "BUY" &&
          currentExposure.totalBuyExposure +
            positionExposure >
            3000000
        ) {
          console.log(
            "Exposure Blocked: BUY exposure limit reached"
          );

          return false;
        }

        if (
          position.side ===
            "SELL" &&
          currentExposure.totalSellExposure +
            positionExposure >
            3000000
        ) {
          console.log(
            "Exposure Blocked: SELL exposure limit reached"
          );

          return false;
        }

        /*
          Add position
        */

        set((state) => {
          const updatedPositions: Position[] =
            [
              position,

              ...state.positions,
            ];

          return {
            positions:
              updatedPositions,

            exposure:
              calculateExposure(
                updatedPositions
              ),
          };
        });

        // Insert to Supabase and store UUID (fire-and-forget)
        supabase
          .from("positions")
          .insert({
            bot_id: position.bot,
            symbol: position.symbol,
            side: position.side,
            quantity: position.quantity,
            entry_price: position.entryPrice,
            current_price: position.currentPrice,
            stop_loss: position.stopLoss,
            take_profit: position.takeProfit,
            pnl: position.pnl,
            status: position.status,
            opened_at: position.openedAt,
          })
          .select("id")
          .single()
          .then(({ data, error }) => {
            if (error) {
              console.error(
                "[Position] Supabase insert failed:",
                error.message
              );
              return;
            }
            if (data?.id) {
              set((state) => ({
                positions: state.positions.map(
                  (p) =>
                    p.id === position.id
                      ? { ...p, supabaseId: data.id }
                      : p
                ),
              }));
            }
          });

        return true;
      },

      updatePosition: (
        id,
        updates
      ) =>
        set((state) => {
          const updatedPositions: Position[] =
            state.positions.map(
              (position) =>
                position.id ===
                id
                  ? {
                      ...position,

                      ...updates,
                    }
                  : position
            );

          return {
            positions:
              updatedPositions,

            exposure:
              calculateExposure(
                updatedPositions
              ),
          };
        }),

      closePosition: (
        id
      ) => {
        const pos = get().positions.find(
          (p) => p.id === id
        );
        const closedAt = new Date().toISOString();

        set((state) => {
          const updatedPositions: Position[] =
            state.positions.map(
              (position) =>
                position.id ===
                id
                  ? {
                      ...position,

                      status:
                        "CLOSED" as const,

                      closedAt,
                    }
                  : position
            );

          return {
            positions:
              updatedPositions,

            exposure:
              calculateExposure(
                updatedPositions
              ),
          };
        });

        // Persist close to Supabase
        if (pos?.supabaseId) {
          const closedPos = get().positions.find(
            (p) => p.id === id
          );
          supabase
            .from("positions")
            .update({
              status: "CLOSED",
              closed_at: closedAt,
              pnl: closedPos?.pnl ?? pos.pnl,
              current_price:
                closedPos?.currentPrice ??
                pos.currentPrice,
            })
            .eq("id", pos.supabaseId)
            .then(({ error }) => {
              if (error) {
                console.error(
                  "[Position] Supabase close failed:",
                  error.message
                );
              }
            });
        }
      },

      recomputeExposure:
        () => {
          const positions =
            get().positions;

          set({
            exposure:
              calculateExposure(
                positions
              ),
          });
        },
    })
  );
