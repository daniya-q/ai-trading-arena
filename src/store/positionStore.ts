import { create } from "zustand";

export type Position = {
  id: number;

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
        totalOpenPositions:
          0,

        totalBuyExposure:
          0,

        totalSellExposure:
          0,

        netExposure: 0,
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
      ) =>
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

                      closedAt:
                        new Date().toISOString(),
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