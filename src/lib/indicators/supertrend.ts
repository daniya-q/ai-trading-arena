type Candle = {
  high: number;
  low: number;
  close: number;
};

export function calculateSupertrend(
  candles: Candle[],
  multiplier = 3
) {
  if (candles.length < 2) {
    return {
      trend: "neutral",
      value: 0,
    };
  }

  const latest =
    candles[candles.length - 1];

  const previous =
    candles[candles.length - 2];

  const atr =
    (latest.high -
      latest.low +
      Math.abs(
        latest.high -
          previous.close
      ) +
      Math.abs(
        latest.low -
          previous.close
      )) /
    3;

  const upperBand =
    (latest.high +
      latest.low) /
      2 +
    multiplier * atr;

  const lowerBand =
    (latest.high +
      latest.low) /
      2 -
    multiplier * atr;

  const trend =
    latest.close > upperBand
      ? "bullish"
      : latest.close < lowerBand
      ? "bearish"
      : "neutral";

  return {
    trend,

    value: Number(
      (
        trend === "bullish"
          ? lowerBand
          : upperBand
      ).toFixed(2)
    ),
  };
}