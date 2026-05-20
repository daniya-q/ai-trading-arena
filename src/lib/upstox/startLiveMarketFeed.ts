import { useLiveMarketStore } from "@/store/liveMarketStore";

import {
  useCandleStore,
} from "@/store/candleStore";

let intervalStarted = false;

export function startLiveMarketFeed() {
  if (intervalStarted) {
    return;
  }

  intervalStarted = true;

  async function fetchMarket() {
    try {
      const response =
        await fetch(
          "/api/upstox/market"
        );

      const data =
        await response.json();

      const nifty =
        data?.data?.[
          "NSE_INDEX:Nifty 50"
        ];

      const banknifty =
        data?.data?.[
          "NSE_INDEX:Nifty Bank"
        ];

      const sensex =
        data?.data?.[
          "BSE_INDEX:SENSEX"
        ];

      /*
        Update live market store
      */

      useLiveMarketStore
        .getState()
        .updateMarket({
          nifty:
            nifty?.last_price ||
            0,

          banknifty:
            banknifty?.last_price ||
            0,

          sensex:
            sensex?.last_price ||
            0,
        });

      /*
        Create realtime candles
      */

      const now =
        Date.now();

      if (nifty) {
        useCandleStore
          .getState()
          .addNiftyCandle({
            time: now,

            open:
              nifty.ohlc.open,

            high:
              nifty.ohlc.high,

            low:
              nifty.ohlc.low,

            close:
              nifty.last_price,
          });
      }

      if (banknifty) {
        useCandleStore
          .getState()
          .addBankniftyCandle({
            time: now,

            open:
              banknifty.ohlc
                .open,

            high:
              banknifty.ohlc
                .high,

            low:
              banknifty.ohlc
                .low,

            close:
              banknifty.last_price,
          });
      }

      if (sensex) {
        useCandleStore
          .getState()
          .addSensexCandle({
            time: now,

            open:
              sensex.ohlc.open,

            high:
              sensex.ohlc.high,

            low:
              sensex.ohlc.low,

            close:
              sensex.last_price,
          });
      }

      console.log(
        "Realtime candles updated"
      );

    } catch (error) {
      console.error(
        "Live Feed Error:",
        error
      );
    }
  }

  /*
    Initial fetch
  */

  fetchMarket();

  /*
    Poll every 5 seconds
  */

  setInterval(() => {
    fetchMarket();
  }, 5000);
}