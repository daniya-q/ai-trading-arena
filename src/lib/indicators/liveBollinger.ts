import { Candle } from "@/store/candleStore";

export function calculateBollingerBands(
  candles: Candle[],
  period = 20,
  multiplier = 2
) {
  if (
    candles.length < period
  ) {
    return {
      upper: 0,

      middle: 0,

      lower: 0,
    };
  }

  const closes =
    candles
      .slice(-period)
      .map(
        (candle) =>
          candle.close
      );

  /*
    SMA
  */

  const mean =
    closes.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / period;

  /*
    Standard deviation
  */

  const variance =
    closes.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) / period;

  const standardDeviation =
    Math.sqrt(variance);

  const upper =
    mean +
    standardDeviation *
      multiplier;

  const lower =
    mean -
    standardDeviation *
      multiplier;

  return {
    upper: Number(
      upper.toFixed(2)
    ),

    middle: Number(
      mean.toFixed(2)
    ),

    lower: Number(
      lower.toFixed(2)
    ),
  };
}