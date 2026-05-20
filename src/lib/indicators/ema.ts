export function calculateEMA(
  prices: number[],
  period = 9
) {
  if (prices.length < period) {
    return prices[
      prices.length - 1
    ];
  }

  const multiplier =
    2 / (period + 1);

  let ema =
    prices
      .slice(0, period)
      .reduce(
        (sum, price) =>
          sum + price,
        0
      ) / period;

  for (
    let i = period;
    i < prices.length;
    i++
  ) {
    ema =
      (prices[i] - ema) *
        multiplier +
      ema;
  }

  return Number(
    ema.toFixed(2)
  );
}