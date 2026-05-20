import { calculateEMA } from "./ema";

export function calculateMACD(
  prices: number[]
) {
  if (prices.length < 26) {
    return {
      macd: 0,
      signal: 0,
      histogram: 0,
    };
  }

  const ema12 = calculateEMA(
    prices,
    12
  );

  const ema26 = calculateEMA(
    prices,
    26
  );

  const macd =
    ema12 - ema26;

  const signal =
    macd * 0.8;

  const histogram =
    macd - signal;

  return {
    macd: Number(
      macd.toFixed(2)
    ),

    signal: Number(
      signal.toFixed(2)
    ),

    histogram: Number(
      histogram.toFixed(2)
    ),
  };
}