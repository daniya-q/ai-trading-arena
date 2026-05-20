import { usePositionStore } from "@/store/positionStore";

import { useAIMemoryStore } from "@/store/aiMemoryStore";

import { usePerformanceStore } from "@/store/performanceStore";

import { useMultiAssetStore } from "@/store/multiAssetStore";

import { trades } from "@/data/trades";

export function updateOpenPositions(
  latestPrice: number
) {
  const {
    positions,

    updatePosition,

    closePosition,
  } =
    usePositionStore.getState();

  positions.forEach(
    (position) => {
      if (
        position.status ===
        "CLOSED"
      ) {
        return;
      }

      let pnl = 0;

      if (
        position.side ===
        "BUY"
      ) {
        pnl =
          (latestPrice -
            position.entryPrice) *
          position.quantity;
      } else {
        pnl =
          (position.entryPrice -
            latestPrice) *
          position.quantity;
      }

      let updatedStopLoss =
        position.stopLoss;

      /*
        BUY trailing
      */

      if (
        position.side ===
        "BUY"
      ) {
        const move =
          latestPrice -
          position.entryPrice;

        if (move > 80) {
          updatedStopLoss =
            Math.max(
              position.stopLoss,

              latestPrice -
                40
            );
        }

        if (move > 150) {
          updatedStopLoss =
            Math.max(
              updatedStopLoss,

              latestPrice -
                25
            );
        }
      }

      /*
        SELL trailing
      */

      if (
        position.side ===
        "SELL"
      ) {
        const move =
          position.entryPrice -
          latestPrice;

        if (move > 80) {
          updatedStopLoss =
            Math.min(
              position.stopLoss,

              latestPrice +
                40
            );
        }

        if (move > 150) {
          updatedStopLoss =
            Math.min(
              updatedStopLoss,

              latestPrice +
                25
            );
        }
      }

      updatePosition(
        position.id,

        {
          currentPrice:
            latestPrice,

          pnl: Number(
            pnl.toFixed(2)
          ),

          stopLoss:
            Number(
              updatedStopLoss.toFixed(
                2
              )
            ),
        }
      );

      const stopLossHit =
        position.side ===
        "BUY"
          ? latestPrice <=
            updatedStopLoss
          : latestPrice >=
            updatedStopLoss;

      const takeProfitHit =
        position.side ===
        "BUY"
          ? latestPrice >=
            position.takeProfit
          : latestPrice <=
            position.takeProfit;

      if (
        stopLossHit ||
        takeProfitHit
      ) {
        closePosition(
          position.id
        );

        trades.unshift({
          id: Date.now(),

          bot:
            position.bot,

          symbol:
            position.symbol,

          side:
            position.side,

          quantity:
            position.quantity,

          entryPrice:
            position.entryPrice,

          currentPrice:
            latestPrice,

          pnl: Number(
            pnl.toFixed(2)
          ),

          status:
            "CLOSED",

          timestamp:
            new Date().toISOString(),
        });

        /*
          Performance attribution
        */

        const asset =
          useMultiAssetStore
            .getState()
            .assets.find(
              (asset) =>
                asset.symbol ===
                position.symbol
            );

        usePerformanceStore
          .getState()
          .addRecord({
            bot:
              position.bot,

            symbol:
              position.symbol,

            pnl: Number(
              pnl.toFixed(2)
            ),

            win: pnl > 0,

            marketRegime:
              asset?.trend ||
              "UNKNOWN",

            volatility:
              asset?.volatility ||
              "UNKNOWN",

            timestamp:
              new Date().toISOString(),
          });

        /*
          AI learning
        */

        const memoryStore =
          useAIMemoryStore.getState();

        const existingMemory =
          memoryStore.memories[
            position.bot
          ];

        const lessons =
          existingMemory
            ?.lessons || [];

        let lesson =
          "";

        if (pnl > 0) {
          lesson = `
Profitable ${position.side} trade on ${position.symbol}.
Trend alignment and execution quality were effective.
Continue adapting position sizing dynamically.
`;
        } else {
          lesson = `
Loss detected on ${position.symbol}.
Avoid overconfidence during unstable volatility.
Improve timing around reversals and momentum exhaustion.
`;
        }

        let updatedConfidence =
          existingMemory
            ?.confidenceScore ||
          50;

        if (pnl > 0) {
          updatedConfidence =
            Math.min(
              100,

              updatedConfidence +
                3
            );
        } else {
          updatedConfidence =
            Math.max(
              10,

              updatedConfidence -
                5
            );
        }

        memoryStore.updateMemory(
          position.bot,

          {
            lessons: [
              lesson,

              ...lessons,
            ].slice(0, 20),

            confidenceScore:
              updatedConfidence,
          }
        );

        console.log(
          `Position Closed: ${position.bot}`
        );

        console.log(
          `Performance Attribution Updated`
        );
      }
    }
  );
}