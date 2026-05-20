export function calculateRSI(
  prices: number[],
  period = 14
) {
  if (prices.length < period + 1) {
    return 50;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    const difference =
      prices[i] - prices[i - 1];

    if (difference >= 0) {
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
    averageGain / averageLoss;

  const rsi =
    100 - 100 / (1 + rs);

  return Number(
    rsi.toFixed(2)
  );
}