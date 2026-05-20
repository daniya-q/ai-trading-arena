import { Candle } from "@/store/candleStore";

export function calculateEMA(
  candles: Candle[],
  period = 20
) {
  if (
    candles.length < period
  ) {
    return 0;
  }

  const closes =
    candles.map(
      (candle) =>
        candle.close
    );

  const multiplier =
    2 / (period + 1);

  let ema =
    closes[0];

  for (
    let i = 1;
    i < closes.length;
    i++
  ) {
    ema =
      (closes[i] -
        ema) *
        multiplier +
      ema;
  }

  return Number(
    ema.toFixed(2)
  );
}