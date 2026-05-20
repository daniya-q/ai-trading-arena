import { Candle } from "@/store/candleStore";

import { calculateATR } from "./liveATR";

export function calculateSupertrend(
  candles: Candle[],
  period = 10,
  multiplier = 3
) {
  if (
    candles.length <
    period + 1
  ) {
    return {
      trend: "NEUTRAL",

      value: 0,
    };
  }

  const atr =
    calculateATR(
      candles,
      period
    );

  const latest =
    candles[
      candles.length - 1
    ];

  const hl2 =
    (latest.high +
      latest.low) /
    2;

  const upperBand =
    hl2 +
    multiplier * atr;

  const lowerBand =
    hl2 -
    multiplier * atr;

  let trend =
    "NEUTRAL";

  let value = hl2;

  if (
    latest.close >
    upperBand
  ) {
    trend = "BULLISH";

    value = lowerBand;
  }

  else if (
    latest.close <
    lowerBand
  ) {
    trend = "BEARISH";

    value = upperBand;
  }

  else {
    trend =
      latest.close > hl2
        ? "BULLISH"
        : "BEARISH";

    value =
      trend ===
      "BULLISH"
        ? lowerBand
        : upperBand;
  }

  return {
    trend,

    value: Number(
      value.toFixed(2)
    ),
  };
}