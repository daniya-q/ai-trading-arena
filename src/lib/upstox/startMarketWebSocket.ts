import { useLiveMarketStore } from "@/store/liveMarketStore";

import { useMultiAssetStore } from "@/store/multiAssetStore";

import { processTick } from "@/lib/market/liveCandleBuilder";

import { updateOpenPositions } from "@/lib/trading/updateOpenPositions";

let socketStarted = false;

export function startMarketWebSocket() {

  if (socketStarted) {
    return;
  }

  socketStarted = true;

  console.log(
    "Simulated Market Feed Started"
  );

  /*
    Pure local streaming engine
  */

  setInterval(() => {

    const nifty =
      24500 +
      Math.random() * 300;

    const banknifty =
      54000 +
      Math.random() * 500;

    const sensex =
      80500 +
      Math.random() * 500;

    const finnifty =
      23500 +
      Math.random() * 250;

    /*
      Live market updates
    */

    useLiveMarketStore
      .getState()
      .updateMarket({
        nifty:
          Number(
            nifty.toFixed(2)
          ),

        banknifty:
          Number(
            banknifty.toFixed(
              2
            )
          ),

        sensex:
          Number(
            sensex.toFixed(
              2
            )
          ),
      });

    /*
      Multi asset engine
    */

    const multiAssetStore =
      useMultiAssetStore.getState();

    multiAssetStore.updateAsset(
      "NIFTY",

      {
        price:
          Number(
            nifty.toFixed(2)
          ),

        change:
          Number(
            (
              Math.random() *
                2 -
              1
            ).toFixed(2)
          ),

        volume:
          Math.floor(
            Math.random() *
              1000000
          ),

        trend:
          Math.random() >
          0.5
            ? "BULLISH"
            : "BEARISH",

        volatility:
          Math.random() >
          0.5
            ? "HIGH"
            : "LOW",
      }
    );

    multiAssetStore.updateAsset(
      "BANKNIFTY",

      {
        price:
          Number(
            banknifty.toFixed(
              2
            )
          ),

        change:
          Number(
            (
              Math.random() *
                2 -
              1
            ).toFixed(2)
          ),

        volume:
          Math.floor(
            Math.random() *
              1000000
          ),

        trend:
          Math.random() >
          0.5
            ? "BULLISH"
            : "BEARISH",

        volatility:
          Math.random() >
          0.5
            ? "HIGH"
            : "LOW",
      }
    );

    multiAssetStore.updateAsset(
      "SENSEX",

      {
        price:
          Number(
            sensex.toFixed(
              2
            )
          ),

        change:
          Number(
            (
              Math.random() *
                2 -
              1
            ).toFixed(2)
          ),

        volume:
          Math.floor(
            Math.random() *
              1000000
          ),

        trend:
          Math.random() >
          0.5
            ? "BULLISH"
            : "BEARISH",

        volatility:
          Math.random() >
          0.5
            ? "HIGH"
            : "LOW",
      }
    );

    multiAssetStore.updateAsset(
      "FINNIFTY",

      {
        price:
          Number(
            finnifty.toFixed(
              2
            )
          ),

        change:
          Number(
            (
              Math.random() *
                2 -
              1
            ).toFixed(2)
          ),

        volume:
          Math.floor(
            Math.random() *
              1000000
          ),

        trend:
          Math.random() >
          0.5
            ? "BULLISH"
            : "BEARISH",

        volatility:
          Math.random() >
          0.5
            ? "HIGH"
            : "LOW",
      }
    );

    /*
      Candle builder
    */

    processTick({
      price: nifty,

      timestamp:
        Date.now(),
    });

    /*
      Position tracking
    */

    updateOpenPositions(
      nifty
    );

    console.log(
      "Live Tick:",
      nifty
    );

  }, 1000);
}