type Candle = {
  open: number;

  high: number;

  low: number;

  close: number;
};

type MarketStructure =
  {
    trend: string;

    breakout: boolean;

    momentum: string;

    support: number;

    resistance: number;

    candleSignal: string;
  };

export function analyzeMarketStructure(
  candles: Candle[]
): MarketStructure {

  if (
    candles.length < 30
  ) {
    return {
      trend: "NEUTRAL",

      breakout: false,

      momentum:
        "NEUTRAL",

      support: 0,

      resistance: 0,

      candleSignal:
        "NONE",
    };
  }

  const recent =
    candles.slice(-20);

  const highs =
    recent.map(
      (c) => c.high
    );

  const lows =
    recent.map(
      (c) => c.low
    );

  const closes =
    recent.map(
      (c) => c.close
    );

  const latest =
    recent[
      recent.length - 1
    ];

  const previous =
    recent[
      recent.length - 2
    ];

  /*
    Support / resistance
  */

  const support =
    Math.min(...lows);

  const resistance =
    Math.max(...highs);

  /*
    Trend
  */

  const firstClose =
    closes[0];

  const lastClose =
    closes[
      closes.length - 1
    ];

  let trend =
    "NEUTRAL";

  if (
    lastClose >
    firstClose * 1.01
  ) {
    trend = "BULLISH";
  }

  if (
    lastClose <
    firstClose * 0.99
  ) {
    trend = "BEARISH";
  }

  /*
    Momentum
  */

  let momentum =
    "WEAK";

  const recentMove =
    Math.abs(
      latest.close -
        previous.close
    );

  if (
    recentMove > 80
  ) {
    momentum =
      "STRONG";
  }

  if (
    recentMove > 150
  ) {
    momentum =
      "EXPLOSIVE";
  }

  /*
    Breakout detection
  */

  const breakout =
    latest.close >
      resistance * 0.998 ||
    latest.close <
      support * 1.002;

  /*
    Candle pattern
  */

  let candleSignal =
    "NONE";

  const body =
    Math.abs(
      latest.close -
        latest.open
    );

  const range =
    latest.high -
    latest.low;

  /*
    Bullish engulfing
  */

  if (
    latest.close >
      latest.open &&
    previous.close <
      previous.open &&
    latest.close >
      previous.open
  ) {
    candleSignal =
      "BULLISH_ENGULFING";
  }

  /*
    Bearish engulfing
  */

  if (
    latest.close <
      latest.open &&
    previous.close >
      previous.open &&
    latest.close <
      previous.open
  ) {
    candleSignal =
      "BEARISH_ENGULFING";
  }

  /*
    Strong impulse candle
  */

  if (
    body / range > 0.7
  ) {
    candleSignal =
      latest.close >
      latest.open
        ? "BULLISH_IMPULSE"
        : "BEARISH_IMPULSE";
  }

  return {
    trend,

    breakout,

    momentum,

    support:
      Number(
        support.toFixed(2)
      ),

    resistance:
      Number(
        resistance.toFixed(
          2
        )
      ),

    candleSignal,
  };
}