import { Candle } from "@/store/candleStore";

export function calculateRSI(
  candles: Candle[],
  period = 14
) {
  if (
    candles.length <
    period + 1
  ) {
    return 50;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i =
      candles.length -
      period;
    i <
    candles.length;
    i++
  ) {
    const current =
      candles[i];

    const previous =
      candles[i - 1];

    const difference =
      current.close -
      previous.close;

    if (difference > 0) {
      gains += difference;
    } else {
      losses += Math.abs(
        difference
      );
    }
  }

  const averageGain =
    gains / period;

  const averageLoss =
    losses / period;

  if (averageLoss === 0) {
    return 100;
  }

  const rs =
    averageGain /
    averageLoss;

  const rsi =
    100 -
    100 / (1 + rs);

  return Number(
    rsi.toFixed(2)
  );
}