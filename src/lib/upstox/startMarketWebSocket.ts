import protobuf from "protobufjs";

import { useLiveMarketStore } from "@/store/liveMarketStore";

import { useMultiAssetStore } from "@/store/multiAssetStore";

import { processTick } from "@/lib/market/liveCandleBuilder";

import { updateOpenPositions } from "@/lib/trading/updateOpenPositions";

/*
  Upstox v3 MarketDataFeed proto schema (inline)
*/

const PROTO_DEF = `
syntax = "proto3";
package com.upstox.marketdatafeederv3udapi.rpc.proto;

message LTPC {
  double ltp = 1;
  int64 ltt = 2;
  int64 ltq = 3;
  double cp = 4;
}

message MarketLevel {
  repeated Quote bidAskQuote = 1;
}

message MarketOHLC {
  repeated OHLC ohlc = 1;
}

message Quote {
  int64 bidQ = 1;
  double bidP = 2;
  int64 askQ = 3;
  double askP = 4;
}

message OptionGreeks {
  double delta = 1;
  double theta = 2;
  double gamma = 3;
  double vega = 4;
  double rho = 5;
}

message OHLC {
  string interval = 1;
  double open = 2;
  double high = 3;
  double low = 4;
  double close = 5;
  int64 vol = 6;
  int64 ts = 7;
}

enum Type {
  initial_feed = 0;
  live_feed = 1;
  market_info = 2;
}

message MarketFullFeed {
  LTPC ltpc = 1;
  MarketLevel marketLevel = 2;
  OptionGreeks optionGreeks = 3;
  MarketOHLC marketOHLC = 4;
  double atp = 5;
  int64 vtt = 6;
  double oi = 7;
  double iv = 8;
  double tbq = 9;
  double tsq = 10;
}

message IndexFullFeed {
  LTPC ltpc = 1;
  MarketOHLC marketOHLC = 2;
}

message FullFeed {
  oneof FullFeedUnion {
    MarketFullFeed marketFF = 1;
    IndexFullFeed indexFF = 2;
  }
}

message FirstLevelWithGreeks {
  LTPC ltpc = 1;
  Quote firstDepth = 2;
  OptionGreeks optionGreeks = 3;
  int64 vtt = 4;
  double oi = 5;
  double iv = 6;
}

message Feed {
  oneof FeedUnion {
    LTPC ltpc = 1;
    FullFeed ff = 2;
    FirstLevelWithGreeks firstLevelWithGreeks = 3;
  }
  RequestMode requestMode = 4;
}

enum RequestMode {
  ltpc = 0;
  full_d5 = 1;
  option_greeks = 2;
  full_d30 = 3;
}

enum MarketStatus {
  PRE_OPEN_START = 0;
  PRE_OPEN_END = 1;
  NORMAL_OPEN = 2;
  NORMAL_CLOSE = 3;
  CLOSING_START = 4;
  CLOSING_END = 5;
}

message MarketInfo {
  map<string, MarketStatus> segmentStatus = 1;
}

message FeedResponse {
  Type type = 1;
  map<string, Feed> feeds = 2;
  int64 currentTs = 3;
  MarketInfo marketInfo = 4;
}
`;

const INSTRUMENT_KEYS = [
  "NSE_INDEX|Nifty 50",
  "NSE_INDEX|Nifty Bank",
  "BSE_INDEX|SENSEX",
];

const KEY_TO_SYMBOL: Record<
  string,
  "NIFTY" | "BANKNIFTY" | "SENSEX"
> = {
  "NSE_INDEX|Nifty 50": "NIFTY",
  "NSE_INDEX|Nifty Bank": "BANKNIFTY",
  "BSE_INDEX|SENSEX": "SENSEX",
};

/*
  IST market hours guard: Mon–Fri 9:15–15:30
*/

function isMarketOpen(): boolean {
  const now = new Date();

  const ist = new Date(
    now.toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    })
  );

  const day = ist.getDay();

  if (day === 0 || day === 6) return false;

  const mins =
    ist.getHours() * 60 +
    ist.getMinutes();

  return mins >= 555 && mins <= 930;
}

let socketStarted = false;
let frameCount = 0;
let frameCounterInterval: ReturnType<typeof setInterval> | null = null;

export async function startMarketWebSocket() {
  if (socketStarted) return;

  socketStarted = true;

  /*
    Parse protobuf schema inline
  */

  const root = protobuf.parse(PROTO_DEF, {
    keepCase: true,
  }).root;

  const FeedResponse = root.lookupType(
    "com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse"
  );

  /*
    Fetch authorized WebSocket URI from Next.js API
  */

  let authorizedUri: string;

  try {
    const res = await fetch(
      "/api/upstox/ws-auth"
    );

    if (!res.ok) {
      throw new Error(
        `ws-auth returned ${res.status}`
      );
    }

    const data = await res.json();

    authorizedUri =
      data.authorized_redirect_uri;

    if (!authorizedUri) {
      throw new Error(
        "No authorized_redirect_uri in response"
      );
    }
  } catch (err) {
    console.error(
      "Upstox WS Auth Error:",
      err
    );

    socketStarted = false;

    return;
  }

  /*
    Open WebSocket connection
  */

  const ws = new WebSocket(authorizedUri);

  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log("Upstox WS Connected");

    frameCount = 0;

    if (frameCounterInterval) {
      clearInterval(frameCounterInterval);
    }

    frameCounterInterval = setInterval(
      () => {
        console.log(
          `[Upstox WS] frames received in last 10s: ${frameCount}`
        );

        frameCount = 0;
      },
      10000
    );

    const subscribeMsg = {
      guid: "uid",

      method: "sub",

      data: {
        instrumentKeys: INSTRUMENT_KEYS,

        mode: "full",
      },
    };

    console.log(
      "Upstox subscribe →",
      JSON.stringify(subscribeMsg)
    );

    ws.send(JSON.stringify(subscribeMsg));
  };

  ws.onmessage = (
    event: MessageEvent
  ) => {
    if (
      !(event.data instanceof ArrayBuffer)
    ) {
      return;
    }

    frameCount++;

    console.log(
      "Upstox binary frame:",
      event.data.byteLength,
      "bytes"
    );

    /*
      Decode protobuf binary frame and
      convert to plain JS object
    */

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let decoded: any;

    try {
      const message = FeedResponse.decode(
        new Uint8Array(event.data)
      );

      decoded = FeedResponse.toObject(
        message,
        { longs: Number, enums: String, defaults: false }
      );
    } catch (err) {
      console.error(
        "Upstox protobuf decode error:",
        err,
        "bytes:",
        event.data.byteLength
      );

      return;
    }

    console.log(
      "Upstox decoded frame type:",
      decoded?.type,
      "| feed keys:",
      decoded?.feeds
        ? Object.keys(decoded.feeds)
        : "none",
      "| raw:",
      JSON.stringify(decoded)
    );

    if (!decoded?.feeds) {
      return;
    }

    const prices: Partial<
      Record<
        "NIFTY" | "BANKNIFTY" | "SENSEX",
        number
      >
    > = {};

    for (const [key, feedRaw] of Object.entries(
      decoded.feeds as Record<string, unknown>
    )) {
      const symbol = KEY_TO_SYMBOL[key];

      if (!symbol) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feed = feedRaw as any;

      /*
        Index instruments: feeds → key → ff → indexFF → ltpc → ltp
        Equity instruments: feeds → key → ff → marketFF → ltpc → ltp
      */

      const rawLtp: number | null =
        feed?.ff?.indexFF?.ltpc?.ltp ??
        feed?.ff?.marketFF?.ltpc?.ltp ??
        null;

      if (rawLtp == null || rawLtp === 0) {
        console.warn(
          `No LTP for ${key}:`,
          JSON.stringify(feed)
        );

        continue;
      }

      prices[symbol] = Number(
        rawLtp.toFixed(2)
      );
    }

    const nifty = prices.NIFTY;
    const banknifty = prices.BANKNIFTY;
    const sensex = prices.SENSEX;

    /*
      Update live market store
    */

    useLiveMarketStore
      .getState()
      .updateMarket({
        ...(nifty != null && { nifty }),

        ...(banknifty != null && {
          banknifty,
        }),

        ...(sensex != null && { sensex }),
      });

    /*
      Update multi-asset store (price only)
    */

    const multiAsset =
      useMultiAssetStore.getState();

    if (nifty != null) {
      multiAsset.updateAsset("NIFTY", {
        price: nifty,
      });
    }

    if (banknifty != null) {
      multiAsset.updateAsset("BANKNIFTY", {
        price: banknifty,
      });
    }

    if (sensex != null) {
      multiAsset.updateAsset("SENSEX", {
        price: sensex,
      });
    }

    const ts = Date.now();

    /*
      Feed candle builder
    */

    if (nifty != null) {
      processTick(
        { price: nifty, timestamp: ts },
        "NIFTY"
      );
    }

    if (banknifty != null) {
      processTick(
        {
          price: banknifty,
          timestamp: ts,
        },
        "BANKNIFTY"
      );
    }

    if (sensex != null) {
      processTick(
        { price: sensex, timestamp: ts },
        "SENSEX"
      );
    }

    /*
      Update open positions — only during market hours
    */

    if (nifty != null && isMarketOpen()) {
      updateOpenPositions(nifty);
    }

    console.log("Live Tick:", prices);
  };

  ws.onerror = (err) => {
    console.error("Upstox WS Error:", err);
  };

  ws.onclose = () => {
    console.log(
      "Upstox WS Closed, reconnecting in 5s..."
    );

    if (frameCounterInterval) {
      clearInterval(frameCounterInterval);
      frameCounterInterval = null;
    }

    socketStarted = false;

    setTimeout(
      () => startMarketWebSocket(),
      5000
    );
  };
}
